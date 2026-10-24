/**
 * 精灵条目卡（桌面 TaskCard 同构）：五呈现 × 派发徽标五态 × 内联操作行（出发/暂停/
 * 📅改期/✎编辑/✔完成/🚪逃走/✕放生两层确认 + 已捕捉/已逃走撤销）× 标签 chips。
 * 分段派生/搜索/OverdueFold → tasks.spec.tsx。
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { mockHost, type MockHost } from "../../src/client/rpc";
import { TaskCard } from "../../src/client/tasks/TaskCard";
import { defaultOpenValue } from "../../src/client/ui/dateTime";
import { makeCategory, makeTask } from "./fixtures";
import type { PanelData } from "../../src/client/model";

afterEach(cleanup);

/** 刷完 mock 异步链 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function renderWithClient(node: React.ReactNode, host: MockHost = mockHost(), locale: PanelData["locale"] = "zh-Hans") {
  const onChange = vi.fn();
  render(
    <ClientProvider client={host}>
      <I18nProvider locale={locale}>{node}</I18nProvider>
    </ClientProvider>,
  );
  return { host, onChange };
}

describe("TaskCard 五呈现 × 派发徽标", () => {
  it.each([
    ["normal", "inbox"],
    ["active", "active"],
    ["activePaused", "paused"],
    ["done", "done"],
    ["escaped", "cancelled"],
  ] as const)("状态 %s → 呈现 %s", (_label, status) => {
    renderWithClient(
      <TaskCard
        task={makeTask({ id: 1, status, startedAt: status === "paused" ? "2026-10-11T08:00:00+08:00" : null })}
        category={makeCategory({ id: 1 })}
        readonly={false}
        onOpen={() => undefined}
        onChanged={() => undefined}
      />,
    );
    const card = screen.getByText(/No\.1/).closest("[data-presentation]") as HTMLElement;
    expect(card.getAttribute("data-presentation")).toBe(_label);
  });

  it("进行中呈现 ♪ 捕获中；暂停变体 ⏸ 暂停", () => {
    renderWithClient(
      <TaskCard
        task={makeTask({ id: 2, status: "active" })}
        readonly={false}
        onOpen={() => undefined}
        onChanged={() => undefined}
      />,
    );
    expect(screen.getByText(/♪ 捕获中/)).toBeTruthy();
    cleanup();
    renderWithClient(
      <TaskCard
        task={makeTask({ id: 3, status: "paused", startedAt: "2026-10-11T08:00:00+08:00" })}
        readonly={false}
        onOpen={() => undefined}
        onChanged={() => undefined}
      />,
    );
    expect(screen.getByText(/⏸ 暂停/)).toBeTruthy();
  });

  it.each([
    ["queued", "排队中", "⏳"],
    ["running", "agent 执行中", "◉"],
    ["done", "已回传", "✓"],
    ["failed", "执行失败", "▲"],
  ] as const)("派发徽标 %s → 形 %s + tooltip 文字（非颜色冗余）", (state, tooltip, glyph) => {
    renderWithClient(
      <TaskCard
        task={makeTask({ id: 4, dispatchState: state })}
        readonly={false}
        onOpen={() => undefined}
        onChanged={() => undefined}
      />,
    );
    // 形（glyph 独立文本节点）+ 徽标容器携带 data-state 与 tooltip；文字标签随形同现
    const badge = screen.getByText(glyph).closest("[data-state]");
    expect(badge?.getAttribute("data-state")).toBe(state);
    expect(badge?.getAttribute("title")).toContain(tooltip);
    expect(badge?.textContent?.replace(glyph, "").trim().length).toBeGreaterThan(0);
  });
});

describe("TaskCard 操作（桌面内联按钮行同构，无溢出菜单）", () => {
  it("出发/✔完成直达 host 命令", async () => {
    const { host } = renderWithClient(
      <TaskCard task={makeTask({ id: 5 })} readonly={false} onOpen={() => undefined} onChanged={() => undefined} />,
    );
    fireEvent.click(screen.getByText("▶ 出发"));
    await flush();
    expect(host.calls.map((c) => c.command)).toContain("taskStart");
    fireEvent.click(screen.getByTitle("完成"));
    await flush();
    expect(host.calls.map((c) => c.command)).toContain("taskComplete");
  });

  it("🚪 逃走一步直发（reasonCode=other，桌面单击语义）", async () => {
    const { host } = renderWithClient(
      <TaskCard task={makeTask({ id: 6 })} readonly={false} onOpen={() => undefined} onChanged={() => undefined} />,
    );
    fireEvent.click(screen.getByTitle("逃走（取消）"));
    await flush();
    const call = host.calls.find((c) => c.command === "taskCancel");
    expect(call).toEqual({ command: "taskCancel", params: { taskId: 6, reasonCode: "other" } });
  });

  it("📅 改期弹窗 → taskReschedule；✕ 放生 → 两层确认弹层 + 撤销", async () => {
    const { host } = renderWithClient(
      <TaskCard
        task={makeTask({ id: 7 })}
        readonly={false}
        allowSchedule
        onOpen={() => undefined}
        onChanged={() => undefined}
      />,
    );
    fireEvent.click(screen.getByTitle("加入路线"));
    // 改期弹窗：截止空值 → 开弹层即落默认 18:00（零键入），保存直发 taskReschedule
    fireEvent.click(screen.getByLabelText("截止"));
    const due = defaultOpenValue();
    fireEvent.click(screen.getByText("保存"));
    await flush();
    expect(host.calls.find((c) => c.command === "taskReschedule")?.params).toEqual({ taskId: 7, due });
    cleanup();
    const host2 = mockHost();
    render(
      <ClientProvider client={host2}>
        <I18nProvider locale="zh-Hans">
          <TaskCard task={makeTask({ id: 8 })} readonly={false} onOpen={() => undefined} onChanged={() => undefined} />
        </I18nProvider>
      </ClientProvider>,
    );
    fireEvent.click(screen.getByTitle("放生（删除）"));
    expect(screen.getByText(/将连同标签关联与跟进记录一并删除/)).toBeTruthy();
    fireEvent.click(screen.getByText("确认放生"));
    await flush();
    expect(host2.calls.map((c) => c.command)).toContain("taskDelete");
    expect(screen.getByTestId("undo-toast").textContent).toContain("已放生「任务 8」");
  });

  it("已捕捉/已逃走卡：状态标 + ↩撤销（taskUpdate 回 scheduled）", async () => {
    const { host } = renderWithClient(
      <TaskCard
        task={makeTask({ id: 9, status: "done", completedAt: "2026-10-11T20:00:00+08:00" })}
        readonly={false}
        onOpen={() => undefined}
        onChanged={() => undefined}
      />,
    );
    expect(screen.getByText("✔ 已捕捉")).toBeTruthy();
    fireEvent.click(screen.getByTitle("↩ 撤销"));
    await flush();
    const call = host.calls.find((c) => c.command === "taskUpdate");
    expect(call?.params).toMatchObject({ id: 9, status: "scheduled" });
    cleanup();
    renderWithClient(
      <TaskCard
        task={makeTask({ id: 10, status: "cancelled" })}
        readonly={false}
        onOpen={() => undefined}
        onChanged={() => undefined}
      />,
    );
    expect(screen.getByText("已逃走")).toBeTruthy();
  });

  it("标签 chips：项目维度 ⛳ 黄底主位、普通标签 # 呈现（桌面 tag-list 同构）", () => {
    renderWithClient(
      <TaskCard
        task={makeTask({
          id: 11,
          tags: [
            { name: "pokemon", dimension: "project" },
            { name: "周报", dimension: "topic" },
          ],
        })}
        readonly={false}
        onOpen={() => undefined}
        onChanged={() => undefined}
      />,
    );
    const project = screen.getByText(/⛳/);
    expect(project.getAttribute("data-project")).toBe("true");
    expect(screen.getByText(/#/).textContent).toContain("周报");
  });
});
