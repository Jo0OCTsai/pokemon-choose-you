/**
 * 任务详情抽屉（桌面 TaskDetailDrawer 同构）：focus trap / Esc / 焦点回归（a11y 断言②
 * 的主落点）+ 属性总览 kv 栅格 + FollowupStream + DispatchTimeline 来源过滤 +
 * DispatchOps（通道/agent 下拉 + ⚡派发 + 手动收口 + running 禁用）。放生走卡片 ✕
 * （桌面同位，抽屉无危险区）；跟进写路径/操作历史/编辑入口 → drawer-followups.spec。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { mockHost } from "../../src/client/rpc";
import { TaskDetailDrawer } from "../../src/client/tasks/TaskDetailDrawer";
import { renderDrawer } from "./drawerHarness";
import { makeData, makeTask } from "./fixtures";

afterEach(cleanup);
vi.useFakeTimers();

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

describe("属性总览 kv 栅格（桌面 d-summary 同构）", () => {
  it("分类/优先级/状态/截止/标签（⛳项目高亮）/来源/创建/完成 全量呈现", () => {
    const data = makeData({
      tasks: [
        makeTask({
          id: 2,
          tags: [
            { name: "pokemon", dimension: "project" },
            { name: "周报", dimension: "topic" },
          ],
          dueAt: "2026-10-12T18:00:00+08:00",
        }),
      ],
    });
    renderDrawer(2, data);
    const summary = screen.getByTestId("task-summary");
    expect(summary.textContent).toContain("分类");
    expect(summary.textContent).toContain("优先级");
    expect(summary.textContent).toContain("⛳ pokemon");
    expect(summary.textContent).toContain("# 周报");
    expect(summary.textContent).toContain("2026-10-12 18:00");
  });
});

/** 派发测试数据：项目标签任务 + 启用中 agent（桌面 dsp-row 同构的数据面） */
function dispatchData(taskOverrides: Parameters<typeof makeTask>[0]): ReturnType<typeof makeData> {
  const data = makeData({ tasks: [makeTask(taskOverrides)] });
  data.agents = [
    {
      id: "claude",
      name: "claude",
      command: "claude",
      args: "",
      historyArgs: "",
      workdir: "",
      timeoutSecs: 600,
      enabled: true,
    },
  ];
  return data;
}

describe("DispatchOps", () => {
  it("通道/agent 同行 + ⚡派发一步直发（无确认弹层）→ dispatchInteractive", async () => {
    const data = dispatchData({ id: 1, tags: [{ name: "pokemon", dimension: "project" }] });
    data.routes = [{ tag: "pokemon", agentId: "claude", workdir: "~/projects/pkm", context: "" }];
    const { host } = renderDrawer(1, data);
    // 桌面 dsp-row 同构：agent 徽章 + 工作目录 + ⚡派发（不弹路由确认层）
    expect(screen.getByText(/claude · 本机/)).toBeTruthy();
    expect(screen.getByText(/📂 ~/)).toBeTruthy();
    expect(screen.queryByText(/即将派发：/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "⚡ 派发" }));
    await vi.runAllTimersAsync();
    expect(host.calls.map((c) => c.command)).toContain("dispatchInteractive");
  });

  it("无项目标签 → 引导 hint（不渲染派发行）", () => {
    renderDrawer();
    expect(screen.getByText(/先给待办挂上「项目」维度标签/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /⚡ 派发/ })).toBeNull();
  });

  it("running 态 ⚡派发禁用（桌面 busyHint 同款）；冲突走行内中性提示不弹窗", () => {
    const data = dispatchData({ id: 1, dispatchState: "running", tags: [{ name: "pokemon", dimension: "project" }] });
    renderDrawer(1, data);
    const go = screen.getByRole("button", { name: "⚡ 派发" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    expect(go.title).toContain("agent 执行中");
    expect(screen.queryByTestId("modal-overlay")).toBeNull();
  });

  it("手动收口行（queued/running 才出）：标记完成/失败/重置 → dispatchClose/dispatchReset", async () => {
    const { host } = renderDrawer(
      1,
      dispatchData({ id: 1, dispatchState: "queued", tags: [{ name: "pokemon", dimension: "project" }] }),
    );
    expect(screen.getByText("排队中")).toBeTruthy();
    fireEvent.click(screen.getByText("标记完成"));
    await vi.runAllTimersAsync();
    expect(host.calls.map((c) => c.command)).toContain("dispatchClose");
    // 收口后行消失（仅 queued/running 呈现）——每档标记独立渲染验证
    cleanup();
    const host2 = mockHost();
    render(
      <ClientProvider client={host2}>
        <I18nProvider locale="zh-Hans">
          <TaskDetailDrawer
            task={makeTask({ id: 1, dispatchState: "queued", tags: [{ name: "pokemon", dimension: "project" }] })}
            data={dispatchData({ id: 1, dispatchState: "queued", tags: [{ name: "pokemon", dimension: "project" }] })}
            categories={[]}
            onClose={() => undefined}
            onChanged={() => undefined}
          />
        </I18nProvider>
      </ClientProvider>,
    );
    fireEvent.click(screen.getByText("标记失败"));
    await vi.runAllTimersAsync();
    expect(host2.calls.map((c) => c.command)).toContain("dispatchClose");
    fireEvent.click(screen.getByText("重置"));
    await vi.runAllTimersAsync();
    expect(host2.calls.map((c) => c.command)).toContain("dispatchReset");
  });
});
