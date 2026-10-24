/**
 * 时刻台词纯逻辑（FR-B2，语义移植主应用 composables/useTimeLines.ts）：
 * 优先级 生日 > 深夜(23:00–04:59) > 周五晚(≥18) > 整点(9:00–18:59)；
 * 普通类每天一次、整点类每小时一次（去重键 + 内存 Set 消费；桌面用 localStorage，
 * helper 会话内存——重开 helper 当日台词可重播一次，属可接受漂移）。
 * 禁播闸门（睡觉/urgent/对话/演出/拖拽/快捷屏）独立判定，由渲染层组装后传入。
 */

export type TimeLineKey = "birthday" | "night" | "friday" | "hour";

export interface TimeLineCtx {
  /** 精灵生日（首次见面日）的月/日（1 基）；缺省不判生日 */
  birthday?: { month: number; day: number } | null;
}

/** 工作时段整点台词的适用小时（9:00~18:59 的整点场合） */
const HOUR_FROM = 9;
const HOUR_TO = 18;

/** 返回此刻 eligible 的台词键（优先级：生日 > 深夜 > 周五晚 > 整点；调用方去重后再播） */
export function pickTimeLine(now: Date, ctx: TimeLineCtx = {}): TimeLineKey | null {
  if (isBirthdayLine(now, ctx.birthday ?? null)) {
    return "birthday";
  }
  const h = now.getHours();
  if (h >= 23 || h < 5) return "night";
  if (isFridayEvening(now, h)) return "friday";
  if (isWorkHour(h)) return "hour";
  return null;
}

/** 生日台词判定（月/日与精灵首次见面日吻合） */
function isBirthdayLine(now: Date, birthday: { month: number; day: number } | null): boolean {
  return birthday !== null && now.getMonth() + 1 === birthday.month && now.getDate() === birthday.day;
}

/** 周五晚判定（≥18 点） */
function isFridayEvening(now: Date, h: number): boolean {
  return now.getDay() === 5 && h >= 18;
}

/** 工作时段整点判定（9:00~18:59） */
function isWorkHour(h: number): boolean {
  return h >= HOUR_FROM && h <= HOUR_TO;
}

/** 当天（整点为当天+小时）去重键：同键同周期只播一次 */
export function lineDedupKey(key: TimeLineKey, now: Date): string {
  const d = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  return key === "hour" ? `pet.line.hour.${d}.${now.getHours()}` : `pet.line.${key}.${d}`;
}

/** 禁播闸门（睡觉/urgent/对话/演出/拖拽/快捷屏期间不播——对齐桌面 checkTimeLines 守卫） */
export interface TimeLineGate {
  asleep: boolean;
  urgent: boolean;
  chatOpen: boolean;
  sceneBusy: boolean;
  dragging: boolean;
  quickOpen: boolean;
}

export function timeLinesBlocked(gate: TimeLineGate): boolean {
  return gate.asleep || gate.urgent || gate.chatOpen || gate.sceneBusy || gate.dragging || gate.quickOpen;
}

/** 生日陪伴天数（FR-B2 生日台词带陪伴天数；至少 1 天） */
export function companionDays(metAtMs: number, nowMs: number): number {
  if (!Number.isFinite(metAtMs) || metAtMs <= 0) return 1;
  return Math.max(1, Math.floor((nowMs - metAtMs) / 86_400_000));
}

/** 首次见面日（月/日，1 基）——helper 侧自有数据（渲染层 localStorage，同桌面 pet.metOn 口径） */
export function birthdayOf(metAtMs: number): { month: number; day: number } | null {
  if (!Number.isFinite(metAtMs) || metAtMs <= 0) return null;
  const d = new Date(metAtMs);
  return { month: d.getMonth() + 1, day: d.getDate() };
}

/** 内存去重消费器：未播过返回 true 并记账（helper 会话级，不持久化） */
export class LineDedup {
  private readonly seen = new Set<string>();

  /** 返回 true = 本次应播（并记账）；false = 本周期已播过 */
  consume(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}
