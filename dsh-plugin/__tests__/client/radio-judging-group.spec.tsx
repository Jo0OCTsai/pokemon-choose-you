/**
 * 判定中分组（judging/pending 独立成组，不混入待办信号——2026-10-23 裁决）：
 * 「◌ 判定中」组行可选中看详情（判定中 chip）但不可勾选分诊；无判定中消息时整组不渲染。
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
        <RadioSegment data={makeData({ messages })} readonly={false} onChanged={() => undefined} />
      </I18nProvider>
    </ClientProvider>,
  );
}

describe("判定中分组（judging/pending 不混入待办信号）", () => {
  it("judging 与 pending 落「◌ 判定中」组：行可选中不可勾选，待办信号组只余 todo/update", () => {
    renderRadio([
      makeMessage({ messageId: "s1", content: "信号本体" }),
      makeMessage({ messageId: "j1", aiStatus: "judging", suggestedTitle: null, content: "判定中消息" }),
      makeMessage({ messageId: "j2", aiStatus: "pending", suggestedTitle: null, content: "待判定消息" }),
    ]);
    const judging = screen.getByTestId("judging-group");
    expect(within(judging).getByText("◌ 判定中")).toBeTruthy();
    expect(within(judging).getAllByTestId("radio-row")).toHaveLength(2);
    // 不可分诊：判定中行无勾选框；待办信号组只含信号行（无空态）
    expect(within(judging).queryByRole("checkbox")).toBeNull();
    const signal = screen.getByTestId("pending-group");
    expect(within(signal).getAllByTestId("radio-row")).toHaveLength(1);
    expect(within(signal).queryByTestId("pending-empty")).toBeNull();
    // 无判定中消息时整组不渲染
    cleanup();
    renderRadio([makeMessage({ messageId: "only-sig" })]);
    expect(screen.queryByTestId("judging-group")).toBeNull();
  });

  it("判定中行可选中进右栏详情（判定中 chip，无分诊按钮）", () => {
    renderRadio([makeMessage({ messageId: "j1", aiStatus: "judging", suggestedTitle: null, content: "判定中消息" })]);
    fireEvent.click(document.querySelector(`[data-testid="radio-row"][data-message-id="j1"]`)!);
    const detail = screen.getByTestId("message-detail");
    expect(detail.getAttribute("data-message-id")).toBe("j1");
    expect(detail.textContent).toContain("判定中…");
    expect(within(detail).queryByText("◎ 捕捉")).toBeNull();
  });
});
