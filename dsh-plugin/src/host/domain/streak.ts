/**
 * 连胜统计（FR-B3 · 桌面 commands/pet.rs streak_eval / streak_conn 同构）：
 * done 本地自然日去重、空天消耗唯一 1 个宽容日、今日未完成不算断、回溯上限 400 天，
 * 输出 { days, todayCount }。纯核心 streakEval 与契约 op streak_eval 共用
 * （contracts/scenarios/streak 由 Rust oracle 锁定——显式 doneDays/today 入参，
 * 防机器时区漂移）。
 */
import type { Conn } from "../storage/db";
import { PkyError } from "../storage/errors";

export interface StreakInfo {
  days: number;
  todayCount: number;
}

/** 回溯上限（桌面同值：恰好/超过 400 连续天都封顶 400） */
export const STREAK_LOOKBACK_DAYS = 400;

/** "YYYY-MM-DD" → 该日 UTC 零点 epoch ms；非法日期（含 2026-02-30）返回 null（NaiveDate::parse 同构） */
export function parseDay(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m === null) {
    return null;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return ms;
}

/** epoch ms → "YYYY-MM-DD"（UTC 分量；连胜回溯用的日字符串口径） */
export function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * 连胜纯核心（桌面 streak_eval 镜像）：doneDays 从 today 往回走——有捕捉计一天；
 * 整天空着可用掉唯一一个宽容日；再空即断；最多回看 400 天。今天还没捕捉不清零
 * （连胜活到今天结束，给用户留着续上的机会）；todayCount 由调用方统计原样带回。
 */
export function streakEval(doneDays: ReadonlySet<string>, today: string, todayCount: number): StreakInfo {
  let cur = parseDay(today);
  if (cur === null) {
    throw new PkyError("INVALID_ARGUMENT", `today 非法：${today}`);
  }
  let days = 0;
  let grace = 1;
  for (let i = 0; i < STREAK_LOOKBACK_DAYS; i++) {
    if (doneDays.has(formatDay(cur))) {
      days += 1;
    } else if (grace > 0) {
      grace -= 1;
    } else {
      break;
    }
    cur -= 86_400_000;
  }
  return { days, todayCount };
}

/**
 * 面向消费的薄封装（桌面 streak_conn 镜像）：读 done 任务的完成本地日集合（DISTINCT
 * + 最新 400 日）与今日捕捉数，交给 streakEval。
 * tz 口径：SQL `date(completed_at, 'localtime')` 按机器时区折算（与桌面逐字同款）；
 * today 取注入 now 的本地日分量——JS Date 本地分量与 SQLite 'localtime' 在同机一致。
 */
export function streakFromDb(conn: Conn, now: Date = new Date()): StreakInfo {
  const rows = conn
    .prepare(
      "SELECT DISTINCT date(completed_at, 'localtime') AS d FROM tasks " +
        "WHERE status='done' AND completed_at IS NOT NULL ORDER BY 1 DESC LIMIT 400",
    )
    .all() as Array<{ d: string | null }>;
  const doneDays = new Set<string>();
  for (const r of rows) {
    // 非法/空完成时刻（date() 折算失败）静默跳过——桌面 filter_map(parse.ok) 同口径
    if (r.d !== null && parseDay(r.d) !== null) {
      doneDays.add(r.d);
    }
  }
  const today = formatLocalDay(now);
  const todayCount = Number(
    (
      conn
        .prepare("SELECT COUNT(*) AS n FROM tasks WHERE status='done' AND date(completed_at, 'localtime') = ?")
        .get(today) as { n: number }
    ).n,
  );
  return streakEval(doneDays, today, todayCount);
}

/** Date → 本地日字符串（本地分量组 "YYYY-MM-DD"——date('now','localtime') 等价面） */
function formatLocalDay(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
