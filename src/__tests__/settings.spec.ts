import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import {
  settings,
  SETTING_DEFAULTS,
  sget,
  sgetNum,
  loadSettings,
  fmtDate,
  fmtTime,
  fmtDateTime,
  POKEMON_LIST,
} from "../settings";

vi.mock("../api", () => ({
  api: {
    listAllSettings: vi.fn(),
    setSetting: vi.fn(),
  },
}));

/** settings 是模块级共享 reactive，每个用例前还原 */
beforeEach(() => {
  Object.keys(settings).forEach((k) => delete settings[k]);
  vi.mocked(api.listAllSettings).mockReset();
});

describe("sget / sgetNum", () => {
  it("未设置时返回内置默认值", () => {
    expect(sget("language")).toBe("zh-Hans");
    expect(sget("pomodoro_minutes")).toBe("25");
    expect(sget("unknown_key")).toBe("");
  });

  it("已设置的值优先于默认值", () => {
    settings.pomodoro_minutes = "45";
    expect(sget("pomodoro_minutes")).toBe("45");
  });

  it("sgetNum 解析数字，非法值回退", () => {
    settings.break_minutes = "10";
    expect(sgetNum("break_minutes", 5)).toBe(10);
    settings.break_minutes = "abc";
    expect(sgetNum("break_minutes", 5)).toBe(5);
    expect(sgetNum("unset_key_xyz", 99)).toBe(99);
  });
});

describe("loadSettings", () => {
  it("合并库中设置与默认值，空串回退默认", async () => {
    vi.mocked(api.listAllSettings).mockResolvedValue({
      language: "en",
      pomodoro_minutes: "",
    });
    await loadSettings();
    expect(settings.language).toBe("en");
    expect(settings.pomodoro_minutes).toBe("25");
    expect(settings.date_format).toBe("YYYY-MM-DD");
  });
});

describe("日期时间格式化", () => {
  // 无时区本地时间（datetime-local 格式），断言与时区无关
  const local = "2026-09-13T13:05";

  it("默认 YYYY-MM-DD + 24 小时制", () => {
    expect(fmtDate(local)).toBe("2026-09-13");
    expect(fmtTime(local)).toBe("13:05");
    expect(fmtDateTime(local)).toBe("2026-09-13 13:05");
  });

  it("MM/DD/YYYY 与 DD/MM/YYYY", () => {
    settings.date_format = "MM/DD/YYYY";
    expect(fmtDate(local)).toBe("09/13/2026");
    settings.date_format = "DD/MM/YYYY";
    expect(fmtDate(local)).toBe("13/09/2026");
  });

  it("12 小时制：下午/上午/午夜", () => {
    settings.time_format = "12h";
    expect(fmtTime(local)).toBe("1:05 PM");
    expect(fmtTime("2026-09-13T09:05")).toBe("9:05 AM");
    expect(fmtTime("2026-09-13T00:30")).toBe("12:30 AM");
    expect(fmtTime("2026-09-13T12:30")).toBe("12:30 PM");
  });

  it("RFC3339 输入可解析（转本地时区）", () => {
    const d = new Date("2026-09-13T09:05:00Z");
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    expect(fmtDate("2026-09-13T09:05:00Z")).toBe(`${y}-${m}-${day}`);
  });

  it("空值与非法输入返回空串", () => {
    expect(fmtDate("")).toBe("");
    expect(fmtDate(null)).toBe("");
    expect(fmtDate(undefined)).toBe("");
    expect(fmtTime("garbage")).toBe("");
    expect(fmtDateTime(null)).toBe("");
  });
});

describe("内置图鉴", () => {
  it("宝可梦 key 不重复且数量为 6", () => {
    const keys = POKEMON_LIST.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(6);
  });
});

describe("默认设置健全性", () => {
  it("数值型默认值均可解析为数字", () => {
    for (const k of ["pomodoro_minutes", "break_minutes", "remind_ahead_minutes", "feishu_poll_interval"]) {
      expect(Number.isFinite(Number(SETTING_DEFAULTS[k])), k).toBe(true);
    }
  });
});
