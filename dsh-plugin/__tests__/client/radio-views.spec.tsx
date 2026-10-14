/**
 * 收音机视图对齐面（桌面 RadioTab parity）：视图切换（⏱按状态/📡按频道——频道分组
 * 渲染与排序）/ 电波搜索（前端过滤消息/会话/发送者，跨分组生效、清空恢复）/
 * 批量条只选高置信 / 无信号组一键清空（reviewBatch dismiss noise）/ 低置信 todo
 * 强制捕捉（桌面 F 键语义的按钮面）。
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { mockHost, type MockHost } from "../../src/client/rpc";
import { RadioSegment } from "../../src/client/radio/RadioSegment";
import { makeData, makeMessage } from "./fixtures";

afterEach(cleanup);

/** 刷完 mock 异步链（real timers） */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function renderRadio(messages = makeData().messages): { host: MockHost; onChanged: ReturnType<typeof vi.fn> } {
  const host = mockHost();
  const data = makeData({ messages });
  const onChanged = vi.fn();
  render(
    <ClientProvider client={host}>
      <I18nProvider locale="zh-Hans">
        <RadioSegment data={data} readonly={false} onChanged={onChanged} />
      </I18nProvider>
    </ClientProvider>,
  );
  return { host, onChanged };
}

/** 待处理组卡级勾选框（按消息 id 定位：行容器 = 卡 div 外层两级，排除批量条内全选框） */
function checkboxOf(messageId: string): HTMLInputElement {
  const card = document.querySelector(`[data-message-id="${messageId}"]`);
  const row = card?.parentElement?.parentElement ?? card?.parentElement;
  const box = row?.querySelector('input[type="checkbox"]');
  if (!(box instanceof HTMLInputElement)) {
    throw new Error(`消息 ${messageId} 的卡级勾选框未找到`);
  }
  return box;
}

