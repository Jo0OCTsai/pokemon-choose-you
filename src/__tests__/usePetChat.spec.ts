import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { api } from "../api";
import { t } from "../i18n";
import { usePetChat } from "../composables/usePetChat";
import { useSettingsStore } from "../stores/settings";

vi.mock("../api", () => ({
  api: { petChat: vi.fn() },
}));

async function flush() {
  await vi.advanceTimersByTimeAsync(1); // 动态 import 走缓存后仍需跨任务结算
  // 再排几轮微任务确保链路走完
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

function makeChat(over: { busy?: boolean; quick?: boolean } = {}) {
  const state = { busy: false, quick: false, ...over };
  const petWindow = { setSize: vi.fn(async () => {}) };
  const calls = { hides: 0, flashes: 0, speaks: [] as string[] };
  const ctl = usePetChat({
    petWindow,
    isSceneBusy: () => state.busy,
    isQuickOpen: () => state.quick,
    hideBubble: () => calls.hides++,
    flashNew: () => calls.flashes++,
    speak: (s) => calls.speaks.push(s),
  });
  return { ctl, state, petWindow, calls };
}

describe("usePetChat AI 对话", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    await import("@tauri-apps/api/dpi"); // 预热动态导入，resizePetWindow 内的 import 走缓存
  });
  afterEach(() => vi.useRealTimers());

  it("openChat：首次问候、聚焦输入行、窗口调高到 300×480", async () => {
    const { ctl, petWindow } = makeChat();
    ctl.openChat();
    expect(ctl.chatOpen.value).toBe(true);
    await flush();
    expect(petWindow.setSize).toHaveBeenCalledWith(expect.objectContaining({ width: 300, height: 480 }));
    expect(ctl.chatLog.value).toEqual([{ role: "bot", text: t("pet.chatGreet") }]);
  });

  it("openChat 互斥：演出进行中不展开；再次 openChat 不重复问候", async () => {
    const { ctl, state } = makeChat({ busy: true });
    ctl.openChat();
    expect(ctl.chatOpen.value).toBe(false);
    state.busy = false;
    ctl.openChat();
    ctl.openChat(); // 已开 → 直接返回
    expect(ctl.chatLog.value).toHaveLength(1); // 问候只推一次
  });

  it("窗口高度分档：快捷屏 590 优先于对话 480；两者都收起回 330", async () => {
    const { ctl, state, petWindow, calls } = makeChat({ quick: true });
    ctl.openChat(); // 快捷屏展开期间开对话 → 590（快捷屏优先于对话态）
    await flush();
    expect(petWindow.setSize).toHaveBeenLastCalledWith(expect.objectContaining({ width: 300, height: 590 }));
    state.quick = false;
    ctl.closeChat();
    expect(ctl.chatOpen.value).toBe(false);
    await flush();
    expect(petWindow.setSize).toHaveBeenLastCalledWith(expect.objectContaining({ width: 300, height: 330 }));
    expect(calls.hides).toBe(1); // 收起时清残留气泡
  });

  it("sendChat 时序：思考中不再发第二条；回答到达闪 ▼ + 语音；空输入不发", async () => {
    const { ctl, calls } = makeChat();
    let resolveChat!: (v: string) => void;
    vi.mocked(api.petChat).mockImplementation(
      () =>
        new Promise((r) => {
          resolveChat = r;
        }),
    );
    ctl.openChat();
    await flush();

    ctl.chatInput.value = "  "; // 空白输入 → 不发
    await ctl.sendChat();
    expect(api.petChat).not.toHaveBeenCalled();

    ctl.chatInput.value = "在吗";
    void ctl.sendChat(); // 思考中的发送不 await（其 promise 挂在 petChat 上）
    expect(ctl.chatThinking.value).toBe(true);
    expect(ctl.chatInput.value).toBe(""); // 发出即清输入行
    expect(ctl.chatLog.value.at(-1)).toEqual({ role: "user", text: "在吗" });

    ctl.chatInput.value = "再来一条";
    await ctl.sendChat(); // 思考中 → 直接返回，不重复请求
    expect(api.petChat).toHaveBeenCalledTimes(1);

    resolveChat("好的！");
    await flush();
    expect(ctl.chatThinking.value).toBe(false);
    expect(ctl.chatLog.value.at(-1)).toEqual({ role: "bot", text: "好的！" });
    expect(calls.flashes).toBe(1); // 回答到达：▼ 闪三下
    expect(calls.speaks).toEqual(["好的！"]);
  });

  it("sendChat 失败：兜底文案入列、不闪不语音、thinking 复位", async () => {
    const { ctl, calls } = makeChat();
    vi.mocked(api.petChat).mockRejectedValue(new Error("boom"));
    ctl.chatInput.value = "会失败的问题";
    await ctl.sendChat();
    await flush();
    expect(ctl.chatLog.value.at(-1)).toEqual({ role: "bot", text: t("pet.chatFail") });
    expect(ctl.chatThinking.value).toBe(false);
    expect(calls.flashes).toBe(0);
    expect(calls.speaks).toEqual([]);
  });

  it("历史 ≤3 条：超出滚动淘汰最旧一条", async () => {
    const { ctl } = makeChat();
    vi.mocked(api.petChat).mockResolvedValueOnce("答1").mockResolvedValueOnce("答2");
    ctl.openChat(); // greet
    ctl.chatInput.value = "问1";
    await ctl.sendChat();
    await flush();
    ctl.chatInput.value = "问2";
    await ctl.sendChat();
    await flush();
    expect(ctl.chatLog.value).toHaveLength(3);
    expect(ctl.chatLog.value.map((m) => m.text)).toEqual(["答1", "问2", "答2"]);
  });

  it("agentConfigured：ai_agents 配置了才为真；对话域不持有定时器（无泄漏）", () => {
    const { ctl } = makeChat();
    expect(ctl.agentConfigured.value).toBe(false); // 默认 "[]"
    useSettingsStore().values.ai_agents = JSON.stringify([{ id: "a" }]);
    expect(ctl.agentConfigured.value).toBe(true);
    expect(vi.getTimerCount()).toBe(0); // 本域无自有定时器
  });
});
