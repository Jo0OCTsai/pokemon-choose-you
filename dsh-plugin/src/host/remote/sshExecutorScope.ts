/**
 * 远端执行脚本组装 + DispatchExecutor 的 SshScope 家族链实现（从 sshExecutor.ts 拆出——
 * 棘轮 max-lines，等量迁移；sshExecutor.ts 为统一再出口，消费面不变）。
 *
 * 超时 = 本机竞态计时 + scope.timeoutMs 双保险（超时置失败记因 DISPTACH_TIMEOUT 语义
 * 由 headlessRun 收口层承载）；断连/传输错误以 error outcome 收场（不抛错——
 * DispatchExecutor 契约）。可执行解析族已拆 sshExecutorResolve.ts（等量迁移）——
 * 再出口保消费面；执行面经用户登录 shell（ssh 会话同环境）。
 */
import { DISPATCH_MIN_TIMEOUT_SECS } from "../domain/dispatch-slots";
import { cdSegment, posixQuote } from "../dispatch/cmdline";
import type { DispatchExecutor, DispatchJob, ExecOutcome } from "../dispatch/executor";
import { buildLocalArgv, effectiveTimeoutSecs } from "../dispatch/executor";
import type { SshScope } from "./sshScope";
import {
  loginShellFlags,
  loginShellOf,
  REMOTE_PATH_BOOTSTRAP,
  resolveRemoteExecutable,
  type ResolvedRemoteCli,
} from "./sshExecutorResolve";

// 可执行解析族（等量迁移至 sshExecutorResolve.ts）——再出口保消费面
export {
  classifyRemoteCliHead,
  loginShellProbeCommand,
  REMOTE_PATH_BOOTSTRAP,
  type RemoteCliInterpreter,
  type ResolvedRemoteCli,
} from "./sshExecutorResolve";

// ---- 远端命令组装（引号全量引用——NFR-11④；prompt 无占位走 stdin 管道） ----

/**
 * 远端执行脚本组装（经用户登录 shell 执行——ssh 会话同环境）：PATH 兜底 + env 导出 +
 * cd 生效目录 + 收口段。exec 定位直替换（超时 kill 直达 agent 进程）；登录 shell 名
 * 形态（函数/别名封装）不 exec——shell 函数不可 exec，末命令退出码经登录 shell 传播
 * （kill 面到 shell，其子进程收尾可能迟滞）。逐 token posixQuote——不可信 prompt
 * 定界正文不裸拼（NFR-11④）。直连降级链共用。
 */
export function remoteDispatchScript(
  job: DispatchJob,
  cli: ResolvedRemoteCli,
  opts: { nodePath: string },
): { script: string; stdin: string | null } {
  const { argv, stdin } = buildLocalArgv(job);
  const parts: string[] = [];
  // PATH 兜底先于 agent 进程（REMOTE_PATH_BOOTSTRAP 单源）：pk shim 在远端 ~/.local/bin，
  // agent 白名单只放行 pk——找不到时无法自救查路径；登录 shell 环境下幂等无害
  parts.push(REMOTE_PATH_BOOTSTRAP);
  for (const [key, value] of Object.entries(job.env ?? {})) {
    parts.push(`export ${key}=${posixQuote(value)}`);
  }
  if (job.workdir !== null && job.workdir !== undefined && job.workdir.trim() !== "") {
    parts.push(`${cdSegment(job.workdir)} || exit 1`);
  }
  if (cli.mode === "shell") {
    parts.push([cli.name, ...argv].map(posixQuote).join(" "));
  } else {
    const head = cli.interpreter === "node" ? [opts.nodePath, cli.path] : [cli.path];
    parts.push(`exec ${[...head, ...argv].map(posixQuote).join(" ")}`);
  }
  return { script: parts.join("; "), stdin };
}

// ---- DispatchExecutor：SshScope 家族链实现 ----

/** 超时判定余量（远端 abort 收口与本机竞态计时的对齐容差，ms） */
const TIMEOUT_GRACE_MS = 500;

/**
 * 远端无头执行器（消费 SshScope.spawn）：见文件头。kill 即刻收口在途 launch
 * （远端清理由 scope.timeoutMs 语义承载）。
 */
export function createSshDispatchExecutor(input: {
  scopeFor: () => Promise<SshScope | null>;
  nodePath: string;
  label: string;
  minTimeoutSecs?: number;
}): DispatchExecutor {
  const executableCache = new Map<string, ResolvedRemoteCli | null>();
  const loginShellCache = new Map<string, string>();
  const state = { killed: false };
  /** 在途 launch 的中止面（kill 即刻收口；远端清理由 scope.timeoutMs 语义承载） */
  const pending = new Set<() => void>();
  return {
    kill() {
      state.killed = true;
      for (const abort of [...pending]) {
        abort();
      }
    },
    launch(job) {
      return launchOverScope(job, input, executableCache, loginShellCache, state, pending);
    },
  };
}

/** scope.spawn 结果的竞态联合：正常 / 传输错误 / 超时或 kill（null） */
type ScopedSpawnOutcome = import("./sshScope").SshSpawnResult | { transportError: string } | null;

