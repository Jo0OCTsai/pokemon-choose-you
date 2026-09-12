import { reactive } from "vue";
import { api } from "./api";

/** 全局共享设置（设置页写入，两个窗口读取） */
export const settings = reactive<Record<string, string>>({});

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
  default_to_inbox: "true",
  feishu_poll_interval: "120",
  feishu_enabled: "false",
  ai_base_url: "",
  ai_api_key: "",
  ai_model: "",
  feishu_app_id: "",
  feishu_app_secret: "",
  todoist_token: "",
};

export function sget(key: string): string {
  return settings[key] ?? SETTING_DEFAULTS[key] ?? "";
}
export function sgetNum(key: string, fallback: number): number {
  const raw = sget(key);
  if (raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export async function loadSettings() {
  const all = await api.listAllSettings();
  Object.keys(all).forEach((k) => (settings[k] = all[k]));
  // 合并默认值：未写库的键在下拉框/开关里也要有确定值，避免显示空白
  Object.entries(SETTING_DEFAULTS).forEach(([k, v]) => {
    if (settings[k] === undefined || settings[k] === "") settings[k] = v;
  });
}

export async function saveSettings(keys: string[]) {
  for (const k of keys) {
    await api.setSetting(k, settings[k] ?? SETTING_DEFAULTS[k] ?? "");
  }
}

// ---- 日期时间格式化（读设置） ----

function parseLocal(s: string): Date | null {
  if (!s) return null;
  // 兼容 "2026-09-13T09:00"（本地无时区）与 RFC3339
  const d = new Date(s.length === 16 ? s + ":00" : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(s: string | null | undefined): string {
  const d = parseLocal(s ?? "");
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  switch (sget("date_format")) {
    case "MM/DD/YYYY":
      return `${m}/${day}/${y}`;
    case "DD/MM/YYYY":
      return `${day}/${m}/${y}`;
    default:
      return `${y}-${m}-${day}`;
  }
}

export function fmtTime(s: string | null | undefined): string {
  const d = parseLocal(s ?? "");
  if (!d) return "";
  const h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, "0");
  if (sget("time_format") === "12h") {
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${min} ${ampm}`;
  }
  return `${String(h).padStart(2, "0")}:${min}`;
}

export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "";
  return `${fmtDate(s)} ${fmtTime(s)}`;
}

// ---- 内置宝可梦图鉴（换装用） ----
export const POKEMON_LIST = [
  { key: "pikachu", name: "皮卡丘" },
  { key: "psyduck", name: "可达鸭" },
  { key: "bulbasaur", name: "妙蛙种子" },
  { key: "chansey", name: "吉利蛋" },
  { key: "eevee", name: "伊布" },
  { key: "snorlax", name: "卡比兽" },
];
