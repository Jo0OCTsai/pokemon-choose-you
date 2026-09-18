import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, getActivePinia, setActivePinia } from "pinia";
import ReviewWizard from "../components/ReviewWizard.vue";
import { api } from "../api";
import { i18n } from "../i18n";
import { useCategoriesStore } from "../stores/categories";
import { useTasksStore } from "../stores/tasks";
import type { Task } from "../types";

vi.mock("../api", () => ({
  api: {
    updateTask: vi.fn(async (patch: { id: number }) => ({ id: patch.id })),
    deleteTask: vi.fn(async () => {}),
    deleteTag: vi.fn(async () => {}),
    setSetting: vi.fn(async () => {}),
    // reload 用：测试里按需改写返回值（默认空）
    listTasks: vi.fn(async () => []),
    listChatMessages: vi.fn(async () => []),
    listTags: vi.fn(async () => []),
    listTagDimensions: vi.fn(async () => [
      { id: 1, key: "project", name: "项目", cardinality: "single", maxTags: 20, sort: 1, enabled: true },
      { id: 4, key: "topic", name: "主题", cardinality: "multi", maxTags: 30, sort: 4, enabled: true },
    ]),
    tagCheckup: vi.fn(async () => ({ merges: [], zombies: [], newDimensions: [], judged: false })),
    mergeTag: vi.fn(async () => {}),
    moveTagsToDimension: vi.fn(async () => {}),
  },
  errorMessage: vi.fn((e: unknown) => String(e)),
}));

function seed(seeds: Partial<Task>[]): Task[] {
  return seeds.map((t, i) => ({
    id: t.id ?? i + 1,
    title: t.title ?? `任务${i + 1}`,
    note: null,
    categoryId: t.categoryId ?? 1,
    status: t.status ?? "inbox",
    priority: "normal",
    dueAt: t.dueAt ?? null,
    remindAt: null,
    reminded: false,
    source: "local",
    externalId: null,
    createdAt: "2026-09-10T00:00:00Z",
    completedAt: t.completedAt ?? null,
    focusSeconds: t.focusSeconds ?? 0,
    tags: [],
  }));
}

async function mountWizard(open: Partial<Task>[] = [], done: Partial<Task>[] = []) {
  const tasks = useTasksStore(); // 绑定 beforeEach 里激活的同一个 pinia
  tasks.open = seed(open);
  tasks.done = seed(done);
  const pinia = getActivePinia();
  if (!pinia) throw new Error("pinia 未激活");
  const w = mount(ReviewWizard, { global: { plugins: [pinia, i18n] } });
  await new Promise((r) => setTimeout(r));
  return w;
}

beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  useCategoriesStore().list = [{ id: 1, name: "工作", pokemon: "皮卡丘", sprite: "pikachu", enabled: true }];
});

