/**
 * 备份域 · 恢复（从 backup.ts 拆件以控文件规模——复杂度棘轮；消费面直接 import 本文件）。
 * 行为基准 = 桌面 backup.rs restore_backup + commands/backup.rs，并按 D25 / AD §4.1 补齐
 * 插件侧口径：文件名白名单（pokemon-choose-you- 前缀 + .db 后缀、显式拒 `/` 与 `\`——
 * 桌面 is_backup_name 同款）→ 备份 user_version 超插件兼容窗口拒绝（DB_SCHEMA_TOO_NEW，
 * 只读保护语义延伸，库不动）→ 前置自动备份（失败即中止 BACKUP_FAILED）→ ATTACH 源库
 * 单事务逐表灌回（桌面在线 backup API 的等价语义：schema 保持本库版本，旧版本备份缺的
 * 表清空、缺的列取默认值）→ 默认分类补种 + 补写当日 last_backup_date（恢复把 settings
 * 回滚，标记一并补上防 backupLoop 当日再跑——桌面 commands/backup.rs 先例）。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getUserVersion, txImmediate, type Conn } from "../storage/db";
import { notFound, paramError, PkyError } from "../storage/errors";
import { MAX_SCHEMA } from "../storage/migrate";
import { DEFAULT_CATEGORIES, DEFAULT_TAG_DIMENSIONS, normalizeLegacyAgentPresets, seedDefaults } from "../storage/seed";
import { backupDir, isBackupName, preBackupOrThrow } from "./backup";
import { importError } from "./backup-import";
import { todayStr } from "./export";
import { setSetting } from "./settings";

/** 恢复源 ATTACH 别名（恢复全程唯一；finally DETACH） */
const RESTORE_SRC = "pky_restore_src";

/** 恢复源（restoreRun 入参：backupId / path 择一，均为备份目录内文件名） */
export interface RestoreSource {
  backupId?: string;
  path?: string;
}

/** 恢复源文件名解析与白名单（桌面 is_backup_name + 拒路径分隔符同款） */
function requireRestoreFile(source: RestoreSource): string {
  const file = source.backupId ?? source.path;
  if (typeof file !== "string" || file === "") {
    throw paramError("恢复源缺少 backupId / path");
  }
  if (!isBackupName(file) || file.includes("/") || file.includes("\\")) {
    throw importError(`非法备份文件名：${file}`, "只认备份目录内 pokemon-choose-you-*.db 文件名");
  }
  return file;
}

/** ATTACH 恢复源（坏文件在打开即报——统一收敛为 IMPORT_VALIDATION_FAILED「备份文件坏」） */
function attachSource(conn: Conn, path: string): void {
  const escaped = path.replaceAll("'", "''");
  try {
    conn.exec(`ATTACH DATABASE '${escaped}' AS ${RESTORE_SRC}`);
  } catch (error) {
    throw importError(`备份文件坏，无法打开：${String(error)}`);
  }
}

/** 备份 user_version 超插件兼容窗口 → 拒绝（只读保护语义延伸到恢复通道，复用码） */
function guardSourceVersion(conn: Conn): void {
  const row = conn.prepare(`PRAGMA ${RESTORE_SRC}.user_version`).get() as { user_version: number };
  if (row.user_version > MAX_SCHEMA) {
    throw new PkyError(
      "DB_SCHEMA_TOO_NEW",
      `备份 user_version=${row.user_version} 超出插件兼容窗口（≤ ${MAX_SCHEMA}）`,
      "请用新版主应用处理后再导出恢复",
    );
  }
}

/** 指定库（main / RESTORE_SRC）某表的列名列表 */
function columnsOf(conn: Conn, db: string, table: string): string[] {
  const cols = conn.prepare(`PRAGMA ${db}.table_info(${table})`).all() as Array<{ name: string }>;
  return cols.map((c) => c.name);
}

/** 单事务逐表灌回：遍历本库全部用户表（列集取源 ∩ 本库；源缺表清空即止） */
function copyAllTables(conn: Conn): void {
  const names = (
    conn
      .prepare("SELECT name FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{
      name: string;
    }>
  ).map((r) => r.name);
  for (const table of names) {
    conn.exec(`DELETE FROM main."${table}"`);
    const mainCols = new Set(columnsOf(conn, "main", table));
    const cols = columnsOf(conn, RESTORE_SRC, table).filter((c) => mainCols.has(c));
    if (cols.length === 0) {
      continue;
    }
    const colList = cols.map((c) => `"${c}"`).join(",");
    conn.exec(`INSERT INTO main."${table}" (${colList}) SELECT ${colList} FROM ${RESTORE_SRC}."${table}"`);
  }
}

/** 默认分类/维度缺行计数（恢复响应 seeded 字段：恢复后补种是否实际补了行） */
function defaultGapCount(conn: Conn): number {
  let gap = 0;
  for (const c of DEFAULT_CATEGORIES) {
    if (conn.prepare("SELECT 1 FROM categories WHERE id=? OR name=?").get(c.id, c.name) === undefined) {
      gap += 1;
    }
  }
  for (const d of DEFAULT_TAG_DIMENSIONS) {
    if (conn.prepare("SELECT 1 FROM tag_dimensions WHERE id=? OR key=?").get(d.id, d.key) === undefined) {
      gap += 1;
    }
  }
  return gap;
}

/**
 * 恢复执行（restoreRun 语义）：白名单 → 打开源库（坏文件拒）→ 超窗拒（库不动、无前置
 * 快照）→ 前置自动备份（D25 失败中止；不 prune——防把恢复源本身清出保留窗口）→ 单事务
 * 灌回 + 补种 + 补写当日 last_backup_date。返回前置快照名 / 恢复后 user_version / 补种标记。
 */
export function runRestore(
  dataDir: string,
  conn: Conn,
  source: RestoreSource,
  now: Date = new Date(),
): { backupId: string; migratedTo: number; seeded: boolean } {
  const file = requireRestoreFile(source);
  const path = join(backupDir(dataDir), file);
  if (!existsSync(path)) {
    throw notFound(`备份 ${file} 不存在`);
  }
  attachSource(conn, path);
  try {
    guardSourceVersion(conn);
    const backupId = preBackupOrThrow(dataDir, conn, now);
    const seeded = txImmediate(conn, () => {
      copyAllTables(conn);
      const gap = defaultGapCount(conn);
      seedDefaults(conn);
      normalizeLegacyAgentPresets(conn);
      setSetting(conn, "last_backup_date", todayStr(now));
      return gap > 0;
    });
    return { backupId, migratedTo: getUserVersion(conn), seeded };
  } finally {
    try {
      conn.exec(`DETACH DATABASE ${RESTORE_SRC}`);
    } catch {
      // 连接级故障下 DETACH 可能再抛——保留原始异常（finally 不掩盖）
    }
  }
}
