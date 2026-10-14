/**
 * 收音机分段：HealthStrip（三档状态点 + 文字 + 立即拉取）/ AuthBanner（未授权/失效单次）/
 * SuggestionCard 内联展开（四动作 + 置信档文字 + 新标签「＋」/ 逃走 6 原因码）/ BatchBar
 * （选中 ≥1 浮现 + 批量分诊）/ FailedGroup / EscapedGroup 恢复 / CaptureBar 判定与撤销。
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { mockHost, type MockHost } from "../../src/client/rpc";
import { RadioSegment } from "../../src/client/radio/RadioSegment";
import { makeData, makeMessage } from "./fixtures";

afterEach(cleanup);

/** 刷完 mock 异步链（real timers；CaptureBar 用例内自管 fake timers） */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function renderRadio(
  messages = makeData().messages,
  health = makeData().health,
  auth = { authorized: true, expired: false },
  host: MockHost = mockHost(),
) {
  const data = makeData({ messages });
  data.health = health;
  data.auth = auth;
  const onChanged = vi.fn();
  render(
    <ClientProvider client={host}>
      <I18nProvider locale="zh-Hans">
        <RadioSegment data={data} readonly={false} onChanged={onChanged} />
      </I18nProvider>
    </ClientProvider>,
  );
  return { host, data, onChanged };
}

describe("HealthStrip", () => {
  it("ok 态：状态点 + 文字「正常」+ 上次成功/下次轮询/失败计数/立即拉取", async () => {
    const { host } = renderRadio();
    const strip = screen.getByTestId("health-strip");
    expect(strip.textContent).toContain("正常");
    expect(strip.textContent).toContain("上次成功 08:00");
    expect(strip.textContent).toContain("下次轮询 08:02");
    expect(strip.textContent).toContain("连续失败 0");
    fireEvent.click(screen.getByText("⚡ 立即拉取"));
    await flush();
    expect(host.calls.map((c) => c.command)).toContain("pollNow");
  });

  it("warn 态文字「重试中」、fail 态「未授权」（非颜色冗余，a11y 断言③）", () => {
    renderRadio([], { level: "warn", lastSuccessAt: null, nextPollAt: null, consecutiveFailures: 2, pendingCount: 1 });
    expect(screen.getByText("重试中")).toBeTruthy();
    cleanup();
    renderRadio([], { level: "fail", lastSuccessAt: null, nextPollAt: null, consecutiveFailures: 5, pendingCount: 3 });
    expect(screen.getByText("未授权")).toBeTruthy();
    expect(screen.getByText("连续失败 5")).toBeTruthy();
  });
});

describe("AuthBanner", () => {
  it("未授权：调频引导 + 授权登录（larkAuth 即时动作）", async () => {
    const { host } = renderRadio([], undefined, { authorized: false, expired: false });
    expect(screen.getByText(/收音机还没调频/)).toBeTruthy();
    fireEvent.click(screen.getByText("授权登录"));
    await flush();
    expect(host.calls.map((c) => c.command)).toContain("larkAuth");
  });

  it("失效：单次横幅可收起不刷屏；重新授权入口在", async () => {
    const { host } = renderRadio([], undefined, { authorized: true, expired: true });
    expect(screen.getByText(/飞书授权已失效，轮询已暂停/)).toBeTruthy();
    fireEvent.click(screen.getByText("重新授权"));
    await flush();
    expect(host.calls.map((c) => c.command)).toContain("larkAuth");
  });
});

