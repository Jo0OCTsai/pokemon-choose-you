/**
 * 设置选项值单源与装载期归一化（optionSets）：双形态共用存储的值域对齐——
 * 历史存量值（插件曾用分钟值/自由文本勿扰时段/zh-CN 日期格式）吸附到与主应用
 * 一致的合法档位；合法值原样保留。
 */
import { describe, expect, it } from "vitest";
import {
  BREAK_MINUTES,
  DATE_FORMATS,
  normalizeSettingValues,
  POLL_INTERVAL_SECS,
  quietHourOptions,
} from "../../src/client/settings/optionSets";

describe("选项数组与主应用值域一致", () => {
  it("轮询间隔值=秒（60/120/300/900）；短休息无 15 档；日期格式为三 ISO 形态", () => {
    expect([...POLL_INTERVAL_SECS]).toEqual([60, 120, 300, 900]);
    expect([...BREAK_MINUTES]).toEqual([0, 5, 10]);
    expect([...DATE_FORMATS]).toEqual(["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"]);
  });

  it("勿扰整点下拉：24 项，值 HH:00 标签 HH（主应用 quietTimeOptions 同形）", () => {
    const options = quietHourOptions();
    expect(options).toHaveLength(24);
    expect(options[22]).toEqual({ value: "22:00", label: "22" });
    expect(options[0]).toEqual({ value: "00:00", label: "00" });
  });
});

describe("normalizeSettingValues 存量归一", () => {
  it("分钟时代的轮询值吸附到秒档（30→60 就近升档、600→900）", () => {
    expect(normalizeSettingValues({ feishu_poll_interval: "30" })).toMatchObject({ feishu_poll_interval: "60" });
    expect(normalizeSettingValues({ feishu_poll_interval: "120" })).toMatchObject({ feishu_poll_interval: "120" });
    expect(normalizeSettingValues({ feishu_poll_interval: "600" })).toMatchObject({ feishu_poll_interval: "900" });
    expect(normalizeSettingValues({ feishu_poll_interval: "garbage" })).toMatchObject({
      feishu_poll_interval: "120",
    });
  });

  it("break 15 档吸附 10；提前提醒 10（等距取更大档）→15、60→30", () => {
    expect(normalizeSettingValues({ break_minutes: "15" })).toMatchObject({ break_minutes: "10" });
    expect(normalizeSettingValues({ remind_ahead_minutes: "10" })).toMatchObject({
      remind_ahead_minutes: "15",
    });
    expect(normalizeSettingValues({ remind_ahead_minutes: "60" })).toMatchObject({
      remind_ahead_minutes: "30",
    });
  });

  it("插件旧日期格式（MM-DD/zh-CN）回落 ISO；未落盘空串回落默认档（draft/saved 同过管线不产生假脏）", () => {
    expect(normalizeSettingValues({ date_format: "zh-CN" })).toMatchObject({ date_format: "YYYY-MM-DD" });
    expect(normalizeSettingValues({ date_format: "MM-DD" })).toMatchObject({ date_format: "YYYY-MM-DD" });
    expect(normalizeSettingValues({ date_format: "" })).toMatchObject({ date_format: "YYYY-MM-DD" });
  });

  it("勿扰自由文本归整点（22/08:30 → 22:00/08:00；非法回落默认档）", () => {
    expect(normalizeSettingValues({ quiet_start: "22" })).toMatchObject({ quiet_start: "22:00" });
    expect(normalizeSettingValues({ quiet_end: "8:30" })).toMatchObject({ quiet_end: "08:00" });
    expect(normalizeSettingValues({ quiet_start: "深夜" })).toMatchObject({ quiet_start: "22:00" });
    expect(normalizeSettingValues({ quiet_end: "25" })).toMatchObject({ quiet_end: "08:00" });
  });
});
