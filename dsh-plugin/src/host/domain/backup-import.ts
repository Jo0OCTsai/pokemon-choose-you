/**
 * 备份域 · 导入（从 backup.ts 拆件以控文件规模——复杂度棘轮；与 export.ts 拆件同先例，
 * 消费面直接 import 本文件）。行为基准 = 桌面 export.rs import_json_from，并按 D25 /
 * AD §4.1 补齐插件侧口径：结构校验（app/format 信封、必需表齐全、列名白名单只认本库
 * schema 列防未知列注入、≤100MB、解析深度限——不符整体拒绝 0 行变更）→ 前置自动备份
 * （失败即中止 BACKUP_FAILED）→ 单条 BEGIN IMMEDIATE 内整体替换（秘钥与提示词覆盖行
 * stash-and-restore 不随导入覆盖）+ 默认分类补种。读导出文件与前置快照都在事务外。
 */
import { readFileSync, statSync } from "node:fs";
import { txImmediate, type Conn } from "../storage/db";
import { notFound, PkyError } from "../storage/errors";
import { normalizeLegacyAgentPresets, seedDefaults } from "../storage/seed";
import { preBackupOrThrow } from "./backup";
import { APP_SLUG, DUMP_TABLES, exportableSettingKey } from "./export";
import { PROMPT_KEY_PREFIX } from "./prompt-overrides";

/** 导入文件大小上限（100MB——AD §4.1 importValidate；防损坏/恶意大文件拖垮 host） */
export const IMPORT_MAX_BYTES = 100 * 1024 * 1024;

/** 解析深度上限（信封 1 + data 2 + 表数组 3 + 行对象 4 + 标量 5；恶意深嵌套整体拒绝） */
export const IMPORT_MAX_DEPTH = 8;

/** 导出格式版本（export.ts format 字段唯一合法值；summary.schemaVersion 的数据源） */
const IMPORT_FORMAT = 1;

/** 导入可缺键的表（export.rs IMPORT_OPTIONAL_TABLES 同款：后加表在旧导出文件中缺键容忍） */
const IMPORT_OPTIONAL_TABLES = new Set(["chat_filter_prefs"]);

/** 秘钥类设置键（桌面 secrets.rs SECRET_KEYS——现为空集：Todoist 下线后无活跃秘钥；回落模式存量行不随导入覆盖） */
const SECRET_SETTING_KEYS = new Set<string>([]);

/** 导入校验摘要（importValidate 响应面，AD §4.1） */
export interface ImportSummary {
  app: string;
  schemaVersion: number;
  counts: Record<string, number>;
  compatible: boolean;
}

/** 导入域错误码收敛件（恢复域对「备份文件坏 / 文件名不符白名单」复用同码） */
export function importError(message: string, hint?: string): PkyError {
  return new PkyError("IMPORT_VALIDATION_FAILED", message, hint);
}

/** 本机不随导入覆盖的 settings 行：秘钥（回落存量）+ 提示词覆盖（与导出排除面同策略） */
function preservedSettingKey(key: unknown): boolean {
  return typeof key === "string" && (SECRET_SETTING_KEYS.has(key) || key.startsWith(PROMPT_KEY_PREFIX));
}

/** 文件内 settings 行是否导入（秘钥/内部迁移标记/提示词覆盖行照谓词过滤——桌面对照） */
function importableSettingRow(row: Record<string, unknown>): boolean {
  return !preservedSettingKey(row.key) && exportableSettingKey(row.key);
}

// ---- 解析与结构校验 ----

/** 迭代式深度探测（递归实现在恶意深嵌套输入上会先爆栈——栈显式扩到与深度同阶） */
function maxJsonDepth(root: unknown): number {
  let max = 1;
  const stack: Array<[unknown, number]> = [[root, 1]];
  while (stack.length > 0) {
    const [value, depth] = stack.pop() as [unknown, number];
    if (depth > max) {
      max = depth;
    }
    if (value !== null && typeof value === "object") {
      const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
      for (const child of children) {
        stack.push([child, depth + 1]);
      }
    }
  }
  return max;
}

/** JSON 解析 + 深度限 + 顶层形状（解析错误统一收敛为 IMPORT_VALIDATION_FAILED） */
function parseEnvelope(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw importError(`不是合法的 JSON 文件：${String(error)}`);
  }
  if (maxJsonDepth(parsed) > IMPORT_MAX_DEPTH) {
    throw importError(`解析深度超限（> ${IMPORT_MAX_DEPTH} 层）`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw importError("导出文件结构坏：顶层不是对象");
  }
  return parsed as Record<string, unknown>;
}

/** 信封校验（app / format / data 字段），返回 data 对象 */
function parseDataField(envelope: Record<string, unknown>): Record<string, unknown> {
  if (envelope.app !== APP_SLUG || envelope.format !== IMPORT_FORMAT) {
    throw importError("不是「就决定是你了」的全量导出文件（app / format 不符）");
  }
  const data = envelope.data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw importError("导出文件缺少 data 字段");
  }
  return data as Record<string, unknown>;
}

