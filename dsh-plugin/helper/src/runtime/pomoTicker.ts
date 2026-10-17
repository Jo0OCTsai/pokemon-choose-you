/**
 * 番茄本地计时器（从 runtime/impl.ts 拆出——棘轮 max-lines，等量迁移；impl.ts 为
 * 统一再出口消费面不变）：1s tick 推进相位，到期置空并回调（气泡/出口归 RuntimeImpl，
 * 绝不自动续轮）。config 经 setter 随 pomodoro-config 下行更新。
 */
import {
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
  private readonly onEnded: (wasBreak: boolean) => void;
  private phaseValue: PomoPhase = null;
  private configValue: PomoConfig = DEFAULT_POMO_CONFIG;
  private readonly timer: ReturnType<typeof setInterval>;

  // 显式字段赋值（Node 24 strip-only 不支持参数属性语法）
  constructor(now: () => number, onEnded: (wasBreak: boolean) => void) {
    this.now = now;
    this.onEnded = onEnded;
    this.timer = setInterval(() => this.tick(), 1_000);
  }

  get phase(): PomoPhase {
    return this.phaseValue;
  }

  set config(config: PomoConfig) {
    this.configValue = config;
  }

  beginFocus(durationMin?: number): void {
    this.phaseValue = startFocus(this.configValue, this.now(), durationMin);
  }

  beginTrial(): void {
    this.phaseValue = startTrial(this.now());
  }

  beginBreak(): void {
    this.phaseValue = startBreak(this.configValue, this.now());
  }

  dispose(): void {
    clearInterval(this.timer);
  }

  private tick(): void {
    if (!this.phaseValue) return;
    const wasBreak = this.phaseValue.kind === "break";
    const result = tickPhase(this.phaseValue, this.now());
    if (result.ended) {
      this.phaseValue = null;
      this.onEnded(wasBreak);
    }
  }
}
