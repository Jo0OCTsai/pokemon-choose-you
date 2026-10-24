/**
 * 诊断日志时间本机时区展示：磁盘日志行写 UTC 墙钟无时区标记（tauri-plugin-log / pk CLI /
 * 插件 fileLogSink 三方同约定，不可改），查看器出屏前换算到本机时区同形展示。
 * 固定 TZ=Asia/Shanghai（+08:00 无夏令时）保证断言确定性。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fmtLogTimeLocal } from "../../src/client/ui/dateTime";

const originalTz = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "Asia/Shanghai";
});

afterAll(() => {
  if (originalTz === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTz;
  }
});

describe("fmtLogTimeLocal（磁盘 UTC 墙钟 → 本机时区同形）", () => {
  it("磁盘格式 YYYY-MM-DD HH:MM:SS 按 UTC 解析后换算本机时区", () => {
    expect(fmtLogTimeLocal("2026-10-17 09:00:00")).toBe("2026-10-17 17:00:00");
  });

  it("跨日：UTC 晚间换算后进入本机次日", () => {
    expect(fmtLogTimeLocal("2026-10-17 20:30:05")).toBe("2026-10-18 04:30:05");
  });

  it("RFC3339 带偏移输入（内存环口径）同样换算", () => {
    expect(fmtLogTimeLocal("2026-10-17T09:00:00.000+00:00")).toBe("2026-10-17 17:00:00");
  });

  it("无法解析的时间串原样返回（一行脏日志不炸整屏）", () => {
    expect(fmtLogTimeLocal("not-a-time")).toBe("not-a-time");
  });
});
