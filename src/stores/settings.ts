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
  /** 勿扰时段：时段内静默非紧急提醒（紧急仍敲门）；start==end 视为关闭 */
  quiet_hours_enabled: "true",
  quiet_start: "22:00",
  quiet_end: "08:00",
  /** 减弱动效：true = 始终停用闪烁/蹦跳动画；false = 跟随系统「减弱动态效果」偏好 */
  reduce_motion: "false",
  /** 逾期任务展示模式：collapse=折叠一行（默认）/ auto_grass=自动归草丛 / show=原样 */
  overdue_mode: "collapse",
  date_format: "YYYY-MM-DD",
  time_format: "24h",
  /** 相对截止时间（时间盲友好：显示为距现在的距离并按临近程度变色） */
  due_relative: "true",
  /** 关闭主窗口隐藏到托盘（Rust 侧 CloseRequested 拦截；仅显式 "false" 才真关闭） */
  close_to_tray: "true",
  /** 每日自动备份（VACUUM INTO 快照，滚动保留） */
  backup_enabled: "true",
  /** 备份滚动保留份数 */
  backup_keep: "7",
  /** 每周复盘提醒（图鉴页「复盘」向导入口） */
  review_enabled: "true",
  /** 复盘提醒星期（1=周一 … 7=周日） */
  review_dow: "1",
  /** 主宝可梦（PokeAPI key；空 = 没有任务时跟随第一个分类的宝可梦） */
  main_pokemon: "",
  /** 每宝可梦自定义台词（JSON：{ [key]: 多行文本 }，撸宠时随机取用） */
  pokemon_quotes: "{}",
  /** 桌宠输入响应（F1）：感知打字快慢做出小回应（默认关；只取活动强度不取内容） */
  pet_input_response: "false",
  /** 输入响应子项：专注态也响应（hop 节奏轻耦合 ≤+10%，默认关） */
  pet_input_response_working: "false",
  /** 桌宠语音（F5）：里程碑/收工/生日/对话回答时说一句（默认静音，系统语音） */
  pet_voice: "false",
  /** 陪跑精灵（F6）：专注满 25 分钟图鉴里的一只宝可梦来旁边陪坐（默认关） */
  pet_mate: "false",
  feishu_poll_interval: "120",
  feishu_enabled: "false",
  /** 我的称呼（逗号/顿号分隔）：群里被这样叫的消息会标注疑似指派给你；真名不发给 AI */
  feishu_my_names: "",
  /** AI agent CLI 列表（AgentConfig 的 JSON 数组字符串） */
  ai_agents: "[]",
  /** 收音机分类使用的 agent id（空则用第一个启用的） */
  ai_agent_id: "",
  /**
   * 终端偏好：交互派发 / 历史记录 / 飞书授权唤起的终端应用。
   * default = 系统内置（macOS Terminal / Windows PowerShell / Linux 自动探测）；
   * iterm2 仅 macOS、ghostty 仅 macOS/Linux、windows-terminal 仅 Windows，
   * 选项由设置页按平台裁剪（与后端 TerminalPref 对齐）
   */
  terminal_preference: "default",
  /** 自动派发（M3）：到期未开始且 project 标签 meta 指定 agent 的待办排队无头执行（默认关） */
  dispatch_auto_enabled: "false",
  /** 每机器并发上限（本机与每台 SSH 主机分别生效；自动派发领取闸门） */
  dispatch_max_concurrent: "1",
  /** worktree 隔离（opt-in）：派发在 ../<repo>-pk-<任务id> 工作树执行，完成后人工合并 */
  dispatch_worktree: "false",
};

/**
 * 秘钥键的「已保存」占位值：后端不回传明文，listAllSettings 对已保存秘钥返回该值。
 * 前端原样保存时后端跳过写入；输入新值则以新值覆盖；清空则删除。
 * （当前无活跃秘钥键，保留占位协议供未来集成使用。）
 */
export const SECRET_STORED = "__STORED__";

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
  "quiet_hours_enabled",
  "quiet_start",
  "quiet_end",
  "reduce_motion",
  "overdue_mode",
  "date_format",
  "time_format",
  "due_relative",
  "close_to_tray",
  "backup_enabled",
  "backup_keep",
  "review_enabled",
  "review_dow",
  "main_pokemon",
  "pokemon_quotes",
  "pet_input_response",
  "pet_input_response_working",
  "pet_voice",
  "pet_mate",
  "feishu_poll_interval",
  "feishu_my_names",
  "ai_agents",
  "ai_agent_id",
  "terminal_preference",
  "dispatch_auto_enabled",
  "dispatch_max_concurrent",
  "dispatch_worktree",
  "feishu_enabled",
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
    /** 注意力友好：把「减弱动效」写到 <html> 上（dex.css 里与系统 prefers-reduced-motion 同等生效） */
    applyMotionPreference() {
      if (typeof document === "undefined") return;
      document.documentElement.classList.toggle("reduce-motion", this.bool("reduce_motion"));
    },
    /** 拉库并合并默认值（空串回退默认） */
    async load() {
      const all = await api.listAllSettings();
      const merged = { ...SETTING_DEFAULTS };
      for (const [k, v] of Object.entries(all)) {
        merged[k] = v === "" ? (SETTING_DEFAULTS[k] ?? v) : v;
      }
      this.values = merged;
      this.applyMotionPreference();
    },
    async save(keys: string[]) {
      for (const k of keys) {
        const v = this.values[k] ?? SETTING_DEFAULTS[k] ?? "";
        if (v === SECRET_STORED) continue; // 占位值原样保存 = 未改动，跳过
        await api.setSetting(k, v);
      }
      this.applyMotionPreference();
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