describe("SuggestionCard", () => {
  it("内联展开：AI 建议盒（标题/理由/置信档文字）+ todo 动作 ◎ 捕捉", async () => {
    const { host } = renderRadio([makeMessage({ messageId: "m1", confidence: "medium" })]);
    expect(screen.getByText("中置信")).toBeTruthy();
    fireEvent.click(screen.getByText(/帮我看一下周报的数字/));
    expect(screen.getByTestId("ai-suggestion").textContent).toContain("核对周报数字");
    expect(screen.getByTestId("suggestion-card").getAttribute("data-confidence")).toBe("medium");
    fireEvent.click(screen.getByText("◎ 捕捉"));
    await flush();
    expect(host.calls).toContainEqual({ command: "reviewAccept", params: { messageId: "m1" } });
  });

  it("update 建议 → ◎ 应用更新；none 建议无分诊键但有 ⚡ 强制捕捉", async () => {
    const { host } = renderRadio([
      makeMessage({ messageId: "m2", aiStatus: "update", updateTaskId: 9, content: "周报改成周五发" }),
      makeMessage({ messageId: "m3", aiStatus: "none", suggestedTitle: null, content: "中午吃什么" }),
    ]);
    const updateCard = screen.getAllByTestId("suggestion-card")[0];
    fireEvent.click(within(updateCard).getByRole("button", { name: /周报改成周五发/ }));
    fireEvent.click(within(updateCard).getByText("◎ 应用更新"));
    await flush();
    expect(host.calls).toContainEqual({ command: "reviewApplyUpdate", params: { messageId: "m2" } });
    // 无动作建议进无信号组（建议卡呈现，U2 原型 a-none 卡）——展开后无捕捉/逃走键，
    // 仅桌面 F 键语义的 ⚡ 强制捕捉（AI 判无信号时人工拍板）
    expect(screen.getByText("中午吃什么")).toBeTruthy();
    const noneCard = screen.getAllByTestId("suggestion-card")[1];
    fireEvent.click(within(noneCard).getByRole("button", { name: /中午吃什么/ }));
    expect(within(noneCard).queryByText("◎ 捕捉")).toBeNull();
    expect(within(noneCard).queryByText("◎ 应用更新")).toBeNull();
    expect(within(noneCard).queryByText("✕ 逃走")).toBeNull();
    fireEvent.click(within(noneCard).getByText("⚡ 强制捕捉"));
    await flush();
    expect(host.calls).toContainEqual({ command: "forceCapture", params: { messageId: "m3" } });
  });

  it("逃走展开 6 原因码菜单 → reviewDismiss(reasonCode)", async () => {
    const { host } = renderRadio([makeMessage({ messageId: "m4" })]);
    fireEvent.click(screen.getByText(/帮我看一下周报的数字/));
    fireEvent.click(screen.getByText("✕ 逃走"));
    fireEvent.click(screen.getByText("已有类似待办"));
    await flush();
    expect(host.calls).toContainEqual({
      command: "reviewDismiss",
      params: { messageId: "m4", reasonCode: "duplicate" },
    });
  });

  it("新标签提议「＋」接受态（aria-pressed，接受建议时创建）", () => {
    const message = makeMessage({
      messageId: "m5",
      suggestedTags: [{ name: "周报", dimension: "topic", isNew: true }],
    });
    renderRadio([message]);
    fireEvent.click(screen.getByText(/帮我看一下周报的数字/));
    const accept = screen.getByTitle("＋ 接受新标签提议");
    expect(accept.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(accept);
    expect(accept.getAttribute("aria-pressed")).toBe("true");
  });

  it("幂等冲突 → 中性提示文案「已在另一处处置」（不弹窗）", async () => {
    // 另一形态先落库：host 侧 reviewStatus 已非 pending，CAS affected=0
    const host = mockHost({ messages: [makeMessage({ messageId: "m1", reviewStatus: "accepted" })] });
    renderRadio([makeMessage({ messageId: "m1" })], undefined, undefined, host);
    fireEvent.click(screen.getByText(/帮我看一下周报的数字/));
    fireEvent.click(screen.getByText("◎ 捕捉"));
    await flush();
    expect(host.calls.map((c) => c.command)).toContain("reviewAccept");
    expect(screen.getByText("这条建议已在另一处处置过了")).toBeTruthy();
    expect(screen.queryByTestId("modal-overlay")).toBeNull();
  });
});

describe("BatchBar（U13）", () => {
  const messages = [makeMessage({ messageId: "b1" }), makeMessage({ messageId: "b2" })];

  it("随待处理组常驻（桌面批量条 parity）：全选/清除联动「已选 N 条」", () => {
    renderRadio(messages);
    // 未选中时常驻可见（桌面批量条常驻），清除钮不出现
    expect(screen.getByTestId("batch-bar").textContent).toContain("已选 0 条");
    expect(screen.queryByText("清除")).toBeNull();
    const checks = screen.getAllByRole("checkbox");
    fireEvent.click(checks[0]);
    expect(screen.getByTestId("batch-bar").textContent).toContain("已选 1 条");
    fireEvent.click(checks[1]);
    expect(screen.getByTestId("batch-bar").textContent).toContain("已选 2 条");
    fireEvent.click(screen.getByText("清除"));
    expect(screen.getByTestId("batch-bar").textContent).toContain("已选 0 条");
  });

  it("批量捕捉 → reviewBatch(op=accept)；批量逃走统一原因码", async () => {
    const { host } = renderRadio(messages);
    const checks = screen.getAllByRole("checkbox");
    fireEvent.click(checks[0]);
    fireEvent.click(checks[1]);
    fireEvent.click(screen.getByText("◎ 全部捕捉"));
    await flush();
    expect(host.calls).toContainEqual({
      command: "reviewBatch",
      params: { messageIds: ["b1", "b2"], op: "accept", reasonCode: undefined },
    });
    fireEvent.click(checks[0]);
    fireEvent.click(screen.getByText("✕ 全部逃走（统一原因码）"));
    fireEvent.click(screen.getByText("已过期"));
    await flush();
    expect(host.calls).toContainEqual({
      command: "reviewBatch",
      params: { messageIds: ["b1"], op: "dismiss", reasonCode: "outdated" },
    });
  });
});

describe("失败组与逃走组", () => {
  it("AI 判定失败 · N 条 + 一键重判（retryJudge all）+ 强制捕捉/逃走", async () => {
    const { host } = renderRadio([
      makeMessage({ messageId: "f1", aiStatus: "error" }),
      makeMessage({ messageId: "f2", aiStatus: "error" }),
    ]);
    expect(screen.getByTestId("failed-group").textContent).toContain("AI 判定失败 · 2 条");
    fireEvent.click(screen.getByText("一键重判"));
    await flush();
    expect(host.calls).toContainEqual({ command: "retryJudge", params: { messageIds: "all" } });
    fireEvent.click(screen.getByText("强制逃走"));
    await flush();
    expect(host.calls.map((c) => c.command)).toContain("forceDismiss");
  });

  it("逃走留档组默认折叠，展开可 ↩恢复（reviewRestore）", async () => {
    const { host } = renderRadio([makeMessage({ messageId: "e1", reviewStatus: "dismissed", dismissReason: "noise" })]);
    fireEvent.click(screen.getByRole("button", { name: /已逃走 · 1/ }));
    expect(screen.getByText("闲聊/噪音")).toBeTruthy();
    fireEvent.click(screen.getByText("↩ 恢复"));
    await flush();
    expect(host.calls).toContainEqual({ command: "reviewRestore", params: { messageId: "e1" } });
  });
});

describe("CaptureBar（⚡发报）", () => {
  it("提报 → 判定中 → 建卡 + 5 秒撤销 toast；判重命中附更新建议提示", async () => {
    vi.useFakeTimers();
    const { host } = renderRadio();
    const input = screen.getByLabelText(/用一句话记录待办/);
    fireEvent.change(input, { target: { value: "订周五的会议室" } });
    fireEvent.click(screen.getByText("⚡ 发报"));
    // 先刷异步链（toast 挂载、5s 计时开始），再断言；不可 runAllTimers（会把撤销窗一并烧掉）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(host.calls.map((c) => c.command)).toContain("captureTodo");
    const toast = screen.getByTestId("undo-toast");
    expect(toast.getAttribute("role")).toBe("status");
    expect(toast.textContent).toContain("已捕捉「订周五的会议室」");
    fireEvent.click(screen.getByText(/撤销 5s/));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(host.calls.map((c) => c.command)).toContain("taskDelete");
    vi.useRealTimers();
  });
});
