/** DialogBox（UIUX §3.2）：初代双线框 + 右下 ▼ + 瞬态气泡（悬停暂停/点击收起/新事件 ▼ 闪 3 次）
 * + 提醒钉住模式（P1 D3：不倒计时、60s 兜底、就近动作条「完成 / 推迟 10 分钟」） */
import { bubbleDuration } from "../state/bubbleTiming.ts";
import { fill, lines } from "./lines.ts";
import { mirror } from "./mirror.ts";
import { refs } from "./refs.ts";

const bridge = window.petBridge;

let bubbleTimer: ReturnType<typeof setTimeout> | null = null;
let bubbleRemaining = 0;
let bubbleDeadline = 0;
let reminderTimer: ReturnType<typeof setTimeout> | null = null;
let reminderBar: HTMLDivElement | null = null;

/** 提醒兜底时长（钉住无人理睬 → 自动撤下不重复打扰，桌面同款 60s） */
const REMINDER_FALLBACK_MS = 60_000;

/** 瞬态气泡：时长自适应（3.5s + 120ms/字封顶 12s）、悬停暂停、点击收起、▼ 新事件闪 3 次 */
export function showDialog(text: string, opts: { tone?: "info" | "event" | "warn"; blink?: boolean } = {}): void {
  if (!text) return;
  dismissReminder(); // 瞬态事件顶掉钉住的提醒（同屏唯一气泡）
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

/** 提醒气泡（P1 D3）：钉住不倒计时 + 60s 兜底 + 就近动作条；新提醒替换旧提醒 */
export function showReminder(
  payload: { taskId: number | string; title: string; urgent: boolean },
  pokemonName: string,
): void {
  disarmBubble();
  dismissReminder();
  const set = lines(mirror.lang);
  const text = payload.urgent
    ? fill(set.remindUrgent, { p: pokemonName, t: payload.title })
    : fill(set.remindNormal, { p: pokemonName, t: payload.title });
  refs.dialogText.textContent = text;
  refs.dialog.dataset.tone = payload.urgent ? "warn" : "info";
  refs.dialog.classList.add("on", "pinned");
  buildReminderBar(payload);
  reminderTimer = setTimeout(() => dismissReminder(), REMINDER_FALLBACK_MS);
}

/** 动作条：✔ 完成（走 done 仪式路径）/ ⇨ 推迟 10 分钟（snooze 上行） */
function buildReminderBar(payload: { taskId: number | string; title: string }): void {
  const set = lines(mirror.lang);
  reminderBar = document.createElement("div");
  reminderBar.className = "reminder-actions hit";
  for (const [label, action] of [
    [set.reminderDo, () => void bridge.cmd("done", { taskId: payload.taskId })],
    [
      set.reminderSnooze,
      () => {
        void bridge.cmd("snooze", { taskId: payload.taskId, minutes: 10 });
        showDialog(set.reminderSnoozed);
      },
    ],
  ] as const) {
    const btn = document.createElement("button");
    btn.className = "reminder-btn";
    btn.textContent = label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      action();
      dismissReminder();
    });
    reminderBar.append(btn);
  }
  refs.dialogInner.append(reminderBar);
}

/** 撤下提醒（60s 兜底 / 动作执行 / 被瞬态事件顶替 / 点击收起共用出口） */
function dismissReminder(): void {
  if (reminderTimer) clearTimeout(reminderTimer);
  reminderTimer = null;
  reminderBar?.remove();
  reminderBar = null;
  refs.dialog.classList.remove("pinned");
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
  dismissReminder();
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
