/**
 * 隧道让位锁（ADR-0003 §2 · 与桌面 tunnel_lock.rs 同构协议）：
 * `<appHome>/tunnels/<部署id>/` 目录锁 + `pid` 文件探活；持有方另以 `ssh-pid`
 * 记录当前 ssh 子进程（被硬杀后接管方据此清孤儿 -R 进程）。抢不到且持有方存活 →
 * 让位待命；持有方已死 → 清残留（含孤儿 ssh）接管。跨平台零依赖：mkdir 原子性 +
 * process.kill(pid, 0)（EPERM = 存活但非本用户 / ESRCH = 已死）。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appHome } from "../storage/paths";

/** 锁目录（协议单源：tunnels/<deploymentId>——两端一致） */
function lockDir(base: string, deploymentId: string): string {
  return join(base, "tunnels", deploymentId);
}

/** 锁内 PID 文件读取（pid / ssh-pid 共用口径：缺文件/坏内容 = null） */
function readPidAt(file: string): number | null {
  try {
    const text = readFileSync(file, "utf8").trim();
    const pid = Number.parseInt(text, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** 持有方 PID（缺文件/坏内容 = null → 视为可接管的半锁） */
export function holderPid(base: string, deploymentId: string): number | null {
  return readPidAt(join(lockDir(base, deploymentId), "pid"));
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
  /** 记录当前 ssh 子进程 PID（持有方每次 spawn 后写；接管死锁的一方据此清孤儿） */
  recordSshPid(pid: number): void;
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
        recordSshPid: (pid) => {
          try {
            writeFileSync(join(dir, "ssh-pid"), String(pid));
          } catch {
            // 记账失败不阻断隧道（timer 上下文不许抛）；孤儿清理缺失由远端端口竞争兜底
          }
        },
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
  // 死锁：清孤儿 ssh + 清残留目录重试一次（清失败 = 对手先到手，让位）
  killOrphanSsh(dir);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    return null;
  }
  return tryAcquireTunnelLock(base, deploymentId);
}

/**
 * 死锁接管时顺带清孤儿 ssh（与桌面 tunnel_lock.rs kill_orphan_ssh 同协议）：
 * 持有方被硬杀时残留的 `ssh -N -R` 会一直占着远端监听端口，接管方的新连接将
 * 循环撞 ExitOnForwardFailure。读 ssh-pid → 探活 → `ps` 命令行核对（含 ssh 与
 * -R，防 PID 复用误杀无关进程）→ SIGTERM；任何一步不成立即跳过——清不掉不
 * 阻塞接管（远端端口冲突兜底）。
 */
export function killOrphanSsh(dir: string): void {
  const pid = readPidAt(join(dir, "ssh-pid"));
  if (pid === null || !pidAlive(pid)) {
    return;
  }
  let looksLikeTunnelSsh = false;
  try {
    // -ww：非 tty 下 ps 按 80 列截断命令行，长路径会把 -R 截出视野
    const out = spawnSync("ps", ["-ww", "-p", String(pid), "-o", "command="], { encoding: "utf8" });
    looksLikeTunnelSsh = out.status === 0 && out.stdout.includes("ssh") && out.stdout.includes("-R");
  } catch {
    looksLikeTunnelSsh = false;
  }
  if (looksLikeTunnelSsh) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // 退出竞态：已死即达成目的
    }
  }
}

/**
 * 回收本进程的自残留锁（pid 文件 = 本进程但锁句柄已丢——旧版 supervisor 在
 * ssh 退出后重抢锁失败泄漏的目录）：tryAcquireTunnelLock 对它按「持有者存活」
 * 永远让位，而进程内存活的持有者只有 supervisor 一条路，自残留即句柄已丢，
 * 清目录重抢即可。持有方是其他进程时不动（返回 null）。
 */
export function reclaimSelfResidue(base: string, deploymentId: string): TunnelLock | null {
  if (holderPid(base, deploymentId) !== process.pid) {
    return null;
  }
  const dir = lockDir(base, deploymentId);
  killOrphanSsh(dir);
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
