/**
 * 任务全字段编辑弹窗（TaskEditModal）：字段初始绑定 / 标题必填校验 / taskUpdate
 * 全量参数（含 tagIds）/ 标签维度单选互斥与总数上限 3 / 空维度标签态与卡片溢出菜单入口。
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { mockHost } from "../../src/client/rpc";
import { defaultOpenValue } from "../../src/client/ui/dateTime";
import { TaskCard } from "../../src/client/tasks/TaskCard";
import { TaskEditModal } from "../../src/client/tasks/TaskEditModal";
import type { Tag, TagDimension } from "../../src/host/domain/vocabulary-tags";
import { makeCategory, makeData, makeTask } from "./fixtures";

afterEach(cleanup);

/** 维度夹具：项目（单选）+ 主题（多选，6 个可挑满上限） */
const DIMENSIONS: TagDimension[] = [
  { id: 1, key: "project", name: "项目", cardinality: "single", maxTags: 10, sort: 0, enabled: true },
  { id: 2, key: "topic", name: "主题", cardinality: "multi", maxTags: 20, sort: 1, enabled: true },
];

function tag(id: number, name: string, dimension: string): Tag {
  return {
    id,
    name,
    description: "",
    dimension,
    meta: null,
    origin: "manual",
    createdAt: "2026-10-01T08:00:00",
    usage: 0,
  };
}

const TAGS: Tag[] = [
  tag(1, "pkm", "project"),
  tag(2, "blog", "project"),
  tag(3, "t1", "topic"),
  tag(4, "t2", "topic"),
  tag(5, "t3", "topic"),
  tag(6, "t4", "topic"),
];

/** 刷完 mock 异步链 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function renderModal(task = makeTask({ id: 1 })) {
  // host 预置同一任务：taskUpdate 命中（mock 缺任务回 NOT_FOUND 走错误分支）
  const host = mockHost({ tasks: [task] });
  const data = makeData({
    categories: [makeCategory({ id: 1, name: "工作" }), makeCategory({ id: 2, name: "生活" })],
    dimensions: DIMENSIONS,
    tags: TAGS,
    tasks: [task],
  });
  const onClose = vi.fn();
  const onChanged = vi.fn();
  render(
    <ClientProvider client={host}>
      <I18nProvider locale="zh-Hans">
        <TaskEditModal task={task} data={data} onClose={onClose} onChanged={onChanged} />
      </I18nProvider>
    </ClientProvider>,
  );
  return { host, data, onClose, onChanged };
}

function inputByLabel(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

/** 日期时间选择器触发钮（弹层选择，零键入） */
function pickerTrigger(label: string): HTMLElement {
  return screen.getByLabelText(label) as HTMLElement;
}

describe("TaskEditModal 字段绑定", () => {
  it("打开即回填任务字段（标题/备注/分类/优先级/截止/提醒/标签选中）", () => {
    renderModal(
      makeTask({
        id: 1,
        title: "核对周报",
        note: "差 3 个数字",
        categoryId: 2,
        priority: "high",
        dueAt: "2026-10-12T18:00:00+08:00",
        remindAt: "2026-10-12T09:30:00+08:00",
        tags: [{ name: "pkm", dimension: "project" }],
      }),
    );
    expect(inputByLabel("标题").value).toBe("核对周报");
    expect((screen.getByLabelText("备注") as HTMLTextAreaElement).value).toBe("差 3 个数字");
    expect((screen.getByLabelText("分类") as HTMLSelectElement).value).toBe("2");
    expect((screen.getByLabelText("优先级") as HTMLSelectElement).value).toBe("high");
    expect(pickerTrigger("截止").textContent).toContain("2026-10-12 18:00");
    expect(pickerTrigger("提醒").textContent).toContain("2026-10-12 09:30");
    // 标签引用（name+dimension）→ id 选中
    expect(screen.getByText("pkm").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("blog").getAttribute("aria-pressed")).toBe("false");
  });

  it("无维度数据时标签区空态引导（edit.noTags）", () => {
    const data = makeData();
    render(
      <ClientProvider client={mockHost()}>
        <I18nProvider locale="zh-Hans">
          <TaskEditModal task={makeTask({ id: 1 })} data={data} onClose={() => undefined} onChanged={() => undefined} />
        </I18nProvider>
      </ClientProvider>,
    );
    expect(screen.getByText("还没有标签，去 背包 → 分类与标签 里添加")).toBeTruthy();
  });
});

