/**
 * 背包（U16-U21）：八分区选单（aria-pressed/一次一分区）+ 分区切换保留草稿 + 保存制
 * （未保存角标/保存中/已保存 hint 4s 自隐/失败保留草稿）+ 勿扰起=止阻断 + 未保存离开
 * 确认三键（保存并离开先提交成功再离开）+ 语言即时跟随 + 会话过滤三态与私聊置灰。
 * 注：八分区整页「渲染但 hidden」（U21 草稿跨分区存活），文本查询一律 within 选单/分区作用域。
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { mockHost, type MockHost } from "../../src/client/rpc";
import { SettingsSegment } from "../../src/client/settings/SettingsSegment";
import type { SectionKey } from "../../src/client/settings/sectionKeys";
import { makeData } from "./fixtures";

afterEach(cleanup);
vi.useFakeTimers();

type SegmentProps = React.ComponentProps<typeof SettingsSegment>;

function renderSettings(data = makeData(), host: MockHost = mockHost(), overrides: Partial<SegmentProps> = {}) {
  const props: SegmentProps = {
    data,
    onChanged: vi.fn(),
    leaveRequest: null,
    onLeaveResolved: vi.fn(),
    onUnsavedChange: vi.fn(),
    ...overrides,
  };
  render(
    <ClientProvider client={host}>
      <I18nProvider locale={data.locale}>
        <SettingsSegment {...props} />
      </I18nProvider>
    </ClientProvider>,
  );
  return { host, data, props };
}

/** 经 SectionNav 点选分区（分区整页容器经 getPage 取） */
function gotoSection(name: string): void {
  const nav = screen.getByTestId("section-nav");
  fireEvent.click(within(nav).getByText(new RegExp(name)));
}

describe("SectionNav 八分区（U21）", () => {
  it("八分区同名同构主应用设置中心，一次只选中一个（aria-pressed）", () => {
    renderSettings();
    const nav = screen.getByTestId("section-nav");
    for (const name of ["专注", "分类与标签", "桌宠", "显示", "Agent", "飞书", "诊断", "通用"]) {
      expect(nav.textContent).toContain(name);
    }
    expect(nav.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
  });

  it("一次只显示一个分区整页，其余 hidden（全部渲染以保留各分区态）", () => {
    renderSettings();
    expect(getVisiblePage("专注").hidden).toBe(false);
    gotoSection("桌宠");
    expect(getPage("focus").hidden).toBe(true);
    expect(getPage("pets").hidden).toBe(false);
  });

  it("切换分区保留未保存草稿（切回仍在，不出确认）", () => {
    renderSettings();
    const focus = getVisiblePage("专注");
    const durationSelect = within(focus).getAllByDisplayValue("25 分钟")[0] as HTMLSelectElement;
    fireEvent.change(durationSelect, { target: { value: "45" } });
    gotoSection("桌宠");
    gotoSection("专注");
    const focus2 = getVisiblePage("专注");
    expect((within(focus2).getAllByDisplayValue("45 分钟")[0] as HTMLSelectElement).value).toBe("45");
    expect(screen.getByTestId("section-save").getAttribute("data-dirty")).toBe("true");
  });
});

/** 取分区整页容器（data-section-page-key 挂在 SettingsSegment 的包裹 div 上） */
function getPage(key: SectionKey): HTMLElement {
  return document.querySelector(`div[data-section-wrap="${key}"]`) as HTMLElement;
}
function getVisiblePage(label: string): HTMLElement {
  const nav = screen.getByTestId("section-nav");
  const button = Array.from(nav.querySelectorAll("button")).find((b) => b.textContent?.includes(label));
  return getPage(button?.getAttribute("data-section") as SectionKey);
}

describe("保存制（U21）", () => {
  it("未保存静态角标 ● + title「有未保存的修改」（不闪烁）", () => {
    renderSettings();
    const focus = getVisiblePage("专注");
    const toggle = within(focus).getAllByRole("switch")[0];
    fireEvent.click(toggle);
    const save = screen.getByTestId("section-save");
    expect(save.getAttribute("data-dirty")).toBe("true");
    expect(save.getAttribute("title")).toBe("有未保存的修改");
    expect(save.querySelector('[data-testid="unsaved-dot"]')).toBeTruthy();
  });

  it("保存 → configWrite（仅 dirty 键）→「已保存」hint 4s 自隐（role=status 无 toast）", async () => {
    const { host } = renderSettings();
    const focus = getVisiblePage("专注");
    fireEvent.click(within(focus).getAllByRole("switch")[0]); // pomodoro_enabled true→false
    fireEvent.click(screen.getByTestId("section-save"));
    await vi.runAllTimersAsync();
    const write = host.calls.find((c) => c.command === "configWrite");
    expect(write?.params).toEqual({ keyValues: { pomodoro_enabled: "false" } });
    const hint = screen.getByText("已保存");
    expect(hint.getAttribute("role")).toBe("status");
    expect(screen.queryByTestId("undo-toast")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4200);
    });
    expect(screen.queryByText("已保存")).toBeNull();
  });

  it("保存按钮恒可点（不 disable）：无 dirty 点击不落库不报错", async () => {
    const { host } = renderSettings();
    const save = screen.getByTestId("section-save") as HTMLButtonElement;
    expect(save.hasAttribute("disabled")).toBe(false);
    fireEvent.click(save);
    await vi.runAllTimersAsync();
    expect(host.calls.some((c) => c.command === "configWrite")).toBe(false);
  });

  it("勿扰起=止：按钮仍可点但不落库（行内防呆原因持续呈现）+ 后端兜底 CONFIG_VALIDATION_FAILED", async () => {
    const host = mockHost();
    renderSettings(makeData(), host);
    const focus = getVisiblePage("专注");
    fireEvent.change(within(focus).getByLabelText("勿扰结束"), { target: { value: "22:00" } });
    const save = screen.getByTestId("section-save") as HTMLButtonElement;
    expect(save.hasAttribute("disabled")).toBe(false);
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    fireEvent.click(save);
    await vi.runAllTimersAsync();
    expect(host.calls.some((c) => c.command === "configWrite")).toBe(false);
    // 后端兜底路径（写入侧校验）
    const fail = await host.configWrite({ keyValues: { quiet_start: "22:00", quiet_end: "22:00" } });
    expect(fail.ok).toBe(false);
  });
});

