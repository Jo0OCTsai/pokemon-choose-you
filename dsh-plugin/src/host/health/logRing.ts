/**
 * 插件运行日志：内存环形缓冲（支持报告数据源，随宿主进程存亡）+ logQuery 查询面
 * （A24 起；ADR-0005 起插件自身日志另经 fileLogSink 落盘共享日志文件，查询面随之
 * 改磁盘单源）。行为基准 = src-tauri/src/commands/diagnostics.rs 的 list_log_entries
 * tail 口径（默认 500、上限 2000）与 LogEntry 字段集（time/level/target/message）；
 * message 出 host 边界前经三层脱敏管线（与支持报告同源，NFR-2 ⑥）。
 * 查询面读共享日志目录最新 .log 文件（<appHome>/logs，桌面 Tauri / pk CLI / 插件
 * fileLogSink 三方同写——桌面 app 不在时插件与 pk 轨迹仍持续可见）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Conn } from "../storage/db";
import { collectSensitiveNames, redactWithNames } from "./redact";

/** 环形缓冲容量（A24：对齐主应用日志查看器上限 2000） */
export const LOG_RING_CAPACITY = 2000;

/** logQuery limit 默认值与上限（list_log_entries 的 `.unwrap_or(500).min(2000)`） */
export const LOG_TAIL_DEFAULT = 500;
export const LOG_TAIL_MAX = 2000;

export type LogLevel = "debug" | "info" | "warn" | "error";

/** 一条运行日志（字段集对齐主应用 LogEntry） */
export interface LogEntry {
  /** 原始时间戳（展示用；ring.log 生成 RFC3339） */
  time: string;
  /** debug / info / warn / error */
  level: string;
  /** 日志目标（模块名，如 radio/pollLoop） */
  target: string;
  message: string;
}

export interface LogQueryParams {
  minLevel?: string;
  target?: string;
  offset?: number;
  limit?: number;
}

/** 日志级别权重（level_rank 同构；未知级别 0 不参与 minLevel 过滤语义） */
export function levelRank(level: string): number {
  switch (level) {
    case "error":
      return 4;
    case "warn":
      return 3;
    case "info":
      return 2;
    case "debug":
    case "trace":
      return 1;
    default:
      return 0;
  }
}

/**
 * 内存环形缓冲（2000 条滚动）：push 顺序追加、超容量丢最旧；
 * query 在缓冲上过滤（级别/来源），不拉全量出边界。
 */
export class LogRing {
  private entries: LogEntry[] = [];

  push(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > LOG_RING_CAPACITY) {
      this.entries.splice(0, this.entries.length - LOG_RING_CAPACITY);
    }
  }

  /** 便捷记录（time = RFC3339；message 原文存内存，脱敏发生在查询出口） */
  log(level: LogLevel, target: string, message: string, time: string): void {
    this.push({ time, level, target, message });
  }

  get size(): number {
    return this.entries.length;
  }

  /** 过滤 + 最新在上；返回的是内存原文本（出口脱敏由 logQuery 完成） */
  query(params: LogQueryParams = {}): { entries: LogEntry[]; total: number } {
    const minRank = levelRank(params.minLevel ?? "");
    const target = params.target?.trim() ?? "";
    const matched = this.entries.filter((e) => {
      if (minRank > 0 && levelRank(e.level) < minRank) {
        return false;
      }
      return target === "" || e.target === target;
    });
    const offset = Math.max(0, params.offset ?? 0);
    const limit = Math.min(LOG_TAIL_MAX, Math.max(0, params.limit ?? LOG_TAIL_DEFAULT));
    const newest = matched.slice().reverse();
    return { entries: newest.slice(offset, offset + limit), total: matched.length };
  }

  /** 缓冲全量原文本拷贝（logQuery 合并磁盘日志时的环侧输入；最新在数组尾） */
  all(): LogEntry[] {
    return this.entries.slice();
  }
}

/** 单行 → LogEntry（diagnostics.rs parse_log_line 同构：[date][time][target][LEVEL] msg） */
function parseDiskLogLine(line: string): LogEntry | null {
  let rest = line;
  const groups: string[] = [];
  for (let i = 0; i < 4; i++) {
    if (!rest.startsWith("[")) {
      return null;
    }
    const end = rest.indexOf("]");
    if (end < 0) {
      return null;
    }
    groups.push(rest.slice(1, end));
    rest = rest.slice(end + 1);
  }
  const level = groups[3].toLowerCase();
  if (levelRank(level) === 0) {
    return null; // 第四段不是日志级别，按非日志行处理
  }
  return { time: `${groups[0]} ${groups[1]}`, level, target: groups[2], message: rest.trimStart() };
}

/** 多行解析（续行并入上一条 message——diagnostics.rs parse_log_lines 同构；
 *  split 的尾空段先丢弃，对齐 Rust lines() 不产尾空行的语义） */
export function parseDiskLogLines(content: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  for (const line of lines) {
    const entry = parseDiskLogLine(line);
    if (entry !== null) {
      entries.push(entry);
    } else if (entries.length > 0) {
      const last = entries[entries.length - 1];
      last.message += `\n${line}`;
    }
  }
  return entries;
}

/** 目录内最新 .log 文件（db.rs newest_log_file 同构：按 mtime 取最大；目录缺失/读失败 = null） */
function newestLogFile(dir: string): string | null {
  try {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".log"))
      .map((f) => join(dir, f));
    let newest: { path: string; mtime: number } | null = null;
    for (const path of files) {
      const mtime = statSync(path).mtimeMs;
      if (newest === null || mtime > newest.mtime) {
        newest = { path, mtime };
      }
    }
    return newest?.path ?? null;
  } catch {
    return null;
  }
}

/** 读主应用共享日志的最新文件（桌面 list_log_entries 同数据源；文件缺失/读失败 = 空集不报错） */
export function readDiskEntries(dir: string): LogEntry[] {
  const file = newestLogFile(dir);
  if (file === null) {
    return [];
  }
  try {
    return parseDiskLogLines(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

/**
 * host 命令 logQuery：磁盘单源（ADR-0005）——读共享日志目录最新文件，级别/来源过滤后
 * 从最新端分页（文件序即时间序，桌面 list_log_entries 同口径不排序；插件增量 = 来源
 * 子串匹配 + offset 分页）。message 出边界前经三层脱敏（名词表查一次库做快照，整批复用）。
 */
export function logQuery(
  conn: Conn,
  params: LogQueryParams = {},
  logDir?: string,
): { entries: LogEntry[]; total: number } {
  const names = collectSensitiveNames(conn);
  const minRank = levelRank(params.minLevel ?? "");
  const needle = (params.target ?? "").trim().toLowerCase();
  const filtered = (logDir === undefined ? [] : readDiskEntries(logDir)).filter((e) => {
    if (minRank > 0 && levelRank(e.level) < minRank) {
      return false;
    }
    return needle === "" || e.target.toLowerCase().includes(needle) || e.message.toLowerCase().includes(needle);
  });
  const offset = Math.max(0, params.offset ?? 0);
  const limit = Math.min(LOG_TAIL_MAX, Math.max(0, params.limit ?? LOG_TAIL_DEFAULT));
  const start = Math.max(0, filtered.length - offset - limit);
  const page = filtered.slice(start, filtered.length - offset).reverse();
  return {
    entries: page.map((e) => ({ ...e, message: redactWithNames(names, e.message) })),
    total: filtered.length,
  };
}
