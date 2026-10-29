/**
 * pk 自持 ssh 编排底座（对齐 remote_pk.rs 的 ssh_run / keyscan 调用面）：pk 是独立
 * CLI，不依赖 host 侧 SshScope 家族链（setup 阶段远端 family 未 provision）。
 * PK_SSH_BIN 可覆盖 ssh 程序（agent 调用同一套覆盖）。
 */
import { spawnSync } from "node:child_process";

export interface SshCtx {
  /** ssh 客户端程序名/路径 */
  sshProgram: string;
  /** ssh-keyscan 程序名/路径 */
  keyscanProgram: string;
  /** SSH 目标（OpenSSH 别名或 user@host） */
  host: string;
  /** 显式端口（0 = 不传，凭 ~/.ssh/config） */
  sshPort: number;
  /** 显式私钥（空 = 走 ssh 默认） */
  agentKey: string | null;
  /** 单步 ssh 的整体超时毫秒（ConnectTimeout 只管 TCP 握手；认证后远端卡住需整体兜底） */
  stepTimeoutMs: number;
}

/** PK_SSH_BIN 覆盖后的 ssh 程序名（ai::ssh_bin 同构） */
export function sshBin(): string {
  const v = process.env.PK_SSH_BIN;
  return v !== undefined && v.trim() !== "" ? v.trim() : "ssh";
}

/** ssh 到远程执行一行命令；stdin 有内容则写入（远程 `cat >` 接收）。
 * 返回 [成功?, stdout+stderr 合并摘要]。BatchMode 免交互，连接超时 10 秒；
 * 整体超时到期 kill（spawnSync timeout 语义与 Rust try_wait 轮询兜底一致） */
export function sshRun(
  ctx: SshCtx,
  extra: readonly string[],
  remoteLine: string,
  stdin: string | null,
): [boolean, string] {
  const out = spawnSync(ctx.sshProgram, sshArgs(ctx, extra, remoteLine), {
    input: stdin ?? undefined,
    encoding: "utf8",
    timeout: ctx.stepTimeoutMs,
    killSignal: "SIGKILL",
  });
  if (out.error) {
    if (out.error.message.includes("TIMED_OUT")) {
      return [
        false,
        `超过 ${Math.round(ctx.stepTimeoutMs / 1000)} 秒未完成——远端 ssh 会话挂起（网络/转发通道可能卡死）`,
      ];
    }
    return [false, `无法启动 ssh（${out.error.message}）`];
  }
  if (out.status === 0) {
    return [true, (out.stdout ?? "").trim()];
  }
  const err = (out.stderr ?? "").trim();
  return [false, err === "" ? `退出码 ${out.status ?? -1}` : err];
}

/** ssh-keyscan 本机 sshd（只扫端口不认证；取 host key 指纹）。失败/空输出返回 null */
export function keyscanLocal(keyscanProgram: string, timeoutMs: number): string | null {
  const out = spawnSync(keyscanProgram, ["-T", "5", "localhost"], {
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  if (out.error || out.status !== 0) return null;
  const stdout = (out.stdout ?? "").trim();
  return stdout === "" ? null : stdout;
}

/** ssh 参数组装（BatchMode/超时/显式端口与密钥；-- 在 host 前防选项注入） */
function sshArgs(ctx: SshCtx, extra: readonly string[], remoteLine: string): string[] {
  const args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"];
  if (ctx.agentKey !== null && ctx.agentKey.trim() !== "") {
    args.push("-i", ctx.agentKey);
  }
  if (ctx.sshPort !== 0 && ctx.sshPort !== 22) {
    args.push("-p", String(ctx.sshPort));
  }
  args.push(...extra);
  return [...args, "--", ctx.host.trim(), remoteLine];
}