/** 执行面 shell argv：登录 shell（[<shell>, -l, -c]——ssh 会话同环境；/bin/sh 退化无 -l——loginShellFlags 单源） */
function shellArgvFor(loginShell: string): string[] {
  return [loginShell, ...loginShellFlags(loginShell), "-c"];
}

/** scope.spawn + 本机竞态计时/中止面的赛跑（kill/超时 = null + timedOut 置位） */
async function raceScopedSpawn(
  scope: SshScope,
  shellArgv: string[],
  script: string,
  stdin: string | null,
  timeoutMs: number,
  pending: Set<() => void>,
): Promise<{ result: ScopedSpawnOutcome; timedOut: boolean }> {
  // 传输层拒绝转值形态（race 不抛）；远端进程清理由 scope.timeoutMs（AbortSignal）承载
  const guarded = scope.spawn([...shellArgv, script], { timeoutMs, ...(stdin === null ? {} : { stdin }) }).then(
    (result): ScopedSpawnOutcome => result,
    (error: unknown): ScopedSpawnOutcome => ({ transportError: String(error).slice(0, 200) }),
  );
  let timedOut = false;
  let settled = false;
  const giveUp = (): void => {
    if (settled) {
      return;
    }
    settled = true;
    timedOut = true;
  };
  let timer: NodeJS.Timeout | undefined;
  let abort: (() => void) | undefined;
  const result: ScopedSpawnOutcome = await Promise.race([
    guarded,
    new Promise<null>((resolve) => {
      abort = () => {
        giveUp();
        resolve(null);
      };
      pending.add(abort);
      timer = setTimeout(() => {
        giveUp();
        resolve(null);
      }, timeoutMs);
    }),
  ]).finally(() => {
    clearTimeout(timer);
    if (abort !== undefined) {
      pending.delete(abort);
    }
  });
  return { result, timedOut };
}

/** 竞态结果 → ExecOutcome 收口（超时 / 传输错误 / 信号终止三分支） */
function scopedOutcomeToExec(
  result: ScopedSpawnOutcome,
  timedOut: boolean,
  durationMs: number,
  timeoutMs: number,
  label: string,
): ExecOutcome {
  if (timedOut) {
    return { exitCode: null, durationMs, stdout: "", timedOut: true };
  }
  if (result === null) {
    return { exitCode: null, durationMs, stdout: "", timedOut: true };
  }
  if ("transportError" in result) {
    return {
      exitCode: null,
      durationMs,
      stdout: "",
      timedOut: false,
      error: `远端执行通道故障（部署 ${label}）：${result.transportError}`,
    };
  }
  // scope abort 与本机计时同阈竞态：code 丢失且耗时贴阈 → 按超时收口
  if (result.code === null && durationMs >= timeoutMs - TIMEOUT_GRACE_MS) {
    return { exitCode: null, durationMs, stdout: result.stdout, timedOut: true };
  }
  if (result.code === null) {
    return {
      exitCode: null,
      durationMs,
      stdout: result.stdout,
      timedOut: false,
      error: `远端进程被信号终止或连接中断（部署 ${label}）：${result.stderr.slice(0, 160)}`,
    };
  }
  return { exitCode: result.code, durationMs, stdout: result.stdout, stderr: result.stderr, timedOut: false };
}

async function launchOverScope(
  job: DispatchJob,
  input: { scopeFor: () => Promise<SshScope | null>; nodePath: string; label: string; minTimeoutSecs?: number },
  executableCache: Map<string, ResolvedRemoteCli | null>,
  loginShellCache: Map<string, string>,
  state: { killed: boolean },
  pending: Set<() => void>,
): Promise<ExecOutcome> {
  const started = Date.now();
  const duration = (): number => Date.now() - started;
  try {
    if (state.killed) {
      return { exitCode: null, durationMs: 0, stdout: "", timedOut: true };
    }
    const scope = await input.scopeFor();
    if (scope === null || !scope.connected) {
      return {
        exitCode: null,
        durationMs: duration(),
        stdout: "",
        timedOut: false,
        error: `远端连接不可用（部署 ${input.label}）——派发置失败，恢复后可重派`,
      };
    }
    const loginShell = await loginShellOf(scope, loginShellCache);
    const cli = await resolveRemoteExecutable(scope, job.command, executableCache, loginShell);
    if ("error" in cli) {
      return { exitCode: null, durationMs: duration(), stdout: "", timedOut: false, error: cli.error };
    }
    const { script, stdin } = remoteDispatchScript(job, cli, { nodePath: input.nodePath });
    const timeoutMs = effectiveTimeoutSecs(job.timeoutSecs, input.minTimeoutSecs ?? DISPATCH_MIN_TIMEOUT_SECS) * 1000;
    const { result, timedOut } = await raceScopedSpawn(
      scope,
      shellArgvFor(loginShell),
      script,
      stdin,
      timeoutMs,
      pending,
    );
    return scopedOutcomeToExec(result, timedOut, duration(), timeoutMs, input.label);
  } catch (error) {
    return {
      exitCode: null,
      durationMs: duration(),
      stdout: "",
      timedOut: false,
      error: `远端执行异常（部署 ${input.label}）：${String(error).slice(0, 200)}`,
    };
  }
}
