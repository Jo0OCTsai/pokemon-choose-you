import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import App from "../App.vue";
import { api } from "../api";
import { i18n } from "../i18n";
import type { Task } from "../types";

vi.mock("../api", () => ({
  api: {
    listTasks: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    startTask: vi.fn(),
    pauseCurrentTask: vi.fn(),
    getCurrentTask: vi.fn(),
    addFocusSeconds: vi.fn(),
    listCategories: vi.fn(),
    setCategoryPokemon: vi.fn(),
    getSetting: vi.fn(),
    setSetting: vi.fn(),
    listImSuggestions: vi.fn(),
    acceptImSuggestion: vi.fn(),
    dismissImSuggestion: vi.fn(),
    listAllSettings: vi.fn(),
    testAiConfig: vi.fn(),
    testFeishuConfig: vi.fn(),
    triggerFeishuPoll: vi.fn(),
    syncTodoist: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
  },
}));

vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: vi.fn(async () => false),
  enable: vi.fn(),
  disable: vi.fn(),
}));

/** 捕获注册的 Tauri 事件监听，模拟后端数据变更广播 */
const eventHandlers = new Map<string, ((e: unknown) => void)[]>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, cb: (e: unknown) => void) => {
    const list = eventHandlers.get(event) ?? [];
    list.push(cb);
    eventHandlers.set(event, list);
    return () => eventHandlers.set(event, list.filter((h) => h !== cb));
  }),
}));
function broadcast(event: string, payload: unknown = null) {
  (eventHandlers.get(event) ?? []).forEach((cb) => cb({ event, id: 0, payload }));
}

const categories = [
  { id: 1, name: "工作", pokemon: "皮卡丘", sprite: "pikachu" },
  { id: 2, name: "学习", pokemon: "可达鸭", sprite: "psyduck" },
];

/** 测试内维护的迷你任务库 */
let tasks: Task[];
function seed(seeds: Partial<Task>[]): Task[] {
  return seeds.map((t, i) => ({
    id: i + 1,
    title: t.title ?? `任务${i + 1}`,
    note: null,
    categoryId: t.categoryId ?? 1,
    status: t.status ?? "inbox",
    priority: t.priority ?? "normal",
    dueAt: t.dueAt ?? null,
    remindAt: null,
    reminded: false,
    source: "local",
    externalId: null,
    createdAt: "2026-09-01T00:00:00Z",
    completedAt: null,
    focusSeconds: 0,
  }));
}

/** 让 mock api 表现得像真的 Rust 后端 */
function wireBackend() {
  tasks = [];
  vi.mocked(api.listCategories).mockResolvedValue(categories);
  vi.mocked(api.listImSuggestions).mockResolvedValue([]);
  vi.mocked(api.listAllSettings).mockResolvedValue({});
  vi.mocked(api.listTasks).mockImplementation(async (filter: string) => {
    if (filter === "done") return tasks.filter((t) => t.status === "done");
    if (filter === "open") return tasks.filter((t) => t.status !== "done");
    return tasks;
  });
  vi.mocked(api.createTask).mockImplementation(async (input) => {
    const t: Task = {
      id: tasks.length + 1,
      title: input.title,
      note: input.note ?? null,
      categoryId: input.categoryId ?? 1,
      status: input.scheduled ? "scheduled" : "inbox",
      priority: (input.priority as Task["priority"]) ?? "normal",
      dueAt: input.dueAt ?? null,
      remindAt: input.remindAt ?? null,
      reminded: false,
      source: "local",
      externalId: null,
      createdAt: "2026-09-01T00:00:00Z",
      completedAt: null,
      focusSeconds: 0,
    };
    tasks.push(t);
    return t;
  });
  vi.mocked(api.updateTask).mockImplementation(async (patch) => {
    const t = tasks.find((x) => x.id === patch.id)!;
    Object.assign(t, patch);
    if (patch.status === "done" && !t.completedAt) t.completedAt = "2026-09-12T10:00:00Z";
    return t;
  });
  vi.mocked(api.startTask).mockImplementation(async (id: number) => {
    tasks.forEach((t) => {
      if (t.status === "active" || t.status === "paused") t.status = "scheduled";
    });
    const t = tasks.find((x) => x.id === id)!;
    t.status = "active";
    return t;
  });
  vi.mocked(api.deleteTask).mockImplementation(async (id: number) => {
    tasks = tasks.filter((t) => t.id !== id);
  });
}

async function mountApp(): Promise<VueWrapper> {
  const w = mount(App, { global: { plugins: [i18n] } });
  await new Promise((r) => setTimeout(r));
  return w;
}

beforeEach(() => {
  vi.clearAllMocks();
  eventHandlers.clear();
  wireBackend();
});

