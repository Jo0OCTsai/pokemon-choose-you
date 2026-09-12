import { defineStore } from "pinia";
import { api } from "../api";

/** 内置默认值：未写库的键在控件里也要有确定值，避免显示空白 */
export const SETTING_DEFAULTS: Record<string, string> = {
  language: "zh-Hans",
  pomodoro_enabled: "true",
  pomodoro_minutes: "25",
  break_minutes: "5",
  pomodoro_notify: "true",
  remind_ahead_minutes: "0",
  notifications_enabled: "true",
  date_format: "YYYY-MM-DD",
  time_format: "24h",
  default_priority: "normal",
  feishu_poll_interval: "120",
  feishu_enabled: "false",
  ai_base_url: "",
  ai_api_key: "",
  ai_model: "",
  feishu_app_id: "",
  feishu_app_secret: "",
  todoist_token: "",
};

/** 设置页保存的键全集（与后端 settings 表对齐） */
export const SETTING_KEYS = [
  "language",
  "pomodoro_enabled",
  "pomodoro_minutes",
  "break_minutes",
  "pomodoro_notify",
  "notifications_enabled",
  "remind_ahead_minutes",
  "date_format",
  "time_format",
  "default_priority",
  "feishu_poll_interval",
  "ai_base_url",
  "ai_api_key",
  "ai_model",
  "feishu_app_id",
  "feishu_app_secret",
  "feishu_enabled",
  "todoist_token",
];

/** 全局共享设置（设置页写入，两个窗口读取），取代旧的模块级 reactive */
export const useSettingsStore = defineStore("settings", {
  state: () => ({
    // 已合并默认值的读写视图：控件直接 v-model 绑 values[key]
    values: { ...SETTING_DEFAULTS } as Record<string, string>,
  }),
  getters: {
    sget(state) {
      return (key: string): string => state.values[key] ?? SETTING_DEFAULTS[key] ?? "";
    },
  },
  actions: {
    sgetNum(key: string, fallback: number): number {
      const raw = this.sget(key);
      if (raw === "") return fallback;
      const n = Number(raw);
      return Number.isFinite(n) ? n : fallback;
    },
    bool(key: string): boolean {
      return this.sget(key) === "true";
    },
    /** 拉库并合并默认值（空串回退默认） */
    async load() {
      const all = await api.listAllSettings();
      const merged = { ...SETTING_DEFAULTS };
      for (const [k, v] of Object.entries(all)) {
        merged[k] = v === "" ? (SETTING_DEFAULTS[k] ?? v) : v;
      }
      this.values = merged;
    },
    async save(keys: string[]) {
      for (const k of keys) {
        await api.setSetting(k, this.values[k] ?? SETTING_DEFAULTS[k] ?? "");
      }
    },
  },
});

// ---- 日期时间格式化（读设置；调用方在组件渲染上下文或 pinia 已激活处） ----

function parseLocal(s: string): Date | null {
  if (!s) return null;
  // 兼容 "2026-09-13T09:00"（本地无时区）与 RFC3339
  const d = new Date(s.length === 16 ? s + ":00" : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(s: string | null | undefined, store = useSettingsStore()): string {
  const d = parseLocal(s ?? "");
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  switch (store.sget("date_format")) {
    case "MM/DD/YYYY":
      return `${m}/${day}/${y}`;
    case "DD/MM/YYYY":
      return `${day}/${m}/${y}`;
    default:
      return `${y}-${m}-${day}`;
  }
}

export function fmtTime(s: string | null | undefined, store = useSettingsStore()): string {
  const d = parseLocal(s ?? "");
  if (!d) return "";
  const h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, "0");
  if (store.sget("time_format") === "12h") {
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${min} ${ampm}`;
  }
  return `${String(h).padStart(2, "0")}:${min}`;
}

export function fmtDateTime(s: string | null | undefined, store = useSettingsStore()): string {
  if (!s) return "";
  return `${fmtDate(s, store)} ${fmtTime(s, store)}`;
}

/** 内置宝可梦图鉴（换装用） */
export const POKEMON_LIST = [
  { key: "pikachu", name: "皮卡丘" },
  { key: "psyduck", name: "可达鸭" },
  { key: "bulbasaur", name: "妙蛙种子" },
  { key: "chansey", name: "吉利蛋" },
  { key: "eevee", name: "伊布" },
  { key: "snorlax", name: "卡比兽" },
];
