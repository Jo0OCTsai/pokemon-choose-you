/**
 * 输入响应（FR-A9 渲染侧面，语义移植 composables/useInputResponse——Bongo Cat 模式）：
 * 消费 main 进程 input-activity 的 {cps}（只计数——键值 0 出 helper 计数模块，NFR-13），
 * 按档位驱动「跟随式」小反应：<2 静默 / 2–5 轻微微抖(earwig) / ≥5 密集（偶尔认真看）；
 * 打字停顿 >3s 一次哈欠/回头；working 态 hop 节奏耦合 ≤+10%（sys-config.focusHopCoupleMax）；
 * 演出中跳过反应（节奏耦合无打扰面可继续）；reducedMotion 整体不启动。
 */
import { bandOf, type InputBand } from "../state/inputCps.ts";
import { mirror } from "./mirror.ts";
import { refs } from "./refs.ts";

const EVAL_MS = 500;
/** 事件断流（>1.5s 无喂入）按静默处理 */
const FEED_STALE_MS = 1_500;
/** 打字停顿阈值（>3s 一次哈欠/看你） */
const DOZE_AFTER_MS = 3_000;
const WIGGLE_CD_LIGHT_MS = 2_600;
const WIGGLE_CD_DENSE_MS = 1_800;
const NOTICE_CD_MS = 6_000;

let lastCps = 0;
let lastFeedAt = 0;
let lastActiveAt = 0;
let lastWiggleAt = 0;
let lastNoticeAt = 0;
let dozeFired = false;
let hopScale: number | null = null;

/** hop 节奏耦合缩放（desktop hopScaleFor 同构：min(cps,10) 线性映射，上限 max 档） */
export function hopScaleFor(cps: number, max: number): number | null {
  if (bandOf(cps) === "silent" || max <= 0) return null;
  return 1 / (1 + ((0.1 * Math.min(cps, 10)) / 10) * (max / 0.1));
}

/** main 进程 input-activity 喂入（cps = 最近一秒事件数；0 = 静默） */
export function feedActivity(cps: number): void {
  lastCps = Math.max(0, cps);
  lastFeedAt = Date.now();
  if (lastCps >= 1) {
    lastActiveAt = lastFeedAt;
    dozeFired = false;
  }
}

export function initInputResponse(): void {
  setInterval(evaluate, EVAL_MS);
}

function evaluate(): void {
  if (mirror.reducedMotion || !mirror.inputResponse.enabled) {
    applyHop(null);
    return;
  }
  const now = Date.now();
  const band: InputBand = now - lastFeedAt > FEED_STALE_MS ? "silent" : bandOf(lastCps);
  mirror.inputBand = band;
  const working = mirror.petState.base === "working";

  applyHop(working ? hopScaleFor(lastCps, mirror.inputResponse.hopCoupleMax) : null);

  if (isBusy()) return; // 演出/对话/拖拽/睡着：反应让路（节奏耦合无打扰面已先行应用）

  if (band === "silent") {
    evaluateSilent(now, working);
    return;
  }
  evaluateActive(now, working, band);
}

/** 静默档反应（非 working 且停顿 >3s：一次哈欠/回头） */
function evaluateSilent(now: number, working: boolean): void {
  if (!working && lastActiveAt > 0 && now - lastActiveAt > DOZE_AFTER_MS && !dozeFired) {
    dozeFired = true;
    micro(Math.random() < 0.5 ? "m-yawn" : "m-look");
  }
}

/** 活跃档反应（非 working：轻/密两档抖动冷却 + 密集档偶发认真看） */
function evaluateActive(now: number, working: boolean, band: InputBand): void {
  if (working) return;
  const cd = band === "light" ? WIGGLE_CD_LIGHT_MS : WIGGLE_CD_DENSE_MS;
  if (now - lastWiggleAt > cd) {
    lastWiggleAt = now;
    micro("m-earwig");
  }
  if (band === "dense" && now - lastNoticeAt > NOTICE_CD_MS) {
    lastNoticeAt = now;
    micro("m-look");
  }
}

function isBusy(): boolean {
  const s = mirror.petState;
  return mirror.sceneBusy || mirror.chatOpen || s.transient !== null || s.asleep || mirror.quickOpen;
}

function micro(cls: string): void {
  refs.stage.classList.add(cls);
  setTimeout(() => refs.stage.classList.remove(cls), cls === "m-earwig" ? 120 : 900);
}

/** working hop 时长轻缩放（CSS var；非专注/静默恢复默认 null） */
function applyHop(scale: number | null): void {
  if (scale === hopScale) return;
  hopScale = scale;
  refs.sprite.style.setProperty("--hop-dur", scale !== null ? `${(1.6 * scale).toFixed(3)}s` : "");
}