describe("App 图鉴机主面板", () => {
  it("渲染六个菜单项", async () => {
    const w = await mountApp();
    const labels = w.findAll(".menu-btn").map((b) => b.text());
    expect(labels).toHaveLength(6);
    expect(labels[0]).toContain("冒险");
    expect(labels[3]).toContain("图鉴");
    expect(labels[4]).toContain("收音机");
  });

  it("列表渲染任务条目：编号、标题、分类徽章", async () => {
    tasks = seed([{ title: "写周报", status: "scheduled" }, { title: "背单词", status: "inbox" }]);
    const w = await mountApp();
    const entries = w.findAll(".entry");
    expect(entries).toHaveLength(2);
    expect(entries[0].get(".title").text()).toBe("写周报");
    expect(entries[0].get(".dex-no").text()).toBe("No.001");
    expect(entries[0].get(".badge").text()).toBe("工作");
    expect(w.text()).toContain("CAUGHT 0/2");
  });

  it("添加任务：默认进草丛（inbox），提交后清空输入并刷新", async () => {
    const w = await mountApp();
    await w.get("form.add input").setValue("新捕捉目标");
    await w.get("form.add").trigger("submit");
    await new Promise((r) => setTimeout(r));
    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "新捕捉目标", categoryId: 1, scheduled: false }),
    );
    expect((w.get("form.add input").element as HTMLInputElement).value).toBe("");
    expect(w.findAll(".entry")).toHaveLength(1);
  });

  it("切换草丛/路线开关后，新建任务进路线（scheduled）", async () => {
    const w = await mountApp();
    // DexToggle 的 offLabel 是"加入路线"，点它把 toInbox 置 false
    const toggle = w.getComponent({ name: "DexToggle" });
    await toggle.get("button").trigger("click");
    await w.get("form.add input").setValue("路线任务");
    await w.get("form.add").trigger("submit");
    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "路线任务", scheduled: true }),
    );
  });

  it("完成/撤销任务：✔ 置 done 并写 completedAt，图鉴页可撤销", async () => {
    tasks = seed([{ title: "今天做完", status: "scheduled" }, { title: "还没做完", status: "scheduled" }]);
    const w = await mountApp();
    const doneBtn = w.findAll(".entry .ops .btn").find((b) => b.text() === "✔")!;
    await doneBtn.trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(api.updateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 1, status: "done" }));
    expect(w.findAll(".entry")).toHaveLength(1);
    expect(w.text()).toContain("CAUGHT 1/2");

    await w.findAll(".menu-btn")[3].trigger("click"); // 图鉴（done）页
    await new Promise((r) => setTimeout(r));
    expect(w.findAll(".entry")).toHaveLength(1);
    expect(w.text()).toContain("已捕捉");
  });

  it("出发/暂停：调用专注模式命令", async () => {
    tasks = seed([{ title: "专注", status: "scheduled" }]);
    const w = await mountApp();
    await w.get(".ops .btn").trigger("click"); // ▶ 出发
    await new Promise((r) => setTimeout(r));
    expect(api.startTask).toHaveBeenCalledWith(1);
  });

  it("删除任务（放生）", async () => {
    tasks = seed([{ title: "放生我", status: "inbox" }]);
    const w = await mountApp();
    await w.get(".ops .btn.del").trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(api.deleteTask).toHaveBeenCalledWith(1);
    expect(w.findAll(".entry")).toHaveLength(0);
  });

  it("收音机页显示待办建议并可捕捉", async () => {
    tasks = seed([]);
    vi.mocked(api.listImSuggestions).mockResolvedValue([
      {
        id: 7,
        messageId: "m1",
        chatName: "项目群",
        sender: "张三",
        content: "明天上午10点开周会",
        suggestedTitle: "参加周会",
        suggestedCategory: "工作",
        suggestedDue: "2026-09-13T10:00",
        reviewStatus: "pending",
        createdAt: "2026-09-11T00:00:00Z",
      },
    ]);
    const w = await mountApp();
    await w.findAll(".menu-btn")[4].trigger("click");
    expect(w.get(".im-content").text()).toContain("明天上午10点开周会");
    expect(w.text()).toContain("参加周会");
    await w.get(".im-actions .btn").trigger("click"); // ◎ 捕捉
    expect(api.acceptImSuggestion).toHaveBeenCalledWith(7);
  });

  it("设置页五个分区可选且默认显示专注", async () => {
    const w = await mountApp();
    await w.findAll(".menu-btn")[5].trigger("click");
    const stabs = w.findAll(".stab");
    expect(stabs).toHaveLength(5);
    expect(w.text()).toContain("番茄钟");
    await stabs[2].trigger("click"); // 显示
    expect(w.text()).toContain("日期格式");
  });

  // ---- 两窗口状态同步：主面板跟随 tasks-changed 事件 ----

  it("桌宠侧改动广播 tasks-changed 后，主面板列表与进度同步刷新", async () => {
    tasks = seed([{ title: "原有任务", status: "scheduled" }]);
    const w = await mountApp();
    expect(w.findAll(".entry")).toHaveLength(1);
    expect(w.text()).toContain("CAUGHT 0/1");

    tasks = seed([
      { title: "原有任务", status: "scheduled" },
      { title: "桌宠完成的任务", status: "done" },
    ]);
    broadcast("tasks-changed");
    await new Promise((r) => setTimeout(r));
    expect(w.findAll(".entry")).toHaveLength(1);
    expect(w.text()).toContain("CAUGHT 1/2");
  });
});
