/**
 * run_setup 步骤 10：远端 sshd 存活探测（client_alive_step 同构；从 setup.ts 拆件控文件规模）。
 */
import { sshRun } from "./ssh";
import type { SetupCtx, SetupStep } from "./setup";

/**
 * 10. 远端 sshd 的 ClientAliveInterval 探测（client_alive_step 同构，建议性不阻断开通）：
 * 常驻隧道的自愈依赖「客户端死 → 远端回收 -R 监听端口」，而 sshd 默认
 * ClientAliveInterval 0（从不主动探测），死连接的端口要等 TCP keepalive（Linux
 * 默认约 2 小时）才释放——期间隧道宿主重连会一直撞 ExitOnForwardFailure。
 * `sudo -n sshd -T` 读生效值（无密码 sudo 失败即回落），回落 grep 配置文件，
 * 都不可得报「无法确认」；1–60s 视为健康，0 或更大给配置建议。
 */
export function clientAliveStep(ctx: SetupCtx): SetupStep {
  const probe =
    "sudo -n sshd -T 2>/dev/null | grep -i '^clientaliveinterval ' " +
    "|| grep -RihsE '^[[:space:]]*ClientAliveInterval[[:space:]]+[0-9]+' " +
    "/etc/ssh/sshd_config /etc/ssh/sshd_config.d/ 2>/dev/null | head -1 " +
    "|| echo UNCONFIRMED";
  const [, out] = sshRun(ctx, [], probe, null);
  return classifyClientAlive(out);
}

/** 探测输出 → 报告步（纯函数，独立测试）：取尾 token 解析秒数后三分类 */
export function classifyClientAlive(raw: string): SetupStep {
  const last = raw.trim().split(/\s+/).pop() ?? "";
  const secs = /^\d+$/.test(last) ? Number(last) : undefined;
  const guidance = "建议在远端 /etc/ssh/sshd_config 设 ClientAliveInterval 15 与 ClientAliveCountMax 3 并重启 sshd";
  if (secs !== undefined && secs >= 1 && secs <= 60) {
    return {
      name: "sshd 存活探测",
      status: "ok",
      detail: `ClientAliveInterval=${secs}s，死连接的隧道端口能被远端及时回收`,
    };
  }
  if (secs !== undefined) {
    return {
      name: "sshd 存活探测",
      status: "warn",
      detail: `ClientAliveInterval=${secs}s（${guidance}）：隧道宿主被强杀后残留 ssh 会占住远端监听端口，重连将循环失败直到端口释放`,
    };
  }
  return {
    name: "sshd 存活探测",
    status: "warn",
    detail: `无法确认生效值（${guidance}）：默认 0 = 从不探测死连接，残留监听端口要等 TCP keepalive（可达 2 小时）才释放`,
  };
}
