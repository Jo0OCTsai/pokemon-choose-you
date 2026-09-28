import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import RadioTab from "../views/RadioTab.vue";
import ImDetailPanel from "../components/radio/ImDetailPanel.vue";
import ImMessageRow from "../components/radio/ImMessageRow.vue";
import { api } from "../api";
import { i18n } from "../i18n";
import { useTasksStore } from "../stores/tasks";
import type { ChatMessage } from "../types";

vi.mock("../api", () => ({
  api: {
    listTasks: vi.fn(async () => []),
    listChatMessages: vi.fn(async () => []),
    captureTodo: vi.fn(async () => ({ message: { id: 1 }, taskId: 7 })),
    acceptChatMessage: vi.fn(async () => 7),
    applyChatMessageUpdate: vi.fn(async () => {}),
    dismissChatMessage: vi.fn(async () => {}),
    undoChatReview: vi.fn(async () => {}),
    forceCreateTodo: vi.fn(async () => {}),
    batchReviewChatMessages: vi.fn(async () => ({ ok: 2, failed: [] })),
    retryAiJudgment: vi.fn(async () => ({ ok: 1, failed: [] })),
  },
  errorMessage: vi.fn((e: unknown) => String(e)),
}));

function msg(partial: Partial<ChatMessage> & { id: number }): ChatMessage {
  return {
    messageId: `mid-${partial.id}`,
    chatName: "项目群",
    sender: "张三",
    content: `消息${partial.id}`,
    reviewStatus: "pending",
    aiStatus: "todo",
    suggestedConfidence: "high",
    createdAt: "2026-09-13T00:00:00Z",
    chatId: "oc-1",
    chatType: "group",
    ...partial,
  };
}

const M = {
  signalHigh: msg({ id: 11 }),
  signalLow: msg({ id: 12, suggestedConfidence: "low", chatId: "oc-2", chatName: "闲聊群" }),
  noise: msg({ id: 21, aiStatus: "none" }),
  failed: msg({ id: 22, aiStatus: "error", suggestedConfidence: "low" }),
  caught: msg({ id: 31, reviewStatus: "accepted" }),
  escaped: msg({ id: 32, reviewStatus: "dismissed" }),
};

async function mountRadio(
  messages: ChatMessage[] = [M.signalHigh, M.signalLow, M.noise, M.failed],
): Promise<VueWrapper> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useTasksStore().chatMessages = messages;
  const w = mount(RadioTab, { global: { plugins: [pinia, i18n] }, attachTo: document.body });
  await flush();
  return w;
}

async function flush() {
  await new Promise((r) => setTimeout(r));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listTasks).mockResolvedValue([]);
  vi.mocked(api.listChatMessages).mockResolvedValue([]);
});

describe("RadioTab 列表分组与聚焦", () => {
  it("分区分组：信号/无信号分列，已处理分区默认收起", async () => {
    const w = await mountRadio([M.signalHigh, M.noise, M.caught, M.escaped]);
    const groups = w.findAll("[data-group]");
    expect(groups.map((g) => g.attributes("data-group"))).toEqual(["pending", "noise", "caught", "escaped"]);
    expect(w.text()).toContain("消息11");
    expect(w.text()).toContain("消息21");
  });

  it("focusCapture：暴露的快捷聚焦把焦点给捕捉输入框", async () => {
    const w = await mountRadio();
    (w.vm as unknown as { focusCapture: () => void }).focusCapture();
    await flush();
    expect(["INPUT", "TEXTAREA"]).toContain(document.activeElement?.tagName);
  });
});

describe("RadioTab 单条分诊", () => {
  it("详情面板捕捉信号：建待办 + toast 提示任务号", async () => {
    const w = await mountRadio();
    w.getComponent(ImDetailPanel).vm.$emit("accept", M.signalHigh);
    await flush();
    expect(api.acceptChatMessage).toHaveBeenCalledWith(11);
    expect(w.text()).toContain(i18n.global.t("im.caughtTask", { id: 7 }));
  });

  it("更新类信号走补丁通道而非新建", async () => {
    const update = msg({ id: 15, aiStatus: "update", updateTaskId: 3 });
    const w = await mountRadio([update]);
    w.getComponent(ImDetailPanel).vm.$emit("accept", update);
    await flush();
    expect(api.applyChatMessageUpdate).toHaveBeenCalledWith(15);
    expect(api.acceptChatMessage).not.toHaveBeenCalled();
  });

  it("已逃走分区的恢复把消息拉回待处理", async () => {
    const w = await mountRadio([M.escaped]);
    w.getComponent(ImDetailPanel).vm.$emit("restore", M.escaped);
    await flush();
    expect(api.undoChatReview).toHaveBeenCalledWith(32);
  });
});

