/**
 * 任务面：精灵条目卡五呈现 × 派发徽标五态 × 溢出菜单（逃走 6 原因码/改期/放生）+
 * OverdueFold fresh start + 四分段派生（CAUGHT x/y / 路线分组 / 草丛 / 图鉴统计与筛选）。
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { mockHost, type MockHost } from "../../src/client/rpc";
import { TaskCard } from "../../src/client/tasks/TaskCard";
import { OverdueFold } from "../../src/client/tasks/OverdueFold";
import { AdventureView, DexView, GrassView, RouteView } from "../../src/client/tasks/views";
import { makeCategory, makeData, makeTask } from "./fixtures";
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
    const badge = screen.getByText(glyph);
    expect(badge.getAttribute("data-state")).toBe(state);
    expect(badge.getAttribute("title")).toContain(tooltip);
  });
});

describe("TaskCard 操作", () => {
  it("出发/完成直达 host 命令", async () => {
    const { host } = renderWithClient(
      <TaskCard task={makeTask({ id: 5 })} readonly={false} onOpen={() => undefined} onChanged={() => undefined} />,
    );
    fireEvent.click(screen.getByText("▶ 出发"));
    await flush();
    expect(host.calls.map((c) => c.command)).toContain("taskStart");
    fireEvent.click(screen.getByText("完成"));
    await flush();
    expect(host.calls.map((c) => c.command)).toContain("taskComplete");
  });

  it("「…」溢出菜单：逃走展开 6 原因码 → taskCancel(reasonCode)", async () => {
    const { host } = renderWithClient(
      <TaskCard task={makeTask({ id: 6 })} readonly={false} onOpen={() => undefined} onChanged={() => undefined} />,
    );
    fireEvent.click(screen.getByLabelText("查看详情"));
    fireEvent.click(screen.getByText("逃走（取消）"));
    const reasons = ["已有类似待办", "不是给我的任务", "建议内容不对", "闲聊/噪音", "已过期", "其他"];
    for (const reason of reasons) {
      expect(screen.getByText(reason)).toBeTruthy();
    }
    fireEvent.click(screen.getByText("闲聊/噪音"));
    await flush();
    const call = host.calls.find((c) => c.command === "taskCancel");
    expect(call).toEqual({ command: "taskCancel", params: { taskId: 6, reasonCode: "noise" } });
  });

  it("溢出菜单改期 → taskReschedule；放生 → 两层确认弹层", async () => {
    const { host } = renderWithClient(
      <TaskCard task={makeTask({ id: 7 })} readonly={false} onOpen={() => undefined} onChanged={() => undefined} />,
    );
    fireEvent.click(screen.getByLabelText("查看详情"));
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-10-12" } });
    await flush();
    expect(host.calls.map((c) => c.command)).toContain("taskReschedule");
    cleanup();
    const host2 = mockHost();
    render(
      <ClientProvider client={host2}>
        <I18nProvider locale="zh-Hans">
          <TaskCard task={makeTask({ id: 8 })} readonly={false} onOpen={() => undefined} onChanged={() => undefined} />
        </I18nProvider>
      </ClientProvider>,
    );
    fireEvent.click(screen.getByLabelText("查看详情"));
    fireEvent.click(screen.getByText("放生（删除）"));
    expect(screen.getByText(/将连同标签关联与跟进记录一并删除/)).toBeTruthy();
    fireEvent.click(screen.getByText("确认放生"));
    await flush();
    expect(host2.calls.map((c) => c.command)).toContain("taskDelete");
    expect(screen.getByTestId("undo-toast").textContent).toContain("已放生「任务 8」");
  });
});

describe("OverdueFold（反羞耻 fresh start）", () => {
  it("昨天有 N 只溜走了 + 全部归草丛（批量清空截止）", async () => {
    const { host } = renderWithClient(
      <OverdueFold
        tasks={[
          makeTask({ id: 10, dueAt: "2026-10-10T10:00:00+08:00" }),
          makeTask({ id: 11, dueAt: "2026-10-09T10:00:00+08:00" }),
        ]}
        readonly={false}
        onChanged={() => undefined}
      />,
    );
    expect(screen.getByText("昨天有 2 只溜走了")).toBeTruthy();
    fireEvent.click(screen.getByText("全部归草丛"));
    await flush();
    const reschedules = host.calls.filter((c) => c.command === "taskReschedule");
    expect(reschedules).toHaveLength(2);
    expect(reschedules[0].params).toEqual({ taskId: 10, due: "" });
    // 无红色催逼：折叠行不含 error 角色
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("展开/收起明细", () => {
    renderWithClient(
      <OverdueFold
        tasks={[makeTask({ id: 12, dueAt: "2026-10-10T10:00:00+08:00" })]}
        readonly={false}
        onChanged={() => undefined}
      />,
    );
    fireEvent.click(screen.getByText("展开"));
    expect(screen.getByText(/No\.12/)).toBeTruthy();
  });
});

describe("四分段派生", () => {
  const tasks = [
    makeTask({ id: 1, status: "active" }),
    makeTask({ id: 2, status: "done", completedAt: "2026-10-11T20:00:00+08:00" }),
    makeTask({ id: 3, status: "scheduled", dueAt: "2026-10-11T18:00:00+08:00" }),
    makeTask({ id: 4, status: "scheduled", dueAt: "2026-10-12T18:00:00+08:00" }),
    makeTask({ id: 5, status: "inbox" }),
    makeTask({ id: 6, status: "cancelled" }),
  ];
  const data = makeData({ tasks });

  it("冒险：CAUGHT 1/3 进度条 + 今日列表", () => {
    renderWithClient(
      <AdventureView data={data} readonly={false} onOpen={() => undefined} onChanged={() => undefined} />,
    );
    expect(screen.getByText("CAUGHT 1/3")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1");
  });

  it("路线：按日期分组（10-11 / 10-12 两站）", () => {
    renderWithClient(<RouteView data={data} readonly={false} onOpen={() => undefined} onChanged={() => undefined} />);
    expect(screen.getByText("2026-10-11")).toBeTruthy();
    expect(screen.getByText("2026-10-12")).toBeTruthy();
  });

  it("草丛：仅 inbox", () => {
    renderWithClient(<GrassView data={data} readonly={false} onOpen={() => undefined} onChanged={() => undefined} />);
    expect(screen.getByText(/No\.5/)).toBeTruthy();
    expect(screen.queryByText(/No\.4/)).toBeNull();
  });

  it("图鉴：统计 + 里程碑档位 + 筛选（全部/已捕捉/已逃走）", () => {
    renderWithClient(<DexView data={data} readonly={false} onOpen={() => undefined} onChanged={() => undefined} />);
    expect(screen.getByText("📙 累计捕捉 1 只 · 逃走 1 只")).toBeTruthy();
    expect(screen.getByText("第一只！图鉴开始转动了。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "已逃走" }));
    expect(screen.getByText(/No\.6/)).toBeTruthy();
    expect(screen.queryByText(/No\.2/)).toBeNull();
  });
});
