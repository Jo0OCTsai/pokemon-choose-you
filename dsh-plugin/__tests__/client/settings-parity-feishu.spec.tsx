/**
 * 设置区 · 飞书分区对齐主应用（桌面为规格单源）：会话过滤搜索 + 生效/偏好/类型
 * 三维筛选 + 汇总计数行。从 settings-parity.spec 拆出（棘轮 max-lines，等量迁移）；
 * 渲染壳/分区导航 → settingsHarness。
 */
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeData } from "./fixtures";
import { getPage, gotoSection, renderSettings } from "./settingsHarness";
import type { PanelData } from "../../src/client/model";

afterEach(cleanup);
vi.useFakeTimers();

describe("飞书分区对齐（会话过滤搜索/筛选/汇总/生效 chip）", () => {
  function feishuData(): PanelData {
    const data = makeData();
    data.filters = [
      // 生效合并视图夹具（host filterList 直出口径：跟随按免打扰，unknown 降级）
      {
        chatId: "g1",
        chatName: "产品群",
        chatType: "group",
        state: "follow",
        effective: "pull",
        source: "follow",
        updatedAt: null,
      },
      {
        chatId: "g2",
        chatName: "设计群",
        chatType: "group",
        state: "always_pull",
        effective: "pull",
        source: "manual",
        updatedAt: "2026-10-11T09:00:00+08:00",
      },
      {
        chatId: "b1",
        chatName: "机器人小助手",
        chatType: "bot",
        state: "always_filter",
        effective: "filter",
        source: "manual",
        updatedAt: null,
      },
      // 免打扰查询失败降级：生效=拉取（不过滤）但来源=降级（chip 带 ⚠）
      {
        chatId: "g3",
        chatName: "备份群",
        chatType: "group",
        state: "follow",
        effective: "pull",
        source: "followDegraded",
        updatedAt: null,
      },
      {
        chatId: "p1",
        chatName: "张三",
        chatType: "p2p",
        state: "follow",
        effective: "pull",
        source: "follow",
        updatedAt: null,
      },
    ];
    return data;
  }

  it("汇总计数行（生效口径）+ 名称搜索过滤", () => {
    renderSettings(feishuData());
    gotoSection("飞书");
    const page = getPage("feishu");
    expect(within(page).getByTestId("filter-summary").textContent).toContain("共 5 个会话：4 拉取 · 1 过滤 · 手动 2");
    fireEvent.change(within(page).getByLabelText("按会话名称搜索"), { target: { value: "产品" } });
    const rows = within(page).getAllByTestId("filter-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("产品群");
  });

  it("行内生效 chip：拉取/过滤 × 跟随/手动/降级（host 合并直出）", () => {
    renderSettings(feishuData());
    gotoSection("飞书");
    const page = getPage("feishu");
    const chipOf = (name: string) =>
      within(within(page).getByText(name).closest('[data-testid="filter-row"]') as HTMLElement).getByTestId(
        "filter-eff",
      );
    expect(chipOf("产品群").textContent).toBe("📡 拉取 · 跟随");
    expect(chipOf("设计群").textContent).toBe("📡 拉取 · 手动");
    expect(chipOf("机器人小助手").textContent).toBe("🔇 过滤 · 手动");
    // 降级：⚠ 角标 + title 说明免打扰查询失败
    const degraded = chipOf("备份群");
    expect(degraded.textContent).toBe("📡 拉取 · 降级 ⚠");
    expect(degraded.getAttribute("title")).toContain("免打扰");
  });

  it("生效/偏好/类型三维筛选（生效档按 host 合并值匹配）", () => {
    renderSettings(feishuData());
    gotoSection("飞书");
    const page = getPage("feishu");
    // 生效状态：拉取 → 跟随+未免打扰的产品群/备份群、手动的设计群（p1 私聊行仅 mock 出现——生产 host 清单排除私聊——同按生效口径计入）
    fireEvent.change(within(page).getByLabelText("按生效状态筛选"), { target: { value: "pull" } });
    const pullRows = within(page).getAllByTestId("filter-row");
    expect(pullRows).toHaveLength(4);
    expect(pullRows.map((r) => r.textContent).join("")).toContain("设计群");
    // 生效状态：过滤 → 只有 always_filter 的机器人
    fireEvent.change(within(page).getByLabelText("按生效状态筛选"), { target: { value: "filter" } });
    const filterRows = within(page).getAllByTestId("filter-row");
    expect(filterRows).toHaveLength(1);
    expect(filterRows[0].textContent).toContain("机器人小助手");
    // 偏好：手动 → 设计群 + 机器人
    fireEvent.change(within(page).getByLabelText("按生效状态筛选"), { target: { value: "all" } });
    fireEvent.change(within(page).getByLabelText("按偏好设置筛选"), { target: { value: "manual" } });
    expect(within(page).getAllByTestId("filter-row")).toHaveLength(2);
    // 类型：机器人 → 只剩机器人小助手（p2p 不进类型档）
    fireEvent.change(within(page).getByLabelText("按偏好设置筛选"), { target: { value: "all" } });
    fireEvent.change(within(page).getByLabelText("按会话类型筛选"), { target: { value: "bot" } });
    const rows = within(page).getAllByTestId("filter-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("机器人小助手");
  });

  it("U28 授权登录一键启动：点击后呈现终端面板启动反馈（larkLoginStart）", async () => {
    renderSettings(feishuData());
    gotoSection("飞书");
    const page = getPage("feishu");
    const btn = within(page).getByTestId("lark-login-btn");
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(within(page).getByTestId("lark-launched").textContent).toContain("已在终端面板启动登录");
    expect(within(page).queryByTestId("lark-launch-failed")).toBeNull();
  });
});
