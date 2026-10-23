/**
 * 远端命令组装 + DispatchExecutor 的 SshScope 家族链实现（从 sshExecutor.ts 拆出——
 * 棘轮 max-lines，等量迁移；sshExecutor.ts 为统一再出口，消费面不变）。
 *
 * 超时 = 本机竞态计时 + scope.timeoutMs 双保险（超时置失败记因 DISPTACH_TIMEOUT 语义
 * 由 headlessRun 收口层承载）；断连/传输错误以 error outcome 收场（不抛错——
 * DispatchExecutor 契约）。可执行解析缓存按实例。
 */
import { DISPATCH_MIN_TIMEOUT_SECS } from "../domain/dispatch-slots";
import { cdSegment, posixQuote } from "../dispatch/cmdline";
import type { DispatchExecutor, DispatchJob, ExecOutcome } from "../dispatch/executor";
import { buildLocalArgv, effectiveTimeoutSecs } from "../dispatch/executor";
import type { SshScope } from "./sshScope";

// ---- 远端命令组装（引号全量引用——NFR-11④；prompt 无占位走 stdin 管道） ----

/** CLI 解释形态：node 前缀（node 脚本型 CLI）/ 直执行（原生二进制与其他解释器） */
export type RemoteCliInterpreter = "node" | "direct";

/**
 * CLI 头部（前 64 字节）→ 解释形态：ELF 原生二进制与其他解释器 shebang 直执行，
 * node shebang 与无 shebang 的 JS 入口走 node 前缀（缺省口径）。回归背景：claude-code
 * ≥2.x npm 发行把 bin 符号链接指向平台原生二进制（bin/claude.exe，ELF），node 直载
 * 在 type:module 包上按扩展名抛 ERR_UNKNOWN_FILE_EXTENSION——远端判定/派发全线退出码 1。
 */
export function classifyRemoteCliHead(head: string): RemoteCliInterpreter {
  if (head.startsWith("\u007fELF")) {
    return "direct";
  }
  if (!head.startsWith("#!")) {
    return "node";
  }
  const firstLine = head.split("\n", 1)[0] ?? "";
  return firstLine.split(/\s+/).some((t) => (t.split("/").pop() ?? "").startsWith("node")) ? "node" : "direct";
}

/**
 * 远端可执行解析（dsh-subprocess-ssh 语义：绝对路径校验）：显式路径必须是绝对路径；
 * 裸名经远端 `command -v` 探测，随后 `head -c 64` 读头部分类解释形态（结果按执行器
 * 实例缓存）。返回 error 文案 = 启动失败。
 */
async function resolveRemoteExecutable(
  scope: SshScope,
  command: string,
  cache: Map<string, { path: string; interpreter: RemoteCliInterpreter } | null>,
): Promise<{ path: string; interpreter: RemoteCliInterpreter } | { error: string }> {
  const cmd = command.trim();
  if (cmd === "") {
    return { error: "agent 命令为空" };
  }
  if (cmd.includes("/") && !cmd.startsWith("/")) {
    return { error: `agent 命令含路径分隔符但非绝对路径：${cmd}（远端执行世界需绝对路径）` };
  }
  if (!cache.has(cmd)) {
    const path = cmd.includes("/") ? cmd : await probeCommandPath(scope, cmd);
    cache.set(cmd, path === null ? null : { path, interpreter: await probeCliInterpreter(scope, path) });
  }
  const hit = cache.get(cmd) ?? null;
  return hit === null
    ? {
        error: `远端找不到命令 ${cmd}（command -v 无结果）——确认 agent CLI 已安装在部署上，或在 agent 配置改填绝对路径`,
      }
    : hit;
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

/** CLI 头部单次读取分类（head 缺席/不可读/通道故障 → node 前缀缺省——既有口径不回退成新失败） */
async function probeCliInterpreter(scope: SshScope, path: string): Promise<RemoteCliInterpreter> {
  try {
    const probe = await scope.shell(`head -c 64 ${posixQuote(path)}`);
    return probe.code === 0 ? classifyRemoteCliHead(probe.stdout) : "node";
  } catch {
    return "node";
  }
}

/**
 * 远端执行脚本组装：CLI 形态决定解释面（node 脚本型 = 部署 nodePath 前缀承载运行时，
 * 与远端 helper 同源；原生二进制/其他解释器 = 直执行）+ 参数（{prompt} 占位替换；无占位
 * 走 stdin 管道，prompt 不上命令行）；env 导出 + cd 生效目录 + exec 收口（退出码直达）。
 * 逐 token posixQuote——不可信 prompt 定界正文不裸拼（NFR-11④）。直连降级链共用。
 */
export function remoteDispatchScript(
  job: DispatchJob,
  cliPath: string,
  opts: { nodePath: string; interpreter: RemoteCliInterpreter },
): { script: string; stdin: string | null } {
  const { argv, stdin } = buildLocalArgv(job);
  const parts: string[] = [];
  // agent Bash 工具环境的 PATH 兜底：pk shim 固定落远端 ~/.local/bin（run_setup PATH 步
  // 同源），而 helper spawn 链的非登录 shell PATH 可能缺它——agent 曾因 pk 找不到
  // （command not found 127）致探针/判定失败（白名单只放行 pk，agent 无法自救查路径）
  parts.push('export PATH="$HOME/.local/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}"');
  for (const [key, value] of Object.entries(job.env ?? {})) {
    parts.push(`export ${key}=${posixQuote(value)}`);
  }
  if (job.workdir !== null && job.workdir !== undefined && job.workdir.trim() !== "") {
    parts.push(`${cdSegment(job.workdir)} || exit 1`);
  }
  const head = opts.interpreter === "node" ? [opts.nodePath, cliPath] : [cliPath];
  parts.push(`exec ${[...head, ...argv].map(posixQuote).join(" ")}`);
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
  const executableCache = new Map<string, { path: string; interpreter: RemoteCliInterpreter } | null>();
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
  return { exitCode: result.code, durationMs, stdout: result.stdout, stderr: result.stderr, timedOut: false };
}

async function launchOverScope(
  job: DispatchJob,
  input: { scopeFor: () => Promise<SshScope | null>; nodePath: string; label: string; minTimeoutSecs?: number },
  executableCache: Map<string, { path: string; interpreter: RemoteCliInterpreter } | null>,
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
    const { script, stdin } = remoteDispatchScript(job, executable.path, {
      nodePath: input.nodePath,
      interpreter: executable.interpreter,
    });
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
