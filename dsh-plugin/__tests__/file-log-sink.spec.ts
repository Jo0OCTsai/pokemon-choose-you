/**
 * health/fileLogSink：桌面对齐落盘——行格式（[UTC日期][UTC时间][target][LEVEL] msg，
 * 与 tauri-plugin-log 写出 / parseDiskLogLines 解析互认）、目录自建、O_APPEND 追加、
 * 512KB KeepOne 同语义轮转（truncate 实现——桌面 fern 持句柄常开，删档会使其写往
 * 已 unlink 的 inode）、写失败回传错误串不抛（日志不碍主流程）。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileLogSink, LOG_ROTATE_MAX_BYTES } from "../src/host/health/fileLogSink";
import { parseDiskLogLines } from "../src/host/health/logRing";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pky-sink-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const T0 = () => new Date("2026-10-20T03:04:05Z");
const logPath = (d: string) => join(d, "logs", "pokemon-choose-you.log");

describe("FileLogSink", () => {
  it("行格式与桌面互认：写出即被 parseDiskLogLines 解析回同构条目", () => {
    const sink = new FileLogSink({ logDir: join(dir, "logs"), now: T0 });
    expect(sink.write("warn", "dsh/radio", "轮询失败")).toBeUndefined();
    const content = readFileSync(logPath(dir), "utf8");
    expect(content).toBe("[2026-10-20][03:04:05][dsh/radio][WARN] 轮询失败\n");
    expect(parseDiskLogLines(content)[0]).toMatchObject({
      time: "2026-10-20 03:04:05",
      level: "warn",
      target: "dsh/radio",
      message: "轮询失败",
    });
  });

  it("目录缺失自建；多次写为追加（行序保留）", () => {
    const sink = new FileLogSink({ logDir: join(dir, "logs"), now: T0 });
    sink.write("info", "dsh/a", "第一条");
    sink.write("error", "dsh/b", "第二条");
    expect(parseDiskLogLines(readFileSync(logPath(dir), "utf8")).map((e) => e.message)).toEqual(["第一条", "第二条"]);
  });

  it("超限轮转：截断后只保留超限后的新行（KeepOne 语义，不删档）", () => {
    const sink = new FileLogSink({ logDir: dir, maxBytes: 60, now: T0 });
    const line = "x".repeat(50);
    sink.write("info", "dsh/a", line); // 文件尚不存在：不轮转，直接落 66 字节
    sink.write("info", "dsh/a", line); // 66+66 > 60：截断后再落
    expect(parseDiskLogLines(readFileSync(join(dir, "pokemon-choose-you.log"), "utf8"))).toHaveLength(1);
  });

  it("轮转阈值默认 512_000，对齐桌面 lib.rs max_file_size", () => {
    expect(LOG_ROTATE_MAX_BYTES).toBe(512_000);
  });

  it("写失败回传错误串不抛（目录路径被文件占位）", () => {
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "");
    const sink = new FileLogSink({ logDir: join(blocker, "logs"), now: T0 });
    expect(typeof sink.write("info", "dsh/a", "m")).toBe("string");
  });
});
