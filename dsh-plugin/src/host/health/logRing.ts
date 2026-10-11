/**
 * 插件运行日志：内存环形缓冲 + logQuery 查询面（A24）——host 半边自身日志的
 * 唯一数据源（不落盘，随宿主进程存亡；跨重启排障走支持报告与宿主进程日志）。
 * 行为基准 = src-tauri/src/commands/diagnostics.rs 的 list_log_entries tail 口径
 * （默认 500、上限 2000）与 LogEntry 字段集（time/level/target/message）；
 * message 出 host 边界前经三层脱敏管线（与支持报告同源，NFR-2 ⑥）。
 */
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
}

/**
 * host 命令 logQuery：级别/来源过滤 host 侧在缓冲上执行，最新在上，
 * message 出边界前经三层脱敏（名词表查一次库做快照，整批复用）。
 */
export function logQuery(
  conn: Conn,
  ring: LogRing,
  params: LogQueryParams = {},
): { entries: LogEntry[]; total: number } {
  const names = collectSensitiveNames(conn);
  const { entries, total } = ring.query(params);
  return {
    entries: entries.map((e) => ({ ...e, message: redactWithNames(names, e.message) })),
    total,
  };
}
