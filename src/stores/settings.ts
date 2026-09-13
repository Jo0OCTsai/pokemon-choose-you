import { defineStore } from "pinia";
import { api } from "../api";

/** 内置默认值：未写库的键在控件里也要有确定值，避免显示空白 */
export const SETTING_DEFAULTS: Record<string, string> = {
  language: "zh-Hans",
  pomodoro_enabled: "true",
  pomodoro_minutes: "25",
  break_minutes: "5",
  pomodoro_notify: "true",
  /** 长番茄钟（≥45 分钟）中点与剩 5 分钟轻提示音 */
  pomodoro_chime: "true",
  remind_ahead_minutes: "0",
  notifications_enabled: "true",
  date_format: "YYYY-MM-DD",
  time_format: "24h",
  /** 相对截止时间（时间盲友好：显示为距现在的距离并按临近程度变色） */
  due_relative: "true",
  default_priority: "normal",
  /** 自然语言快速捕捉（输入框解析「明天 5pm 交周报 #工作」，带预览可取消） */
  nl_capture_enabled: "true",
  /** 每日自动备份（VACUUM INTO 快照，滚动保留） */
  backup_enabled: "true",
  /** 备份滚动保留份数 */
  backup_keep: "7",
  /** 每周复盘提醒（图鉴页「复盘」向导入口） */
  review_enabled: "true",
  /** 复盘提醒星期（1=周一 … 7=周日） */
  review_dow: "1",
  feishu_poll_interval: "120",
  feishu_enabled: "false",
  /** 飞书拉取引擎：builtin = 内置直连（自建应用 OAuth），cli = 官方 lark-cli 子进程 */
  feishu_engine: "builtin",
  /** AI agent CLI 列表（AgentConfig 的 JSON 数组字符串） */
  ai_agents: "[]",
  /** 收音机分类使用的 agent id（空则用第一个启用的） */
  ai_agent_id: "",
  feishu_app_id: "",
  feishu_app_secret: "",
  todoist_token: "",
};

/**
 * 秘钥键的「已保存」占位值：后端不回传明文，listAllSettings 对已保存秘钥返回该值。
 * 前端原样保存时后端跳过写入；输入新值则以新值覆盖；清空则删除。
 */
export const SECRET_STORED = "__STORED__";

/** 走系统钥匙串的秘钥键（与后端 secrets::SECRET_KEYS 对齐；仅用于输入框占位提示） */
export const SECRET_KEYS = ["feishu_app_secret", "feishu_user_token", "feishu_refresh_token", "todoist_token"];

/** 设置页保存的键全集（与后端 settings 表对齐） */
export const SETTING_KEYS = [
  "language",
  "pomodoro_enabled",
  "pomodoro_minutes",
  "break_minutes",
  "pomodoro_notify",
  "pomodoro_chime",
  "notifications_enabled",
  "remind_ahead_minutes",
  "date_format",
  "time_format",
  "due_relative",
  "default_priority",
  "nl_capture_enabled",
  "backup_enabled",
  "backup_keep",
  "review_enabled",
  "review_dow",
  "feishu_poll_interval",
  "ai_agents",
  "ai_agent_id",
  "feishu_app_id",
  "feishu_app_secret",
  "feishu_enabled",
  "feishu_engine",
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
        const v = this.values[k] ?? SETTING_DEFAULTS[k] ?? "";
        if (v === SECRET_STORED) continue; // 占位值原样保存 = 未改动，跳过
        await api.setSetting(k, v);
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