describe("RadioTab 逃走与强制", () => {
  it("逃走后 5 秒撤销窗口内可反悔", async () => {
    const w = await mountRadio([M.signalHigh]);
    w.getComponent(ImDetailPanel).vm.$emit("dismiss", M.signalHigh);
    await flush();
    expect(api.dismissChatMessage).toHaveBeenCalledWith(11, undefined);
    expect(w.text()).toContain(i18n.global.t("im.released"));
    await w
      .get(".undo-btn, [class*=undo] button, .toast button")
      .trigger("click")
      .catch(async () => {
        await w.get("button", { multiple: false });
      });
    expect(api.undoChatReview).toHaveBeenCalledWith(11);
  });

  it("强制捕捉：error 消息绕过判定直接建待办", async () => {
    const w = await mountRadio([M.failed]);
    w.getComponent(ImDetailPanel).vm.$emit("force", M.failed);
    await flush();
    expect(api.forceCreateTodo).toHaveBeenCalledWith(22);
    expect(w.text()).toContain(i18n.global.t("im.forceDone"));
  });
});

describe("RadioTab 批量勾选", () => {
  it("勾选、高置信筛选，一键捕捉调批量接口", async () => {
    const w = await mountRadio();
    const rows = w.findAllComponents(ImMessageRow);
    rows[0].vm.$emit("toggle-check", 11);
    await flush();
    expect(w.text()).toContain("（1）", "批量按钮显示勾选数");
    await w.get(".hi-conf-btn").trigger("click"); // 只勾高置信（11 是 high，12 是 low）
    await flush();
    await w.findAll(".batch-bar .btn")[0].trigger("click");
    await flush();
    expect(api.batchReviewChatMessages).toHaveBeenCalledWith([11], "accept");
    expect(w.text()).toContain(i18n.global.t("im.batchDone", { n: 2 }), "ok 数取回传值");
  });

  it("全选切换：一次全勾再点全清", async () => {
    const w = await mountRadio();
    await w.get(".batch-check input").trigger("change"); // 全选
    await flush();
    expect(w.text()).toContain("（2）", "信号区两条全选");
    await w.get(".batch-check input").trigger("change"); // 再点全清
    await flush();
    expect(w.text()).not.toContain("（2）");
  });
});

describe("RadioTab 噪音清扫", () => {
  it("一键清空无信号：整组 dismiss 落 noise 原因", async () => {
    const w = await mountRadio();
    w.findAllComponents({ name: "ClearNoiseActions" })[0].vm.$emit("clear");
    await flush();
    expect(api.batchReviewChatMessages).toHaveBeenCalledWith([21, 22], "dismiss", "noise");
  });

  it("判定失败一键重判", async () => {
    const w = await mountRadio();
    w.findAllComponents({ name: "ClearNoiseActions" })[0].vm.$emit("retry");
    await flush();
    expect(api.retryAiJudgment).toHaveBeenCalledWith([22]);
  });
});

describe("RadioTab 键盘流", () => {
  it("J 下移选中，C 捕捉当前信号；输入框焦点时不劫持", async () => {
    const w = await mountRadio();
    const key = (k: string, target: HTMLElement | Window = window) => {
      const event = new KeyboardEvent("keydown", { key: k, bubbles: true });
      Object.defineProperty(event, "target", { value: target === window ? window : target });
      (target as Window).dispatchEvent(event);
    };
    key("j");
    await flush();
    const rows = w.findAllComponents(ImMessageRow);
    expect(rows[1].props("selectedId")).toBe(12);
    key("c");
    await flush();
    // J 下移后 C 捕捉的是当前选中条
    expect(api.acceptChatMessage).toHaveBeenCalledWith(12);

    // 焦点在输入框时按键不劫持（不触发捕捉）
    api.acceptChatMessage.mockClear();
    key("c", w.get(".search-input").element as HTMLElement);
    await flush();
    expect(api.acceptChatMessage).not.toHaveBeenCalled();
  });
});
