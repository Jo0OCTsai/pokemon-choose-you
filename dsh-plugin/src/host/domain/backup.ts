/**
 * 数据备份与导出域（行为基准 = src-tauri/src/backup.rs + commands/export.rs）：
 * - 备份：`VACUUM INTO` 生成压缩快照（不含 WAL、可直接打开——与桌面产物完全一致），
 *   手动入口同样参与 backup_keep 滚动保留；
 * - 导出：全量 JSON（秘钥/内部标记/提示词覆盖除外）/ 任务 CSV（BOM + RFC4180 转义）/
 *   今日日报 Markdown，产物写 exports/ 目录。
 * 恢复 / 导入 / 每日自动备份调度不在本域（恢复需关库重开牵动 conn 生命周期、导入是
 * 整体替换语义、调度归桌面 Rust——dsh host 只做手动触发）。
 */
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Conn } from "../storage/db";
import { nowRfc3339 } from "../storage/db";
import { getSetting } from "./settings";
import { PROMPT_KEY_PREFIX } from "./prompt-overrides";

/** 备份文件名前缀 / 后缀（与 backup.rs NAME_PREFIX/NAME_SUFFIX 一致；列表与滚动清理共用） */
const NAME_PREFIX = "pokemon-choose-you-";
const NAME_SUFFIX = ".db";

/** 导出文件名前缀与全量 JSON 的 app 标识字段（export.rs APP_SLUG） */
const APP_SLUG = "pokemon-choose-you";

/** 全量导出包含的表（顺序即桌面 DUMP_TABLES 逐字；被引用表在前） */
const DUMP_TABLES = [
  "categories",
  "tasks",
  "tags",
  "task_tags",
  "task_notes",
  "task_logs",
  "chat_messages",
  "feishu_users",
  "sync_state",
  "settings",
  "chat_filter_prefs",
] as const;

/** 不随导出文件出库的 settings 行：内部迁移标记位（db.rs is_internal_setting_key） */
const INTERNAL_SETTING_KEYS = new Set(["ai_agent_presets_v2"]);

/** 备份目录：<dataDir>/backups（桌面 backup_dir 同路径——两形态共享同一份产物） */
export function backupDir(dataDir: string): string {
  return join(dataDir, "backups");
}

/** 导出目录：<dataDir>/exports（export.rs exports_dir 同路径） */
export function exportsDir(dataDir: string): string {
  return join(dataDir, "exports");
}

function isBackupName(name: string): boolean {
  return name.startsWith(NAME_PREFIX) && name.endsWith(NAME_SUFFIX);
}

