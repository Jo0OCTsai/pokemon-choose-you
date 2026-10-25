/**
 * 备份域 · 导入面（domain/backup-import.ts）：真实临时库全流程——结构校验失败整体拒绝
 * （库 0 行变更，FR-A5 Gherkin）、100MB / 解析深度 / 列名白名单三道上限、前置自动备份
 * （D25：失败即中止不执行替换）、整体替换语义（秘钥与提示词覆盖行不随导入覆盖——桌面
 * 对照）、导入空分类文件后默认分类补种。用例主体提为命名函数（describe 回调行数棘轮）。
 */
import { existsSync, mkdirSync, readFileSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupDir, listBackups } from "../src/host/domain/backup";
import { IMPORT_MAX_BYTES, IMPORT_MAX_DEPTH, runImport, validateImport } from "../src/host/domain/backup-import";
import { exportFullJson } from "../src/host/domain/export";
import { PkyError } from "../src/host/storage/errors";
import { createTestDb, seedTask, type TestDb } from "./helpers";

let src: TestDb;
let target: TestDb;
let exportPath: string;

beforeEach(() => {
  src = createTestDb();
  target = createTestDb();
  seedSrcFixture(src.conn);
  exportPath = exportFullJson(join(src.dir, "data"), src.conn, new Date(2026, 9, 17, 10, 0, 0));
  seedTask(target.conn, "本地旧任务");
  target.conn
    .prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('language', 'fr'), ('ai_prompt_im_classify', '本机规则')",
    )
    .run();
});

afterEach(() => {
  src.close();
  target.close();
});

/** 导出源夹具：两任务 + 标签关联 + 过滤偏好 + 设置（覆盖键在源库但不随文件出库） */
function seedSrcFixture(conn: TestDb["conn"]): void {
  seedTask(conn, "写周报");
  seedTask(conn, '交报告, "最终"');
  conn
    .prepare("INSERT INTO tags (name, description, dimension_id, created_at) VALUES ('重要', '', 1, '2026-09-01')")
    .run();
  conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (1, 1)").run();
  conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('language', 'en'), ('backup_keep', '3')").run();
  conn
    .prepare(
      "INSERT INTO chat_filter_prefs (chat_id, preference, updated_at) VALUES ('oc_a', 'always_filter', '2026-09-23T00:00:00Z')",
    )
    .run();
}