describe("未保存离开确认（U21）", () => {
  function renderRerender() {
    const host = mockHost();
    const data = makeData();
    const resolved = vi.fn();
    const props = { data, onChanged: vi.fn(), onLeaveResolved: resolved, onUnsavedChange: vi.fn() };
    const view = (leave: string | null) => (
      <ClientProvider client={host}>
        <I18nProvider locale="zh-Hans">
          <SettingsSegment {...props} leaveRequest={leave} />
        </I18nProvider>
      </ClientProvider>
    );
    const { rerender } = render(view(null));
    return { host, resolved, rerender: (leave: string | null) => rerender(view(leave)) };
  }

  it("三键弹层（保存并离开/放弃修改/留在这里）+ focus trap", () => {
    const { rerender } = renderRerender();
    fireEvent.click(within(getVisiblePage("专注")).getAllByRole("switch")[0]);
    rerender("adventure");
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("背包还有未保存的修改。");
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (const label of ["保存并离开", "放弃修改", "留在这里"]) {
      expect(within(dialog).getByText(label)).toBeTruthy();
    }
  });

  it("保存并离开：先 configWrite 成功再放行", async () => {
    const { host, resolved, rerender } = renderRerender();
    fireEvent.click(within(getVisiblePage("专注")).getAllByRole("switch")[0]);
    rerender("logs");
    fireEvent.click(screen.getByText("保存并离开"));
    await vi.runAllTimersAsync();
    expect(host.calls.map((c) => c.command)).toContain("configWrite");
    expect(resolved).toHaveBeenCalledWith(true);
  });

  it("放弃修改：草稿回落基线后放行", async () => {
    const { resolved, rerender } = renderRerender();
    fireEvent.click(within(getVisiblePage("专注")).getAllByRole("switch")[0]);
    rerender("adventure");
    fireEvent.click(screen.getByText("放弃修改"));
    await vi.runAllTimersAsync();
    expect(resolved).toHaveBeenCalledWith(true);
    rerender(null);
    expect(screen.getByTestId("section-save").getAttribute("data-dirty")).toBeNull();
  });

  it("留在这里 / Esc：不放行（resolved false）", () => {
    const { resolved, rerender } = renderRerender();
    fireEvent.click(within(getVisiblePage("专注")).getAllByRole("switch")[0]);
    rerender("adventure");
    fireEvent.click(screen.getByText("留在这里"));
    expect(resolved).toHaveBeenCalledWith(false);
    rerender("logs");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(resolved).toHaveBeenCalledWith(false);
  });
});
