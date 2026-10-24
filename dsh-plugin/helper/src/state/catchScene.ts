/**
 * 捕捉演出判定纯逻辑（FR-B3，语义移植 PetApp.vue milestoneCrossed/streakToShow +
 * useCatchScene 演出变体）：里程碑 = 图鉴累计捕捉跨 {10,50,100,200,500,1000} 阈值
 * （优先、与连胜演出互不叠加）；连胜演出 = 今日首捕（前 todayCount=0 且完成计数后 >0）
 * 且连胜 ≥3 天。reducedMotion 即时结算（0ms 等待、时序保留）由渲染层执行。
 *
 * 数据来源注记：before/after 图鉴计数与连胜快照在桌面由 PetApp 完成路径内取自后端；
 * helper 侧同样由完成动作编排方（host 郑重时刻判定，pet/solemn.ts 同构）供给——
 * 桥协议当前无承载数据面（full-parity 2.4/2.5 发现的接线缺口，见 helper/README 注记），
 * 未接线时 planCatchScene 退化为 plain（普通单球演出），机制全量在位。
 */

/** 图鉴累计捕捉里程碑阈值（对齐桌面与 host pet/solemn.ts MILESTONES） */
export const MILESTONES = [10, 50, 100, 200, 500, 1000] as const;

/** 连胜快照（对齐桌面 task_streak 输出 {days, today_count}） */
export interface StreakSnap {
  days: number;
  todayCount: number;
}

/** 演出变体：plain 单球 / streak 双球三摇 / milestone 双排星星 */
export type SceneKind = "plain" | "streak" | "milestone";

/** 里程碑判定：完成前后累计数跨过任一阈值返回该阈值（多次跨越取最高）；数据缺失 → null */
export function crossedMilestone(before: number | null, after: number | null): number | null {
  if (before == null || after == null || after <= before) return null;
  let crossed: number | null = null;
  for (const m of MILESTONES) {
    if (before < m && after >= m) crossed = m;
  }
  return crossed;
}

/** 连胜演出判定：今日首捕（before.todayCount=0 且 after.todayCount>0）且 after.days ≥3 → 天数 */
export function streakCeremonyDays(before: StreakSnap | null, after: StreakSnap | null): number | null {
  if (before == null || after == null) return null;
  if (before.todayCount === 0 && after.todayCount > 0 && after.days >= 3) return after.days;
  return null;
}

/** 演出计划：里程碑优先、互不叠加（FR-B3 Gherkin「里程碑优先」场景） */
export function planCatchScene(input: { milestone?: number | null; streakDays?: number | null }): SceneKind {
  if (input.milestone != null) return "milestone";
  if (input.streakDays != null) return "streak";
  return "plain";
}

/**
 * 演出时序表（ms 相对演出起点；跳过/reducedMotion 时整体即时结算——「时序保留」=
 * 结算文案与顺序不变，等待时长归零）。双球三摇是唯一允许超 1.5s 的演出，上限 2s。
 */
export interface SceneStep {
  at: number;
  phase: "crouch" | "throw" | "land" | "shake" | "settle";
  /** streak 变体的交替侧（-1/1）；单球演出恒 0 */
  side: -1 | 0 | 1;
}

/** 单球演出帧序列（预备 120ms → 掷球 300ms → 三摇 600ms → 星星 → 收场 1320ms） */
export function plainSceneSeq(): SceneStep[] {
  return [
    { at: 0, phase: "crouch", side: 0 },
    { at: 120, phase: "throw", side: 0 },
    { at: 420, phase: "shake", side: 0 },
    { at: 1020, phase: "settle", side: 0 },
    { at: 1320, phase: "settle", side: 0 },
  ];
}

/** 连胜双球变体（双球左右交替三摇 ×2 轮，≤2s） */
export function streakSceneSeq(): SceneStep[] {
  return [
    { at: 0, phase: "crouch", side: 0 },
    { at: 120, phase: "throw", side: -1 },
    { at: 120, phase: "throw", side: 1 },
    { at: 420, phase: "shake", side: -1 },
    { at: 770, phase: "shake", side: 1 },
    { at: 1120, phase: "shake", side: -1 },
    { at: 1470, phase: "shake", side: 1 },
    { at: 1820, phase: "settle", side: 0 },
    { at: 1920, phase: "settle", side: 0 },
  ];
}

/** 演出结算的星星数（milestone 双排 12 / streak 14 / plain 6——对齐桌面 burstStars 档位） */
export function sceneStarCount(kind: SceneKind): number {
  if (kind === "milestone") return 12;
  return kind === "streak" ? 14 : 6;
}
