/** 渲染层共享类型与状态镜像（ui-event 驱动 + 每秒 snapshot 兜底；模块间单一可变面） */
import type { Lang, QuickTask } from "../bridge/protocol.ts";
import type { InputBand } from "../state/inputCps.ts";

export type PetStateLite = {
  base: "idle" | "working" | "paused";
  transient: "celebrating" | "petting" | "dragging" | "rest" | null;
  asleep: boolean;
};

export type TaskLite = {
  id: number | string;
  title: string;
  categoryPokemon: string;
  status: string;
} | null;

export interface SpriteInfo {
  res: { key: string; urls: string[]; builtin: boolean; fallback: boolean };
  missing: { key: string; standIn: string } | null;
  standInName: string;
}

export interface Snapshot {
  petState: PetStateLite;
  lang: Lang;
  activeTask: TaskLite;
  todayTasks: QuickTask[];
  pomo: {
    kind: string;
    msLeft: number;
    /** 本轮总时长（focus/trial；break 无——陪跑专注计时用） */
    durationMs: number;
    progress: { pct: number; tone: "green" | "amber" | "red" } | null;
  } | null;
  reducedMotion: boolean;
  perched: boolean;
  petVisible: boolean;
  inputResponse: { enabled: boolean; hopCoupleMax: number };
  petConfig: { mate: boolean; agentConfigured: boolean };
}

export interface Mirror {
  lang: Lang;
  petState: PetStateLite;
  lastTask: TaskLite;
  todayTasks: QuickTask[];
  reducedMotion: boolean;
  /** 番茄功能开关（pomodoro-config 下发；false 时 PomoPill 不显示——主应用 parity） */
  pomoEnabled: boolean;
  lastInteractAt: number;
  greetedToday: boolean;
  /** ChatBox 开合（时刻台词禁播闸门 + 窗口高度面） */
  chatOpen: boolean;
  /** 快捷图鉴屏开合 */
  quickOpen: boolean;
  /** 捕捉演出进行中（inputResponse/时刻台词让路面） */
  sceneBusy: boolean;
  /** 坐栖态（姿态幅度减半 + 拎起即离） */
  perched: boolean;
  /** 首次见面时刻（生日台词基准；localStorage 持久——桌面 pet.metOn 同族键位） */
  metAt: number;
  /** 输入响应配置投影（snapshot 下发；hop 耦合上限） */
  inputResponse: { enabled: boolean; hopCoupleMax: number };
  /** 最近输入活动档位（inputResponse 消费面） */
  inputBand: InputBand;
  /** 桌宠基础面（sys-config.pet 投影：陪跑闸门 + ChatBox 菜单条件项；快照兜底同步） */
  petConfig: { mate: boolean; agentConfigured: boolean };
}

export const mirror: Mirror = {
  lang: "zh-Hans",
  petState: { base: "idle", transient: null, asleep: false },
  lastTask: null,
  todayTasks: [],
  reducedMotion: false,
  pomoEnabled: false,
  lastInteractAt: Date.now(),
  greetedToday: false,
  chatOpen: false,
  quickOpen: false,
  sceneBusy: false,
  perched: false,
  metAt: Date.now(),
  inputResponse: { enabled: false, hopCoupleMax: 0 },
  inputBand: "silent",
  petConfig: { mate: false, agentConfigured: true },
};

/** 任意用户交互的时间戳（asleep 判定与唤醒用） */
export function touchInteract(): void {
  mirror.lastInteractAt = Date.now();
}