describe("视图切换（⏱ 按状态 / 📡 按频道）", () => {
  const messages = [
    makeMessage({
      messageId: "c-done",
      chatName: "产品群",
      reviewStatus: "accepted",
      taskId: 7,
      content: "已捕捉的旧信号",
    }),
    makeMessage({
      messageId: "c-noise",
      chatName: "产品群",
      aiStatus: "none",
      suggestedTitle: null,
      content: "中午吃什么",
    }),
    makeMessage({ messageId: "c-sig", chatName: "产品群", content: "新的周报信号" }),
    makeMessage({
      messageId: "c-escaped",
      chatName: "产品群",
      reviewStatus: "dismissed",
      dismissReason: "noise",
      content: "已逃走的闲聊",
    }),
    makeMessage({ messageId: "c-life", chatName: "生活群", content: "生活群信号" }),
    makeMessage({ messageId: "c-cap", chatName: "", reviewStatus: "accepted", taskId: 8, content: "本地快捕留档" }),
  ];

  it("默认按状态分组；频道组不渲染", () => {
    renderRadio(messages);
    expect(screen.getByText("◎ 待办信号")).toBeTruthy();
    expect(screen.queryByTestId("channel-feed")).toBeNull();
  });

  it("频道模式：按会话聚拢——组头 📡 名称 + 待处理数/总数，信号在前、已处理垫底", () => {
    renderRadio(messages);
    fireEvent.click(screen.getByRole("button", { name: "📡 按频道" }));

    const groups = screen.getAllByTestId("channel-group");
    // 会话组序 = 首次出现序：产品群、生活群、FEISHU（空会话名回落，桌面同构）
    expect(groups.map((g) => g.getAttribute("data-chat"))).toEqual(["产品群", "生活群", "FEISHU"]);
    // 组头：📡 会话名 + 「{n} 待处理」（组内有信号 → 热点态）+ 「{n} 条」总数
    expect(within(groups[0]).getByText("📡 产品群")).toBeTruthy();
    expect(within(groups[0]).getByText("1 待处理").getAttribute("data-hot")).toBe("true");
    expect(within(groups[0]).getByText("4 条")).toBeTruthy();
    expect(within(groups[1]).getByText("1 待处理").getAttribute("data-hot")).toBe("true");
    // 组内排序：待处理信号 → 其余待处理 → 已捕捉 → 已逃走（并入各自频道组尾）
    const order = [...groups[0].querySelectorAll("[data-message-id],[data-testid='channel-archived-row']")].map(
      (el) => el.getAttribute("data-message-id") ?? "archived",
    );
    expect(order).toEqual(["c-sig", "c-noise", "archived", "archived"]);
    const archived = within(groups[0]).getAllByTestId("channel-archived-row");
    expect(archived[0].textContent).toContain("已捕捉的旧信号");
    expect(archived[0].textContent).toContain("已捕捉为待办 No.7");
    expect(archived[1].textContent).toContain("已逃走的闲聊");
    expect(archived[1].textContent).toContain("闲聊/噪音");
    // 已处理走归档行（无分诊按钮），待处理走建议卡
    expect(within(groups[0]).getAllByTestId("suggestion-card")).toHaveLength(2);

    // 切回状态模式：频道组收起、五分组回来
    fireEvent.click(screen.getByRole("button", { name: "⏱ 按状态" }));
    expect(screen.queryByTestId("channel-feed")).toBeNull();
    expect(screen.getByText("◎ 待办信号")).toBeTruthy();
  });

  it("切换钮 aria-pressed 标记当前模式（非颜色冗余）", () => {
    renderRadio([makeMessage({ messageId: "v1" })]);
    const time = screen.getByRole("button", { name: "⏱ 按状态" });
    const channel = screen.getByRole("button", { name: "📡 按频道" });
    expect(time.getAttribute("aria-pressed")).toBe("true");
    expect(channel.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(channel);
    expect(time.getAttribute("aria-pressed")).toBe("false");
    expect(channel.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("电波搜索（前端过滤，跨全部分组生效）", () => {
  const messages = [
    makeMessage({ messageId: "s1", content: "帮我看一下周报的数字", chatName: "产品群", senderName: "成员_1024" }),
    makeMessage({
      messageId: "s2",
      aiStatus: "none",
      suggestedTitle: null,
      content: "中午吃什么",
      chatName: "生活群",
      senderName: "成员_2048",
    }),
  ];

  it("按消息内容过滤：命中入组、未命中隐藏；清空恢复", () => {
    renderRadio(messages);
    fireEvent.change(screen.getByTestId("radio-search"), { target: { value: "周报" } });
    expect(screen.getByText(/帮我看一下周报的数字/)).toBeTruthy();
    expect(screen.queryByText("中午吃什么")).toBeNull();
    fireEvent.change(screen.getByTestId("radio-search"), { target: { value: "" } });
    expect(screen.getByText("中午吃什么")).toBeTruthy();
  });

  it("按会话名/发送者过滤；频道模式同样生效", () => {
    renderRadio(messages);
    fireEvent.change(screen.getByTestId("radio-search"), { target: { value: "生活群" } });
    expect(screen.queryByText(/帮我看一下周报的数字/)).toBeNull();
    expect(screen.getByText("中午吃什么")).toBeTruthy();
    fireEvent.change(screen.getByTestId("radio-search"), { target: { value: "成员_1024" } });
    expect(screen.getByText(/帮我看一下周报的数字/)).toBeTruthy();
    expect(screen.queryByText("中午吃什么")).toBeNull();
    // 频道模式：过滤后只呈现命中的频道组
    fireEvent.change(screen.getByTestId("radio-search"), { target: { value: "生活群" } });
    fireEvent.click(screen.getByRole("button", { name: "📡 按频道" }));
    const groups = screen.getAllByTestId("channel-group");
    expect(groups).toHaveLength(1);
    expect(within(groups[0]).getByText("📡 生活群")).toBeTruthy();
  });
});

describe("批量条：全选待处理 / 只选高置信", () => {
  it("只选高置信：仅勾选 confidence=high 的待处理消息，批量捕捉只带高置信 id", async () => {
    const { host } = renderRadio([
      makeMessage({ messageId: "h1", confidence: "high", content: "高置信信号" }),
      makeMessage({ messageId: "lo1", confidence: "low", content: "低置信信号" }),
      makeMessage({ messageId: "me1", confidence: "medium", content: "中置信信号" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "只选高置信" }));
    expect(checkboxOf("h1").checked).toBe(true);
    expect(checkboxOf("lo1").checked).toBe(false);
    expect(checkboxOf("me1").checked).toBe(false);
    expect(screen.getByTestId("batch-bar").textContent).toContain("已选 1 条");
    fireEvent.click(screen.getByText("◎ 全部捕捉"));
    await flush();
    expect(host.calls).toContainEqual({
      command: "reviewBatch",
      params: { messageIds: ["h1"], op: "accept", reasonCode: undefined },
    });
  });

  it("全选待处理：一键勾满/清空（待处理组全体）", () => {
    renderRadio([
      makeMessage({ messageId: "a1", content: "信号一" }),
      makeMessage({ messageId: "a2", content: "信号二" }),
    ]);
    // 卡级勾选框与批量条共用「全选待处理」可访问名——按批量条域内取钮
    const selectAll = within(screen.getByTestId("batch-bar")).getByRole("checkbox");
    fireEvent.click(selectAll);
    expect(screen.getByTestId("batch-bar").textContent).toContain("已选 2 条");
    expect(checkboxOf("a1").checked).toBe(true);
    expect(checkboxOf("a2").checked).toBe(true);
    fireEvent.click(selectAll);
    expect(screen.getByTestId("batch-bar").textContent).toContain("已选 0 条");
    expect(checkboxOf("a1").checked).toBe(false);
  });
});

describe("无信号组一键清空", () => {
  it("✕ 一键清空 → reviewBatch(dismiss, noise) 整组批逃并刷新", async () => {
    const { host, onChanged } = renderRadio([
      makeMessage({ messageId: "n1", aiStatus: "none", suggestedTitle: null, content: "闲聊一" }),
      makeMessage({ messageId: "n2", aiStatus: "none", suggestedTitle: null, content: "闲聊二" }),
      makeMessage({ messageId: "t1", content: "待办信号" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "✕ 一键清空" }));
    await flush();
    expect(host.calls).toContainEqual({
      command: "reviewBatch",
      params: { messageIds: ["n1", "n2"], op: "dismiss", reasonCode: "noise" },
    });
    expect(onChanged).toHaveBeenCalled();
  });
});

describe("强制捕捉（桌面 F 键语义的按钮面）", () => {
  it("低置信 todo 建议展开有 ⚡ 强制捕捉 → forceCapture；高置信 todo / update 不加", async () => {
    const { host } = renderRadio([
      makeMessage({ messageId: "low1", confidence: "low", content: "低置信待办" }),
      makeMessage({ messageId: "high1", confidence: "high", content: "高置信待办" }),
      makeMessage({ messageId: "upd1", aiStatus: "update", updateTaskId: 9, content: "更新建议消息" }),
    ]);
    const cards = screen.getAllByTestId("suggestion-card");
    fireEvent.click(within(cards[0]).getByRole("button", { name: /低置信待办/ }));
    fireEvent.click(within(cards[0]).getByText("⚡ 强制捕捉"));
    await flush();
    expect(host.calls).toContainEqual({ command: "forceCapture", params: { messageId: "low1" } });
    fireEvent.click(within(cards[1]).getByRole("button", { name: /高置信待办/ }));
    expect(within(cards[1]).queryByText("⚡ 强制捕捉")).toBeNull();
    fireEvent.click(within(cards[2]).getByRole("button", { name: /更新建议消息/ }));
    expect(within(cards[2]).queryByText("⚡ 强制捕捉")).toBeNull();
  });
});
