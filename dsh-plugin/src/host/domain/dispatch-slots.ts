/**
 * 机器级并发槽表（dispatch_slots，FR-X1 / §7.1 条目 5）——行为基准 =
 * src-tauri/src/commands/dispatch/auto.rs：跨形态（app / dsh / pk）合计计数，
 * 崩溃后租约过期自动回收（A6：租约时长 = 无头超时 + 5 分钟余量）。
 */
import { nowRfc3339, txImmediate, type Conn } from "../storage/db";
import { claimDispatch, DS_QUEUED } from "./dispatch";

/** 无头超时下限（秒，与 headless.rs DISPATCH_MIN_TIMEOUT_SECS 一致；槽租约的基数） */
export const DISPATCH_MIN_TIMEOUT_SECS = 600;

/** 槽租约余量（秒，A6：租约时长 = 无头超时 + 5 分钟） */
export const SLOT_LEASE_MARGIN_SECS = 300;

/** host_key 归一（auto.rs host_key 同款）：本机 'local'；远程 'ssh:user@host[:port]'（空白 host 视同本机） */
export function dispatchHostKey(remote: { host: string } | null | undefined): string {
  const host = remote?.host?.trim();
  return host ? `ssh:${host}` : "local";
}

/** 槽租约时长（秒）：无头超时（600 下限）+ 5 分钟余量（A6） */
export function slotLeaseSecs(agentTimeoutSecs: number): number {
  return Math.max(agentTimeoutSecs, DISPATCH_MIN_TIMEOUT_SECS) + SLOT_LEASE_MARGIN_SECS;
}

/** 回收过期租约（每 tick 开头；rfc3339 字典序与时间序一致——A6 崩溃自愈） */
export function reclaimExpiredSlots(conn: Conn, now = nowRfc3339()): number {
  return Number(conn.prepare("DELETE FROM dispatch_slots WHERE lease_expires_at < ?").run(now).changes);
}

export interface AcquireSlotOptions {
  taskId: number;
  hostKey: string;
  maxConcurrent: number;
  leaseSecs: number;
  owner?: string;
  now?: Date;
}

/**
 * 领取并占槽（claim_with_slot 同构）：上限检查（COUNT）+ claim + 插租约行在同一
 * BEGIN IMMEDIATE 事务内原子完成——不会出现「claim 了没占槽」或「两个形态同时过
 * COUNT 检查」的中间态。返回 false = 没领到（槽满 / 任务已被领取）。
 * owner 供崩溃排障（app/dsh，不参与互斥判定）。
 */
export function acquireSlot(conn: Conn, opts: AcquireSlotOptions): boolean {
  const now = opts.now ?? new Date();
  const leaseExpires = nowRfc3339(new Date(now.getTime() + opts.leaseSecs * 1000));
  return txImmediate(conn, () => {
    const used = conn.prepare("SELECT COUNT(*) AS n FROM dispatch_slots WHERE host_key=?").get(opts.hostKey) as {
      n: number;
    };
    if (used.n >= opts.maxConcurrent) {
      return false;
    }
    if (!claimDispatch(conn, opts.taskId, { allowNull: false, states: [DS_QUEUED] })) {
      return false;
    }
    conn
      .prepare(
        "INSERT INTO dispatch_slots (host_key, task_id, owner, acquired_at, lease_expires_at) " +
          "VALUES (?, ?, ?, ?, ?)",
      )
      .run(opts.hostKey, opts.taskId, opts.owner ?? "dsh", nowRfc3339(now), leaseExpires);
    return true;
  });
}

/** 收口释放槽（完成 / 失败）：删对应租约行，额度立即可复用 */
export function releaseSlot(conn: Conn, hostKey: string, taskId: number): void {
  conn.prepare("DELETE FROM dispatch_slots WHERE host_key=? AND task_id=?").run(hostKey, taskId);
}
