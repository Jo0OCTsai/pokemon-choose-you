/**
 * 生命感调度器（PET_INTERACTION_DESIGN §4.4）——桌宠待机时低频随机微动作，
 * 像「它在过自己的日子」：眨眼 / 左右看 / 翻面 / 哈欠，均为一次性事件而非循环动画。
 *
 * 纪律（注意力友好）：
 * - working 态只保留眨眼且频率减半（专注时不打扰）；
 * - 同一时间只有一个微动作，与事件演出互斥（isBusy 让路）；
 * - 「减弱动态效果」生效时整个调度器不启动（动画即时完成，调度失去意义且省电）。
 */
export type PetMicroAction = "blink" | "look" | "flip" | "yawn";

/** 权重池：眨眼最常见，哈欠最稀罕 */
const IDLE_POOL: [PetMicroAction, number][] = [
  ["blink", 5],
  ["look", 3],
  ["flip", 2],
  ["yawn", 1],
];
const WORKING_POOL: PetMicroAction[] = ["blink"];

function pickWeighted(pool: [PetMicroAction, number][]): PetMicroAction {
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [action, w] of pool) {
    if ((r -= w) < 0) return action;
  }
  return pool[0][0];
}

export function motionReduced(): boolean {
  return (
    document.documentElement.classList.contains("reduce-motion") ||
    (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  );
}

export function usePetIdle(options: {
  /** 演出/交互进行中（捕捉演出、撸宠、拖拽等）→ 本次跳过，重新排程 */
  isBusy: () => boolean;
  /** working/urgent 态 → 微动作池降级、间隔拉长 */
  isWorking: () => boolean;
  /** 微动作派发：由调用方挂类并限时回收 */
  trigger: (action: PetMicroAction) => void;
}) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  function scheduleNext() {
    if (!running) return;
    const working = options.isWorking();
    // idle 4~9s / working 7~13s（减半 ≈ 只剩眨眼的场合不值得频繁打扰）
    const wait = (working ? 7000 : 4000) + Math.random() * (working ? 6000 : 5000);
    timer = setTimeout(() => {
      if (!running) return;
      if (!options.isBusy()) {
        const action = working ? WORKING_POOL[0] : pickWeighted(IDLE_POOL);
        options.trigger(action);
      }
      scheduleNext();
    }, wait);
  }

  return {
    start() {
      if (running || motionReduced()) return;
      running = true;
      scheduleNext();
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
