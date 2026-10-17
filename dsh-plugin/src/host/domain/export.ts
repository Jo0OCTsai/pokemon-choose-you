/**
 * 数据导出域（从 backup.ts 拆出以控文件规模——复杂度棘轮；行为基准 = src-tauri/src/
 * commands/export.rs）：全量 JSON（秘钥/内部标记/提示词覆盖除外）/ 任务 CSV（BOM +
 * RFC4180 转义）/ 今日日报 Markdown，产物写 exports/ 目录。备份域见 backup.ts
 * （本文件公共件由其再出口，消费面 import 不变）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Conn } from "../storage/db";
import { nowRfc3339 } from "../storage/db";
import { PROMPT_KEY_PREFIX } from "./prompt-overrides";

/** 导出文件名前缀与全量 JSON 的 app 标识字段（export.rs APP_SLUG） */
export const APP_SLUG = "pokemon-choose-you";

/** 导出目录：<dataDir>/exports（export.rs exports_dir 同路径） */
export function exportsDir(dataDir: string): string {
  return join(dataDir, "exports");
}

/** 本地时间戳（backup.rs 同款 %Y%m%d-%H%M%S；导出文件名共用） */
export function stampNow(now: Date): string {
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

/** 全量导出包含的表（顺序即桌面 DUMP_TABLES 逐字；被引用表在前。导入域按同序整体替换） */
export const DUMP_TABLES = [
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

/** settings 行是否随文件出库（export_json_to 同谓词：秘钥在系统钥匙串（桌面 SECRET_KEYS 现为空集）、内部迁移标记与提示词覆盖除外）。导入端对文件内行按同谓词过滤 */
export function exportableSettingKey(key: unknown): boolean {
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

/** 今日捕捉段（完成：按 completed_at 的本地日期归入，含专注合计与逐条明细） */
function dailyCaughtSection(conn: Conn, date: string): string {
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
  let md = `今日捕捉 ${done.length} 只，专注 ${Math.floor(focusTotal / 60)} 分钟。\n\n`;
  if (done.length > 0) {
    md += "## 已捕捉\n\n";
    for (const r of done) {
      const focus = Number(r.focus_seconds ?? 0);
      const minute = focus >= 60 ? ` · 专注 ${Math.floor(focus / 60)} 分钟` : "";
      md += `- ✅ ${r.title}（${r.category ?? ""}·${r.pokemon ?? ""} · ${r.priority}${minute}）\n`;
    }
    md += "\n";
  }
  return md;
}

/** 路线上段（进行中/暂停在前，余量带截止） */
function dailyOpenSection(conn: Conn): string {
  const open = conn
    .prepare(
      "SELECT t.title, t.status, t.due_at, c.name AS category FROM tasks t " +
        "LEFT JOIN categories c ON c.id = t.category_id " +
        "WHERE t.status IN ('active','paused','scheduled','inbox') ORDER BY t.due_at",
    )
    .all() as Array<Record<string, unknown>>;
  if (open.length === 0) {
    return "";
  }
  let md = "## 路线上\n\n";
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
  return `${md}\n`;
}

/** 今日跟进段（AI 来源带 AI 前缀） */
function dailyNotesSection(conn: Conn, date: string): string {
  const notes = (
    conn
      .prepare(
        "SELECT n.content, n.created_at, t.id AS tid, t.title, n.source " +
          "FROM task_notes n JOIN tasks t ON t.id = n.task_id ORDER BY n.created_at",
      )
      .all() as Array<Record<string, unknown>>
  ).filter((r) => localDate(r.created_at as string | null) === date);
  if (notes.length === 0) {
    return "";
  }
  let md = "## 今日跟进\n\n";
  for (const r of notes) {
    const tag = r.source === "ai" ? "AI " : "";
    md += `- No.${r.tid} ${r.title}：${tag}${r.content}\n`;
  }
  return md;
}

/** 今日日报导出（export_daily_md_to 逐字：今日捕捉/路线上/今日跟进三段），返回完整路径 */
export function exportDailyReport(dataDir: string, conn: Conn, date: string): string {
  const md =
    `# 训练家日报 · ${date}\n\n` +
    dailyCaughtSection(conn, date) +
    dailyOpenSection(conn) +
    dailyNotesSection(conn, date);
  return writeExport(dataDir, `${APP_SLUG}-daily-${date}.md`, md);
}
