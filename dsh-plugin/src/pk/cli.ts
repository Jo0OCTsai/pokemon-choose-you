/**
 * pk CLI 基础设施（对齐 src-tauri/src/bin/pk/cli.rs 逐条目）：错误类型与退出码、
 * 日志行、数据库连接、参数解析与通用取值校验。信封契约（contracts/cli_envelope）
 * 锁定本面与 Rust 实现的 stdout/stderr/退出码一致性。
 */
import { existsSync, mkdirSync, openSync, writeSync, closeSync } from "node:fs";
import { dirname, join } from "node:path";
import { appHome, DATA_SUBDIR, DB_FILE } from "../host/storage/paths";
import { open as openConn, type Conn } from "../host/storage/db";
import { PkyError } from "../host/storage/errors";

/** CLI 错误：message + 退出码（0 成功 / 1 业务 / 2 用法） */
export class CliError extends Error {
  constructor(
    msg: string,
    public readonly code: number,
  ) {
    super(msg);
    this.name = "CliError";
  }
}

/** 错误出口：`{"error": "..."}` 到 stderr + 指定退出码（fail 同构） */
export function fail(msg: string, code: number): never {
  cliLog("ERROR", `失败退出（码 ${code}）: ${msg}`);
  process.stderr.write(`${JSON.stringify({ error: msg })}\n`);
  process.exit(code);
}

/**
 * 往应用日志文件追加一行轨迹（cli_log 同构）：格式与 tauri-plugin-log 一致，
 * 单行一次 O_APPEND 写入；任何失败静默放弃（日志不碍主流程）。
 */
export function cliLog(level: string, msg: string): void {
  const path = process.env.PK_LOG_FILE;
  if (!path) return;
  try {
    const fd = openSync(path, "a");
    try {
      writeSync(fd, `${formatLogLine(new Date(), level, msg)}\n`);
    } finally {
      closeSync(fd);
    }
  } catch {
    // 日志失败不影响主流程
  }
}

/** 日志行格式（format_log_line 同构：[日期][时间][pk][级别] 消息，时间为 UTC） */
export function formatLogLine(now: Date, level: string, msg: string): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getUTCFullYear()}-${p(now.getUTCMonth() + 1)}-${p(now.getUTCDate())}`;
  const time = `${p(now.getUTCHours())}:${p(now.getUTCMinutes())}:${p(now.getUTCSeconds())}`;
  return `[${date}][${time}][pk][${level}] ${msg.replaceAll("\n", " ")}`;
}

/** 缺省库路径（default_db_path 同构）：CHOOSE_YOU_HOME 优先，缺省 ~/.choose-you/data/<db> */
export function defaultDbPath(): string {
  const home = appHome();
  if (!home) throw new Error("无法定位用户主目录");
  return join(home, DATA_SUBDIR, DB_FILE);
}

/** 打开应用数据库（open_db 同构）：WAL + busy_timeout=5000；不存在且非引导则报错。
 * 连接经 storage/db 唯一握连接模块打开（dsh 侧不变量，PRAGMA 同源） */
export function openDb(tolerateMissing: boolean): Conn {
  const path = process.env.PK_DB ?? defaultDbPath();
  if (!existsSync(path)) {
    if (!tolerateMissing) {
      throw new Error(`数据库不存在：${path}。请先启动一次应用（或运行 pk init-db），也可用 PK_DB 环境变量指定路径`);
    }
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch (e) {
      throw new Error(`创建数据库目录失败: ${e}`);
    }
  }
  try {
    return openConn(path);
  } catch (e) {
    throw new Error(`打开数据库失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 已解析的命令行：位置参数 + 旗标（--key [value]，value 缺省为空串表示布尔旗标） */
export interface Parsed {
  positionals: string[];
  flags: Array<[string, string]>;
}

export function parseArgs(args: readonly string[]): Parsed {
  const positionals: string[] = [];
  const flags: Array<[string, string]> = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.push([key, next]);
        i += 1;
      } else {
        flags.push([key, ""]);
      }
    } else {
      positionals.push(a);
    }
    i += 1;
  }
  return { positionals, flags };
}

export function flag(p: Parsed, key: string): string | undefined {
  for (const [k, v] of p.flags) {
    if (k === key) return v;
  }
  return undefined;
}

export function positional(p: Parsed, i: number, what: string): string {
  const v = p.positionals[i];
  if (v === undefined) throw new CliError(`缺少${what}，用法见 pk help`, 2);
  return v;
}

export function usageErr(msg: string): CliError {
  return new CliError(msg, 2);
}

/** domain 域错误 → CLI 错误（db_err 同构：AppError Display 前缀逐字对齐 error.rs） */
export function dbErr(error: unknown): CliError {
  if (error instanceof PkyError) {
    const prefix =
      error.code === "NOT_FOUND" ? "未找到: " : error.code === "INVALID_ARGUMENT" ? "输入无效: " : "数据库错误: ";
    return new CliError(`${prefix}${error.message}`, 1);
  }
  return new CliError(`数据库错误: ${error instanceof Error ? error.message : String(error)}`, 1);
}

/** 裸 SQL 错误 → CLI 错误（sq_err 同构） */
export function sqErr(error: unknown): CliError {
  return new CliError(`数据库错误: ${error instanceof Error ? error.message : String(error)}`, 1);
}

export const VALID_STATUS = ["inbox", "scheduled", "active", "paused", "done", "cancelled"];
export const VALID_PRIORITY = ["low", "normal", "high", "urgent"];
export const VALID_CONFIDENCE = ["high", "medium", "low"];

export function validateChoice(value: string, allowed: readonly string[], what: string): void {
  if (!allowed.includes(value)) {
    throw new CliError(`${what}「${value}」无效，可选：${allowed.join("/")}`, 2);
  }
}

/** task list 的 --limit：缺省 50；`all`（或 0）不截断（parse_limit 同构） */
export function parseLimit(p: Parsed): number | undefined {
  const v = flag(p, "limit");
  if (v === undefined) return 50;
  if (v.toLowerCase() === "all" || v === "0") return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw usageErr("--limit 须是正整数或 all");
  return n;
}
