/**
 * 备份域 · 恢复面（domain/backup-restore.ts）：真实临时库——恢复回到备份点、恢复前自动
 * 备份（D25）、文件名白名单拒路径分隔符（桌面 is_backup_name 同款）、坏文件 / 超窗版本
 * 拒绝（DB_SCHEMA_TOO_NEW 只读保护延伸到恢复通道）时库不变、旧版本备份恢复后迁移口径
 * 维持 + 默认分类补种、恢复后补写当日 last_backup_date（防 backupLoop 当日再跑）。
 * 用例主体提为命名函数（describe 回调行数棘轮）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupDir, createBackup, listBackups } from "../src/host/domain/backup";
import { runRestore } from "../src/host/domain/backup-restore";
import { PkyError } from "../src/host/storage/errors";
import { loadSchemaSql } from "../src/host/storage/migrate";
import { createTestDb, scalar, seedTask, type TestDb } from "./helpers";

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
  seedTask(db.conn, "备份时的任务");
});

afterEach(() => {
  db.close();
});

function dataDir(): string {
  return join(db.dir, "data");
}

/** 断言 domain 调用抛 PkyError 并返回其 code（信封化归命令层 2.9） */
function pkyCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(PkyError);
    return (error as PkyError).code;
  }
  throw new Error("期望抛 PkyError 但调用未抛错");
}

/** 在备份目录放一个手工构建的备份库文件（v1 schema / 超窗版本 / 坏文件探针） */
function putBackup(name: string, build: (c: DatabaseSync) => void): void {
  const dir = backupDir(dataDir());
  mkdirSync(dir, { recursive: true });
  const file = new DatabaseSync(join(dir, name));
  build(file);
  file.close();
}

function restoreRollsBackCase(): void {
  const snap = createBackup(dataDir(), db.conn, new Date(2026, 9, 17, 9, 0, 0));
  db.conn
    .prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('language', 'en'), ('last_backup_date', '2026-01-01')",
    )
    .run();
  seedTask(db.conn, "备份后的新任务");

  const result = runRestore(dataDir(), db.conn, { backupId: snap }, new Date(2026, 9, 17, 15, 0, 0));
  expect(result.backupId).toMatch(/^pokemon-choose-you-20261017-150000(-\d+)?\.db$/);
  expect(result.migratedTo).toBe(1);
  expect(result.seeded).toBe(false);
  // 数据回到备份点（桌面 restore_rolls_db_back_to_snapshot 同手法）
  expect(scalar(db.conn, "SELECT COUNT(*) FROM tasks")).toBe(1);
  expect(scalar(db.conn, "SELECT title FROM tasks")).toBe("备份时的任务");
  // 恢复前自动备份落目录（时间倒序列表：前置快照在前、恢复源在后）
  expect(listBackups(dataDir()).map((b) => b.file)).toEqual([result.backupId, snap]);
  // 恢复把 settings 也回滚了：当日备份标记补写为今日（桌面 commands/backup.rs 同款）
  expect(scalar(db.conn, "SELECT value FROM settings WHERE key='last_backup_date'")).toBe("2026-10-17");
}

function pathEntryEquivalentCase(): void {
  const snap = createBackup(dataDir(), db.conn);
  seedTask(db.conn, "多出来的");
  runRestore(dataDir(), db.conn, { path: snap }, new Date(2026, 9, 17, 15, 0, 0));
  expect(scalar(db.conn, "SELECT COUNT(*) FROM tasks")).toBe(1);
}

function whitelistRejectsCase(): void {
  const before = scalar(db.conn, "SELECT COUNT(*) FROM tasks");
  for (const bad of ["../evil.db", "a/b.db", "secrets.txt", "pokemon-choose-you-x\\y.db"]) {
    expect(pkyCode(() => runRestore(dataDir(), db.conn, { path: bad }))).toBe("IMPORT_VALIDATION_FAILED");
  }
  expect(pkyCode(() => runRestore(dataDir(), db.conn, {}))).toBe("INVALID_ARGUMENT");
  expect(scalar(db.conn, "SELECT COUNT(*) FROM tasks")).toBe(before);
}

