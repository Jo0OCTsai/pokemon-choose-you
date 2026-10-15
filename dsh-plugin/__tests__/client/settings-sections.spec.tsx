/**
 * 背包八分区内容对齐主应用（U20）：桌宠/显示（预览+语言即时跟随）/飞书（会话过滤三态与
 * 私聊置灰）/Agent（判定执行方+终端偏好 badge+agent 卡删除）/诊断（两链路+日志+支持报告）/
 * 通用（badge+库状态+双形态说明）/分类与标签（维度 key 只读+放生级联确认）。
 * 保存制与离开确认见 settings.spec.tsx。
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { mockHost, type MockHost } from "../../src/client/rpc";
import { SettingsSegment } from "../../src/client/settings/SettingsSegment";
import type { SectionKey } from "../../src/client/settings/sectionKeys";
import { makeData } from "./fixtures";

afterEach(cleanup);
vi.useFakeTimers();

/** 渲染背包分段（与 settings.spec 同款夹具；本文件聚焦分区内容对齐） */
function renderSettings(
  data = makeData(),
  host: MockHost = mockHost(),
  overrides: Partial<React.ComponentProps<typeof SettingsSegment>> = {},
) {
  render(
    <ClientProvider client={host}>
      <I18nProvider locale={data.locale}>
        <SettingsSegment
          data={data}
          onChanged={vi.fn()}
          leaveRequest={null}
          onLeaveResolved={vi.fn()}
          onUnsavedChange={vi.fn()}
          {...overrides}
        />
      </I18nProvider>
    </ClientProvider>,
  );
  return { host };
}

/** 经 SectionNav 点选分区 */
function gotoSection(name: string): void {
  const nav = screen.getByTestId("section-nav");
  fireEvent.click(within(nav).getByText(new RegExp(name)));
}

/** 分区整页容器 */
function getPage(key: SectionKey): HTMLElement {
  return document.querySelector(`div[data-section-wrap="${key}"]`) as HTMLElement;
}

function getVisiblePage(label: string): HTMLElement {
  const nav = screen.getByTestId("section-nav");
  const button = Array.from(nav.querySelectorAll("button")).find((b) => b.textContent?.includes(label));
  return getPage(button?.getAttribute("data-section") as SectionKey);
}

