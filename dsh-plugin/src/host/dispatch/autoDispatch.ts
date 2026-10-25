/**
 * 自动派发扫描循环（60s，timer 注入）——行为基准 =
 * src-tauri/src/commands/dispatch/auto.rs dispatch_tick / spawn_dispatch_loop：
 * 开关读设置 → 回收过期槽 → queue_due（domain 原语：到期 + 项目标签指定 agent +
 * 只动 NULL 行 + done/failed 不重入）→ pick_queued 逐个无头编排（槽满等待：
 * 保持 queued 下轮再试）；meta 指定的 agent 已不可用 → 撤销排队（重置，下次满足
 * 条件再排，不留在 queued 卡死）。完成通知（系统通知）归 host 命令层装配。
 */
import type { Conn } from "../storage/db";
import { dispatchTransition } from "../domain/dispatch";
import { pickQueued, queueDueTasks } from "../domain/dispatch";
import { reclaimExpiredSlots } from "../domain/dispatch-slots";
import { loadAgents } from "../domain/settings";
import { runQueuedHeadless, type HeadlessDeps } from "./headless";

/** 扫描间隔（秒，auto.rs spawn_dispatch_loop 同值） */
export const AUTO_DISPATCH_INTERVAL_SECS = 60;

/** 注入式定时器（真实 = setInterval；测试注入手动触发） */
export interface TimerApi {
  every(ms: number, fn: () => void): unknown;
  cancel(handle: unknown): void;
}

export const systemTimer: TimerApi = {
  every: (ms, fn) => setInterval(fn, ms),
  cancel: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export interface AutoDispatchTickResult {
  autoOn: boolean;
  /** 本轮排队条数（queue_due） */
  queued: number;
  /** 回收的过期槽租约数（A6 崩溃自愈） */
  reclaimed: number;
  /** 成功领取并执行条数 */
  dispatched: number;
  /** agent 不可用撤销排队条数 */
  cancelled: number;
  /** 未领取（槽满 / 已被领取）条数 */
  skipped: number;
}

/**
 * 单轮扫描（可独立驱动——测试与 host 命令 pollNow 复用）：dispatch_auto_enabled
 * 未开 → no-op。逐个顺序 await（领取在槽原语内原子完成，跨形态并发由槽表闸住）。
 */
export async function autoDispatchTick(
  conn: Conn,
  deps: HeadlessDeps = {},
  now?: Date,
): Promise<AutoDispatchTickResult> {
  const result: AutoDispatchTickResult = {
    autoOn: true,
    queued: 0,
    reclaimed: 0,
    dispatched: 0,
    cancelled: 0,
    skipped: 0,
  };
  const autoOn = conn.prepare("SELECT value FROM settings WHERE key='dispatch_auto_enabled'").get() as
    { value: string } | undefined;
  if (autoOn?.value !== "true") {
    result.autoOn = false;
    return result;
  }
  // 每轮开头回收过期槽租约（A6：崩溃/被杀的派发留下的租约到期即扫掉）
  result.reclaimed = reclaimExpiredSlots(conn);
  result.queued = queueDueTasks(conn, now === undefined ? {} : { now });
  const agents = loadAgents(conn);
  for (const { taskId, agentId } of pickQueued(conn)) {
    if (!agents.some((a) => a.id === agentId && a.enabled)) {
      // meta 指定的 agent 已不可用：撤销排队（重置），下次满足条件再排——auto.rs 同款
      dispatchTransition(conn, taskId, null, "排队后 agent 不可用，自动撤销", "dsh:dispatch-auto");
      result.cancelled++;
      continue;
    }
    const run = await runQueuedHeadless(conn, deps, taskId);
    if (run.started) {
      result.dispatched++;
    } else {
      result.skipped++;
    }
  }
  return result;
}

export interface AutoDispatchLoop {
  stop(): void;
}

/** 60 秒扫描循环（timer 注入；tick 失败不中断循环——对齐 spawn_dispatch_loop warn 继续） */
export function startAutoDispatchLoop(
  conn: Conn,
  deps: HeadlessDeps = {},
  opts: { intervalMs?: number; timer?: TimerApi; onError?(error: unknown): void } = {},
): AutoDispatchLoop {
  const timer = opts.timer ?? systemTimer;
  const handle = timer.every((opts.intervalMs ?? AUTO_DISPATCH_INTERVAL_SECS * 1000) as number, () => {
    void autoDispatchTick(conn, deps).catch((error) => opts.onError?.(error));
  });
  return {
    stop() {
      timer.cancel(handle);
    },
  };
}