function missingAndCorruptCase(): void {
  expect(pkyCode(() => runRestore(dataDir(), db.conn, { backupId: "pokemon-choose-you-20990101-000000.db" }))).toBe(
    "NOT_FOUND",
  );
  putBackup("pokemon-choose-you-bad-000000.db", () => undefined);
  writeFileSync(join(backupDir(dataDir()), "pokemon-choose-you-bad-000000.db"), "not a sqlite file");
  expect(pkyCode(() => runRestore(dataDir(), db.conn, { backupId: "pokemon-choose-you-bad-000000.db" }))).toBe(
    "IMPORT_VALIDATION_FAILED",
  );
  expect(scalar(db.conn, "SELECT COUNT(*) FROM tasks")).toBe(1);
}

function tooNewRejectedCase(): void {
  const future = "pokemon-choose-you-future-000000.db";
  putBackup(future, (c) => {
    c.exec("PRAGMA user_version = 3");
  });
  expect(pkyCode(() => runRestore(dataDir(), db.conn, { backupId: future }))).toBe("DB_SCHEMA_TOO_NEW");
  expect(scalar(db.conn, "SELECT COUNT(*) FROM tasks")).toBe(1);
  // 备份目录里只有探针文件自身——未做前置快照、库未动
  expect(listBackups(dataDir()).map((b) => b.file)).toEqual([future]);
}

function v1RestoreCase(): void {
  putBackup("pokemon-choose-you-v1-000001.db", (c) => {
    c.exec(loadSchemaSql("001_v1.sql").sql);
    c.exec("INSERT INTO tasks (title, status, created_at) VALUES ('v1 任务', 'inbox', '2026-01-01T00:00:00+00:00')");
    c.exec("PRAGMA user_version = 1");
  });
  const result = runRestore(
    dataDir(),
    db.conn,
    { backupId: "pokemon-choose-you-v1-000001.db" },
    new Date(2026, 9, 17, 15, 0, 0),
  );
  expect(scalar(db.conn, "SELECT title FROM tasks")).toBe("v1 任务");
  expect(result.migratedTo).toBe(1);
  expect(result.seeded).toBe(true);
  expect(scalar(db.conn, "SELECT COUNT(*) FROM categories")).toBe(5);
  expect(scalar(db.conn, "SELECT COUNT(*) FROM dispatch_slots")).toBe(0);
}

function promptOverrideRollbackCase(): void {
  db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_prompt_capture', '备份时的规则')").run();
  const snap = createBackup(dataDir(), db.conn);
  db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_prompt_capture', '现在的规则')").run();
  runRestore(dataDir(), db.conn, { backupId: snap }, new Date(2026, 9, 17, 15, 0, 0));
  expect(scalar(db.conn, "SELECT value FROM settings WHERE key='ai_prompt_capture'")).toBe("备份时的规则");
}

describe("恢复 runRestore", () => {
  it("恢复回到备份点 + 恢复前自动备份 + 补写当日 last_backup_date（Gherkin 恢复备份版本兼容）", restoreRollsBackCase);
  it("path 入口与 backupId 等价", pathEntryEquivalentCase);
  it("文件名白名单：拒路径分隔符与非备份名（桌面 is_backup_name 同款），库不变", whitelistRejectsCase);
  it("合法名但文件不存在 → NOT_FOUND；坏文件（非 SQLite）→ IMPORT_VALIDATION_FAILED 且库不变", missingAndCorruptCase);
  it("超窗备份拒绝（user_version 超插件兼容窗口）：库不变、不产生前置快照（Gherkin）", tooNewRejectedCase);
  it("旧版本备份（v1）恢复：数据到位、迁移口径维持 v1、默认分类补种（Gherkin）", v1RestoreCase);
  it("提示词覆盖随备份点回滚（恢复是全库点态回滚，非导出通道的排除面）", promptOverrideRollbackCase);
});
