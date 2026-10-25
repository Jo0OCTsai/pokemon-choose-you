/**
 * 当日去重键 CAS（AD §4.6 · 桌面 db.rs claim_daily_key 同构）：单条 BEGIN IMMEDIATE 内
 * INSERT OR IGNORE 建行 → `UPDATE settings SET value=<今日> WHERE key=? AND value<>?<今日>`，
 * affected=1 才算抢到（当日一次、跨形态同窗让位、次日可再抢）。
 * 消费方：逾期温和通知（auto_grass 每天一次）与每周复盘提醒（当日一次）——键名与桌面
 * 逐字一致（跨形态仲裁键，两形态任一侧抢到即全系统当日一次）。
 */
import { txImmediate, type Conn } from "../storage/db";

/** 逾期 fresh start 当日去重键（桌面 scheduler.rs tick 同键） */
export const FRESH_START_LAST_RUN = "fresh_start_last_run";

/** 每周复盘提醒当日去重键（桌面 scheduler.rs tick 同键） */
export const REVIEW_LAST_NOTIFIED = "review_last_notified";

/**
 * 抢占当日去重键：抢到 true 才有当日送达权；同日再抢（本形态或对面形态已抢）false；
 * 次日换日期可再抢。抢占失败（锁/IO）不阻断调用方——按让位处理（桌面同款返回 false）。
 */
export function claimDailyKey(conn: Conn, key: string, today: string): boolean {
  try {
    return txImmediate(conn, () => {
      conn.prepare("INSERT INTO settings (key, value) VALUES (?, '') ON CONFLICT(key) DO NOTHING").run(key);
      return conn.prepare("UPDATE settings SET value=?1 WHERE key=?2 AND value<>?1").run(today, key).changes === 1;
    });
  } catch {
    return false;
  }
}
