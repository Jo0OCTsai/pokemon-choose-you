/**
 * 备份域 · 每日备份循环决策（backupLoop 纯逻辑；30min timer 注入归组 2.7 装配层，
 * 装配点 assembly.ts 不在本文件）。行为基准 = 桌面 backup.rs run_daily_backup，
 * 落键时序按 AD §3.2 / A36：备份**成功后**才条件写键——键未写 = 下轮必重试，
 * 杜绝「先烧键、备份失败后当日恒不重试」；写键失败不回滚已成功备份（下轮读旧值自愈）；
 * 空库跳过（tasks + chat_messages = 0）；prune 滚动保留 backup_keep（默认 7 下限 1，
 * 复用 runBackupNow）。跨形态同窗竞态双备份 = 良性事件（A36）。
 */
import { txImmediate, type Conn } from "../storage/db";
import { runBackupNow } from "./backup";
import { todayStr } from "./export";
import { getSetting, setSetting } from "./settings";

/** 跳过/失败原因（created=false 时的 reason；呈现与诊断用） */
export type DailyBackupSkipReason = "disabled" | "already-today" | "empty-db" | "backup-failed";

/** 单轮决策结果（timer 装配层消费；file 为新快照文件名） */
export interface DailyBackupOutcome {
  created: boolean;
  file: string | null;
  reason?: DailyBackupSkipReason;
  /** 条件写键是否落上（键已等于今日也计 true；false = 写键失败，下轮读旧值自愈） */
  keyWritten: boolean;
}

/** 空库判定失败按「有数据」处理（桌面 unwrap_or(true) 同口径——探测失败不抑制备份） */
function dbHasData(conn: Conn): boolean {
  try {
    const row = conn
      .prepare("SELECT (SELECT COUNT(*) FROM tasks) + (SELECT COUNT(*) FROM chat_messages) AS n")
      .get() as { n: number };
    return row.n > 0;
  } catch {
    return true;
  }
}

/**
 * 备份成功后的条件写键（A36 时序）：`UPDATE … WHERE value<>今日`——今日已写（跨形态
 * 竞态另一形态已备份）时 no-op；行缺失则补插（全新库无该行，纯 UPDATE 恒 0 affected
 * 会导致每轮重备——补插是「键未写 = 下轮必重试」语义的补位，桌面现行无条件 upsert
 * 落键使存量库均有该行）。
 */
export function writeBackupDateKey(conn: Conn, today: string): void {
  txImmediate(conn, () => {
    const updated = conn
      .prepare("UPDATE settings SET value=? WHERE key='last_backup_date' AND value<>?")
      .run(today, today);
    if (updated.changes === 0 && getSetting(conn, "last_backup_date") === null) {
      setSetting(conn, "last_backup_date", today);
    }
  });
}

/**
 * 每日调度的一次决策（桌面 run_daily_backup 同构 + A36 落键时序；now 注入可测）：
 * 开关关 / 当日已备份 / 空库 → 跳过；否则快照 + prune + 条件写键。备份失败不上抛
 * （桌面 log warn 下轮重试同口径——timer 装配层静默续轮），键未写保证当日可重试。
 */
export function runDailyBackup(dataDir: string, conn: Conn, now: Date = new Date()): DailyBackupOutcome {
  if (getSetting(conn, "backup_enabled") === "false") {
    return { created: false, file: null, reason: "disabled", keyWritten: false };
  }
  const today = todayStr(now);
  if (getSetting(conn, "last_backup_date") === today) {
    return { created: false, file: null, reason: "already-today", keyWritten: true };
  }
  if (!dbHasData(conn)) {
    return { created: false, file: null, reason: "empty-db", keyWritten: false };
  }
  let file: string;
  try {
    file = runBackupNow(dataDir, conn, now).file;
  } catch {
    return { created: false, file: null, reason: "backup-failed", keyWritten: false };
  }
  let keyWritten = true;
  try {
    writeBackupDateKey(conn, today);
  } catch {
    keyWritten = false; // 不回滚已成功备份——下轮读旧值自愈重跑
  }
  return { created: true, file, keyWritten };
}
