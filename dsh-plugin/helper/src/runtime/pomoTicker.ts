/**
 * 番茄本地计时器（从 runtime/impl.ts 拆出——棘轮 max-lines，等量迁移；impl.ts 为
 * 统一再出口消费面不变）：1s tick 推进相位，到期置空并回调 kind（气泡/通知/接休息
 * 出口归 RuntimeImpl）。chime 打点（≥45min 长番茄：中点 1 声 / 剩 5 分钟 2 声）由
 * onChime 回调上抛渲染层合成。config 经 setter 随 pomodoro-config 下行更新。
 */
import {
  CHIME_MIN_FOCUS,
  DEFAULT_POMO_CONFIG,
  startBreak,
  startFocus,
  startTrial,
  tickPhase,
  type PomoConfig,
  type PomoPhase,
} from "../state/pomodoro.ts";

export class PomoTicker {
  private readonly now: () => number;
  private readonly onEnded: (kind: "focus" | "trial" | "break") => void;
  private readonly onChime: ((count: 1 | 2) => void) | null;
  private phaseValue: PomoPhase = null;
  private configValue: PomoConfig = DEFAULT_POMO_CONFIG;
  private readonly timer: ReturnType<typeof setInterval>;
  private chimeMid = false;
  private chimeNear = false;

  // 显式字段赋值（Node 24 strip-only 不支持参数属性语法）
  constructor(
    now: () => number,
    onEnded: (kind: "focus" | "trial" | "break") => void,
    onChime?: (count: 1 | 2) => void,
  ) {
    this.now = now;
    this.onEnded = onEnded;
    this.onChime = onChime ?? null;
    this.timer = setInterval(() => this.tick(), 1_000);
  }

  get phase(): PomoPhase {
    return this.phaseValue;
  }

  get config(): PomoConfig {
    return this.configValue;
  }

  set config(config: PomoConfig) {
    this.configValue = config;
  }

  beginFocus(durationMin?: number): void {
    this.resetChime();
    this.phaseValue = startFocus(this.configValue, this.now(), durationMin);
  }

  beginTrial(): void {
    this.resetChime();
    this.phaseValue = startTrial(this.now());
  }

  beginBreak(): void {
    this.resetChime();
    this.phaseValue = startBreak(this.configValue, this.now());
  }

  dispose(): void {
    clearInterval(this.timer);
  }

  private resetChime(): void {
    this.chimeMid = false;
    this.chimeNear = false;
  }

  private tick(): void {
    if (!this.phaseValue) return;
    this.tickChime(this.phaseValue);
    const kind = this.phaseValue.kind;
    const result = tickPhase(this.phaseValue, this.now());
    if (result.ended) {
      this.phaseValue = null;
      this.onEnded(kind);
    }
  }

  /** 长番茄打点（chime 开且 ≥45min 专注：过中点 1 声、剩 ≤5 分钟 2 声——各一次） */
  private tickChime(phase: NonNullable<PomoPhase>): void {
    if (phase.kind !== "focus") return;
    if (this.onChime === null || !this.configValue.chime || phase.durationMin < CHIME_MIN_FOCUS) return;
    const now = this.now();
    if (!this.chimeMid && now >= phase.endAt - (phase.durationMin * 60_000) / 2) {
      this.chimeMid = true;
      this.onChime(1);
    }
    if (!this.chimeNear && phase.endAt - now <= 5 * 60_000) {
      this.chimeNear = true;
      this.onChime(2);
    }
  }
}
