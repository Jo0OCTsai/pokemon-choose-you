/**
 * 待办信号组空态（桌面 RadioTab .pending-empty parity）：0 条待办信号时分组不消失——
 * 组头仍渲染（计数 0），组内居中显示 im.signalAllDone「全部处理完」鼓励文案；折叠
 * 与搜索过滤后的落空同走该空态。
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { mockHost } from "../../src/client/rpc";
import { RadioSegment } from "../../src/client/radio/RadioSegment";
import { makeData, makeMessage } from "./fixtures";

afterEach(cleanup);

function renderRadio(messages = makeData().messages): void {
  render(
    <ClientProvider client={mockHost()}>
      <I18nProvider locale="zh-Hans">
        <RadioSegment data={makeData({ messages })} readonly={false} onChanged={vi.fn()} />
      </I18nProvider>
    </ClientProvider>,
  );
}

/** 只有无信号 + 已捕捉留档：待办信号恰为 0，但列表非空（顶层空态不接管） */
const onlyNoise = [
  makeMessage({ messageId: "e-noise", aiStatus: "none", suggestedTitle: null, content: "中午吃什么" }),
  makeMessage({ messageId: "e-done", reviewStatus: "accepted", taskId: 9, content: "已捕捉信号" }),
];

describe("待办信号组空态（桌面 .pending-empty parity）", () => {
  it("无待办信号时组头仍渲染、计数 0，组内显示「待办信号全部处理完」而非整组消失", () => {
    renderRadio(onlyNoise);
    const group = screen.getByTestId("pending-group");
    expect(within(group).getByText("◎ 待办信号")).toBeTruthy();
    expect(within(group).getByText("0")).toBeTruthy();
    expect(within(group).getByTestId("pending-empty").textContent).toBe("待办信号全部处理完，训练家效率惊人 ⚡");
    expect(within(group).queryByTestId("radio-row")).toBeNull();
  });

  it("有待办信号时不显示空态文案", () => {
    renderRadio([...onlyNoise, makeMessage({ messageId: "e-sig", content: "新信号" })]);
    expect(screen.queryByTestId("pending-empty")).toBeNull();
    expect(within(screen.getByTestId("pending-group")).getByTestId("radio-row")).toBeTruthy();
  });

  it("空态组同样可折叠：折叠即卸载空态文案，再点恢复", () => {
    renderRadio(onlyNoise);
    fireEvent.click(screen.getByText("◎ 待办信号"));
    expect(screen.queryByTestId("pending-empty")).toBeNull();
    fireEvent.click(screen.getByText("◎ 待办信号"));
    expect(screen.getByTestId("pending-empty")).toBeTruthy();
  });

  it("搜索过滤掉全部待办信号后同样落空态（桌面搜索结果同走分组逻辑）", () => {
    renderRadio([
      makeMessage({ messageId: "f-sig", content: "周报信号", chatName: "产品群" }),
      makeMessage({
        messageId: "f-noise",
        aiStatus: "none",
        suggestedTitle: null,
        content: "中午吃什么",
        chatName: "生活群",
      }),
    ]);
    expect(screen.queryByTestId("pending-empty")).toBeNull();
    fireEvent.change(screen.getByTestId("radio-search"), { target: { value: "生活群" } });
    expect(screen.getByTestId("pending-empty")).toBeTruthy();
    fireEvent.change(screen.getByTestId("radio-search"), { target: { value: "" } });
    expect(screen.queryByTestId("pending-empty")).toBeNull();
  });
});
