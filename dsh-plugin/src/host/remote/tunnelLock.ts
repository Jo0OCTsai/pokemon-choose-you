/**
 * 隧道让位锁（ADR-0003 §2 · 与桌面 tunnel_lock.rs 同构协议）：
 * `<appHome>/tunnels/<部署id>/` 目录锁 + `pid` 文件探活。抢不到且持有方存活 →
 * 让位待命；持有方已死 → 清残留接管。跨平台零依赖：mkdir 原子性 +
 * process.kill(pid, 0)（EPERM = 存活但非本用户 / ESRCH = 已死）。
 */
import { mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appHome } from "../storage/paths";

/** 锁目录（协议单源：tunnels/<deploymentId>——两端一致） */
function lockDir(base: string, deploymentId: string): string {
  return join(base, "tunnels", deploymentId);
}

/** 持有方 PID（缺文件/坏内容 = null → 视为可接管的半锁） */
export function holderPid(base: string, deploymentId: string): number | null {
  try {
    const text = readFileSync(join(lockDir(base, deploymentId), "pid"), "utf8").trim();
    const pid = Number.parseInt(text, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** PID 探活：kill-0 语义（EPERM = 存活；ESRCH = 死） */
export function pidAlive(pid: number): boolean {
  if (pid === process.pid) {
    return true;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** 锁句柄：release() 幂等；进程退出时残留目录由存活方按死锁接管 */
export interface TunnelLock {
  readonly dir: string;
  release(): void;
}

/**
 * 尝试获取部署的隧道维护权：true = 拿到（含 release）；false = 已被存活宿主持有
 * （让位待命，不发起同端口 ssh -R）。父目录幂等创建（无锁语义），原子性只依赖
 * 叶子 mkdir 的 EEXIST。
 */
export function tryAcquireTunnelLock(base: string, deploymentId: string): TunnelLock | null {
  const parent = join(base, "tunnels");
  mkdirSync(parent, { recursive: true });
  const dir = lockDir(base, deploymentId);
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir);
      writeFileSync(join(dir, "pid"), String(process.pid));
      return {
        dir,
        release() {
          rmSync(dir, { recursive: true, force: true });
        },
      };
    } catch {
      return null; // 并发对手先到手
    }
  }
  const pid = holderPid(base, deploymentId);
  if (pid !== null && pidAlive(pid)) {
    return null;
  }
  // 死锁：清残留重试一次（清失败 = 对手先到手，让位）
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    return null;
  }
  return tryAcquireTunnelLock(base, deploymentId);
}

/** 让位锁根目录（<appHome>；测试注入显式 base） */
export function defaultLockBase(): string {
  return appHome() ?? join(process.env.HOME ?? ".", ".choose-you");
}
