/**
 * 备份域 · 每日备份循环决策（domain/backup-loop.ts runDailyBackup，timer 注入归组 2.7）：
 * 跨天判定（last_backup_date ≠ 今日才执行）、空库跳过、备份成功后条件写键（A36 时序）、
 * prune 滚动保留 backup_keep。两个关键时序用例：「备份失败当日可重试」「写键失败下轮自愈」。
 * 用例主体提为命名函数（describe 回调行数棘轮）。
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupDir, listBackups } from "../src/host/domain/backup";
import { runDailyBackup, writeBackupDateKey } from "../src/host/domain/backup-loop";
import { createTestDb, scalar, seedTask, type TestDb } from "./helpers";

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
});

/** 注入日期（本地时区口径，与 todayStr 一致） */
const D1 = new Date(2026, 9, 16, 8, 0, 0);
const D2 = new Date(2026, 9, 17, 8, 0, 0);

function dataDir(): string {
  return join(db.dir, "data");
}

function setKey(key: string, value: string): void {
  db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

function lastBackupDate(): unknown {
  return scalar(db.conn, "SELECT value FROM settings WHERE key='last_backup_date'");
}

function skipStatesCase(): void {
  setKey("backup_enabled", "false");
  expect(runDailyBackup(dataDir(), db.conn, D1)).toEqual({
    created: false,
    file: null,
    reason: "disabled",
    keyWritten: false,
  });
  setKey("backup_enabled", "true");
  expect(runDailyBackup(dataDir(), db.conn, D1)).toEqual({
    created: false,
    file: null,
    reason: "empty-db",
    keyWritten: false,
  });
  seedTask(db.conn, "有数据了");
  setKey("last_backup_date", "2026-10-16");
  expect(runDailyBackup(dataDir(), db.conn, D1)).toEqual({
    created: false,
    file: null,
    reason: "already-today",
    keyWritten: true,
  });
  expect(listBackups(dataDir())).toEqual([]);
}

function firstRunCreatesCase(): void {
  const dir = backupDir(dataDir());
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "pokemon-choose-you-20260910-080000.db"), "");
  setKey("backup_keep", "1");
  seedTask(db.conn, "任务");
  setKey("last_backup_date", "2026-10-15");
  const out = runDailyBackup(dataDir(), db.conn, D1);
  expect(out.created).toBe(true);
  expect(out.file).toMatch(/^pokemon-choose-you-20261016-080000(-\d+)?\.db$/);
  expect(out.keyWritten).toBe(true);
  expect(lastBackupDate()).toBe("2026-10-16");
  expect(listBackups(dataDir()).map((b) => b.file)).toEqual([out.file]);
}

function backupFailRetryCase(): void {
  seedTask(db.conn, "任务");
  setKey("last_backup_date", "2026-10-15");
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(backupDir(dataDir()), ""); // backups 路径被普通文件占据 → 快照建目录即失败
  const failed = runDailyBackup(dataDir(), db.conn, D1);
  expect(failed).toEqual({ created: false, file: null, reason: "backup-failed", keyWritten: false });
  expect(lastBackupDate()).toBe("2026-10-15"); // 键未烧：当日未被标记为已备份
  rmSync(backupDir(dataDir()));
  const retried = runDailyBackup(dataDir(), db.conn, D1); // 同日重试仍尝试
  expect(retried.created).toBe(true);
  expect(lastBackupDate()).toBe("2026-10-16");
}

function keyWriteSelfHealCase(): void {
  seedTask(db.conn, "任务");
  const first = runDailyBackup(dataDir(), db.conn, D1);
  expect(first.keyWritten).toBe(true);
  expect(lastBackupDate()).toBe("2026-10-16");
  db.conn.exec(
    "CREATE TRIGGER block_backup_key BEFORE UPDATE ON settings WHEN NEW.key='last_backup_date' " +
      "BEGIN SELECT RAISE(ABORT, 'key write blocked'); END",
  );
  const second = runDailyBackup(dataDir(), db.conn, D2);
  expect(second.created).toBe(true); // 备份成功不回滚
  expect(second.keyWritten).toBe(false); // 写键失败
  expect(lastBackupDate()).toBe("2026-10-16"); // 键留旧值
  db.conn.exec("DROP TRIGGER block_backup_key");
  const third = runDailyBackup(dataDir(), db.conn, D2);
  expect(third.created).toBe(true); // 下轮读旧值自愈重跑
  expect(third.keyWritten).toBe(true);
  expect(lastBackupDate()).toBe("2026-10-17");
  expect(listBackups(dataDir())).toHaveLength(3);
}

describe("每日备份循环决策 runDailyBackup", () => {
  it("开关关闭 / 空库 / 当日已备份：三跳过态（桌面 daily_backup_decisions 同手法）", skipStatesCase);
  it("跨天首轮：创建快照 + 条件写键 + prune 滚动保留（backup_keep=1 只留最新）", firstRunCreatesCase);
  it("「备份失败当日可重试」：失败 → 键未写 → 同日再跑仍尝试并成功", backupFailRetryCase);
  it("「写键失败下轮自愈」：备份成功但写键失败 → 键留旧值 → 下轮读旧值重跑", keyWriteSelfHealCase);
});

describe("条件写键 writeBackupDateKey", () => {
  it("行缺失补插 / 旧值条件更新 / 今日值幂等 no-op", () => {
    writeBackupDateKey(db.conn, "2026-10-17"); // 缺行 → 补插（防全新库每轮重备）
    expect(lastBackupDate()).toBe("2026-10-17");
    db.conn.prepare("UPDATE settings SET value='2026-10-15' WHERE key='last_backup_date'").run();
    writeBackupDateKey(db.conn, "2026-10-17"); // 旧值 → 条件更新（A36：UPDATE … WHERE value<>今日）
    expect(lastBackupDate()).toBe("2026-10-17");
    writeBackupDateKey(db.conn, "2026-10-17"); // 今日 → affected=0 且行已在，no-op 不报错
    expect(lastBackupDate()).toBe("2026-10-17");
  });
});
