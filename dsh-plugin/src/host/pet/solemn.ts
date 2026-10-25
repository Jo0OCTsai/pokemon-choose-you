/**
 * Solemn moment determination and TTS dispatch (full-parity A30 / §4.6 / FR-A7·B3): host completion
 * action orchestration path——on completion (this form is the form where the completion action occurred), fetch streak (and Pokédex pre/post counts),
 * milestone (priority, non-stacking) or streak ceremony (today's first capture && streak ≥3 days) qualifies as a solemn moment → `tts-speak` is only sent to **this form's** helper
 * (the opposing form's pet is physically isolated with no TTS bridge——arbitration does not depend on cross-form signals).
 *
 * `StreakProvider` is an injected interface placeholder (domain/streak.ts is being implemented by parallel task 1.5);
 * assembly wiring is in 2.7/2.9. Default muted = shared key `pet_voice` (desktop alignment D26;
 * helper side is additionally gated by sys-config.tts.enabled——both sides share the same source).
 */
import type { Conn } from "../storage/db";
import { getSetting } from "../domain/settings";
import { resolveLang } from "./stateFeed";
import { streakFromDb } from "../domain/streak";
import type { BridgeClient } from "./bridge";

/** Streak snapshot shape (aligned with desktop task_streak output {days, today_count}) */
export interface StreakSnapshot {
  days: number;
  todayCount: number;
}

/** Streak data source injection interface (2.7/2.9 assembly wired to domain/streak.ts) */
export interface StreakProvider {
  read(conn: Conn): StreakSnapshot;
}

/** Dex cumulative capture milestones (desktop aligned; priority over streak ceremony, non-stacking) */
export const MILESTONES = [10, 50, 100, 200, 500, 1000] as const;

/** Solemn moment type (three-language text is assembled by caller——buildText injects i18n surface) */
export type SolemnKind = "milestone" | "streak";

export interface SolemnContext {
  kind: SolemnKind;
  milestone?: number;
  streakDays?: number;
}

/** Milestone determination: Pokédex cumulative count crosses a threshold while going from before → after (returns that threshold; multiple crossings take the highest) */
export function crossedMilestone(before: number, after: number): number | null {
  let crossed: number | null = null;
  for (const m of MILESTONES) {
    if (before < m && after >= m) crossed = m;
  }
  return crossed;
}

/** Streak ceremony determination (FR-B3): today's first capture (todayCount===1, completion already counted) && streak ≥3 days */
export function isStreakCeremony(snapshot: StreakSnapshot): boolean {
  return snapshot.days >= 3 && snapshot.todayCount === 1;
}

/** Solemn TTS determination dependency surface (all injected) */
export interface SolemnDeps {
  conn: Conn;
  streak: StreakProvider;
  /** This form's current bridge (the opposing form has no bridge——physically isolated) */
  bridge(): BridgeClient | null;
  /** Three-language line assembly (called by the caller——implementation on i18n/dictionary surface, 2.7/2.9) */
  buildText(ctx: SolemnContext, lang: ReturnType<typeof resolveLang>): string;
}

/**
 * Completion action path's solemn TTS (call this after the completion action has been persisted): shared key pet_voice off (default silent D26)
 * → not sent; helper not present → not sent (silent); milestone priority over streak ceremony.
 * Returns whether tts-speak was actually sent (sys-tts capability bit missing is also not sent——the send face is internally gated).
 */
export function speakSolemnOnCompletion(deps: SolemnDeps, dexCounts?: { before: number; after: number }): boolean {
  if (getSetting(deps.conn, "pet_voice") !== "true") {
    return false;
  }
  const ctx = solemnContext(deps, dexCounts);
  if (ctx === null) {
    return false;
  }
  const bridge = deps.bridge();
  if (bridge === null) {
    return false;
  }
  return bridge.sys.sendTtsSpeak(deps.buildText(ctx, resolveLang(deps.conn)));
}

/** Solemn moment judgment (pure function, no sending surface——unit-testable): milestone priority; otherwise streak ceremony */
function solemnContext(
  deps: Pick<SolemnDeps, "conn" | "streak">,
  dexCounts?: { before: number; after: number },
): SolemnContext | null {
  if (dexCounts !== undefined) {
    const milestone = crossedMilestone(dexCounts.before, dexCounts.after);
    if (milestone !== null) {
      return { kind: "milestone", milestone };
    }
  }
  const snapshot = deps.streak.read(deps.conn);
  return isStreakCeremony(snapshot) ? { kind: "streak", streakDays: snapshot.days } : null;
}

// ---- 2.7 装配消费面：三语台词 + 完成路径一站式封装（taskComplete / pet done 共用） ----

/** Solemn moment three-language line (2.7 wiring: host-side assembly, tone aligned with desktop pet voice——at most 1 line) */
export function solemnTtsText(ctx: SolemnContext, lang: ReturnType<typeof resolveLang>): string {
  if (ctx.kind === "milestone") {
    const m = String(ctx.milestone);
    if (lang === "zh-Hant") return `圖鑑收錄第 ${m} 隻！這一刻，值得紀念。`;
    if (lang === "en") return `Dex entry number ${m}! A moment worth remembering, Trainer.`;
    return `图鉴收录第 ${m} 只！这一刻，值得纪念。`;
  }
  const d = String(ctx.streakDays);
  if (lang === "zh-Hant") return `連勝 ${d} 天了，訓練家。明天也一起出發吧！`;
  if (lang === "en") return `${d}-day streak, Trainer. Let's head out again tomorrow!`;
  return `连胜 ${d} 天了，训练家。明天也一起出发吧！`;
}

/** 图鉴累计捕捉数（milestone 判定的前后快照数据源——完成动作路径读两次） */
export function dexDoneCount(conn: Conn): number {
  return Number((conn.prepare("SELECT COALESCE(SUM(status='done'), 0) AS n FROM tasks").get() as { n: number }).n);
}

/** open 任务计数（allDone 收工判定数据源——桌面 listTasks("open") 同口径：全部未完成） */
export function openTaskCount(conn: Conn): number {
  return Number(
    (
      conn.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status IN ('inbox','scheduled','active','paused')").get() as {
        n: number;
      }
    ).n,
  );
}

/**
 * Completion path one-stop solemn moment (taskComplete orchestration / pet done path shared consumption——2.7 wiring):
 * dexCounts provides before/after Pokémon count (milestone judgment); streak source fixed to streakFromDb.
 * Returns the solemn moment context (null = not a solemn moment / no voice sent)——for task-state.caught variant projection (A1).
 */
export function celebrateSolemn(
  conn: Conn,
  bridge: () => BridgeClient | null,
  dexCounts?: { before: number; after: number },
): SolemnContext | null {
  const ctx = solemnContext({ conn, streak: { read: (c) => streakFromDb(c) } }, dexCounts);
  if (ctx === null) {
    return null;
  }
  speakSolemnOnCompletion(
    {
      conn,
      streak: { read: (c) => streakFromDb(c) },
      bridge,
      buildText: solemnTtsText,
    },
    dexCounts,
  );
  return ctx;
}

/** Solemn moment context → task-state.caught variant projection (A1: helper CatchShow data surface) */
export function caughtVariantOf(ctx: SolemnContext): { milestone?: number; streakDays?: number } {
  return ctx.kind === "milestone" ? { milestone: ctx.milestone } : { streakDays: ctx.streakDays };
}
