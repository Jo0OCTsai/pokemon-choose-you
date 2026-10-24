/**
 * 番茄本地计时纯逻辑（D2：各形态本地态不同步，账目由数据层经 focus-settle 合并）。
 * 绝不自动开下一轮（注意力友好原则 2）：focus 到期只置 ended 标志，由 UI 呈现出口。
 */
export interface PomoConfig {
  /** 专注时长档位（分钟）：[15, 25, 45, 60] */
  durations: number[];
  breakMin: number;
  /** 番茄功能开关（共享设置 pomodoro_enabled；false 时渲染层不显示 PomoPill） */
  enabled: boolean;
}

export const DEFAULT_POMO_CONFIG: PomoConfig = {
  durations: [15, 25, 45, 60],
  breakMin: 5,
  enabled: false,
};

export type PomoPhase =
  | { kind: "focus"; endAt: number; durationMin: number }
  | { kind: "break"; endAt: number }
  | { kind: "trial"; endAt: number } // 🍦 先试 5 分钟（结束不自动接休息）
  | null;

export const TRIAL_MIN = 5;

export function startFocus(cfg: PomoConfig, now: number, durationMin?: number): PomoPhase {
  const duration = durationMin ?? cfg.durations[Math.min(1, cfg.durations.length - 1)] ?? 25;
  return { kind: "focus", endAt: now + duration * 60_000, durationMin: duration };
}

export function startBreak(cfg: PomoConfig, now: number): PomoPhase {
  return { kind: "break", endAt: now + cfg.breakMin * 60_000 };
}

export function startTrial(now: number): PomoPhase {
  return { kind: "trial", endAt: now + TRIAL_MIN * 60_000 };
}

/** 到期判定（纯函数：phase 到点返回 ended=true 且 phase 置 null——不自动续轮） */
export function tickPhase(phase: PomoPhase, now: number): { phase: PomoPhase; ended: boolean } {
  if (!phase) return { phase: null, ended: false };
  if (now < phase.endAt) return { phase, ended: false };
  return { phase: null, ended: true };
}

/** 剩余 ms（无 phase 为 null；色环/药丸倒计时共用） */
export function msLeft(phase: PomoPhase, now: number): number | null {
  if (!phase) return null;
  return Math.max(0, phase.endAt - now);
}

/** mm:ss（药丸/chip 定宽防跳动） */
export function mmss(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * 色环进度（0~1，已流逝占比）与档位色（绿 → 琥珀 → 红；时间盲友好，UIUX §5）。
 * 无 phase 返回 null（色环隐藏）。
 */
export function ringProgress(phase: PomoPhase, now: number): { pct: number; tone: "green" | "amber" | "red" } | null {
  if (!phase) return null;
  const total =
    phase.kind === "focus" ? phase.durationMin * 60_000 : phase.kind === "break" ? null : TRIAL_MIN * 60_000;
  if (total === null) return { pct: 0, tone: "green" };
  const pct = Math.min(1, Math.max(0, 1 - (phase.endAt - now) / total));
  const tone = pct >= 0.95 ? "red" : pct >= 0.7 ? "amber" : "green";
  return { pct, tone };
}
