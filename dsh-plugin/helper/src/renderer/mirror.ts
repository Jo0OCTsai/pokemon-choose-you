/** 渲染层共享类型与状态镜像（ui-event 驱动 + 每秒 snapshot 兜底；模块间单一可变面） */
import type { Lang, QuickTask } from "../bridge/protocol.ts";

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
    progress: { pct: number; tone: "green" | "amber" | "red" } | null;
  } | null;
  reducedMotion: boolean;
}

export interface Mirror {
  lang: Lang;
  petState: PetStateLite;
  lastTask: TaskLite;
  todayTasks: QuickTask[];
  reducedMotion: boolean;
  lastInteractAt: number;
  greetedToday: boolean;
}

export const mirror: Mirror = {
  lang: "zh-Hans",
  petState: { base: "idle", transient: null, asleep: false },
  lastTask: null,
  todayTasks: [],
  reducedMotion: false,
  lastInteractAt: Date.now(),
  greetedToday: false,
};

/** 任意用户交互的时间戳（asleep 判定与唤醒用） */
export function touchInteract(): void {
  mirror.lastInteractAt = Date.now();
}
