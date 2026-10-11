/** CaptureShow（UIUX §3.3/PET_INTERACTION_DESIGN §3.3）：≤1.5s 可跳过（蹲→球抛物线→三摇→星星） */
import { mirror } from "./mirror.ts";
import { refs } from "./refs.ts";

const bridge = window.petBridge;

let captureTimers: ReturnType<typeof setTimeout>[] = [];

export function playCapture(): void {
  if (mirror.reducedMotion) return; // 减弱动效：演出跳过，直接结果气泡（runtime 已发）
  stopCapture();
  captureTimers = CAPTURE_SEQ.map(([at, fn]) => setTimeout(fn, at));
}

/** 演出帧序列（预备 120ms → 掷球 300ms → 三摇 600ms → 星星爆开 → 收场） */
const CAPTURE_SEQ: [number, () => void][] = [
  [0, () => refs.stage.classList.add("cap-crouch")],
  [
    120,
    () => {
      refs.stage.classList.remove("cap-crouch");
      refs.captureBall.classList.add("fly");
    },
  ],
  [
    420,
    () => {
      refs.captureBall.classList.remove("fly");
      refs.captureBall.classList.add("shake");
      refs.stage.classList.add("cap-hide-sprite");
    },
  ],
  [
    1020,
    () => {
      refs.captureBall.classList.remove("shake");
      refs.captureStars.classList.add("burst");
    },
  ],
  [1320, endCapture],
];

function endCapture(): void {
  refs.stage.classList.remove("cap-hide-sprite");
  refs.captureStars.classList.remove("burst");
  void bridge.interact("celebrate-end");
}

export function stopCapture(): void {
  for (const t of captureTimers) clearTimeout(t);
  captureTimers = [];
  refs.stage.classList.remove("cap-crouch", "cap-hide-sprite");
  refs.captureBall.classList.remove("fly", "shake");
  refs.captureStars.classList.remove("burst");
}

// 演出期间点击跳过（注意力友好原则 1：演出是对用户动作的回应，随时可拒）
refs.stage.addEventListener("click", () => {
  if (mirror.petState.transient === "celebrating") {
    stopCapture();
    void bridge.interact("celebrate-end");
  }
});
