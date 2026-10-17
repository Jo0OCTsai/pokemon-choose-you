/**
 * 远端命令组装 + DispatchExecutor 的 SshScope 家族链实现（从 sshExecutor.ts 拆出——
 * 棘轮 max-lines，等量迁移；sshExecutor.ts 为统一再出口，消费面不变）。
 *
 * 超时 = 本机竞态计时 + scope.timeoutMs 双保险（超时置失败记因 DISPTACH_TIMEOUT 语义
 * 由 headlessRun 收口层承载）；断连/传输错误以 error outcome 收场（不抛错——
 * DispatchExecutor 契约）。可执行解析缓存按实例。
 */
import { DISPATCH_MIN_TIMEOUT_SECS } from "../domain/dispatch-slots";
import { posixQuote } from "../dispatch/cmdline";
import type { DispatchExecutor, DispatchJob, ExecOutcome } from "../dispatch/executor";
import { buildLocalArgv, effectiveTimeoutSecs } from "../dispatch/executor";
import type { SshScope } from "./sshScope";

// ---- 远端命令组装（引号全量引用——NFR-11④；prompt 无占位走 stdin 管道） ----

/**
 * 远端可执行解析（dsh-subprocess-ssh 语义：绝对路径校验）：显式路径必须是绝对路径；
 * 裸名经远端 `command -v` 探测（结果按执行器实例缓存）。返回 error 文案 = 启动失败。
 */
async function resolveRemoteExecutable(
  scope: SshScope,
  command: string,
  cache: Map<string, string | null>,
): Promise<{ path: string } | { error: string }> {
  const cmd = command.trim();
  if (cmd === "") {
    return { error: "agent 命令为空" };
  }
  if (cmd.includes("/")) {
    return cmd.startsWith("/")
      ? { path: cmd }
      : { error: `agent 命令含路径分隔符但非绝对路径：${cmd}（远端执行世界需绝对路径）` };
  }
  if (!cache.has(cmd)) {
    cache.set(cmd, await probeCommandPath(scope, cmd));
  }
  const hit = cache.get(cmd) ?? null;
  return hit === null
    ? {
        error: `远端找不到命令 ${cmd}（command -v 无结果）——确认 agent CLI 已安装在部署上，或在 agent 配置改填绝对路径`,
      }
    : { path: hit };
}

/** 远端 `command -v` 单次探测（通道故障与找不到同归 null——launch 失败文案给指引） */
async function probeCommandPath(scope: SshScope, cmd: string): Promise<string | null> {
  try {
    const probe = await scope.shell(`command -v ${posixQuote(cmd)}`);
    const hit = probe.code === 0 ? (probe.stdout.trim().split(/\s+/)[0] ?? "") : "";
    return hit.startsWith("/") ? hit : null;
  } catch {
    return null;
  }
}

/**
 * 远端执行脚本组装：node 前缀（部署 nodePath 承载 node 脚本型 agent CLI 的运行时，
 * 与远端 helper 同源）+ 解析后的 agent CLI + 参数（{prompt} 占位替换；无占位走 stdin
 * 管道，prompt 不上命令行）；env 导出 + cd 生效目录 + exec 收口（退出码直达）。
 * 逐 token posixQuote——不可信 prompt 定界正文不裸拼（NFR-11④）。直连降级链共用。
 */
export function remoteDispatchScript(
  job: DispatchJob,
  nodePath: string,
  cliPath: string,
): { script: string; stdin: string | null } {
  const { argv, stdin } = buildLocalArgv(job);
  const parts: string[] = [];
  for (const [key, value] of Object.entries(job.env ?? {})) {
    parts.push(`export ${key}=${posixQuote(value)}`);
  }
  if (job.workdir !== null && job.workdir !== undefined && job.workdir.trim() !== "") {
    parts.push(`cd ${posixQuote(job.workdir.trim())} || exit 1`);
  }
  parts.push(`exec ${[nodePath, cliPath, ...argv].map(posixQuote).join(" ")}`);
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
  const executableCache = new Map<string, string | null>();
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
      return launchOverScope(job, input, executableCache, state, pending);
    },
  };
}

/** scope.spawn 结果的竞态联合：正常 / 传输错误 / 超时或 kill（null） */
type ScopedSpawnOutcome = import("./sshScope").SshSpawnResult | { transportError: string } | null;

/** scope.spawn + 本机竞态计时/中止面的赛跑（kill/超时 = null + timedOut 置位） */
async function raceScopedSpawn(
  scope: SshScope,
  script: string,
  stdin: string | null,
  timeoutMs: number,
  pending: Set<() => void>,
): Promise<{ result: ScopedSpawnOutcome; timedOut: boolean }> {
  // 传输层拒绝转值形态（race 不抛）；远端进程清理由 scope.timeoutMs（AbortSignal）承载
  const guarded = scope.spawn(["/bin/sh", "-c", script], { timeoutMs, ...(stdin === null ? {} : { stdin }) }).then(
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
  return { exitCode: result.code, durationMs, stdout: result.stdout, timedOut: false };
}

async function launchOverScope(
  job: DispatchJob,
  input: { scopeFor: () => Promise<SshScope | null>; nodePath: string; label: string; minTimeoutSecs?: number },
  executableCache: Map<string, string | null>,
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
    const executable = await resolveRemoteExecutable(scope, job.command, executableCache);
    if ("error" in executable) {
      return { exitCode: null, durationMs: duration(), stdout: "", timedOut: false, error: executable.error };
    }
    const { script, stdin } = remoteDispatchScript(job, input.nodePath, executable.path);
    const timeoutMs = effectiveTimeoutSecs(job.timeoutSecs, input.minTimeoutSecs ?? DISPATCH_MIN_TIMEOUT_SECS) * 1000;
    const { result, timedOut } = await raceScopedSpawn(scope, script, stdin, timeoutMs, pending);
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
