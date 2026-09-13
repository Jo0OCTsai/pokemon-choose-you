import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { api } from "../api";
import { SETTING_DEFAULTS, SECRET_STORED, useSettingsStore, fmtDate, fmtTime, fmtDateTime } from "../stores/settings";

vi.mock("../api", () => ({
  api: {
    listAllSettings: vi.fn(),
    setSetting: vi.fn(),
  },
}));

/** 每个用例前重建 pinia + store（等价于旧的模块级 reactive 重置） */
beforeEach(() => {
  setActivePinia(createPinia());
  vi.mocked(api.listAllSettings).mockReset();
});

describe("sget / sgetNum", () => {
  it("未设置时返回内置默认值", () => {
    const settings = useSettingsStore();
    expect(settings.sget("language")).toBe("zh-Hans");
    expect(settings.sget("pomodoro_minutes")).toBe("25");
    expect(settings.sget("unknown_key")).toBe("");
  });

  it("已设置的值优先于默认值", () => {
    const settings = useSettingsStore();
    settings.values.pomodoro_minutes = "45";
    expect(settings.sget("pomodoro_minutes")).toBe("45");
  });

  it("sgetNum 解析数字，非法值回退", () => {
    const settings = useSettingsStore();
    settings.values.break_minutes = "10";
    expect(settings.sgetNum("break_minutes", 5)).toBe(10);
    settings.values.break_minutes = "abc";
    expect(settings.sgetNum("break_minutes", 5)).toBe(5);
    expect(settings.sgetNum("unset_key_xyz", 99)).toBe(99);
  });

  it("bool 读取字符串开关", () => {
    const settings = useSettingsStore();
    expect(settings.bool("pomodoro_enabled")).toBe(true);
    settings.values.pomodoro_enabled = "false";
    expect(settings.bool("pomodoro_enabled")).toBe(false);
  });
});

describe("load", () => {
  it("合并库中设置与默认值，空串回退默认", async () => {
    vi.mocked(api.listAllSettings).mockResolvedValue({
      language: "en",
      pomodoro_minutes: "",
    });
    const settings = useSettingsStore();
    await settings.load();
    expect(settings.values.language).toBe("en");
    expect(settings.values.pomodoro_minutes).toBe("25");
    expect(settings.values.date_format).toBe("YYYY-MM-DD");
  });
});

describe("日期时间格式化", () => {
  // 无时区本地时间（datetime-local 格式），断言与时区无关
  const local = "2026-09-13T13:05";

  it("默认 YYYY-MM-DD + 24 小时制", () => {
    const settings = useSettingsStore();
    expect(fmtDate(local, settings)).toBe("2026-09-13");
    expect(fmtTime(local, settings)).toBe("13:05");
    expect(fmtDateTime(local, settings)).toBe("2026-09-13 13:05");
  });

  it("MM/DD/YYYY 与 DD/MM/YYYY", () => {
    const settings = useSettingsStore();
    settings.values.date_format = "MM/DD/YYYY";
    expect(fmtDate(local, settings)).toBe("09/13/2026");
    settings.values.date_format = "DD/MM/YYYY";
    expect(fmtDate(local, settings)).toBe("13/09/2026");
  });

  it("12 小时制：下午/上午/午夜", () => {
    const settings = useSettingsStore();
    settings.values.time_format = "12h";
    expect(fmtTime(local, settings)).toBe("1:05 PM");
    expect(fmtTime("2026-09-13T09:05", settings)).toBe("9:05 AM");
    expect(fmtTime("2026-09-13T00:30", settings)).toBe("12:30 AM");
    expect(fmtTime("2026-09-13T12:30", settings)).toBe("12:30 PM");
  });

  it("RFC3339 输入可解析（转本地时区）", () => {
    const settings = useSettingsStore();
    const d = new Date("2026-09-13T09:05:00Z");
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    expect(fmtDate("2026-09-13T09:05:00Z", settings)).toBe(`${y}-${m}-${day}`);
  });

  it("空值与非法输入返回空串", () => {
    const settings = useSettingsStore();
    expect(fmtDate("", settings)).toBe("");
    expect(fmtDate(null, settings)).toBe("");
    expect(fmtDate(undefined, settings)).toBe("");
    expect(fmtTime("garbage", settings)).toBe("");
    expect(fmtDateTime(null, settings)).toBe("");
  });
});

describe("save：秘钥占位值跳过", () => {
  it("占位值原样保存时跳过该键，普通值与改动过的秘钥正常提交", async () => {
    const settings = useSettingsStore();
    settings.values.language = "en";
    settings.values.todoist_token = SECRET_STORED; // 已保存、未改动 → 跳过
    await settings.save(["language", "todoist_token"]);
    expect(api.setSetting).toHaveBeenCalledTimes(1);
    expect(api.setSetting).toHaveBeenCalledWith("language", "en");
    expect(api.setSetting).not.toHaveBeenCalledWith("todoist_token", SECRET_STORED);

    // 用户输入了新值 → 正常提交
    settings.values.todoist_token = "new-token";
    await settings.save(["todoist_token"]);
    expect(api.setSetting).toHaveBeenCalledWith("todoist_token", "new-token");
  });
});

describe("默认设置健全性", () => {
  it("数值型默认值均可解析为数字", () => {
    for (const k of ["pomodoro_minutes", "break_minutes", "remind_ahead_minutes", "feishu_poll_interval"]) {
      expect(Number.isFinite(Number(SETTING_DEFAULTS[k])), k).toBe(true);
    }
  });

  it("个性化键默认值合法：主宝可梦为空、台词表为空 JSON", () => {
    expect(SETTING_DEFAULTS.main_pokemon).toBe("");
    expect(JSON.parse(SETTING_DEFAULTS.pokemon_quotes)).toEqual({});
  });
});
