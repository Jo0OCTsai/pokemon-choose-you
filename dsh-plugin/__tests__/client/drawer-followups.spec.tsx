/**
 * 抽屉跟进/历史/编辑面（对照桌面跟进段与 edit.history）：跟进记录写路径（添加回灌、
 * 两段删除与超时复位）+ taskHistory 操作历史渲染 + 底部「编辑」入口全字段弹窗。
 * 渲染壳经 drawerHarness 共用（从 drawer.spec 等量迁出）。
 */
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDrawer } from "./drawerHarness";
import { makeData, makeTask } from "./fixtures";

afterEach(cleanup);
vi.useFakeTimers();

describe("跟进记录写路径（对照桌面跟进段）", () => {
  it("添加跟进 → taskNoteAdd → 重拉 taskDetail 回灌新内容", async () => {
    const data = makeData({ tasks: [makeTask({ id: 1 })] });
    const { host } = renderDrawer(1, data);
    fireEvent.change(screen.getByPlaceholderText(/补充跟进记录/), { target: { value: "已联系对方" } });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(host.calls.find((c) => c.command === "taskNoteAdd")?.params).toEqual({ taskId: 1, content: "已联系对方" });
    expect(screen.getByText("已联系对方")).toBeTruthy();
  });

  it("跟进两段删除（✕ → 确认删除？4 秒内再点生效）；AI 来源同样可删（对齐桌面）", async () => {
    const notes = [
      { id: 5, taskId: 1, content: "手动记录", source: "manual", createdAt: "2026-10-11T09:00:00+08:00" },
      { id: 6, taskId: 1, content: "AI 记录", source: "ai", createdAt: "2026-10-11T10:00:00+08:00" },
    ];
    const data = makeData({ tasks: [makeTask({ id: 1 })], followups: { 1: notes } });
    const { host } = renderDrawer(1, data, { followups: { 1: notes } });
    // AI 来源也渲染删除钮（桌面/Rust 无 source 守卫）
    expect(screen.getByLabelText("✕ AI 记录")).toBeTruthy();
    const del = screen.getByLabelText("✕ 手动记录");
    fireEvent.click(del);
    // 第一段：进入确认态，未发写命令
    expect(screen.getByText("确认删除？")).toBeTruthy();
    expect(host.calls.map((c) => c.command)).not.toContain("taskNoteDelete");
    // 第二段：4 秒内再点 → taskNoteDelete
    fireEvent.click(screen.getByText("确认删除？"));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(host.calls.find((c) => c.command === "taskNoteDelete")?.params).toEqual({ id: 5 });
  });

  it("两段确认 4 秒超时自动复位（再点重新进入确认态，不误删）", async () => {
    const notes = [{ id: 7, taskId: 1, content: "另一条", source: "manual", createdAt: "2026-10-11T09:00:00+08:00" }];
    const data = makeData({ tasks: [makeTask({ id: 1 })], followups: { 1: notes } });
    const { host } = renderDrawer(1, data, { followups: { 1: notes } });
    fireEvent.click(screen.getByLabelText("✕ 另一条"));
    expect(screen.getByText("确认删除？")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    // 超时复位：回 ✕，且未发删除
    expect(screen.queryByText("确认删除？")).toBeNull();
    expect(screen.getByLabelText("✕ 另一条")).toBeTruthy();
    expect(host.calls.map((c) => c.command)).not.toContain("taskNoteDelete");
  });
});

describe("操作历史段（对照桌面 edit.history）", () => {
  it("进抽屉拉取 taskHistory，渲染动作文案 + 字段旧→新（status 走翻译）", async () => {
    const data = makeData({ tasks: [makeTask({ id: 1 })] });
    const logs = [
      {
        id: 1,
        taskId: 1,
        action: "create",
        field: "title",
        oldValue: null,
        newValue: "任务 1",
        origin: "dsh",
        createdAt: "2026-10-11T08:00:00+08:00",
      },
      {
        id: 2,
        taskId: 1,
        action: "update",
        field: "status",
        oldValue: "inbox",
        newValue: "done",
        origin: "local",
        createdAt: "2026-10-11T09:00:00+08:00",
      },
    ];
    const { host } = renderDrawer(1, data, { taskLogs: { 1: logs } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(host.calls.find((c) => c.command === "taskHistory")?.params).toEqual({ taskId: 1 });
    const history = screen.getByTestId("task-history");
    expect(history.textContent).toContain("创建 · title: — → 任务 1");
    expect(history.textContent).toContain("修改 · status: 草丛 → 已完成");
    expect(history.textContent).toContain("2026-10-11 08:00");
  });

  it("无记录 → 空态文案", async () => {
    renderDrawer(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("task-history").textContent).toContain("暂无操作记录");
  });
});

describe("抽屉「编辑」入口（属性总览卡右上角）", () => {
  it("基础信息卡右上角编辑按钮打开全字段弹窗，保存走 taskUpdate 并刷新", async () => {
    const data = makeData({ tasks: [makeTask({ id: 1 })] });
    const { host, onChanged } = renderDrawer(1, data);
    // 编辑钮在基础信息卡（task-summary）内
    expect(within(screen.getByTestId("task-summary")).getByRole("button", { name: "✎ 编辑" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "✎ 编辑" }));
    expect(screen.getByText(/编辑待办/)).toBeTruthy();
    // 默认标题非空 → 保存直发全量 patch
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    const call = host.calls.find((c) => c.command === "taskUpdate");
    expect(call?.params).toMatchObject({ id: 1, title: "任务 1", tagIds: [] });
    expect(onChanged).toHaveBeenCalled();
    // 保存成功后弹窗关闭
    expect(screen.queryByText(/编辑待办/)).toBeNull();
  });
});
