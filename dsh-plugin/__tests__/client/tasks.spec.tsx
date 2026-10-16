/**
 * 任务面：精灵条目卡五呈现 × 派发徽标五态 × 溢出菜单（逃走 6 原因码/改期/放生）+
 * OverdueFold fresh start + 四分段派生（CAUGHT x/y / 路线分组 / 草丛 / 图鉴统计与筛选）。
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { mockHost, type MockHost } from "../../src/client/rpc";
import { OverdueFold } from "../../src/client/tasks/OverdueFold";
import { PageHeader } from "../../src/client/app/PageHeader";
import { AdventureView, DexView, GrassView, RouteView } from "../../src/client/tasks/views";
import { makeData, makeTask } from "./fixtures";
import type { PanelData } from "../../src/client/model";

afterEach(cleanup);

/** 刷完 mock 异步链 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** 等 300ms 防抖窗 + mock 异步链（真实定时器——本文件未启用假时钟） */
async function settleSearch(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 340));
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

  it("冒险：页头日期 + CAUGHT 1/3 进度条（PageHeader）+ 今日列表", () => {
    // 日期与 CAUGHT 进度在页头（桌面 today 页头同位），AdventureView 只承载列表
    renderWithClient(
      <>
        <PageHeader pendingCount={0} segment="adventure" data={data} />
        <AdventureView data={data} readonly={false} onOpen={() => undefined} onChanged={() => undefined} />
      </>,
    );
    expect(screen.getByText("2026-10-11")).toBeTruthy();
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

describe("任务搜索栏（四分段共享，对照 TaskTab 搜索）", () => {
  const tasks = [
    makeTask({ id: 5, status: "inbox", title: "找皮卡丘" }),
    makeTask({ id: 6, status: "inbox", title: "写周报" }),
  ];
  const data = makeData({ tasks });

  /** host 与 PanelData 同源任务集（taskSearch 在 host 内存态里匹配） */
  function renderGrass() {
    const host = mockHost({ tasks });
    render(
      <ClientProvider client={host}>
        <I18nProvider locale="zh-Hans">
          <GrassView data={data} readonly={false} onOpen={() => undefined} onChanged={() => undefined} />
        </I18nProvider>
      </ClientProvider>,
    );
    return host;
  }

  it("输入防抖 300ms → taskSearch → 结果渲染 + 常规内容隐藏；清空恢复原视图", async () => {
    const host = renderGrass();
    expect(screen.getByTestId("segment-grass")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("🔍 搜索待办（标题 / 备注 / 标签 / 跟进记录）"), {
      target: { value: "皮卡丘" },
    });
    await settleSearch();
    expect(host.calls.find((c) => c.command === "taskSearch")?.params).toEqual({ query: "皮卡丘" });
    expect(screen.getByText("命中 1 条")).toBeTruthy();
    expect(screen.getByText(/No\.5/)).toBeTruthy();
    expect(screen.queryByText(/No\.6/)).toBeNull();
    // 搜索态隐藏该视图常规内容
    expect(screen.queryByTestId("segment-grass")).toBeNull();
    // 清空 → 恢复原视图
    fireEvent.change(screen.getByPlaceholderText("🔍 搜索待办（标题 / 备注 / 标签 / 跟进记录）"), {
      target: { value: "" },
    });
    expect(screen.getByTestId("segment-grass")).toBeTruthy();
    expect(screen.queryByText(/No\.5/)).toBeTruthy();
  });

  it("无命中 → 空态（search.empty）", async () => {
    renderGrass();
    fireEvent.change(screen.getByPlaceholderText("🔍 搜索待办（标题 / 备注 / 标签 / 跟进记录）"), {
      target: { value: "不存在的词" },
    });
    await settleSearch();
    expect(screen.getByText("没有找到匹配的宝可梦。")).toBeTruthy();
  });
});
