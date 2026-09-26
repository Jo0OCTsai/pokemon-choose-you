import { onUnmounted, ref } from "vue";
import { bubbleDuration } from "../bubbleTiming";
import { motionReduced } from "./usePetIdle";

/**
 * 瞬态台词气泡（VPet 范式）——从 PetApp 抽出的气泡状态机：
 * 说完自动淡出（时长随文本长度自适应，见 bubbleTiming.ts），悬停暂停、移开续走剩余时间、
 * 点击收起；状态不占常驻文字。钉住态（提醒）与快捷屏展开期间不自动消失。
 * 对话态（chatOpen）让位：不倒计时、不渐隐、不收起。
 */
export interface PetBubbleOpts {
  /** 对话态气泡让位（不倒计时 / 不渐隐 / 不收起） */
  isChatOpen: () => boolean;
  /** 快捷屏展开期间（引导台词）不自动消失 */
  isQuickOpen: () => boolean;
  /** 点击收起时顺带消化钉住的提醒（调用方清 reminderTask 与其兜底定时器） */
  onDismiss: () => void;
}

export function usePetBubble(opts: PetBubbleOpts) {
  const bubble = ref("");
  const bubbleVisible = ref(false);
  const bubbleFading = ref(false);
  /** 钉住态不参与自动倒计时（提醒气泡可操作，等用户处理或 60s 兜底） */
  const bubblePinned = ref(false);
  const bubbleNew = ref(false);

  let bubbleTimer: ReturnType<typeof setTimeout> | null = null;
  let bubbleRemainMs = 0;
  let bubbleDeadline = 0;
  const BUBBLE_FADE_MS = 220;

  function stopBubbleTimer() {
    if (bubbleTimer) {
      clearTimeout(bubbleTimer);
      bubbleTimer = null;
    }
  }
  function startBubbleCountdown() {
    stopBubbleTimer();
    // 钉住态（提醒）与快捷屏展开期间（引导台词）不自动消失
    if (bubblePinned.value || opts.isQuickOpen()) return;
    bubbleRemainMs = bubbleDuration(bubble.value);
    bubbleDeadline = Date.now() + bubbleRemainMs;
    bubbleTimer = setTimeout(fadeBubble, bubbleRemainMs);
  }
  /** 「有新事」时 ▼ 闪 3 次后回归静态（注意力红线：不永久占用闪烁名额） */
  function flashNew() {
    bubbleNew.value = false;
    requestAnimationFrame(() => {
      bubbleNew.value = true;
    });
  }
  function showBubble(text: string, show: { isNew?: boolean; pinned?: boolean } = {}) {
    bubble.value = text;
    bubblePinned.value = show.pinned ?? false;
    bubbleFading.value = false;
    bubbleVisible.value = true;
    if (show.isNew) flashNew();
    startBubbleCountdown();
  }
  function say(text: string, isNew = false) {
    showBubble(text, { isNew });
  }
  /** 到时渐隐：透明度过渡结束后再摘除节点 */
  function fadeBubble() {
    stopBubbleTimer();
    if (!bubbleVisible.value || opts.isChatOpen()) return;
    bubbleFading.value = true;
    bubbleTimer = setTimeout(
      () => {
        bubbleVisible.value = false;
        bubbleFading.value = false;
      },
      motionReduced() ? 0 : BUBBLE_FADE_MS,
    );
  }
  /** 点击收起（手动关）：顺带消化钉住的提醒 */
  function dismissBubble() {
    if (opts.isChatOpen()) return;
    opts.onDismiss();
    bubblePinned.value = false;
    fadeBubble();
  }
  /** 悬停暂停倒计时：想细读就停留，移开再续走剩余时间 */
  function pauseBubbleCountdown() {
    if (!bubbleVisible.value || bubblePinned.value || bubbleFading.value || !bubbleTimer) return;
    bubbleRemainMs = Math.max(0, bubbleDeadline - Date.now());
    stopBubbleTimer();
  }
  function resumeBubbleCountdown() {
    if (!bubbleVisible.value || bubblePinned.value || bubbleFading.value || bubbleTimer) return;
    bubbleDeadline = Date.now() + bubbleRemainMs;
    bubbleTimer = setTimeout(fadeBubble, bubbleRemainMs);
  }
  function hideBubble() {
    stopBubbleTimer();
    bubbleVisible.value = false;
    bubbleFading.value = false;
    bubblePinned.value = false;
  }

  onUnmounted(stopBubbleTimer);

  return {
    bubble,
    bubbleVisible,
    bubbleFading,
    bubblePinned,
    bubbleNew,
    showBubble,
    say,
    flashNew,
    dismissBubble,
    pauseBubbleCountdown,
    resumeBubbleCountdown,
    hideBubble,
  };
}
