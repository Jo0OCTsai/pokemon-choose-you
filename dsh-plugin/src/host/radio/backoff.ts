/**
 * 轮询指数退避与间隔口径——行为基准 = src-tauri/src/feishu.rs 的 spawn_poll_loop：
 * 失败 backoff = (backoff * 2).min(8)（即失败计数驱动的 2^n 封顶 8）、成功复位 1；
 * 间隔读共享设置 feishu_poll_interval（≥30 下限，默认 120 秒——D8 共享口径）。
 */
import type { Conn } from "../storage/db";
import { getSetting } from "../domain/settings";

/** 退避倍数上限（×8） */
export const BACKOFF_MAX = 8;

/** 轮询间隔下限与默认（秒，spawn_poll_loop 的 filter(s >= 30).unwrap_or(120)） */
export const MIN_POLL_INTERVAL_SECS = 30;
export const DEFAULT_POLL_INTERVAL_SECS = 120;

/**
 * 失败计数 → 退避倍数：0 → 1（不退避）；n → min(2^n, 8)。
 * 与 Rust 序列一致：1 失败后 ×2、再失败 ×4、×8 封顶；成功复位由计数清零达成。
 */
export function backoffFactor(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) {
    return 1;
  }
  return Math.min(2 ** consecutiveFailures, BACKOFF_MAX);
}

/** 实际睡眠秒数 = 间隔 × 退避倍数 */
export function sleepSeconds(intervalSecs: number, consecutiveFailures: number): number {
  return intervalSecs * backoffFactor(consecutiveFailures);
}

/** 读共享设置里的轮询间隔（非法/过小回落默认 120；≥30 下限） */
export function pollIntervalSecs(conn: Conn): number {
  const raw = Number(getSetting(conn, "feishu_poll_interval") ?? "");
  if (!Number.isFinite(raw) || raw < MIN_POLL_INTERVAL_SECS) {
    return DEFAULT_POLL_INTERVAL_SECS;
  }
  return Math.floor(raw);
}
