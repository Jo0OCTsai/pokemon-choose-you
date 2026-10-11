/**
 * 远程 deployment 免密预检（SSH_AUTH_REQUIRED）：`ssh -o BatchMode=yes
 * -o ConnectTimeout=10 <target> true` 连通探测——密钥不通直接失败不挂起等密码
 * （BatchMode 语义）。hostKey 归一复用 domain/dispatch-slots 口径。
 *
 * 探测执行器可注入：生产走真实 ssh（真实 dsh SSH provider 装配后可替换为平台
 * provider）；测试注入 fake 探测脚本（成功 / 失败 / 超时）。
 */
import { execFile } from "node:child_process";
import { PkyError, type PkyErrorShape } from "../storage/errors";

/** 预检连接超时（秒，与主应用 SSH 连接参数同值） */
export const SSH_CONNECT_TIMEOUT_SECS = 10;

/** 探测结果（exit 0 = 免密连通） */
export interface SshProbeResult {
  code: number | null;
  stderr: string;
}

/** 探测执行器（argv 不含 ssh 程序名；注入 fake 供测试） */
export type SshProbeRunner = (argv: string[], opts: { timeoutMs: number }) => Promise<SshProbeResult>;

export function sshCheckErrorShape(target: string, stderr: string): PkyErrorShape {
  return new PkyError(
    "SSH_AUTH_REQUIRED",
    `SSH 免密预检失败（${target}）：${stderr.slice(0, 160)}`,
    "先在 dsh 侧完成 deployment 的免密配置（ssh-copy-id / 密钥加入 agent），或改用本机路由",
  ).toShape();
}

/**
 * 探测执行器工厂：child_process 跑 ssh（BatchMode + ConnectTimeout + 整体超时兜底）。
 * sshBin 注入点 = 测试用 fake ssh 探测脚本（成功/失败脚本）驱动真实子进程路径；
 * 生产缺省系统 ssh（真实 dsh SSH provider 装配后可整体替换 probe）。
 */
export function systemSshProbe(sshBin = "ssh"): SshProbeRunner {
  return (argv, { timeoutMs }) =>
    new Promise((resolve) => {
      execFile(sshBin, argv, { timeout: timeoutMs, killSignal: "SIGKILL" }, (error, _stdout, stderr) => {
        const err = error as (NodeJS.ErrnoException & { code?: number | string }) | null;
        resolve({
          code: err === null ? 0 : typeof err.code === "number" ? err.code : 1,
          stderr: String(stderr !== "" && stderr !== undefined ? stderr : (err?.message ?? "")),
        });
      });
    });
}

/** 缺省探测执行器（系统 ssh） */
export const defaultSshProbe: SshProbeRunner = systemSshProbe();

/** 解析 [user@]host[:port] 连接目标（端口 → -p；user@host[:port] 整体作 ssh 目标） */
export function sshProbeArgv(target: string, connectTimeoutSecs = SSH_CONNECT_TIMEOUT_SECS): string[] {
  const t = target.trim();
  const portMatch = /:(\d+)$/.exec(t);
  const hostPart = portMatch !== null ? t.slice(0, portMatch.index) : t;
  const argv = ["-o", "BatchMode=yes", "-o", `ConnectTimeout=${connectTimeoutSecs}`];
  if (portMatch !== null) {
    argv.push("-p", portMatch[1]);
  }
  argv.push("--", hostPart, "true");
  return argv;
}

export type SshCheckOutcome = { ok: true } | { ok: false; error: PkyErrorShape };

/**
 * 免密预检：exit 0 → ok；非 0 / 探测超时 → SSH_AUTH_REQUIRED（AD §4.1.1 错误码表）。
 * 探测器缺省走系统 ssh；deployment 路由派发（交互/无头）前调用。
 */
export async function sshCheck(
  target: string,
  opts: { probe?: SshProbeRunner; connectTimeoutSecs?: number } = {},
): Promise<SshCheckOutcome> {
  const connectTimeoutSecs = opts.connectTimeoutSecs ?? SSH_CONNECT_TIMEOUT_SECS;
  const probe = opts.probe ?? defaultSshProbe;
  const argv = sshProbeArgv(target, connectTimeoutSecs);
  // ConnectTimeout 只管 TCP 建连；整体超时兜底（连接后的认证挂起等）
  const result = await probe(argv, { timeoutMs: (connectTimeoutSecs + 5) * 1000 });
  if (result.code === 0) {
    return { ok: true };
  }
  return { ok: false, error: sshCheckErrorShape(target, result.stderr) };
}
