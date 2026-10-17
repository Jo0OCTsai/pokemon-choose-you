/**
 * CaptureShow（UIUX §3.3 + FR-B3 演出面，语义移植 useCatchScene）：
 * plain 单球 ≤1.5s（蹲→球抛物线→三摇→星星）；streak 双球左右交替三摇 ≤2s（今日首捕且
 * 连胜 ≥3 天）；milestone 双排星星（跨 {10,50,100,200,500,1000} 阈值——优先、与连胜
 * 互不叠加）。点击跳过（演出永不绑架用户时间）；reducedMotion 即时结算 0ms（时序保留：
 * celebrate-end 照常收口、星星跳过）。
 */
import { plainSceneSeq, sceneStarCount, streakSceneSeq, type SceneKind } from "../state/catchScene.ts";
import { mirror } from "./mirror.ts";
import { refs } from "./refs.ts";

const bridge = window.petBridge;

let captureTimers: ReturnType<typeof setTimeout>[] = [];
let stars: HTMLElement[] = [];

export function playCapture(scene: SceneKind): void {
  stopCapture(false); // 清上一场残留（不发 celebrate-end——新一轮会自己收口）
  if (mirror.reducedMotion) {
    // 减弱动效：演出即时结算（0ms 等待）——celebrate-end 必须照发收口 transient
    void bridge.interact("celebrate-end");
    return;
  }
  mirror.sceneBusy = true;
  const seq = scene === "streak" ? streakSceneSeq() : plainSceneSeq();
  const starsAt = seq.at(-2)!.at; // 倒数第二步 = 星星爆开；末步 = 收场（streak 收在 2s 内）
  const endAtMs = seq.at(-1)!.at;
  for (const step of seq) {
    if (step.phase === "settle") continue; // 结算统一走 settle()/endCapture()
    captureTimers.push(setTimeout(stepFn(step), step.at));
  }
  captureTimers.push(
    setTimeout(() => {
      const count = sceneStarCount(scene);
      burstStars(count);
      if (scene === "milestone") setTimeout(() => burstStars(6, 18), 150); // 双排星星第二波
    }, starsAt),
  );
  captureTimers.push(setTimeout(() => endCapture(), endAtMs));
}

type SeqStep = { at: number; phase: "crouch" | "throw" | "land" | "shake" | "settle"; side: -1 | 0 | 1 };

/** 帧步骤 → 元素类操作（state/catchScene 时序表的消费面） */
function stepFn(step: SeqStep): () => void {
  const ball = step.side < 0 ? refs.captureBall : step.side > 0 ? refs.captureBall2 : refs.captureBall;
  switch (step.phase) {
    case "crouch":
      return () => refs.stage.classList.add("cap-crouch");
    case "throw":
      return () => {
        refs.stage.classList.remove("cap-crouch");
        refs.stage.classList.add("cap-hide-sprite");
        ball.classList.add("fly");
      };
    case "shake":
      return () => {
        ball.classList.remove("fly");
        ball.classList.add("shake");
      };
    case "land":
      return () => {
        ball.classList.remove("shake");
        ball.classList.add("fly", "landed");
      };
    case "settle":
      return () => undefined; // 结算在 settle()（星星 + 收口）
  }
}

function endCapture(): void {
  clearElements();
  mirror.sceneBusy = false;
  void bridge.interact("celebrate-end");
}

/** 动态造星（挂精灵命中区；桌面 burstStars 同构——纯样式元素无文本面） */
function burstStars(n: number, dyOffset = 0): void {
  const host = refs.stage;
  for (let i = 0; i < n; i++) {
    const s = document.createElement("i");
    s.className = "pk-star" + (n > 6 && i % 3 === 0 ? " big" : "");
    const ang = (Math.PI * 2 * i) / n + Math.random() * 0.6;
    const d = 46 + Math.random() * 26;
    s.style.setProperty("--dx", `${String(Math.round(Math.cos(ang) * d))}px`);
    s.style.setProperty("--dy", `${String(Math.round(Math.sin(ang) * d - 14 + dyOffset))}px`);
    host.appendChild(s);
    stars.push(s);
    setTimeout(() => {
      s.remove();
      stars = stars.filter((x) => x !== s);
    }, 450);
  }
}

/**
 * 停止/跳过演出。finish=false：清残留不收口（新演出接管）；跳过路径 finish=true 由
 * 点击监听调用（即时结算——星星跳过、celebrate-end 照发，时序保留）。
 */
export function stopCapture(finish = true): void {
  const wasPlaying = captureTimers.length > 0 || mirror.sceneBusy;
  for (const t of captureTimers) clearTimeout(t);
  captureTimers = [];
  clearElements();
  mirror.sceneBusy = false;
  if (finish && wasPlaying) void bridge.interact("celebrate-end");
}

function clearElements(): void {
  refs.stage.classList.remove("cap-crouch", "cap-hide-sprite");
  refs.captureBall.classList.remove("fly", "shake", "landed");
  refs.captureBall2.classList.remove("fly", "shake", "landed");
  for (const s of stars.splice(0)) s.remove();
}

// 演出期间点击跳过（注意力友好原则 1：演出是对用户动作的回应，随时可拒）
refs.stage.addEventListener("click", () => {
  if (mirror.sceneBusy) stopCapture(true);
});
