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

/** 待处理组行级勾选框（按消息 id 定位：勾选框在行容器内，排除批量条内全选框） */
function checkboxOf(messageId: string): HTMLInputElement {
  const row = document.querySelector(`[data-testid="radio-row"][data-message-id="${messageId}"]`);
  const box = row?.querySelector('input[type="checkbox"]');
  if (!(box instanceof HTMLInputElement)) {
    throw new Error(`消息 ${messageId} 的行级勾选框未找到`);
  }
  return box;
}

/** 行选中（行点击 = 选中，详情在右栏） */
function selectRow(messageId: string): void {
  fireEvent.click(document.querySelector(`[data-testid="radio-row"][data-message-id="${messageId}"]`)!);
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
    const order = [...groups[0].querySelectorAll("[data-testid='radio-row']")].map((el) =>
      el.getAttribute("data-message-id"),
    );
    expect(order).toEqual(["c-sig", "c-noise", "c-done", "c-escaped"]);
    // 已处理行尾回执（✔ No.7）；原因/原委在选中后的右栏详情
    const doneRow = groups[0].querySelector("[data-message-id='c-done']");
    expect(doneRow?.textContent).toContain("✔ No.7");
    // 全部走电波行（选中制，无分诊按钮内联）
    expect(within(groups[0]).getAllByTestId("radio-row")).toHaveLength(4);

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

describe("分组折叠（桌面 ImListGroup parity：状态组与频道组都可折叠）", () => {
  it("待处理组默认展开；组头点击折叠即卸载行，再点恢复", () => {
    renderRadio([makeMessage({ messageId: "p1", content: "待办信号" })]);
    expect(screen.getByTestId("radio-row")).toBeTruthy();
    fireEvent.click(screen.getByText("◎ 待办信号"));
    expect(screen.queryByTestId("radio-row")).toBeNull();
    fireEvent.click(screen.getByText("◎ 待办信号"));
    expect(screen.getByTestId("radio-row")).toBeTruthy();
  });

  it("已捕捉/已逃走默认折叠（归档不占视野）；展开可见回执行", () => {
    renderRadio([makeMessage({ messageId: "d1", reviewStatus: "accepted", taskId: 3, content: "已存档信号" })]);
    expect(screen.queryByText(/已存档信号/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /已捕捉/ }));
    expect(screen.getByText(/已存档信号/)).toBeTruthy();
    expect(screen.getByTestId("caught-group").textContent).toContain("✔ No.3");
  });

  it("频道模式组头同样可折叠；折叠态组内消息卸载、组头计数保留", () => {
    renderRadio([makeMessage({ messageId: "ch1", chatName: "产品群", content: "频道信号" })]);
    fireEvent.click(screen.getByRole("button", { name: "📡 按频道" }));
    expect(within(screen.getByTestId("channel-group")).getByTestId("radio-row")).toBeTruthy();
    fireEvent.click(screen.getByText("📡 产品群"));
    const group = screen.getByTestId("channel-group");
    expect(group.querySelector("[data-testid='radio-row']")).toBeNull();
    expect(within(group).getByText("1 待处理")).toBeTruthy();
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
    const feed = screen.getByTestId("suggestion-feed");
    fireEvent.change(screen.getByTestId("radio-search"), { target: { value: "周报" } });
    expect(within(feed).getByText(/帮我看一下周报的数字/)).toBeTruthy();
    expect(within(feed).queryByText("中午吃什么")).toBeNull();
    fireEvent.change(screen.getByTestId("radio-search"), { target: { value: "" } });
    expect(within(screen.getByTestId("suggestion-feed")).getByText("中午吃什么")).toBeTruthy();
  });

  it("按会话名/发送者过滤；频道模式同样生效", () => {
    renderRadio(messages);
    const feed = screen.getByTestId("suggestion-feed");
    fireEvent.change(screen.getByTestId("radio-search"), { target: { value: "生活群" } });
    expect(within(feed).queryByText(/帮我看一下周报的数字/)).toBeNull();
    expect(within(feed).getByText("中午吃什么")).toBeTruthy();
    fireEvent.change(screen.getByTestId("radio-search"), { target: { value: "成员_1024" } });
    expect(within(feed).getByText(/帮我看一下周报的数字/)).toBeTruthy();
    expect(within(feed).queryByText("中午吃什么")).toBeNull();
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
  it("低置信 todo 选中后有 ⚡ 强制捕捉 → forceCapture；none 同有", async () => {
    const { host } = renderRadio([
      makeMessage({ messageId: "low1", confidence: "low", content: "低置信待办" }),
      makeMessage({ messageId: "no1", aiStatus: "none", suggestedTitle: null, content: "无信号消息" }),
    ]);
    selectRow("low1");
    fireEvent.click(screen.getByText(/⚡ 强制捕捉/));
    await flush();
    expect(host.calls).toContainEqual({ command: "forceCapture", params: { messageId: "low1" } });
    // 无信号消息同样支持强制捕捉（人工拍板）
    selectRow("no1");
    fireEvent.click(screen.getByText(/⚡ 强制捕捉/));
    await flush();
    expect(host.calls).toContainEqual({ command: "forceCapture", params: { messageId: "no1" } });
  });
});
