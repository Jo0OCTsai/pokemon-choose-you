/**
 * 任务详情抽屉：focus trap / Esc / 焦点回归（a11y 断言②的主落点）+ FollowupStream +
 * DispatchTimeline 来源过滤 + DispatchOps（双通道确认弹层/收口/重派/取消排队/互斥冲突
 * 中性提示）+ ReleaseGuard 两层确认与 5 秒撤销。
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { mockHost, type MockHostState } from "../../src/client/rpc";
import { TaskDetailDrawer } from "../../src/client/tasks/TaskDetailDrawer";
import { makeData, makeTask } from "./fixtures";

afterEach(cleanup);
vi.useFakeTimers();

function renderDrawer(taskId = 1, data = makeData(), initial: Partial<MockHostState> = {}) {
  const host = mockHost({ tasks: data.tasks, ...initial });
  const onClose = vi.fn();
  const onChanged = vi.fn();
  const task = data.tasks.find((t) => t.id === taskId) ?? makeTask({ id: taskId });
  render(
    <ClientProvider client={host}>
      <I18nProvider locale="zh-Hans">
        <TaskDetailDrawer
          task={task}
          data={data}
          categories={data.categories}
          onClose={onClose}
          onChanged={onChanged}
        />
      </I18nProvider>
    </ClientProvider>,
  );
  return { host, onClose, onChanged };
}

describe("抽屉焦点管理（a11y 断言②）", () => {
  it("打开即聚焦容器内首个可聚焦元素；Tab 循环不出容器", () => {
    renderDrawer();
    const drawer = screen.getByTestId("task-drawer");
    expect(drawer.contains(document.activeElement)).toBe(true);
    const focusables = Array.from(
      drawer.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]"),
    ).filter((el) => !el.hasAttribute("disabled"));
    expect(focusables.length).toBeGreaterThan(3);
    // 从最后一个 Tab → 回到第一个（循环）
    const last = focusables[focusables.length - 1];
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(focusables[0]);
    // 从第一个 Shift+Tab → 到最后一个
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("Esc 关闭且焦点回归触发元素", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const { onClose } = renderDrawer();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    // useFocusTrap cleanup 在卸载时回归焦点——手动卸载后再断言
    cleanup();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});

describe("FollowupStream / DispatchTimeline", () => {
  it("跟进记录流按追加序展示", () => {
    const data = makeData({ tasks: [makeTask({ id: 1 })] });
    data.followups[1] = [
      { id: 1, taskId: 1, content: "先查口径", source: "feishu", createdAt: "2026-10-11T09:00:00+08:00" },
      { id: 2, taskId: 1, content: "差 3 个数字", source: "dsh", createdAt: "2026-10-11T10:00:00+08:00" },
    ];
    renderDrawer(1, data);
    expect(screen.getByText("先查口径")).toBeTruthy();
    expect(screen.getByText("差 3 个数字")).toBeTruthy();
    cleanup();
    renderDrawer(1, makeData({ tasks: [makeTask({ id: 1 })] }));
    expect(screen.getByText("暂无跟进记录")).toBeTruthy();
  });

  it("Agent 时间线：时长/成本/退出码 + 来源过滤", () => {
    const data = makeData({ tasks: [makeTask({ id: 1 })] });
    data.sessions = [
      {
        id: 1,
        taskId: 1,
        agentId: "claude",
        sessionId: "s-1",
        kind: "dispatch_headless",
        durationMs: 65000,
        costUsd: 0.021,
        exitCode: 0,
        createdAt: "2026-10-11T09:00:00+08:00",
        summary: "改了 2 个文件",
      },
      {
        id: 2,
        taskId: 1,
        agentId: "claude",
        sessionId: "s-2",
        kind: "capture",
        durationMs: 4000,
        costUsd: null,
        exitCode: null,
        createdAt: "2026-10-11T10:00:00+08:00",
        summary: null,
      },
    ];
    renderDrawer(1, data);
    expect(screen.getByText(/65s/)).toBeTruthy();
    expect(screen.getByText(/\$0\.021/)).toBeTruthy();
    expect(screen.getByText(/exit 0/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "无头派发" }));
    expect(screen.getByText(/改了 2 个文件/)).toBeTruthy();
    expect(screen.queryByText(/s-2/)).toBeNull();
  });

  it("无执行记录时空态：还没有派出过 agent", () => {
    renderDrawer();
    expect(screen.getAllByText("还没有派出过 agent").length).toBeGreaterThan(0);
  });
});

describe("DispatchOps", () => {
  it("派发先出路由确认弹层（可临时改选说明），确认后 dispatchInteractive", async () => {
    const data = makeData({ tasks: [makeTask({ id: 1, tags: [{ name: "pokemon", dimension: "project" }] })] });
    data.routes = [{ tag: "pokemon", agentId: "claude", workdir: "~/projects/pkm", context: "" }];
    const { host } = renderDrawer(1, data);
    fireEvent.click(screen.getByText("🖥 交互（新终端）"));
    expect(screen.getByText(/即将派发：claude · 本机/)).toBeTruthy();
    expect(screen.getByText(/交互通道将在终端面板启动/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "派发" }));
    await vi.runAllTimersAsync();
    expect(host.calls.map((c) => c.command)).toContain("dispatchInteractive");
  });

  it("互斥冲突（DISPATCH_ALREADY_ACTIVE）中性提示，不弹窗", async () => {
    const data = makeData({ tasks: [makeTask({ id: 1, dispatchState: "running" })] });
    const { host } = renderDrawer(1, data);
    fireEvent.click(screen.getByText("🤖 无头（自动回传）"));
    fireEvent.click(screen.getByRole("button", { name: "派发" }));
    await vi.runAllTimersAsync();
    expect(host.calls.map((c) => c.command)).toContain("dispatchHeadless");
    expect(screen.getByText("该任务已有进行中的派发，请先收口或重置")).toBeTruthy();
  });

  it("收口三键 + 重派 + 取消排队（排队态才可取消）", async () => {
    const data = makeData({ tasks: [makeTask({ id: 1, dispatchState: "queued" })] });
    const { host } = renderDrawer(1, data);
    fireEvent.click(screen.getByText("取消排队"));
    await vi.runAllTimersAsync();
    expect(host.calls.map((c) => c.command)).toContain("dispatchCancel");
    fireEvent.click(screen.getByText("标记完成"));
    await vi.runAllTimersAsync();
    expect(host.calls.map((c) => c.command)).toContain("dispatchClose");
    fireEvent.click(screen.getByText("重派"));
    await vi.runAllTimersAsync();
    expect(host.calls.map((c) => c.command)).toContain("dispatchRedo");
  });
});

describe("ReleaseGuard", () => {
  it("两层确认 → taskDelete → 撤销 toast（role=status）；5 秒窗口内撤销恢复", async () => {
    const { host, onChanged } = renderDrawer(1);
    fireEvent.click(screen.getByRole("button", { name: "放生（删除）" }));
    expect(screen.getByText(/执行后 5 秒内可撤销/)).toBeTruthy();
    fireEvent.click(screen.getByText("确认放生"));
    await vi.runAllTimersAsync();
    expect(host.calls.map((c) => c.command)).toContain("taskDelete");
    const toast = screen.getByTestId("undo-toast");
    expect(toast.getAttribute("role")).toBe("status");
    expect(toast.getAttribute("aria-live")).toBe("polite");
    expect(toast.textContent).toContain("已放生「任务 1」");
    fireEvent.click(screen.getByText(/撤销 5s/));
    await vi.runAllTimersAsync();
    expect(host.calls.map((c) => c.command)).toContain("taskDeleteUndo");
    expect(onChanged).toHaveBeenCalled();
  });

  it("撤销窗 5 秒超时自动收口", async () => {
    renderDrawer(1);
    fireEvent.click(screen.getByRole("button", { name: "放生（删除）" }));
    fireEvent.click(screen.getByText("确认放生"));
    // 先挂 toast（异步链），再推进撤销窗 5s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("undo-toast")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(screen.queryByTestId("undo-toast")).toBeNull();
  });
});

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

describe("抽屉「编辑」入口（桌面同款）", () => {
  it("底部编辑按钮打开全字段弹窗，保存走 taskUpdate 并刷新", async () => {
    const data = makeData({ tasks: [makeTask({ id: 1 })] });
    const { host, onChanged } = renderDrawer(1, data);
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
