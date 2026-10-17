/** DialogBox（UIUX §3.2）：初代双线框 + 右下 ▼ + 瞬态气泡（悬停暂停/点击收起/新事件 ▼ 闪 3 次） */
import { bubbleDuration } from "../state/bubbleTiming.ts";
import { refs } from "./refs.ts";

let bubbleTimer: ReturnType<typeof setTimeout> | null = null;
let bubbleRemaining = 0;
let bubbleDeadline = 0;

/** 瞬态气泡：时长自适应（3.5s + 120ms/字封顶 12s）、悬停暂停、点击收起、▼ 新事件闪 3 次 */
export function showDialog(text: string, opts: { tone?: "info" | "event" | "warn"; blink?: boolean } = {}): void {
  if (!text) return;
  const { dialog, dialogText, dialogNext } = refs;
  dialogText.textContent = text;
  dialog.dataset.tone = opts.tone ?? "info";
  dialog.classList.add("on");
  // ▼ 同屏唯一闪烁名额：仅新事件闪 3 次后转静态
  dialogNext.classList.remove("blink");
  if (opts.blink) {
    void dialogNext.offsetWidth; // 重启动画
    dialogNext.classList.add("blink");
  }
  armBubble(bubbleDuration(text));
}

function armBubble(ms: number): void {
  disarmBubble();
  bubbleRemaining = ms;
  bubbleDeadline = Date.now() + ms;
  bubbleTimer = setTimeout(() => hideDialog(), ms);
}

function disarmBubble(): void {
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = null;
}

function hideDialog(): void {
  disarmBubble();
  refs.dialog.classList.remove("on");
}

/** 收起气泡公共出口（ChatBox 收起时清残留等复用） */
export { hideDialog };

// 悬停暂停计时 / 移出恢复 / 点击立即收起（UIUX §3.4 气泡时序）
refs.dialog.addEventListener("mouseenter", () => {
  if (bubbleTimer) {
    bubbleRemaining = Math.max(0, bubbleDeadline - Date.now());
    disarmBubble();
  }
});
refs.dialog.addEventListener("mouseleave", () => {
  if (refs.dialog.classList.contains("on") && !bubbleTimer && bubbleRemaining > 0) {
    armBubble(bubbleRemaining);
  }
});
refs.dialog.addEventListener("click", () => hideDialog());