describe("分区内容对齐主应用（U20）", () => {
  it("专注分区触达类键带「作用于主应用触达」badge", () => {
    renderSettings();
    const focus = getVisiblePage("专注");
    expect(within(focus).getAllByText("作用于主应用触达").length).toBeGreaterThanOrEqual(4);
  });

  it("桌宠分区：主宝可梦/台词/输入响应×2/语音/陪跑（作用于主应用桌宠 badge）", () => {
    renderSettings();
    gotoSection("桌宠");
    const page = getPage("pets");
    expect(within(page).getAllByText("作用于主应用桌宠").length).toBeGreaterThanOrEqual(4);
  });

  it("显示分区：时间制式带实时预览（24h ↔ 12h）", () => {
    renderSettings();
    gotoSection("显示");
    const page = getPage("display");
    expect(within(page).getByTestId("display-preview").textContent).toContain("2026-10-11 16:24");
    fireEvent.change(within(page).getByDisplayValue("24 小时制（18:00）"), { target: { value: "12h" } });
    expect(within(page).getByTestId("display-preview").textContent).toContain("4:24 PM");
  });

  it("语言即时跟随：onLocalePreview 上抛（U21/U8：即时切换、落库走保存）", () => {
    const onLocalePreview = vi.fn();
    renderSettings(makeData(), mockHost(), { onLocalePreview });
    gotoSection("显示");
    fireEvent.change(within(getPage("display")).getByDisplayValue("简体中文"), { target: { value: "en" } });
    expect(onLocalePreview).toHaveBeenCalledWith("en");
  });

  it("飞书分区：会话过滤三态行内切换；私聊固定跟随置灰只读", async () => {
    const data = makeData();
    data.filters = [
      { chatId: "g1", chatName: "产品群", chatType: "group", state: "follow", updatedAt: null },
      { chatId: "p1", chatName: "张三", chatType: "p2p", state: "follow", updatedAt: null },
    ];
    const { host } = renderSettings(data);
    gotoSection("飞书");
    const page = getPage("feishu");
    const groupRow = within(page).getByText("产品群").closest('[data-testid="filter-row"]') as HTMLElement;
    const pullBtn = Array.from(groupRow.querySelectorAll("button")).find(
      (b) => b.textContent === "拉取",
    ) as HTMLElement;
    fireEvent.click(pullBtn);
    await vi.runAllTimersAsync();
    expect(host.calls.map((c) => c.command)).toContain("filterUpsert");
    const dmRow = within(page).getByText("张三").closest('[data-testid="filter-row"]') as HTMLElement;
    expect(dmRow.textContent).toContain("私聊固定跟随，不参与过滤");
    expect(dmRow.querySelector("button[aria-pressed]")).toBeNull();
  });

  it("Agent 分区：判定执行方（分支 C 文案）+ 终端偏好 badge + agent 卡删除（修订检测面）", async () => {
    const data = makeData();
    data.agents = [
      {
        id: "a1",
        name: "Claude Code",
        command: "claude",
        args: "",
        historyArgs: "",
        workdir: "",
        timeoutSecs: 600,
        enabled: true,
      },
    ];
    const { host } = renderSettings(data);
    gotoSection("Agent");
    const page = getPage("agents");
    expect(within(page).getAllByText("Claude Code").length).toBeGreaterThan(0);
    expect(within(page).getByText(/当前：消费主应用结果/)).toBeTruthy();
    expect(within(page).getAllByText("作用于主应用交互派发").length).toBeGreaterThanOrEqual(1);
    fireEvent.click(within(page).getAllByText("删除")[0]);
    // 确认弹层的确认键与卡上删除同名——取弹层内最后一个
    fireEvent.click(screen.getAllByRole("button", { name: "删除" }).pop() as HTMLElement);
    await vi.runAllTimersAsync();
    expect(host.calls.map((c) => c.command)).toContain("agentDelete");
  });

  it("诊断分区：两链路面板（状态点+文字非颜色冗余）+ 日志查看器 + 支持报告", async () => {
    const host = mockHost();
    host.state.diagnostics = [
      {
        provider: "feishu",
        level: "ok",
        lastSuccessAt: "2026-10-11T08:00:00+08:00",
        nextPollAt: null,
        consecutiveFailures: 0,
        lastError: null,
        lastErrorAt: null,
        pendingCount: 2,
        primaryAgent: null,
      },
      {
        provider: "ai",
        level: "degraded",
        lastSuccessAt: null,
        nextPollAt: null,
        consecutiveFailures: 1,
        lastError: "timeout",
        lastErrorAt: null,
        pendingCount: 0,
        primaryAgent: "claude",
      },
    ];
    host.state.logEntries = [{ time: "2026-10-11 09:00:00", level: "warn", target: "radio", message: "退避重试" }];
    renderSettings(makeData(), host);
    gotoSection("诊断");
    const page = getPage("diag");
    await vi.runAllTimersAsync();
    expect(within(page).getByText(/飞书电波 · 正常/)).toBeTruthy();
    expect(within(page).getByText(/AI Agent · 降级重试中/)).toBeTruthy();
    expect(within(page).getByText(/待确认建议 2/)).toBeTruthy();
    expect(within(page).getByText("退避重试")).toBeTruthy();
    fireEvent.click(within(page).getByText("复制支持报告"));
    await vi.runAllTimersAsync();
    expect(host.calls.map((c) => c.command)).toContain("supportReport");
  });

  it("通用分区：复盘/备份/托盘 badge + 库状态查询 + 双形态说明", async () => {
    const { host } = renderSettings();
    gotoSection("通用");
    const page = getPage("general");
    expect(within(page).getAllByText("作用于主应用").length).toBeGreaterThanOrEqual(3);
    expect(within(page).getByTestId("dual-form-note").textContent).toContain("双形态小贴士");
    fireEvent.click(within(page).getByText("查询库状态"));
    await vi.runAllTimersAsync();
    expect(host.calls.map((c) => c.command)).toContain("dbStatus");
    expect(within(page).getByText(/库版本 v1/)).toBeTruthy();
  });

  it("分类与标签分区：分类卡（名称/描述可编辑）+ 维度 key 只读 + 放生分类级联确认", async () => {
    const data = makeData();
    data.dimensions = [
      { id: 1, key: "project", name: "项目", cardinality: "single", maxTags: 3, sort: 1, enabled: true },
    ];
    data.tags = [];
    const { host } = renderSettings(data);
    gotoSection("分类与标签");
    const page = getPage("taxonomy");
    expect(within(page).getByDisplayValue("工作")).toBeTruthy();
    // 维度 key 只读列（桌面 dim-key 同款：key 定宽呈现于行首，title 承载全文）
    expect(within(page).getByText("project")).toBeTruthy();
    fireEvent.click(within(page).getAllByText("放生")[0]);
    expect(screen.getByText(/将归入第一个分类/)).toBeTruthy();
    fireEvent.click(screen.getByText("确认放生"));
    await vi.runAllTimersAsync();
    expect(host.calls.map((c) => c.command)).toContain("categoryDelete");
  });
});
