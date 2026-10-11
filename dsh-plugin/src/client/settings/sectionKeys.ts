/**
 * 背包八分区键位与分区定义（U20/U21）：36 共享设置键全量分发到各分区页（键单源 =
 * host/domain/settings SETTING_KEYS，此处只读类型约束）；实体 CRUD 面（分类/标签/维度/
 * agent 卡/提示词/会话过滤）不走保存制、维持各自提交语义。
 */
import type { SettingKey } from "../../host/domain/settings";

/** 专注分区（🍅）：番茄钟表单 + 提醒与勿扰（后五键触达类，作用于主应用） */
export const FOCUS_KEYS = [
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
] as const satisfies readonly SettingKey[];

/** 桌宠分区（🐾）：主宝可梦/台词/输入响应×2/语音/陪跑（作用于主应用桌宠）+ 减弱动效（dsh 同读） */
export const PET_KEYS = [
  "main_pokemon",
  "pokemon_quotes",
  "pet_input_response",
  "pet_input_response_working",
  "pet_voice",
  "pet_mate",
  "reduce_motion",
] as const satisfies readonly SettingKey[];

/** 显示分区（👀）：语言（即时跟随+保存落库）/日期/时间制式/逾期模式/相对截止（后两项 dsh 同读同生效） */
export const DISPLAY_KEYS = [
  "language",
  "date_format",
  "time_format",
  "overdue_mode",
  "due_relative",
] as const satisfies readonly SettingKey[];

/** Agent 分区（🤖）共享键：判定执行方/终端偏好/自动派发/并发/worktree（agent 列表与路由为实体 CRUD 面） */
export const AGENT_KEYS = [
  "ai_agent_id",
  "terminal_preference",
  "dispatch_auto_enabled",
  "dispatch_max_concurrent",
  "dispatch_worktree",
] as const satisfies readonly SettingKey[];

/** 飞书分区共享键：启用/间隔/我的称呼（保存制）；授权/测试连接/会话过滤为即时动作与实体 CRUD */
export const FEISHU_KEYS = [
  "feishu_enabled",
  "feishu_poll_interval",
  "feishu_my_names",
] as const satisfies readonly SettingKey[];

/** 通用分区（⚙️）：复盘提醒/备份/关闭到托盘（作用于主应用）+ 库状态/使用指南/双形态说明 */
export const GENERAL_KEYS = [
  "review_enabled",
  "review_dow",
  "backup_enabled",
  "backup_keep",
  "close_to_tray",
] as const satisfies readonly SettingKey[];

/** 八分区（对齐主应用设置中心同名同序，U21） */
export const SECTION_KEYS = ["focus", "taxonomy", "pets", "display", "agents", "feishu", "diag", "general"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_LABEL_KEYS: Record<SectionKey, string> = {
  focus: "stabs.focus",
  taxonomy: "stabs.taxonomy",
  pets: "stabs.pets",
  display: "stabs.display",
  agents: "stabs.agents",
  feishu: "stabs.feishu",
  diag: "stabs.diag",
  general: "stabs.general",
};

/** 保存制覆盖的全部共享键（ai_agents 经 agent 卡 CRUD 面，不进草稿） */
export const DRAFT_KEYS: readonly string[] = [
  ...FOCUS_KEYS,
  ...PET_KEYS,
  ...DISPLAY_KEYS,
  ...AGENT_KEYS,
  ...FEISHU_KEYS,
  ...GENERAL_KEYS,
];