describe("TaskEditModal 保存与校验", () => {
  it("标题清空 → 必填校验拦截，不调 taskUpdate", async () => {
    const { host } = renderModal();
    fireEvent.change(inputByLabel("标题"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("标题不能为空");
    expect(host.calls.map((c) => c.command)).not.toContain("taskUpdate");
  });

  it("保存 → taskUpdate 全量参数（含 tagIds 与清空截止→null）→ 刷新并关闭", async () => {
    const { host, onChanged, onClose } = renderModal(
      makeTask({ id: 7, dueAt: "2026-10-12T18:00:00+08:00", tags: [{ name: "pkm", dimension: "project" }] }),
    );
    fireEvent.change(inputByLabel("标题"), { target: { value: "改标题" } });
    fireEvent.change(screen.getByLabelText("备注"), { target: { value: "加备注" } });
    fireEvent.change(screen.getByLabelText("分类"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("优先级"), { target: { value: "urgent" } });
    // 清空截止：开弹层（有值不动）→ 清空（空串 → null）；提醒空值打开落默认 18:00，改小时到 08
    fireEvent.click(pickerTrigger("截止"));
    fireEvent.click(screen.getByText("清空"));
    fireEvent.click(pickerTrigger("提醒"));
    fireEvent.change(screen.getByLabelText("提醒 时"), { target: { value: "08" } });
    const remindAt = `${defaultOpenValue().slice(0, 10)}T08:00`;
    // 换项目标签（pkm → blog）
    fireEvent.click(screen.getByText("blog"));
    fireEvent.click(screen.getByText("t1"));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await flush();
    const call = host.calls.find((c) => c.command === "taskUpdate");
    expect(call?.params).toEqual({
      id: 7,
      title: "改标题",
      note: "加备注",
      categoryId: 2,
      priority: "urgent",
      dueAt: null,
      remindAt,
      tagIds: [2, 3],
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("取消直接丢弃关闭（无确认、不调写命令）", () => {
    const { host, onClose } = renderModal();
    fireEvent.change(inputByLabel("标题"), { target: { value: "改一半" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(host.calls.map((c) => c.command)).not.toContain("taskUpdate");
  });
});

describe("TaskEditModal 标签维度规则", () => {
  it("项目维度单选：选另一只自动替换", () => {
    renderModal(makeTask({ id: 1, tags: [{ name: "pkm", dimension: "project" }] }));
    expect(screen.getByText("pkm").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByText("blog"));
    expect(screen.getByText("pkm").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("blog").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("1/3")).toBeTruthy();
  });

  it("总数上限 3：满额后未选中 chips 禁用，计数 3/3；取消选中可再腾位", () => {
    renderModal(makeTask({ id: 1 }));
    for (const name of ["t1", "t2", "t3"]) {
      fireEvent.click(screen.getByText(name));
    }
    expect(screen.getByText("3/3")).toBeTruthy();
    const blocked = screen.getByText("t4") as HTMLButtonElement;
    expect(blocked.disabled).toBe(true);
    // 已选项仍可取消（去选中不受上限影响）
    fireEvent.click(screen.getByText("t2"));
    expect(screen.getByText("2/3")).toBeTruthy();
    expect((screen.getByText("t4") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("TaskCard ✎ 编辑入口（内联按钮，桌面同构）", () => {
  it("✎ 钮 → onEdit 回调携任务；未传 onEdit 不渲染编辑钮", () => {
    const onEdit = vi.fn();
    const task = makeTask({ id: 3 });
    render(
      <ClientProvider client={mockHost()}>
        <I18nProvider locale="zh-Hans">
          <TaskCard
            task={task}
            category={makeCategory({ id: 1 })}
            readonly={false}
            onOpen={() => undefined}
            onChanged={() => undefined}
            onEdit={onEdit}
          />
        </I18nProvider>
      </ClientProvider>,
    );
    fireEvent.click(screen.getByTitle("编辑"));
    expect(onEdit).toHaveBeenCalledWith(task);
    cleanup();
    // 缺省 onEdit：不渲染编辑钮
    render(
      <ClientProvider client={mockHost()}>
        <I18nProvider locale="zh-Hans">
          <TaskCard task={task} readonly={false} onOpen={() => undefined} onChanged={() => undefined} />
        </I18nProvider>
      </ClientProvider>,
    );
    expect(screen.queryByTitle("编辑")).toBeNull();
  });
});
