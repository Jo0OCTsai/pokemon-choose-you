/**
 * 插件页面装配：七段 SegmentNav + 切换 + 收音机计数（静态 + ⚠ 变体 U14）+ pageOpen
 * 锚点（panel/settings）+ SchemaBanner 只读传播（禁用清单）+ 待处理计数 + 空态文案。
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginDetailPage } from "../../src/client/app/PluginDetailPage";
import { mockHost } from "../../src/client/rpc";
import { makeData, makeMessage, makeTask } from "./fixtures";

afterEach(cleanup);

function renderPage(data = makeData(), host = mockHost()) {
  const onChange = vi.fn();
  render(<PluginDetailPage client={host} data={data} onChanged={onChange} />);
  return { host, onChange };
}

describe("PluginDetailPage · 分段导航", () => {
  it("七段齐全（冒险/草丛/路线/图鉴/收音机/日志/背包）且可切换", () => {
    renderPage();
    const nav = screen.getByTestId("segment-nav");
    const labels = nav.textContent ?? "";
    for (const name of ["冒险", "草丛", "路线", "图鉴", "收音机", "日志", "背包"]) {
      expect(labels).toContain(name);
    }
    fireEvent.click(screen.getByText("草丛"));
    expect(screen.getByTestId("segment-grass")).toBeTruthy();
    fireEvent.click(screen.getByText("图鉴"));
    expect(screen.getByTestId("segment-dex")).toBeTruthy();
    fireEvent.click(screen.getByText("日志"));
    expect(screen.getByTestId("segment-logs")).toBeTruthy();
  });

  it("收音机待处理计数静态呈现（无 aria-live——被动信号不打断）", () => {
    const data = makeData({ messages: [makeMessage({ messageId: "m1" }), makeMessage({ messageId: "m2" })] });
    data.health = { ...data.health, pendingCount: 2 };
    renderPage(data);
    const count = screen.getByTestId("pending-count");
    expect(count.textContent).toContain("2");
    expect(count.getAttribute("aria-live")).toBeNull();
    const radioTab = screen.getByTestId("segment-nav").querySelector('[data-segment="radio"]');
    expect(radioTab?.textContent).toContain("2");
    expect(radioTab?.getAttribute("aria-live")).toBeNull();
  });

  it("连续失败 ≥3 时收音机段计数叠加静态 ⚠ 前缀（U14；不闪烁）", () => {
    const data = makeData();
    data.health = { ...data.health, pendingCount: 4, consecutiveFailures: 3 };
    renderPage(data);
    const radioTab = screen.getByTestId("segment-nav").querySelector('[data-segment="radio"]');
    expect(radioTab?.getAttribute("data-warn")).toBe("true");
    expect(radioTab?.textContent).toContain("⚠4");
  });

  it("pageOpen 推送锚定：section=settings 切到背包段", () => {
    const host = mockHost();
    renderPage(makeData(), host);
    act(() => {
      host.emitPageOpen({ section: "settings" });
    });
    expect(screen.getByTestId("segment-settings")).toBeTruthy();
    act(() => {
      host.emitPageOpen({ section: "panel" });
    });
    expect(screen.getByTestId("segment-adventure")).toBeTruthy();
  });

  it("初始分段可注入（锚点参数）", () => {
    const host = mockHost();
    render(<PluginDetailPage client={host} data={makeData()} initialSegment="settings" />);
    expect(screen.getByTestId("segment-settings")).toBeTruthy();
  });
});

describe("PluginDetailPage · 只读传播（DB_SCHEMA_TOO_NEW）", () => {
  it("mode=ro 时顶部持久横幅 + 任务卡操作与发报禁用", async () => {
    const data = makeData({ tasks: [makeTask({ id: 1, status: "scheduled", dueAt: "2026-10-11T18:00:00+08:00" })] });
    data.dbStatus = { userVersion: 9, pluginWindow: { min: 1, max: 2 }, mode: "ro" };
    const { host } = renderPage(data);
    expect(screen.getByTestId("schema-banner").textContent).toContain("待办库版本较新");
    expect(screen.getByText("只读模式")).toBeTruthy();
    // 任务卡快捷操作置灰（§4.2 禁用清单）
    const card = screen.getByText(/No\.1/).closest("[data-presentation]");
    const buttons = (card as HTMLElement)?.querySelectorAll("button");
    expect(buttons).toBeTruthy();
    for (const button of Array.from(buttons ?? [])) {
      expect(button.hasAttribute("disabled")).toBe(true);
    }
    // 收音机发报禁用
    fireEvent.click(screen.getByText("收音机"));
    const input = screen.getByLabelText("用一句话记录待办，AI 自动判定内容 / 分类 / 标签 / 截止时间…");
    expect(input.hasAttribute("disabled")).toBe(true);
    // 写命令不可达（mock 只读守卫同步兜底）
    const blocked = await host.taskStart({ taskId: 1 });
    expect(blocked.ok).toBe(false);
  });
});

describe("空态文案（§8）", () => {
  it("任务分段冷启动：草丛静悄悄（被动引导，无按钮）", () => {
    renderPage();
    expect(screen.getByText(/草丛静悄悄——在会话里说一句/)).toBeTruthy();
  });

  it("收音机无消息：电波安静", () => {
    renderPage();
    fireEvent.click(screen.getByText("收音机"));
    expect(screen.getByText(/电波安静。有新消息会以计数提醒/)).toBeTruthy();
  });

  it("日志空态：还没有派出过 agent", () => {
    renderPage();
    fireEvent.click(screen.getByText("日志"));
    expect(screen.getByText("还没有派出过 agent")).toBeTruthy();
  });

  it("loading 态显示骨架行", () => {
    renderPage(makeData({ loading: true }));
    expect(screen.getByTestId("skeleton-rows")).toBeTruthy();
  });
});
