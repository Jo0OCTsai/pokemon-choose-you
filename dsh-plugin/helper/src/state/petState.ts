/**
 * 桌宠状态机（UIUX §3.4 矩阵的纯逻辑层；渲染层只消费状态上 CSS 类）。
 *
 * 结构：base（task-state 驱动的底态）+ transient（一次性演出/交互态，结束后回落 base）：
 * - base：idle（→asleep 子态：无任务 + 5min 无交互）/ working / paused；
 * - transient：celebrating（捕捉演出，一次性）/ petting（撸宠 0.9s 可被打断）/ dragging（拖动，
 *   悬挂小碎步）/ landing（松手挤压回弹 420ms 一次性，桌面 dragPhys release 同口径）/ rest（短休息）；
 * - urgent 抖动 v1 降级不做（U10）；小剧场/彩蛋/坐栖降级（D4）。
 *
 * 实现形态：事件 → handler 表分发（每事件一个小函数，复杂度档位对齐域核心口径——
 * 大 switch 会把 10 个 case 的分支全记在一个函数头上）。
 */
import type { ActiveTask } from "../bridge/protocol.ts";

export type PetBaseState = "idle" | "working" | "paused" | "urgent";
export type PetTransient = "celebrating" | "petting" | "dragging" | "landing" | "rest";

export interface PetState {
  base: PetBaseState;
  transient: PetTransient | null;
  /** idle 子态：无任务 + 持续无交互 → 睡着（任意交互揉眼醒来） */
  asleep: boolean;
}

export const PET_IDLE_STATE: PetState = { base: "idle", transient: null, asleep: false };

/** idle → asleep 的静默阈值（UIUX §3.4：无任务 + 5min 无交互） */
export const ASLEEP_AFTER_MS = 5 * 60_000;

export type PetEvent =
  | { kind: "task-state"; task: ActiveTask | null }
  /** 本端点 ✔ 完成 → celebrating（一次性，演出结束 celebrate-end 回落） */
  | { kind: "task-done" }
  | { kind: "celebrate-end" }
  | { kind: "pet-start" }
  | { kind: "pet-end" }
  | { kind: "drag-start" }
  | { kind: "drag-end" }
  /** 松手挤压回弹 420ms 到点回落（渲染层定时派发） */
  | { kind: "land-end" }
  | { kind: "break-start" }
  | { kind: "break-end" }
  /** 任意用户交互（点击/悬停/拖动开始）——asleep 揉眼醒来 */
  | { kind: "interact" }
  /** 提醒 urgent 底态（P1 D3，解除 U10）：on 进催促抖动，off 回任务派生底态 */
  | { kind: "urgent"; on: boolean };

/** task-state → 底态映射（status 对齐任务六态；helper 只关心 active/paused） */
export function baseFromTask(task: ActiveTask | null): PetBaseState {
  if (!task) return "idle";
  if (task.status === "active") return "working";
  if (task.status === "paused") return "paused";
  return "idle";
}

// ---- 事件 handler（每个 ≤ 少数分支） ----

function onTaskState(state: PetState, ev: Extract<PetEvent, { kind: "task-state" }>): PetState {
  const base = baseFromTask(ev.task);
  // 新任务出发（idle → working）：清演出态并唤醒——「就决定是你了」由气泡层接棒
  const transient = base === "working" && state.base !== "working" ? null : state.transient;
  const asleep = ev.task ? false : state.asleep;
  return { base, transient, asleep };
}

function onTaskDone(state: PetState): PetState {
  return { ...state, transient: "celebrating", asleep: false };
}

/** urgent 底态（P1 D3 解除 U10）：on = 催促抖动（演出/睡觉让位），off 回 idle 待 task-state 校正 */
function onUrgent(state: PetState, ev: Extract<PetEvent, { kind: "urgent" }>): PetState {
  if (!ev.on) return state.base === "urgent" ? { ...state, base: "idle" } : state;
  return { ...state, base: "urgent", transient: null, asleep: false };
}

function clearTransient(state: PetState, which: PetTransient): PetState {
  return state.transient === which ? { ...state, transient: null } : state;
}

/** 演出独占态（celebrating）与拖动（dragging）期间不接受进入的 handler 共用守卫 */
function occupied(state: PetState): boolean {
  return state.transient === "celebrating" || state.transient === "dragging";
}

type PetHandler<K extends PetEvent["kind"]> = (state: PetState, ev: Extract<PetEvent, { kind: K }>) => PetState;

const HANDLERS: { [K in PetEvent["kind"]]: PetHandler<K> } = {
  "task-state": onTaskState,
  "task-done": onTaskDone,
  "celebrate-end": (s) => clearTransient(s, "celebrating"),
  "pet-start": (s) => (occupied(s) ? s : { ...s, transient: "petting", asleep: false }),
  "pet-end": (s) => clearTransient(s, "petting"),
  "drag-start": (s) => ({ ...s, transient: "dragging", asleep: false }),
  "drag-end": (s) => (s.transient === "dragging" ? { ...s, transient: "landing" } : s),
  "land-end": (s) => clearTransient(s, "landing"),
  "break-start": (s) => (occupied(s) ? s : { ...s, transient: "rest" }),
  "break-end": (s) => clearTransient(s, "rest"),
  interact: (s) => (s.asleep ? { ...s, asleep: false } : s),
  urgent: onUrgent,
};

export function reduce(state: PetState, ev: PetEvent): PetState {
  const handler = HANDLERS[ev.kind] as (s: PetState, e: PetEvent) => PetState;
  return handler(state, ev);
}

/** 是否该入睡（纯判定，时钟由调用方注入；渲染层在 idle 态静默时轮询） */
export function shouldSleep(state: PetState, lastInteractMs: number, nowMs: number): boolean {
  return state.base === "idle" && !state.transient && nowMs - lastInteractMs >= ASLEEP_AFTER_MS;
}
