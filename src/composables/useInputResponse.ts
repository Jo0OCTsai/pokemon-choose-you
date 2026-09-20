import { motionReduced } from "./usePetIdle";

/**
 * 输入响应（PET_EXPERIENCE_PROPOSAL F1，Bongo Cat 模式）：
 * 消费后端每秒一次的 {cps}（键鼠活动强度，见 src-tauri/src/input.rs——只传计数不传内容），
 * 按档位驱动「跟随式」小反应。纪律：这是对用户输入的被动跟随，不是演出——
 * 幅度 ≤ 微动作档、无音效、无气泡、不占闪烁名额；「减弱动效」下整体关闭。
 */

export type InputBand = "silent" | "light" | "dense";

/** 分档：<2 静默 · 2~5 轻打字 · ≥5 密集 */
export function bandOf(cps: number): InputBand {
  if (cps < 2) return "silent";
  return cps < 5 ? "light" : "dense";
}

/**
 * working 态 hop 节奏耦合：返回动画时长缩放（1 = 默认，<1 = 加快，上限 +10%）。
 * 静默档返回 null（恢复默认）。
 */
export function hopScaleFor(cps: number): number | null {
  if (bandOf(cps) === "silent") return null;
  return 1 / (1 + (0.1 * Math.min(cps, 10)) / 10);
}

export interface InputResponseOpts {
  isEnabled: () => boolean;
  isWorking: () => boolean;
  /** 「专注时也响应」子开关（独立默认关） */
  isWorkingCoupled: () => boolean;
  /** 演出/演出级互斥：忙时跳过反应，但节奏耦合无打扰面可继续 */
  isBusy: () => boolean;
  /** idle/paused 微抖回应（±2°/120ms） */
  onWiggle: () => void;
  /** 密集档偶尔「认真看」 */
  onNotice: () => void;
  /** 打字停顿 >3s 后的一次哈欠/看你 */
  onDoze: () => void;
  /** working 节奏耦合缩放（null = 恢复默认） */
  onHopScale: (scale: number | null) => void;
}

const EVAL_MS = 500;

export function useInputResponse(opts: InputResponseOpts) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let lastCps = 0;
  let lastFeedAt = 0;
  /** 最近一次有活动（cps ≥ 1）的时刻——停顿判定以它为准（cps=0 的喂入不算活动） */
  let lastActiveAt = 0;
  let lastWiggleAt = 0;
  let lastNoticeAt = 0;
  let dozeFired = false;

  /** 后端事件喂入（cps = 最近一秒键鼠事件数；0 表示静默） */
  function feed(cps: number) {
    if (!running) return;
    lastCps = Math.max(0, cps);
    lastFeedAt = Date.now();
    if (lastCps >= 1) {
      lastActiveAt = lastFeedAt;
      dozeFired = false;
    }
  }

  function evaluate() {
    if (!running) return;
    const now = Date.now();
    // 事件断流（>1.5s 无喂入）按静默处理
    const band = now - lastFeedAt > 1500 ? "silent" : bandOf(lastCps);
    const working = opts.isWorking();

    if (working) {
      opts.onHopScale(opts.isWorkingCoupled() ? hopScaleFor(lastCps) : null);
    } else {
      opts.onHopScale(null);
    }

    if (opts.isBusy()) return;

    if (band === "silent") {
      // 打字停顿 >3s：一次哈欠/回头看你（专注态不打断节奏）
      if (!working && lastActiveAt > 0 && now - lastActiveAt > 3000 && !dozeFired) {
        dozeFired = true;
        opts.onDoze();
      }
      return;
    }
    if (!working) {
      const wiggleCd = band === "light" ? 2600 : 1800;
      if (now - lastWiggleAt > wiggleCd) {
        lastWiggleAt = now;
        opts.onWiggle();
      }
      if (band === "dense" && now - lastNoticeAt > 6000) {
        lastNoticeAt = now;
        opts.onNotice();
      }
    }
  }

  return {
    feed,
    start() {
      if (running || motionReduced()) return;
      running = true;
      timer = setInterval(evaluate, EVAL_MS);
    },
    stop() {
      running = false;
      if (timer) clearInterval(timer);
      timer = null;
      lastCps = 0;
      opts.onHopScale(null);
    },
  };
}
