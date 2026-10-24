/**
 * 陪跑精灵纯逻辑（FR-B4，语义移植 PetApp.vue mate watch/inviteMate）：
 * 专注满 25 分钟且仍在 working → 一位图鉴宝可梦来陪坐（排除当前与主宝可梦，
 * 图鉴空回退伊布）；一次会话（一场专注）最多一位、只出现一次；默认关（pet_mate）。
 * 零台词零闪烁零数值（桌面纪律）。相位时序（walk 650ms → sit；离场 wave 620ms）
 * 由渲染层执行，reducedMotion 直接 sit 相位。
 */

/** 陪跑触发阈值：本场专注已进行秒数 */
export const MATE_AFTER_FOCUS_SEC = 25 * 60;

/** 图鉴候选耗尽时的回退精灵（内置六只之一，必然可达） */
export const MATE_FALLBACK = "eevee";

/** 陪跑触发闸门（对齐桌面 watch(focusElapsedSec) 守卫全量） */
export interface MateGate {
  /** pet_mate 共享设置（默认关；helper 侧经配置面注入——见 README 接线注记） */
  enabled: boolean;
  /** 当前处于 working 底态 */
  working: boolean;
  /** 本场专注已进行秒数 */
  focusSec: number;
  /** 客人已在场 */
  present: boolean;
  /** 本场专注已请过（会话结束重置） */
  shownThisSession: boolean;
}

export function shouldInviteMate(gate: MateGate): boolean {
  if (gate.present || gate.shownThisSession) return false;
  if (!gate.enabled || !gate.working) return false;
  return gate.focusSec >= MATE_AFTER_FOCUS_SEC;
}

/** 从候选池挑一位（排除当前与主宝可梦；空池/全排除回退伊布） */
export function pickMateSprite(pool: readonly string[], exclude: readonly string[]): string {
  const deny = new Set(exclude.filter((s) => s));
  const candidates = pool.filter((s) => s && !deny.has(s));
  if (candidates.length === 0) return MATE_FALLBACK;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? MATE_FALLBACK;
}

/** 专注会话结束（番茄 running false 沿）→ 重置「本场已请」标记（下一场可再请） */
export function mateSessionReset(running: boolean, wasRunning: boolean): boolean {
  return !running && wasRunning;
}
