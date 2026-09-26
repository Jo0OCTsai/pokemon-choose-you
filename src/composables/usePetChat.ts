import { computed, nextTick, ref, useTemplateRef } from "vue";
import type { Window } from "@tauri-apps/api/window";
import { api } from "../api";
import { t } from "../i18n";
import { useSettingsStore } from "../stores/settings";

export interface PetChatOpts {
  /** 桌宠窗口：展开对话 / 快捷屏时动态调高 */
  petWindow: Pick<Window, "setSize">;
  /** 捕捉演出进行中不展开对话 */
  isSceneBusy: () => boolean;
  /** 快捷屏优先于对话态（决定窗口高度） */
  isQuickOpen: () => boolean;
  /** 收起对话时顺带清掉残留气泡 */
  hideBubble: () => void;
  /** 回答到达：▼ 闪三下（占位回归规则） */
  flashNew: () => void;
  /** 语音播报回答（F5） */
  speak: (text: string) => void;
}

/**
 * AI 对话（F2）——从 PetApp 抽出的对话态状态机：
 * 右键菜单入口（配了 agent 才出现，agentConfigured），对话框原位展开 ≤4 行（历史 ≤3 条 + 输入行）；
 * 展开时把窗口调高（LogicalSize 300×{330/480/590}，透明窗口多余高度不可见）。
 */
export function usePetChat(opts: PetChatOpts) {
  const settings = useSettingsStore();
  const chatOpen = ref(false);
  const chatLog = ref<{ role: "user" | "bot"; text: string }[]>([]);
  const chatThinking = ref(false);
  const chatInput = ref("");
  /** 模板里 <input ref="chatInputRef">，打开对话后聚焦输入行 */
  const chatInputRef = useTemplateRef<HTMLInputElement>("chatInputRef");
  const agentConfigured = computed(() => {
    try {
      return (JSON.parse(settings.sget("ai_agents") || "[]") as unknown[]).length > 0;
    } catch {
      return false;
    }
  });

  function pushChat(role: "user" | "bot", text: string) {
    chatLog.value.push({ role, text });
    if (chatLog.value.length > 3) chatLog.value.shift();
  }

  async function resizePetWindow() {
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    const h = opts.isQuickOpen() ? 590 : chatOpen.value ? 480 : 330;
    await opts.petWindow.setSize(new LogicalSize(300, h));
  }

  function openChat() {
    if (opts.isSceneBusy() || chatOpen.value) return;
    chatOpen.value = true;
    void resizePetWindow();
    if (!chatLog.value.length) pushChat("bot", t("pet.chatGreet"));
    void nextTick(() => chatInputRef.value?.focus());
  }

  function closeChat() {
    chatOpen.value = false;
    void resizePetWindow();
    opts.hideBubble();
  }

  async function sendChat() {
    const q = chatInput.value.trim();
    if (!q || chatThinking.value) return;
    chatInput.value = "";
    pushChat("user", q);
    chatThinking.value = true;
    try {
      const answer = await api.petChat(q);
      pushChat("bot", answer);
      opts.flashNew(); // 回答到达：▼ 闪三下（占位回归规则）
      opts.speak(answer);
    } catch {
      pushChat("bot", t("pet.chatFail"));
    } finally {
      chatThinking.value = false;
    }
  }

  return {
    chatOpen,
    chatLog,
    chatThinking,
    chatInput,
    chatInputRef,
    agentConfigured,
    resizePetWindow,
    openChat,
    closeChat,
    sendChat,
  };
}