/** 本地时间戳（backup.rs 同款 %Y%m%d-%H%M%S；导出文件名共用） */
function stampNow(now: Date): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}` +
    `-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`
  );
}

/** 本地日期串（YYYY-MM-DD；日报缺省口径） */
export function todayStr(now: Date): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
}

/** 备份条目（与桌面 BackupInfo 同构；createdAt 取文件修改时间的本地时区 RFC3339） */
export interface BackupInfo {
  file: string;
  size: number;
  createdAt: string;
}

/** mtime → 本地时区 RFC3339（chrono DateTime<Local>::to_rfc3339 同形态） */
function rfc3339Local(ms: number): string {
  const d = new Date(ms);
  const offsetMin = -d.getTimezoneOffset();
  const p2 = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const sign = offsetMin >= 0 ? "+" : "-";
  const shifted = new Date(ms + offsetMin * 60_000);
  return `${shifted.toISOString().replace(/\.\d{3}Z$/, "")}${sign}${p2(Math.floor(offsetMin / 60))}:${p2(offsetMin % 60)}`;
}

/**
 * 创建一份快照（VACUUM INTO：产物是压缩后的完整库，不含 WAL 垃圾——与桌面 create_backup
 * 同做法；相对「wal_checkpoint 后复制文件」能保证快照一致性且产物更小，且两形态产物同名
 * 同格式可互认）。同一秒内重复创建时追加序号避免覆盖。返回文件名。
 */
export function createBackup(dataDir: string, conn: Conn, now: Date = new Date()): string {
  const dir = backupDir(dataDir);
  mkdirSync(dir, { recursive: true });
  let name = `${NAME_PREFIX}${stampNow(now)}${NAME_SUFFIX}`;
  let n = 2;
  while (statSafe(join(dir, name)) !== undefined) {
    name = `${NAME_PREFIX}${stampNow(now)}-${n}${NAME_SUFFIX}`;
    n += 1;
  }
  conn.prepare("VACUUM INTO ?").run(join(dir, name));
  return name;
}

function statSafe(path: string): { size: number; mtimeMs: number } | undefined {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

/** 备份列表（按文件名字典序倒序 = 时间倒序；目录不存在返回空列表） */
export function listBackups(dataDir: string): BackupInfo[] {
  const dir = backupDir(dataDir);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: BackupInfo[] = [];
  for (const name of names) {
    if (!isBackupName(name)) {
      continue;
    }
    const meta = statSafe(join(dir, name));
    if (meta === undefined) {
      continue;
    }
    out.push({ file: name, size: meta.size, createdAt: rfc3339Local(meta.mtimeMs) });
  }
  out.sort((a, b) => (a.file < b.file ? 1 : a.file > b.file ? -1 : 0));
  return out;
}

/** 滚动清理：只保留最新 keep 份，返回删除数（清理失败不中断——桌面同口径） */
export function pruneBackups(dataDir: string, keep: number): number {
  const list = listBackups(dataDir);
  let removed = 0;
  for (const old of list.slice(Math.max(1, keep))) {
    try {
      rmSync(join(backupDir(dataDir), old.file));
      removed += 1;
    } catch {
      // 单个文件清理失败跳过（锁竞争等瞬时原因）
    }
  }
  return removed;
}

/**
 * 立即备份（commands/backup.rs create_backup_now 同构）：读 backup_keep 共享设置
 * （缺省 7、至少 1）→ 快照 → 滚动保留。返回新文件名与保留列表。
 */
export function runBackupNow(
  dataDir: string,
  conn: Conn,
  now: Date = new Date(),
): { file: string; files: BackupInfo[] } {
  const keepRaw = Number.parseInt(getSetting(conn, "backup_keep") ?? "", 10);
  const keep = Math.max(Number.isNaN(keepRaw) ? 7 : keepRaw, 1);
  const file = createBackup(dataDir, conn, now);
  pruneBackups(dataDir, keep);
  return { file, files: listBackups(dataDir) };
}

// ---- 全量 JSON 导出 ----

/** SQL 值 → JSON 值（dump_table 同构：Blob 以 0x 前缀往返，本库无 Blob 列、防御性处理） */
function toJsonValue(v: unknown): unknown {
  if (v instanceof Uint8Array) {
    const hex = Array.from(v.slice(0, 64), (b) => b.toString(16).padStart(2, "0")).join("");
    return `0x${hex}`;
  }
  if (typeof v === "bigint") {
    return Number(v);
  }
  return v;
}

/** settings 行是否随文件出库（export_json_to 同谓词：秘钥在系统钥匙串（桌面 SECRET_KEYS 现为空集）、内部迁移标记与提示词覆盖除外） */
function exportableSettingKey(key: unknown): boolean {
  return typeof key === "string" && !INTERNAL_SETTING_KEYS.has(key) && !key.startsWith(PROMPT_KEY_PREFIX);
}

/** 全量 JSON 导出（默认 exports/ 目录；返回写入的完整路径） */
export function exportFullJson(dataDir: string, conn: Conn, now: Date = new Date()): string {
  const data: Record<string, Array<Record<string, unknown>>> = {};
  for (const table of DUMP_TABLES) {
    const rows = conn.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
    data[table] = table === "settings" ? rows.filter((r) => exportableSettingKey(r.key)) : rows;
  }
  for (const rows of Object.values(data)) {
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        row[key] = toJsonValue(row[key]);
      }
    }
  }
  const payload = {
    app: APP_SLUG,
    format: 1,
    exportedAt: nowRfc3339(now),
    data,
  };
  const pretty = `${JSON.stringify(payload, null, 2)}\n`;
  return writeExport(dataDir, `${APP_SLUG}-full-${stampNow(now)}.json`, pretty);
}

/** 写导出文件（exports/ 目录不存在则创建），返回完整路径 */
function writeExport(dataDir: string, name: string, content: string): string {
  const dir = exportsDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

// ---- 任务 CSV ----

/** RFC 4180 转义（csv_field 逐字）：含逗号/引号/换行的字段加引号并双写引号 */
function csvField(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

/** 任务 CSV 导出（带 UTF-8 BOM，Excel 友好；列与查询与 export_csv_to 逐字一致） */
export function exportTasksCsv(dataDir: string, conn: Conn, now: Date = new Date()): string {
  const rows = conn
    .prepare(
      "SELECT t.id, t.title, t.status, t.priority, c.name AS category, " +
        "COALESCE((SELECT group_concat(name, ' ') FROM tags g JOIN task_tags tt ON tt.tag_id=g.id WHERE tt.task_id=t.id), '') AS tags, " +
        "t.due_at, t.remind_at, t.focus_seconds, t.source, t.created_at, t.completed_at " +
        "FROM tasks t LEFT JOIN categories c ON c.id = t.category_id ORDER BY t.id",
    )
    .all() as Array<Record<string, unknown>>;
  let out = "\u{feff}";
  out += "id,title,status,priority,category,tags,due_at,remind_at,focus_seconds,source,created_at,completed_at\n";
  for (const r of rows) {
    const fields = [
      r.id,
      r.title,
      r.status,
      r.priority,
      r.category ?? "",
      r.tags ?? "",
      r.due_at ?? "",
      r.remind_at ?? "",
      r.focus_seconds,
      r.source,
      r.created_at,
      r.completed_at ?? "",
    ].map((f) => csvField(String(f ?? "")));
    out += `${fields.join(",")}\n`;
  }
  return writeExport(dataDir, `${APP_SLUG}-tasks-${stampNow(now)}.csv`, out);
}

// ---- 今日日报 Markdown ----

/**
 * RFC3339 → 本地日期串（local_date 同构）：要求带时区偏移的完整形态
 * （chrono parse_from_rfc3339 同判——缺偏移的裸本地串返回 null 不误收）
 */
function localDate(s: string | null | undefined): string | null {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}T.*([Zz]|[+-]\d{2}:\d{2})$/.test(s)) {
    return null;
  }
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) {
    return null;
  }
  return todayStr(new Date(ms));
}

/** 今日日报导出（export_daily_md_to 逐字：今日捕捉/路线上/今日跟进三段），返回完整路径 */
export function exportDailyReport(dataDir: string, conn: Conn, date: string): string {
  let md = `# 训练家日报 · ${date}\n\n`;

  // 今日捕捉（完成）：按 completed_at 的本地日期归入
  const done = (
    conn
      .prepare(
        "SELECT t.title, t.priority, t.focus_seconds, c.name AS category, c.pokemon, t.completed_at " +
          "FROM tasks t LEFT JOIN categories c ON c.id = t.category_id " +
          "WHERE t.status = 'done' ORDER BY t.completed_at",
      )
      .all() as Array<Record<string, unknown>>
  ).filter((r) => localDate(r.completed_at as string | null) === date);
  const focusTotal = done.reduce((sum, r) => sum + Number(r.focus_seconds ?? 0), 0);
  md += `今日捕捉 ${done.length} 只，专注 ${Math.floor(focusTotal / 60)} 分钟。\n\n`;
  if (done.length > 0) {
    md += "## 已捕捉\n\n";
    for (const r of done) {
      const focus = Number(r.focus_seconds ?? 0);
      const minute = focus >= 60 ? ` · 专注 ${Math.floor(focus / 60)} 分钟` : "";
      md += `- ✅ ${r.title}（${r.category ?? ""}·${r.pokemon ?? ""} · ${r.priority}${minute}）\n`;
    }
    md += "\n";
  }

  // 进行中 / 路线上
  const open = conn
    .prepare(
      "SELECT t.title, t.status, t.due_at, c.name AS category FROM tasks t " +
        "LEFT JOIN categories c ON c.id = t.category_id " +
        "WHERE t.status IN ('active','paused','scheduled','inbox') ORDER BY t.due_at",
    )
    .all() as Array<Record<string, unknown>>;
  if (open.length > 0) {
    md += "## 路线上\n\n";
    const walking = open.filter((r) => r.status === "active" || r.status === "paused");
    const rest = open.filter((r) => r.status !== "active" && r.status !== "paused");
    for (const r of walking) {
      md += `- 🚶 ${r.title}（${r.category ?? ""}）\n`;
    }
    for (const r of rest) {
      const dueStr =
        String(r.due_at ?? "")
          .replaceAll("T", " ")
          .split(".")[0] ?? "";
      const duePart = dueStr === "" ? "" : ` · 截止 ${dueStr}`;
      md += `- [ ] ${r.title}（${r.category ?? ""}${duePart}）\n`;
    }
    md += "\n";
  }

  // 今日跟进记录
  const notes = (
    conn
      .prepare(
        "SELECT n.content, n.created_at, t.id AS tid, t.title, n.source " +
          "FROM task_notes n JOIN tasks t ON t.id = n.task_id ORDER BY n.created_at",
      )
      .all() as Array<Record<string, unknown>>
  ).filter((r) => localDate(r.created_at as string | null) === date);
  if (notes.length > 0) {
    md += "## 今日跟进\n\n";
    for (const r of notes) {
      const tag = r.source === "ai" ? "AI " : "";
      md += `- No.${r.tid} ${r.title}：${tag}${r.content}\n`;
    }
  }
  return writeExport(dataDir, `${APP_SLUG}-daily-${date}.md`, md);
}
