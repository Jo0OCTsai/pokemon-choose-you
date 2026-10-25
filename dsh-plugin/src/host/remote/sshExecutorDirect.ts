/**
 * 直连降级链 DispatchExecutor + ShellRunner 远端实现（从 sshExecutor.ts 拆出——
 * 棘轮 max-lines，等量迁移；sshExecutor.ts 为统一再出口，消费面不变）。
 *
 * 直连降级（D31）：家族缺失/降级标记的兜底——经本机 ssh 二进制把同款组装脚本送到
 * 目标执行（BatchMode 免密；execFile timeout 超时 kill）。env 导出经脚本 export
 * 承载（plain ssh 不转发本机环境）。ShellRunner（FR-RD5）：家族链 scope.shell /
 * 直连 ssh 二进制两形态，worktree 同款脚本在远端跑。
 */
import { execFile } from "node:child_process";
import { DISPATCH_MIN_TIMEOUT_SECS } from "../domain/dispatch-slots";
import type { DispatchExecutor, ExecOutcome } from "../dispatch/executor";
import { effectiveTimeoutSecs } from "../dispatch/executor";
import type { ShellRunner } from "../dispatch/worktree";
import { SSH_CONNECT_TIMEOUT_SECS, sshConnectArgs } from "../dispatch/sshCheck";
import { remoteDispatchScript } from "./sshExecutorScope";
import type { SshScope } from "./sshScope";

/** execFile 回调错误形态（exit code / killed） */
type ExecFileError = (NodeJS.ErrnoException & { code?: number | string; killed?: boolean }) | null;

/**
 * 直连降级执行器（家族缺失/降级标记的兜底）：不解析远端可执行——agent 命令需为
 * 远端绝对路径；解释形态固定 node 前缀（本链无驻留连接做头部分类探测，原生二进制
 * CLI 场景见 docs/debt.md）；超时由 execFile timeout kill 承载（无常驻句柄）。
 */
export function createDirectSshExecutor(input: {
  target: string;
  nodePath: string;
  label: string;
  minTimeoutSecs?: number;
  sshBin?: string;
  connectTimeoutSecs?: number;
}): DispatchExecutor {
  const executableHint = "直连降级链不解析远端可执行——agent 命令需为远端绝对路径";
  return {
    kill() {
      // 一次性 execFile 无常驻句柄；超时由 execFile timeout kill 承载
    },
    async launch(job) {
      const started = Date.now();
      const duration = (): number => Date.now() - started;
      const cli = job.command.trim();
      if (cli === "" || !cli.startsWith("/")) {
        return { exitCode: null, durationMs: duration(), stdout: "", timedOut: false, error: executableHint };
      }
      const timeoutMs = effectiveTimeoutSecs(job.timeoutSecs, input.minTimeoutSecs ?? DISPATCH_MIN_TIMEOUT_SECS) * 1000;
      // 直连链经系统 ssh：sshd 按用户登录 shell 起会话（env 同源），node 前缀固定形态
      // 维持既有口径（见 docs/debt.md 直连降级链条目）
      const { script, stdin } = remoteDispatchScript(
        job,
        { mode: "exec", path: cli, interpreter: "node" },
        { nodePath: input.nodePath },
      );
      const argv = [
        ...sshConnectArgs(input.target, input.connectTimeoutSecs ?? SSH_CONNECT_TIMEOUT_SECS),
        "--",
        parseSshHost(input.target),
        script,
      ];
      return await execOverSshBinary(input.sshBin ?? "ssh", argv, timeoutMs, stdin, duration);
    },
  };
}

/** execFile 直连执行收口（超时 kill / stdin 管道；错误与退出码转 ExecOutcome 值形态） */
function execOverSshBinary(
  bin: string,
  argv: string[],
  timeoutMs: number,
  stdin: string | null,
  duration: () => number,
): Promise<ExecOutcome> {
  return new Promise<ExecOutcome>((resolve) => {
    const child = execFile(bin, argv, { timeout: timeoutMs, killSignal: "SIGKILL" }, (error, stdout, stderr) => {
      const err = error as ExecFileError;
      const timedOut = err !== null && err.killed === true;
      resolve({
        exitCode: err === null ? 0 : typeof err.code === "number" ? err.code : null,
        durationMs: duration(),
        stdout: String(stdout),
        stderr: String(stderr),
        timedOut,
        ...(timedOut || err === null ? {} : { error: `ssh 直连执行失败：${String(stderr).slice(0, 160)}` }),
      });
    });
    if (stdin !== null) {
      child.stdin?.on("error", () => undefined); // 子进程不读 stdin（EPIPE）不视为失败
      child.stdin?.end(stdin);
    }
  });
}

/** [user@]host[:port] → ssh 主机参数（端口已由 sshConnectArgs 以 -p 承载） */
function parseSshHost(target: string): string {
  const t = target.trim();
  const portMatch = /:(\d+)$/.exec(t);
  return portMatch !== null ? t.slice(0, portMatch.index) : t;
}

// ---- ShellRunner 远端实现（worktree 脚本远端跑——FR-RD5） ----

/** SshScope 版 ShellRunner（家族链：脚本经 scope.shell 在远端 /bin/sh 执行） */
export function scopeShellRunner(scopeFor: () => Promise<SshScope | null>): ShellRunner {
  return async (script) => {
    let scope: SshScope | null = null;
    try {
      scope = await scopeFor();
    } catch (error) {
      return { ok: false, stdout: "", stderr: `远端连接建立失败：${String(error).slice(0, 120)}` };
    }
    if (scope === null || !scope.connected) {
      return { ok: false, stdout: "", stderr: "远端连接不可用（免密未配置或已断开）" };
    }
    try {
      const result = await scope.shell(script);
      return { ok: result.code === 0, stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      return { ok: false, stdout: "", stderr: String(error).slice(0, 160) };
    }
  };
}

/** 直连降级版 ShellRunner（经本机 ssh 二进制执行；worktree 同款脚本在远端跑） */
export function directSshRunner(
  target: string,
  opts: { sshBin?: string; connectTimeoutSecs?: number } = {},
): ShellRunner {
  const connectTimeoutSecs = opts.connectTimeoutSecs ?? SSH_CONNECT_TIMEOUT_SECS;
  return (script) =>
    new Promise((resolve) => {
      execFile(
        opts.sshBin ?? "ssh",
        [...sshConnectArgs(target, connectTimeoutSecs), "--", parseSshHost(target), script],
        { timeout: 30_000, killSignal: "SIGKILL" },
        (error, stdout, stderr) => {
          const err = error as ExecFileError;
          resolve({
            ok: err === null,
            stdout: String(stdout),
            stderr: String(stderr !== "" && stderr !== undefined ? stderr : (err?.message ?? "")),
          });
        },
      );
    });
}