/** 目标库数据目录（domain 函数显式注入——不走命令层 env 解析） */
function dataDir(): string {
  return join(target.dir, "data");
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

type Envelope = { app?: unknown; format?: unknown; data?: Record<string, unknown> };

/** 在导出文件基础上构造变体（改信封 / 夹带行），写到目标临时目录返回路径 */
function craftVariant(mutate: (parsed: Envelope) => void): string {
  const parsed = JSON.parse(readFileSync(exportPath, "utf8")) as Envelope;
  mutate(parsed);
  const path = join(target.dir, "crafted.json");
  writeFileSync(path, JSON.stringify(parsed));
  return path;
}

function scalar(sql: string): unknown {
  const row = target.conn.prepare(sql).get() as Record<string, unknown> | undefined;
  return row === undefined ? undefined : Object.values(row)[0];
}

function validSummaryCase(): void {
  const summary = validateImport(target.conn, exportPath);
  expect(summary.app).toBe("pokemon-choose-you");
  expect(summary.schemaVersion).toBe(1);
  expect(summary.compatible).toBe(true);
  expect(summary.counts.tasks).toBe(2);
  expect(summary.counts.categories).toBe(5);
  expect(summary.counts.settings).toBe(2);
  expect(summary.counts.chat_filter_prefs).toBe(1);
}

function appMismatchRejectsCase(): void {
  const bad = craftVariant((p) => {
    p.app = "other-app";
  });
  expect(pkyCode(() => validateImport(target.conn, bad))).toBe("IMPORT_VALIDATION_FAILED");
  expect(pkyCode(() => runImport(dataDir(), target.conn, bad))).toBe("IMPORT_VALIDATION_FAILED");
  expect(scalar("SELECT COUNT(*) FROM tasks WHERE title='本地旧任务'")).toBe(1);
  expect(scalar("SELECT value FROM settings WHERE key='language'")).toBe("fr");
  expect(existsSync(backupDir(dataDir()))).toBe(false);
}

function brokenStructureRejectsCase(): void {
  const notJson = join(target.dir, "not.json");
  writeFileSync(notJson, "not json at all");
  expect(pkyCode(() => validateImport(target.conn, notJson))).toBe("IMPORT_VALIDATION_FAILED");
  expect(
    pkyCode(() =>
      validateImport(
        target.conn,
        craftVariant((p) => {
          delete p.data;
        }),
      ),
    ),
  ).toBe("IMPORT_VALIDATION_FAILED");
  expect(
    pkyCode(() =>
      validateImport(
        target.conn,
        craftVariant((p) => {
          delete p.data?.sync_state;
        }),
      ),
    ),
  ).toBe("IMPORT_VALIDATION_FAILED");
  expect(
    pkyCode(() =>
      validateImport(
        target.conn,
        craftVariant((p) => {
          p.data!.tags = "x";
        }),
      ),
    ),
  ).toBe("IMPORT_VALIDATION_FAILED");
  expect(
    pkyCode(() =>
      validateImport(
        target.conn,
        craftVariant((p) => {
          p.data!.tags = ["not-an-object"];
        }),
      ),
    ),
  ).toBe("IMPORT_VALIDATION_FAILED");
}

function columnWhitelistCase(): void {
  const unknownCol = craftVariant((p) => {
    (p.data!.tasks as Array<Record<string, unknown>>)[0].evil_column = "x";
  });
  expect(pkyCode(() => validateImport(target.conn, unknownCol))).toBe("IMPORT_VALIDATION_FAILED");
  const quotedCol = craftVariant((p) => {
    (p.data!.tags as Array<Record<string, unknown>>)[0]['name"), ("1"=1 --'] = "x";
  });
  expect(pkyCode(() => validateImport(target.conn, quotedCol))).toBe("IMPORT_VALIDATION_FAILED");
}

function depthLimitCase(): void {
  const deep = join(target.dir, "deep.json");
  writeFileSync(
    deep,
    JSON.stringify({ app: "pokemon-choose-you", format: 1, data: { tags: [[[[[[[[[["x"]]]]]]]]]] } }),
  );
  expect(pkyCode(() => validateImport(target.conn, deep))).toBe("IMPORT_VALIDATION_FAILED");
}

function sizeLimitCase(): void {
  const big = join(target.dir, "big.json");
  writeFileSync(big, "{}");
  truncateSync(big, IMPORT_MAX_BYTES + 1);
  expect(pkyCode(() => validateImport(target.conn, big))).toBe("IMPORT_VALIDATION_FAILED");
}

function missingAndOptionalCase(): void {
  expect(pkyCode(() => validateImport(target.conn, join(target.dir, "nope.json")))).toBe("NOT_FOUND");
  const legacy = craftVariant((p) => {
    delete p.data?.chat_filter_prefs;
  });
  expect(validateImport(target.conn, legacy).counts.chat_filter_prefs).toBe(0);
}

function runImportReplacesCase(): void {
  const result = runImport(dataDir(), target.conn, exportPath, new Date(2026, 9, 17, 12, 0, 0));
  expect(result.backupId).toMatch(/^pokemon-choose-you-20261017-120000(-\d+)?\.db$/);
  expect(result.applied).toBe(12);
  // 前置快照落备份目录、计入列表（Gherkin：先自动创建一份备份，计入滚动保留）
  expect(listBackups(dataDir()).map((b) => b.file)).toContain(result.backupId);
  // 整体替换：本地旧任务消失、导出任务齐、联表关系保留
  const titles = (target.conn.prepare("SELECT title FROM tasks ORDER BY id").all() as Array<{ title: string }>).map(
    (r) => r.title,
  );
  expect(titles).toEqual(["写周报", '交报告, "最终"']);
  expect(scalar("SELECT g.name FROM tags g JOIN task_tags tt ON tt.tag_id=g.id WHERE tt.task_id=1")).toBe("重要");
  // 设置被整体替换；本机提示词覆盖不随导入覆盖
  expect(scalar("SELECT value FROM settings WHERE key='language'")).toBe("en");
  expect(scalar("SELECT value FROM settings WHERE key='ai_prompt_im_classify'")).toBe("本机规则");
  expect(scalar("SELECT COUNT(*) FROM chat_filter_prefs")).toBe(1);
}

function smuggledPromptRowsCase(): void {
  const crafted = craftVariant((p) => {
    (p.data!.settings as Array<Record<string, unknown>>).push({ key: "ai_prompt_capture", value: "夹带行" });
  });
  runImport(dataDir(), target.conn, crafted, new Date(2026, 9, 17, 12, 0, 0));
  expect(scalar("SELECT COUNT(*) FROM settings WHERE key LIKE 'ai_prompt_%'")).toBe(1);
  expect(scalar("SELECT COUNT(*) FROM settings WHERE key='ai_prompt_capture'")).toBe(0);
}

function backupFailureAbortsCase(): void {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(backupDir(dataDir()), ""); // backups 路径被普通文件占据 → 快照建目录即失败
  expect(pkyCode(() => runImport(dataDir(), target.conn, exportPath))).toBe("BACKUP_FAILED");
  expect(scalar("SELECT COUNT(*) FROM tasks WHERE title='本地旧任务'")).toBe(1);
  expect(scalar("SELECT value FROM settings WHERE key='language'")).toBe("fr");
}

function emptyCategoriesReseedCase(): void {
  const emptyCategories = craftVariant((p) => {
    p.data!.categories = [];
  });
  runImport(dataDir(), target.conn, emptyCategories, new Date(2026, 9, 17, 12, 0, 0));
  expect(scalar("SELECT COUNT(*) FROM categories")).toBe(5);
}

function jsonValueCoercionCase(): void {
  const crafted = craftVariant((p) => {
    const tasks = p.data!.tasks as Array<Record<string, unknown>>;
    tasks[0].focus_seconds = true; // boolean → 整数 1
    tasks[0].title = { deep: "对象" }; // 对象 → JSON 文本（桌面 other => Text(to_string) 同构）
  });
  const result = runImport(dataDir(), target.conn, crafted, new Date(2026, 9, 17, 12, 0, 0));
  expect(result.applied).toBe(12);
  expect(scalar("SELECT focus_seconds FROM tasks WHERE id=1")).toBe(1);
  expect(scalar("SELECT title FROM tasks WHERE id=1")).toBe(JSON.stringify({ deep: "对象" }));
}

describe("导入校验 validateImport", () => {
  it("合法导出：summary 形状（app / schemaVersion / counts / compatible）", validSummaryCase);
  it("app 字段不符：校验与执行同码拒绝，库 0 行变更（Gherkin 结构校验失败整体拒绝）", appMismatchRejectsCase);
  it("结构坏（非 JSON / 缺 data / 缺必需表 / 表非数组 / 行非对象）→ 同码拒绝", brokenStructureRejectsCase);
  it("列名白名单：未知列与含引号恶意列名整体拒绝（防未知列注入）", columnWhitelistCase);
  it(`解析深度限：嵌套超 ${IMPORT_MAX_DEPTH} 层拒绝`, depthLimitCase);
  it(`文件超过上限拒绝（${IMPORT_MAX_BYTES} 字节；稀疏文件探针不实写）`, sizeLimitCase);
  it("文件不存在 → NOT_FOUND；旧格式缺可选表 chat_filter_prefs 可通过", missingAndOptionalCase);
});

describe("导入执行 runImport", () => {
  it("前置快照 + 整体替换 + 提示词覆盖不随导入覆盖（Gherkin 导入前置快照与整体替换）", runImportReplacesCase);
  it("文件内夹带的 ai_prompt_* 行不导入（隐私排除面双向，桌面对照）", smuggledPromptRowsCase);
  it("导入前备份失败中止：不执行整体替换（Gherkin 导入前备份失败中止）", backupFailureAbortsCase);
  it("导入空分类的文件后默认分类补种（导入端 init 种子兜底）", emptyCategoriesReseedCase);
  it("JSON 值 → SQLite 值收敛：boolean → 1、对象 → JSON 文本（桌面 json_to_sql 同构）", jsonValueCoercionCase);
});
