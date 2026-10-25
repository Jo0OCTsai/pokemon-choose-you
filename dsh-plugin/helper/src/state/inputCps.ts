/**
 * 输入活动强度纯逻辑（FR-A9/AD §4.4「只计数」红线的数值面）：cps = 最近 1s 滑动
 * 窗口内的事件次数（键盘/鼠标按下各计 1，**不区分也不读取任何内容字段**——
 * NFR-13：键值/键名/窗口标题/应用名 0 出本模块）；上行 ≥1s 节流。
 * 时间戳环形缓冲封顶（防高频打字无界增长）。
 */

/** 滑动窗口长度（ms）与缓冲封顶（64 个事件 ≈ 6s @10cps，超出丢最旧） */
export const CPS_WINDOW_MS = 1_000;
export const CPS_RING_CAP = 64;

/** 上行节流最小间隔（AD §4.3 input-activity「≥1s 节流回传」） */
export const ACTIVITY_EMIT_MIN_GAP_MS = 1_000;

export class CpsGauge {
  private readonly ring: number[] = [];
  private readonly now: () => number;
  private readonly windowMs: number;
  private readonly cap: number;

  constructor(now: () => number, windowMs = CPS_WINDOW_MS, cap = CPS_RING_CAP) {
    this.now = now;
    this.windowMs = windowMs;
    this.cap = cap;
  }

  /** 一个键/鼠标事件入窗（无载荷——调用方只许传「次数」，不传内容） */
  feed(): void {
    this.ring.push(this.now());
    if (this.ring.length > this.cap) this.ring.shift();
  }

  /** 当前窗口 cps（窗口外时间戳顺带清理） */
  sample(): number {
    const cutoff = this.now() - this.windowMs;
    while (this.ring.length > 0 && this.ring[0]! < cutoff) this.ring.shift();
    return this.ring.length;
  }

  reset(): void {
    this.ring.length = 0;
  }
}

/** 节流判定：距上次上行 ≥ minGapMs 才允许发（首报立即允许——lastSent=null 语义传 -Infinity） */
export function shouldEmitActivity(lastSentMs: number, nowMs: number, minGapMs = ACTIVITY_EMIT_MIN_GAP_MS): boolean {
  return nowMs - lastSentMs >= minGapMs;
}

/** cps 三档（AD §4.4：<2 静默 / 2–5 轻微 / ≥5 密集——驱动渲染层微抖与回头） */
export type InputBand = "silent" | "light" | "dense";

export function bandOf(cps: number): InputBand {
  if (cps < 2) return "silent";
  return cps < 5 ? "light" : "dense";
}
