import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { usePetBubble } from "../composables/usePetBubble";
import { BUBBLE_MS_PER_CHAR, BUBBLE_MIN_MS } from "../bubbleTiming";

/** 「短」= 1 字：3.5s + 120ms；对齐 bubbleTiming 的自适应时长 */
const ONE_CHAR_MS = BUBBLE_MIN_MS + 1 * BUBBLE_MS_PER_CHAR;

function makeBubble(over: { chat?: boolean; quick?: boolean } = {}) {
  const state = { chat: false, quick: false, ...over };
  const onDismiss = vi.fn();
  const ctl = usePetBubble({
    isChatOpen: () => state.chat,
    isQuickOpen: () => state.quick,
    onDismiss,
  });
  return { ctl, state, onDismiss };
}

describe("usePetBubble 瞬态台词气泡", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllTimers(); // 清掉上一用例遗留的假定时器，计数断言只看本用例
    document.documentElement.classList.remove("reduce-motion");
    // rAF 同步结算，闪三下（bubbleNew）的断言不依赖帧调度
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("say 后按字符数倒计时，到点渐隐 220ms 再摘除", () => {
    const { ctl } = makeBubble();
    ctl.say("短");
    expect(ctl.bubble.value).toBe("短");
    expect(ctl.bubbleVisible.value).toBe(true);
    vi.advanceTimersByTime(ONE_CHAR_MS - 1);
    expect(ctl.bubbleVisible.value).toBe(true);
    expect(ctl.bubbleFading.value).toBe(false);
    vi.advanceTimersByTime(1); // 到点 → 渐隐态
    expect(ctl.bubbleFading.value).toBe(true);
    expect(ctl.bubbleVisible.value).toBe(true);
    vi.advanceTimersByTime(220); // 透明度过渡结束摘除节点
    expect(ctl.bubbleVisible.value).toBe(false);
    expect(ctl.bubbleFading.value).toBe(false);
  });

  it("悬停暂停倒计时，移开续走剩余时间", () => {
    const { ctl } = makeBubble();
    ctl.say("短");
    vi.advanceTimersByTime(1000);
    ctl.pauseBubbleCountdown();
    vi.advanceTimersByTime(60_000); // 悬停期间不走
    expect(ctl.bubbleVisible.value).toBe(true);
    ctl.resumeBubbleCountdown();
    vi.advanceTimersByTime(ONE_CHAR_MS - 1000 - 1); // 剩余时间
    expect(ctl.bubbleVisible.value).toBe(true);
    vi.advanceTimersByTime(1);
    expect(ctl.bubbleFading.value).toBe(true);
  });

  it("钉住态（提醒）与快捷屏展开期间不自动消失", () => {
    const pinned = makeBubble();
    pinned.ctl.showBubble("提醒", { pinned: true, isNew: true });
    vi.advanceTimersByTime(60_000);
    expect(pinned.ctl.bubbleVisible.value).toBe(true);
    expect(pinned.ctl.bubblePinned.value).toBe(true);

    const quick = makeBubble({ quick: true });
    quick.ctl.say("引导");
    vi.advanceTimersByTime(60_000);
    expect(quick.ctl.bubbleVisible.value).toBe(true);
  });

  it("点击收起：消化钉住态、回调 onDismiss 后渐隐", () => {
    const { ctl, onDismiss } = makeBubble();
    ctl.showBubble("提醒", { pinned: true });
    ctl.dismissBubble();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(ctl.bubblePinned.value).toBe(false);
    vi.advanceTimersByTime(220);
    expect(ctl.bubbleVisible.value).toBe(false);
  });

  it("对话态让位：不渐隐、不收起（onDismiss 不触发）", () => {
    const { ctl, state, onDismiss } = makeBubble({ chat: true });
    ctl.say("短");
    vi.advanceTimersByTime(ONE_CHAR_MS + 220);
    expect(ctl.bubbleVisible.value).toBe(true); // 到点不淡出
    ctl.dismissBubble();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(ctl.bubbleVisible.value).toBe(true);
    expect(state.chat).toBe(true);
  });

  it("hideBubble 立即清场（含钉住态）", () => {
    const { ctl } = makeBubble();
    ctl.showBubble("提醒", { pinned: true });
    ctl.hideBubble();
    expect(ctl.bubbleVisible.value).toBe(false);
    expect(ctl.bubbleFading.value).toBe(false);
    expect(ctl.bubblePinned.value).toBe(false);
    vi.advanceTimersByTime(60_000); // 无残留定时器再翻状态
    expect(ctl.bubbleVisible.value).toBe(false);
  });

  it("isNew 闪三下：bubbleNew 经 rAF 置真（flashNew 供回答到达复用）", () => {
    const { ctl } = makeBubble();
    expect(ctl.bubbleNew.value).toBe(false);
    ctl.showBubble("新事", { isNew: true });
    expect(ctl.bubbleNew.value).toBe(true);
    ctl.bubbleNew.value = false;
    ctl.flashNew();
    expect(ctl.bubbleNew.value).toBe(true);
  });

  it("unmount 清理倒计时定时器，无泄漏", () => {
    let captured: ReturnType<typeof usePetBubble> | null = null;
    const Host = defineComponent({
      setup() {
        captured = usePetBubble({ isChatOpen: () => false, isQuickOpen: () => false, onDismiss: () => {} });
        return () => null;
      },
    });
    const w = mount(Host);
    const ctl = captured!;
    const base = vi.getTimerCount(); // mount 本身可能挂一个环境定时器，以差值断言
    ctl.say("短");
    expect(vi.getTimerCount()).toBe(base + 1);
    w.unmount();
    expect(vi.getTimerCount()).toBe(base); // onUnmounted 自清气泡倒计时
    vi.advanceTimersByTime(60_000);
    expect(ctl.bubbleVisible.value).toBe(true); // 定时器已清，不再淡出
  });
});
