/**
 * 收音机分段（桌面 RadioTab 双栏同构）：HealthStrip（三档状态点 + 文字 + 立即拉取）/
 * AuthBanner（未授权/失效单次）/ 电波行选中 → 右栏 MessageDetail（四动作 + 置信色点 +
 * 新标签「＋」/ 逃走 ▾ 6 原因码）/ BatchBar（常驻 + 批量分诊）/ FailedGroup /
 * EscapedGroup 恢复 / CaptureBar 判定与撤销。
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

/** 按 messageId 选中电波行（行点击 = 选中，详情在右栏） */
function selectRow(messageId: string): void {
  fireEvent.click(document.querySelector(`[data-testid="radio-row"][data-message-id="${messageId}"]`)!);
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

describe("MessageDetail（右栏选中详情）", () => {
  it("行选中：AI 建议盒（标题/理由）+ 置信色点文字档 + todo 动作 ◎ 捕捉", async () => {
    const { host } = renderRadio([makeMessage({ messageId: "m1", confidence: "medium" })]);
    selectRow("m1");
    const detail = screen.getByTestId("message-detail");
    expect(detail.getAttribute("data-message-id")).toBe("m1");
    expect(screen.getByTestId("ai-suggestion").textContent).toContain("核对周报数字");
    // 置信三档：色点形色 + title 文字档位（非颜色冗余，a11y 断言③）
    expect(document.querySelector('[data-conf="medium"]')?.getAttribute("title")).toBe("中置信");
    fireEvent.click(screen.getByText("◎ 捕捉"));
    await flush();
    expect(host.calls).toContainEqual({ command: "reviewAccept", params: { messageId: "m1" } });
  });

  it("update 建议 → ◎ 应用更新；none 建议无分诊键但有 ⚡ 强制捕捉", async () => {
    const { host } = renderRadio([
      makeMessage({ messageId: "m2", aiStatus: "update", updateTaskId: 9, content: "周报改成周五发" }),
      makeMessage({ messageId: "m3", aiStatus: "none", suggestedTitle: null, content: "中午吃什么" }),
    ]);
    selectRow("m2");
    fireEvent.click(screen.getByText("◎ 应用更新"));
    await flush();
    expect(host.calls).toContainEqual({ command: "reviewApplyUpdate", params: { messageId: "m2" } });
    // 无动作建议进无信号组——无捕捉/应用更新/逃走键，仅桌面 F 键语义的 ⚡ 强制捕捉
    selectRow("m3");
    const detail = screen.getByTestId("message-detail");
    expect(detail.textContent).toContain("中午吃什么");
    expect(within(detail).queryByText("◎ 捕捉")).toBeNull();
    expect(within(detail).queryByText("◎ 应用更新")).toBeNull();
    expect(within(detail).queryByText("✕ 逃走")).toBeNull();
    fireEvent.click(within(detail).getByText(/⚡ 强制捕捉/));
    await flush();
    expect(host.calls).toContainEqual({ command: "forceCapture", params: { messageId: "m3" } });
  });

  it("✕ 逃走一步直发（reasonCode=other）；▾ 展开 6 原因码菜单 → reviewDismiss(reasonCode)", async () => {
    const { host } = renderRadio([makeMessage({ messageId: "m4" })]);
    selectRow("m4");
    fireEvent.click(screen.getByText("✕ 逃走"));
    await flush();
    expect(host.calls).toContainEqual({
      command: "reviewDismiss",
      params: { messageId: "m4", reasonCode: "other" },
    });
    cleanup();
    const host2 = mockHost();
    render(
      <ClientProvider client={host2}>
        <I18nProvider locale="zh-Hans">
          <RadioSegment
            data={makeData({ messages: [makeMessage({ messageId: "m4b" })] })}
            readonly={false}
            onChanged={() => undefined}
          />
        </I18nProvider>
      </ClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "为什么逃走？（帮 AI 越判越准）" }));
    fireEvent.click(screen.getByText("已有类似待办"));
    await flush();
    expect(host2.calls).toContainEqual({
      command: "reviewDismiss",
      params: { messageId: "m4b", reasonCode: "duplicate" },
    });
  });

  it("新标签提议「＋」接受态（aria-pressed，接受建议时创建）", () => {
    const message = makeMessage({
      messageId: "m5",
      suggestedTags: [{ name: "周报", dimension: "topic", isNew: true }],
    });
    renderRadio([message]);
    selectRow("m5");
    const accept = screen.getByTitle("＋ 接受新标签提议");
    expect(accept.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(accept);
    expect(accept.getAttribute("aria-pressed")).toBe("true");
  });

  it("幂等冲突 → 中性提示文案「已在另一处处置」（不弹窗）", async () => {
    // 另一形态先落库：host 侧 reviewStatus 已非 pending，CAS affected=0
    const host = mockHost({ messages: [makeMessage({ messageId: "m1", reviewStatus: "accepted" })] });
    renderRadio([makeMessage({ messageId: "m1" })], undefined, undefined, host);
    selectRow("m1");
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
  it("⚠ AI 判定失败 + 独立计数徽标（其他状态组同构）+ 一键重判（retryJudge all）+ 强制捕捉/逃走", async () => {
    const { host } = renderRadio([
      makeMessage({ messageId: "f1", aiStatus: "error" }),
      makeMessage({ messageId: "f2", aiStatus: "error" }),
    ]);
    const group = screen.getByTestId("failed-group");
    // 组头 = 桌面 im.groupFailed 标题 + 计数徽标（非热点态，桌面 failed 组不传 count-hot）；不再把「· N 条」拼进标题
    expect(within(group).getByText("⚠ AI 判定失败")).toBeTruthy();
    expect(within(group).getByText("2").getAttribute("data-hot")).toBeNull();
    expect(group.textContent).not.toContain("· 2 条");
    fireEvent.click(screen.getByText("一键重判"));
    await flush();
    expect(host.calls).toContainEqual({ command: "retryJudge", params: { messageIds: "all" } });
    fireEvent.click(screen.getByText("强制逃走"));
    await flush();
    expect(host.calls.map((c) => c.command)).toContain("forceDismiss");
  });

  it("逃走留档组默认折叠，展开选中行 → 右栏 ↩恢复（reviewRestore）", async () => {
    const { host } = renderRadio([makeMessage({ messageId: "e1", reviewStatus: "dismissed", dismissReason: "noise" })]);
    // 组头折叠钮（FeedGroup：caret + 标题 + 计数 + 状态字）；默认折叠，点一次展开
    fireEvent.click(screen.getByRole("button", { name: /已逃走/ }));
    selectRow("e1");
    // 详情条：AI 原判 + 逃走原因（桌面 dim-banner 同构）
    expect(screen.getByTestId("message-detail").textContent).toContain("闲聊/噪音");
    fireEvent.click(screen.getByText("↩ 恢复"));
    await flush();
    expect(host.calls).toContainEqual({ command: "reviewRestore", params: { messageId: "e1" } });
  });
});

describe("CaptureBar（⚡发报）", () => {
  it("快捷键提示收敛为输入框内 ⌨ 图标：data-tip 气泡承载原 kbdHint 文案，通栏提示行已移除", () => {
    renderRadio();
    const glyph = screen.getByRole("img", { name: /快捷键：J\/K/ });
    expect(glyph.getAttribute("data-tip")).toContain("Esc 收起");
    expect(screen.queryByText(/^快捷键：J\/K/)).toBeNull();
  });

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