/** 表在 live schema 的列集（列名白名单数据源——只认本库 schema 列，防未知列注入） */
function schemaColumns(conn: Conn, table: string): Set<string> {
  const cols = conn.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(cols.map((c) => c.name));
}

/** 取一张表的行数组（可缺键表缺省空数组；非数组/非对象行 = 结构坏） */
function collectRows(data: Record<string, unknown>, table: string): Array<Record<string, unknown>> {
  const value = data[table];
  if (value === undefined) {
    if (IMPORT_OPTIONAL_TABLES.has(table)) {
      return [];
    }
    throw importError(`导出文件缺少 ${table} 表`);
  }
  if (!Array.isArray(value)) {
    throw importError(`「${table}」不是数组`);
  }
  for (const row of value) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      throw importError(`「${table}」含非对象行`);
    }
  }
  return value as Array<Record<string, unknown>>;
}

/** 列名白名单：行内键集必须 ⊆ 本库该表列集（含引号注入等任何非 schema 列名一律拒绝） */
function assertColumnsKnown(rows: Array<Record<string, unknown>>, table: string, schema: Set<string>): void {
  for (const row of rows) {
    for (const col of Object.keys(row)) {
      if (!schema.has(col)) {
        throw importError(`导入文件的「${table}」含非法列名「${col}」`);
      }
    }
  }
}

/** 读取并整体校验导出文件（validateImport / runImport 共用；不符抛 IMPORT_VALIDATION_FAILED） */
function loadImport(conn: Conn, path: string): Map<string, Array<Record<string, unknown>>> {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    throw notFound(`导入文件不存在：${path}`);
  }
  if (size > IMPORT_MAX_BYTES) {
    throw importError(`文件超过 ${IMPORT_MAX_BYTES} 字节上限`);
  }
  const data = parseDataField(parseEnvelope(readFileSync(path, "utf8")));
  const tables = new Map<string, Array<Record<string, unknown>>>();
  for (const table of DUMP_TABLES) {
    const rows = collectRows(data, table);
    assertColumnsKnown(rows, table, schemaColumns(conn, table));
    tables.set(table, table === "settings" ? rows.filter(importableSettingRow) : rows);
  }
  return tables;
}

// ---- 导入执行 ----

/** JSON 值 → SQLite 绑定值（桌面 json_to_sql 同构；node:sqlite 不收 boolean/undefined） */
function jsonToSqlValue(v: unknown): string | number | null {
  if (v === null || v === undefined) {
    return null;
  }
  switch (typeof v) {
    case "boolean":
      return v ? 1 : 0;
    case "string":
      return v;
    default:
      return typeof v === "number" ? v : JSON.stringify(v);
  }
}

/** 按行键并集插入（列名已过白名单；返回插入行数）。0x 前缀 Blob 往返不解码——本库无 Blob 列，按 TEXT 原样 */
function insertRows(conn: Conn, table: string, rows: Array<Record<string, unknown>>): number {
  if (rows.length === 0) {
    return 0;
  }
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const colList = cols.map((c) => `"${c}"`).join(",");
  const stmt = conn.prepare(`INSERT INTO ${table} (${colList}) VALUES (${cols.map(() => "?").join(",")})`);
  for (const row of rows) {
    stmt.run(...cols.map((c) => jsonToSqlValue(row[c])));
  }
  return rows.length;
}

/** 事务内先暂存秘钥/提示词覆盖行（整体替换后放回——桌面 stash-and-restore 同款） */
function stashPreservedSettings(conn: Conn): Array<Record<string, unknown>> {
  const rows = conn.prepare("SELECT key, value FROM settings").all() as Array<Record<string, unknown>>;
  return rows.filter((r) => preservedSettingKey(r.key));
}

/**
 * 导入执行（importRun 语义）：校验（不符 0 行变更、不产生备份）→ 前置自动备份（D25
 * 失败中止）→ 单条 BEGIN IMMEDIATE 内整体替换 + 暂存行放回 + 默认分类补种（导入不触
 * user_version，无需补跑迁移）。返回前置快照文件名（backupId）与导入行计数。
 */
export function runImport(
  dataDir: string,
  conn: Conn,
  path: string,
  now: Date = new Date(),
): { backupId: string; applied: number } {
  const tables = loadImport(conn, path);
  const backupId = preBackupOrThrow(dataDir, conn, now);
  const applied = txImmediate(conn, () => {
    const stash = stashPreservedSettings(conn);
    let total = 0;
    for (const table of DUMP_TABLES) {
      conn.exec(`DELETE FROM ${table}`);
      total += insertRows(conn, table, tables.get(table) ?? []);
    }
    insertRows(conn, "settings", stash);
    seedDefaults(conn);
    normalizeLegacyAgentPresets(conn);
    return total;
  });
  return { backupId, applied };
}

/** 导入只读预检（importValidate 语义）：结构与摘要，不产生任何变更 */
export function validateImport(conn: Conn, path: string): ImportSummary {
  const tables = loadImport(conn, path);
  const counts: Record<string, number> = {};
  for (const [table, rows] of tables) {
    counts[table] = rows.length;
  }
  return { app: APP_SLUG, schemaVersion: IMPORT_FORMAT, counts, compatible: true };
}
