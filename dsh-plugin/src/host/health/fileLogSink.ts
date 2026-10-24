/**
 * 插件日志落盘 sink（ADR-0005 · 对齐桌面共享日志）：与桌面 tauri-plugin-log / pk CLI
 * 同写 <appHome>/logs/pokemon-choose-you.log，行格式 `[UTC日期][UTC时间][target][LEVEL] msg`
 * （parseDiskLogLines / diagnostics.rs parse_log_line 双端互认），单行一次 O_APPEND——
 * 与桌面/pk 的写入交错安全（pk cli_log 同配方）。
 * 轮转 = 超阈值截断而非删档：桌面 fern 的 LogLandfiller 持句柄常开，删除路径会使其
 * 继续写往已 unlink 的 inode（日志真丢）；O_APPEND 语义下 truncate(0) 后双方写入都
 * 回到文件头，KeepOne 语义等价且不破坏任何一方的句柄。目录缺失自建（纯 dsh 场景
 * 无桌面代建）。写失败回传错误串不抛（日志不碍主流程——调用方记环内 warn 使支持报告可见）。
 */
import { appendFileSync, mkdirSync, statSync, truncateSync } from "node:fs";
import { join } from "node:path";
import { logDirFrom, LOG_FILE_STEM } from "../storage/paths";
import type { LogRing, LogLevel } from "./logRing";

/** 轮转阈值字节（src-tauri/src/lib.rs max_file_size 同值，KeepOne 语义） */
export const LOG_ROTATE_MAX_BYTES = 512_000;

export interface FileLogSinkOptions {
  logDir: string;
  /** 时钟注入（测试确定性） */
  now?: () => Date;
  /** 轮转阈值（缺省对齐桌面 512_000） */
  maxBytes?: number;
}

/** 落一条日志到共享文件；成功返回 undefined，失败返回错误串（不抛） */
export class FileLogSink {
  private readonly dir: string;
  private readonly path: string;
  private readonly now: () => Date;
  private readonly maxBytes: number;

  constructor(opts: FileLogSinkOptions) {
    this.dir = opts.logDir;
    this.path = join(opts.logDir, `${LOG_FILE_STEM}.log`);
    this.now = opts.now ?? (() => new Date());
    this.maxBytes = opts.maxBytes ?? LOG_ROTATE_MAX_BYTES;
  }

  write(level: string, target: string, message: string): string | undefined {
    try {
      mkdirSync(this.dir, { recursive: true });
      const line = formatLogLine(this.now(), level, target, message);
      this.rotateIfDue(Buffer.byteLength(line));
      appendFileSync(this.path, line);
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  private rotateIfDue(lineBytes: number): void {
    let size = 0;
    try {
      size = statSync(this.path).size;
    } catch {
      return; // 文件不存在：无可截断，append 自建
    }
    if (size > 0 && size + lineBytes > this.maxBytes) {
      truncateSync(this.path, 0);
    }
  }
}

/** 行格式化（tauri-plugin-log desktop format 同构：UTC 墙钟、无时区标记） */
export function formatLogLine(now: Date, level: string, target: string, message: string): string {
  const iso = now.toISOString();
  return `[${iso.slice(0, 10)}][${iso.slice(11, 19)}][${target}][${level.toUpperCase()}] ${message}\n`;
}

/** 统一日志回调签名（HostCommandDeps["log"] 同构） */
export type HostLogFn = (level: LogLevel, target: string, message: string) => void;

/** 统一日志回调：内存环（RFC3339 +00:00）+ FileLogSink 落盘（桌面同格式，target 加
 *  dsh/ 命名空间前缀——共享文件里可辨识来源/过滤器抓手）；落盘失败回环 warn（支持报告
 *  可见），不重试不递归 */
export function pluginLogger(logs: LogRing, sink: FileLogSink | null): HostLogFn {
  return (level, target, message) => {
    const time = new Date().toISOString().replace("Z", "+00:00");
    logs.log(level, target, message, time);
    const error = sink?.write(level, `dsh/${target}`, message);
    if (error !== undefined) {
      logs.log("warn", "log-sink", `日志落盘失败（本轮已跳过）：${error}`, time);
    }
  };
}

/** 落盘 sink 装配（显式 null 关闭；缺省 <appHome>/logs，无法定位同关闭） */
export function createLogSink(dir: string | null | undefined): FileLogSink | null {
  const resolved = dir === undefined ? logDirFrom() : dir;
  return resolved === undefined || resolved === null ? null : new FileLogSink({ logDir: resolved });
}