describe("ReviewWizard 训练家复盘", () => {
  it("总览统计本周捕捉/专注/路线/草丛", async () => {
    const w = await mountWizard(
      [
        { title: "路线任务", status: "scheduled", dueAt: "2026-09-14T09:00" },
        { title: "草丛任务", status: "inbox" },
      ],
      [{ title: "完成的", status: "done", completedAt: new Date().toISOString(), focusSeconds: 1500 }],
    );
    expect(w.text()).toContain("训练家复盘");
    expect(w.get(".stat-row").text()).toContain("1"); // 本周捕捉 1
    expect(w.text()).toContain("本周捕捉");
    expect(w.text()).toContain("25"); // 专注 25 分钟
    expect(w.text()).toContain("工作"); // 分类条
  });

  it("路线逐站复盘：完成/归草丛/逃走就地处置", async () => {
    // reload 返回剩余路线任务：完成 1 → 剩 [2,3]；归草丛 2 → 剩 [3]；逃走 3 → 空
    const remaining = seed([
      { id: 2, title: "第二站", status: "active" },
      { id: 3, title: "第三站", status: "scheduled", dueAt: "2026-09-15T09:00" },
    ]);
    vi.mocked(api.listTasks).mockImplementation(async () => remaining);

    const w = await mountWizard([
      { id: 1, title: "写周报", status: "scheduled", dueAt: "2026-09-14T09:00" },
      { id: 2, title: "第二站", status: "active" },
      { id: 3, title: "第三站", status: "scheduled", dueAt: "2026-09-15T09:00" },
    ]);
    // 总览 → 路线复盘
    await w
      .findAll(".btn")
      .find((b) => b.text() === "下一步")!
      .trigger("click");
    await new Promise((r) => setTimeout(r));
    await w
      .findAll(".btn")
      .find((b) => b.text().includes("✔"))!
      .trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(api.updateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 1, status: "done" }));

    // 归草丛 = 清截止时间（当前指向第二站）；reload 后只剩第三站
    vi.mocked(api.listTasks).mockImplementation(async () => [remaining[1]]);
    await w
      .findAll(".btn")
      .find((b) => b.text().includes("归草丛"))!
      .trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(api.updateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 2, dueAt: null }));

    // 逃走（第三站）
    await w
      .findAll(".btn")
      .find((b) => b.text().includes("🚪"))!
      .trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(api.updateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 3, status: "cancelled" }));
  });

  it("草丛批量归位：全选放生逐条删除", async () => {
    const w = await mountWizard([
      { title: "A", status: "inbox" },
      { title: "B", status: "inbox" },
    ]);
    // 走到草丛步骤
    await w
      .findAll(".btn")
      .find((b) => b.text() === "下一步")!
      .trigger("click"); // 总览 → 路线（空）
    await new Promise((r) => setTimeout(r));
    await w
      .findAll(".btn")
      .find((b) => b.text() === "下一步")!
      .trigger("click"); // 空路线 → 草丛（无待复盘项时按钮显示「下一步」）
    await new Promise((r) => setTimeout(r));
    expect(w.text()).toContain("全选草丛");

    await w.get(".grass-head input[type='checkbox']").trigger("change");
    await w
      .findAll(".btn")
      .find((b) => b.text().includes("批量放生"))!
      .trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(api.deleteTask).toHaveBeenCalledTimes(2);
    expect(w.text()).toContain("已放生 2 只");
  });

  it("收尾标记本周已复盘", async () => {
    const w = await mountWizard();
    for (let i = 0; i < 4; i++) {
      await w
        .findAll(".btn")
        .find((b) => b.text() === "下一步")!
        .trigger("click");
      await new Promise((r) => setTimeout(r));
    }
    await w
      .findAll(".btn")
      .find((b) => b.text().includes("结束复盘"))!
      .trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(api.setSetting).toHaveBeenCalledWith("review_last_done", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it("标签体检：合并建议与僵尸标签逐条处置", async () => {
    vi.mocked(api.tagCheckup).mockResolvedValue({
      merges: [
        {
          fromId: 11,
          fromName: "工作周报",
          intoId: 10,
          intoName: "周报",
          dimension: "topic",
          similarity: 0.86,
          judged: true,
          reason: "同一含义",
        },
      ],
      zombies: [{ id: 12, name: "幻觉标签", dimension: "topic", origin: "ai", createdAt: "2026-01-01T00:00:00Z" }],
      newDimensions: [],
      judged: true,
    });
    const w = await mountWizard();
    for (let i = 0; i < 3; i++) {
      await w
        .findAll(".btn")
        .find((b) => b.text() === "下一步")!
        .trigger("click");
      await new Promise((r) => setTimeout(r));
    }
    expect(w.text()).toContain("「工作周报」→「周报」");
    expect(w.text()).toContain("幻觉标签");
    expect(w.text()).toContain("AI 已复核");

    // 合并：调 mergeTag，行消失
    await w
      .findAll(".btn")
      .find((b) => b.text() === "合并")!
      .trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(api.mergeTag).toHaveBeenCalledWith(11, 10);
    expect(w.text()).not.toContain("「工作周报」→「周报」");

    // 放生僵尸：调 deleteTag，行消失
    await w
      .findAll(".btn")
      .find((b) => b.text().includes("放生"))!
      .trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(api.deleteTag).toHaveBeenCalledWith(12);
    expect(w.text()).toContain("词表很健康");
  });
});
