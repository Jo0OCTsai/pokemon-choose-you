/**
 * TaskEditModal · create 模式（U22/FR-C1）：段头「＋ 新建任务」入口（三任务段常驻）+
 * 空态主行动 + 缺省值（分类 = 第一个启用 / 优先级 normal / 状态 = 排期?scheduled:inbox
 * 由 taskCreate 参数承载）+ 标题必填 trim 行内校验 + 只读禁用。
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { mockHost, type MockHost } from "../../src/client/rpc";
import { AdventureView, GrassView, RouteView } from "../../src/client/tasks/views";
import { TaskEditModal } from "../../src/client/tasks/TaskEditModal";
import { makeCategory, makeData, makeTask } from "./fixtures";

afterEach(cleanup);

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** 多轮 flush（向导等链式异步面共用口径） */
async function flushAll(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await flush();
  }
}

/** 共享分类夹具（PanelData 与 mock host 同源——taskCreate 缺省分类在 host 侧解析） */
const CATEGORIES = [
  makeCategory({ id: 1, name: "工作" }),
  makeCategory({ id: 2, name: "生活" }),
  makeCategory({ id: 3, name: "已停用", enabled: false }),
];

function renderModal(host: MockHost = mockHost({ categories: CATEGORIES }), readonly = false) {
  const data = makeData({
    categories: CATEGORIES,
    tasks: [makeTask({ id: 5 })],
  });
  const onClose = vi.fn();
  const onChanged = vi.fn();
  render(
    <ClientProvider client={host}>
      <I18nProvider locale="zh-Hans">
        <TaskEditModal data={data} readonly={readonly} onClose={onClose} onChanged={onChanged} />
      </I18nProvider>
    </ClientProvider>,
  );
  return { host, onClose, onChanged };
}

describe("TaskEditModal create 模式", () => {
  it("标题空（含 trim 后为空）提交 → 行内「标题不能为空」，表单不关、不调 taskCreate", async () => {
    const { host, onClose } = renderModal();
    expect(screen.getByTestId("task-create-form")).toBeTruthy();
    fireEvent.click(screen.getByText("保存"));
    expect(screen.getByText(/标题不能为空/)).toBeTruthy();
    await flushAll();
    expect(host.calls.some((c) => c.command === "taskCreate")).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("最小路径：仅填标题提交 → taskCreate 带缺省（分类 = 第一个启用，优先级 normal），弹窗关闭", async () => {
    const { host, onClose, onChanged } = renderModal();
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "  写周报  " } });
    fireEvent.click(screen.getByText("保存"));
    await flushAll();
    const create = host.calls.find((c) => c.command === "taskCreate");
    expect(create).toBeTruthy();
    expect(create?.params).toMatchObject({ title: "写周报", categoryId: 1, priority: "normal" });
    expect(onChanged).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("排期字段：填排期提交 → scheduledFor 入参（状态推导 scheduled 归 host）；标签全量替换关联入参", async () => {
    const { host } = renderModal();
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "周会" } });
    // 排期 = DateTimePicker 弹层（零键入）：空值打开即落默认时刻（当天/次日 18:00）
    fireEvent.click(screen.getByLabelText("排期"));
    fireEvent.click(screen.getByText("保存"));
    await flushAll();
    const create = host.calls.find((c) => c.command === "taskCreate");
    expect(create?.params).toMatchObject({
      title: "周会",
      scheduledFor: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    });
  });

  it("只读模式：提交键禁用（M7 禁用清单——新建任务表单提交）", () => {
    renderModal(mockHost(), true);
    expect((screen.getByText("保存") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("三任务段「＋ 新建任务」入口（U22）", () => {
  const data = makeData({ tasks: [makeTask({ id: 5 })] });

  function renderSegment(node: React.JSX.Element, host: MockHost) {
    render(
      <ClientProvider client={host}>
        <I18nProvider locale="zh-Hans">{node}</I18nProvider>
      </ClientProvider>,
    );
  }

  it("冒险/草丛/路线段头常驻入口（宿主档次按钮）；空态另有主行动 buttonDex", async () => {
    const host = mockHost({ tasks: [makeTask({ id: 5 })] });
    renderSegment(
      <AdventureView data={data} readonly={false} onOpen={() => undefined} onChanged={() => undefined} />,
      host,
    );
    expect(screen.getAllByTestId("task-create-entry").length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getAllByTestId("task-create-entry")[0]);
    expect(screen.getByTestId("task-create-form")).toBeTruthy();
  });

  it("空态主行动：草丛空 → 「＋ 新建任务」buttonDex + 升级文案", async () => {
    const host = mockHost();
    renderSegment(
      <GrassView data={makeData()} readonly={false} onOpen={() => undefined} onChanged={() => undefined} />,
      host,
    );
    expect(screen.getByText(/草丛静悄悄——在会话里说一句、用 ⚡发报，或直接新建第一只/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("task-create-empty"));
    expect(screen.getByTestId("task-create-form")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "第一只" } });
    fireEvent.click(screen.getByText("保存"));
    await flushAll();
    expect(host.calls.some((c) => c.command === "taskCreate")).toBe(true);
  });

  it("只读模式：段头与空态入口置灰", () => {
    renderSegment(
      <RouteView data={makeData()} readonly onOpen={() => undefined} onChanged={() => undefined} />,
      mockHost(),
    );
    expect((screen.getByTestId("task-create-empty") as HTMLButtonElement).disabled).toBe(true);
  });
});
