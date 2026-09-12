import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PetApp from "../PetApp.vue";
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
    listChatMessages: vi.fn(),
    acceptChatMessage: vi.fn(),
    dismissChatMessage: vi.fn(),
    forceCreateTodo: vi.fn(),
    listTags: vi.fn(),
    searchTasks: vi.fn(),
    listTaskNotes: vi.fn(),
    addTaskNote: vi.fn(),
    deleteTaskNote: vi.fn(),
    createTag: vi.fn(),
    updateTag: vi.fn(),
    deleteTag: vi.fn(),
    listAllSettings: vi.fn(),
    openMainWindow: vi.fn(),
    testAiConfig: vi.fn(),
    openAgentHistory: vi.fn(),
    testFeishuConfig: vi.fn(),
    triggerFeishuPoll: vi.fn(),
    syncTodoist: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
    consumeQuickCapture: vi.fn(),
    checkUpdate: vi.fn(),
    installUpdate: vi.fn(),
  },
}));

/** 捕获注册的 Tauri 事件监听，模拟后端数据变更广播 */
const eventHandlers = new Map<string, ((e: unknown) => void)[]>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, cb: (e: unknown) => void) => {
    const list = eventHandlers.get(event) ?? [];
    list.push(cb);
    eventHandlers.set(event, list);
    return () =>
      eventHandlers.set(
        event,
        list.filter((h) => h !== cb),
      );
  }),
}));
function broadcast(event: string, payload: unknown = null) {
  (eventHandlers.get(event) ?? []).forEach((cb) => cb({ event, id: 0, payload }));
}

const petWindowMock = { setSize: vi.fn(async () => {}), startDragging: vi.fn() };
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => petWindowMock,
}));

const categories = [
  { id: 1, name: "工作", pokemon: "皮卡丘", sprite: "pikachu", enabled: true },
  { id: 2, name: "学习", pokemon: "可达鸭", sprite: "psyduck", enabled: true },
];

function task(partial: Partial<Task>): Task {
  return {
    id: 1,
    title: "写周报",
    note: null,
    categoryId: 1,
    status: "active",
    priority: "normal",
    dueAt: null,
    remindAt: null,
    reminded: false,
    source: "local",
    externalId: null,
    createdAt: "2026-09-01T00:00:00Z",
    completedAt: null,
    focusSeconds: 0,
    tags: [],
    ...partial,
  };
}

let tasks: Task[];
let current: Task | null;

async function mountPet(): Promise<VueWrapper> {
  vi.mocked(api.listCategories).mockResolvedValue(categories);
  vi.mocked(api.getCurrentTask).mockImplementation(async () => current);
  vi.mocked(api.listTasks).mockImplementation(async () => tasks);
  const w = mount(PetApp, { global: { plugins: [createPinia(), i18n] } });
  await vi.advanceTimersByTimeAsync(1);
  return w;
}

/** 触发交互后刷新异步链（假定时器下不能用真实 setTimeout 等待） */
async function flush() {
  await vi.advanceTimersByTimeAsync(1);
  // 动态 import 命中模块缓存后经微任务结算，多排几轮确保链路走完
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 12, 10, 0, 0));
  vi.clearAllMocks();
  eventHandlers.clear();
  // 每个用例独立的 pinia + settings store（取代旧的模块级 reactive 手动清理）
  setActivePinia(createPinia());
  // 默认设置值，个别测试可在 mountPet 前覆盖 listAllSettings
  vi.mocked(api.listAllSettings).mockResolvedValue({});
  vi.mocked(api.addFocusSeconds).mockResolvedValue(undefined);
  tasks = [];
  current = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PetApp 桌宠", () => {
  it("无任务时显示待机气泡与默认精灵", async () => {
    const w = await mountPet();
    expect(w.get(".dialog-text").text()).toBe("今天的冒险还没开始，点击我挑个目标吧");
    expect(w.get(".pet-sprite").attributes("src")).toBe("/pokemon/pikachu.gif");
    expect(w.find(".pomo-pill").exists()).toBe(false);
  });

  it("有进行中任务且番茄钟开启时自动倒计时并上报专注时长", async () => {
    current = task({ id: 3, title: "写周报" });
    const w = await mountPet();
    expect(w.get(".dialog-text").text()).toContain("正在捕捉：写周报");
    const pill = w.get(".pomo-pill");
    expect(pill.text()).toContain("25:00");
    // 走 61 秒：应上报一次 60 秒专注
    await vi.advanceTimersByTimeAsync(61_000);
    expect(api.addFocusSeconds).toHaveBeenCalledWith(3, 60);
    expect(w.get(".pomo-pill .px").text()).toContain("23:59");
  });

  it("暂停按钮：停表并调用 pauseCurrentTask", async () => {
    current = task({});
    const w = await mountPet();
    await vi.advanceTimersByTimeAsync(5_000);
    await w.get(".pomo-btn").trigger("click"); // ⏸
    await flush();
    expect(api.pauseCurrentTask).toHaveBeenCalled();
    const after = w.get(".pomo-pill .px").text();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(w.get(".pomo-pill .px").text()).toBe(after);
  });

  it("完成按钮：置 done 并刷新", async () => {
    current = task({});
    const w = await mountPet();
    const done = w.findAll(".pomo-btn").find((b) => b.text() === "✔")!;
    await done.trigger("click");
    await flush();
    expect(api.updateTask).toHaveBeenCalledWith({ id: 1, status: "done" });
  });

  it("点击精灵展开快捷图鉴屏，列出候选任务", async () => {
    await import("@tauri-apps/api/dpi"); // 预热动态导入，toggleQuick 内的 import 走缓存
    current = task({ id: 1, status: "active" });
    tasks = [task({ id: 1, title: "进行中" }), task({ id: 2, title: "下一个", status: "scheduled" })];
    const w = await mountPet();
    expect(w.find(".quick-dex").exists()).toBe(false);
    await w.get(".sprite-hit").trigger("click");
    await vi.advanceTimersByTimeAsync(250); // 越过单击/双击区分延迟
    await flush();
    expect(w.find(".quick-dex").exists()).toBe(true);
    const items = w.findAll(".q-item");
    expect(items).toHaveLength(2);
    expect(items[1].get(".q-title").text()).toBe("下一个");
    expect(petWindowMock.setSize).toHaveBeenCalled();
  });

  it("快捷屏选择后出发：调用 startTask 并显示就决定是你了", async () => {
    current = task({ id: 1, status: "active" });
    tasks = [task({ id: 1, title: "进行中" }), task({ id: 2, title: "下一个", status: "scheduled" })];
    const w = await mountPet();
    await w.get(".sprite-hit").trigger("click");
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    await w.findAll(".q-item")[1].trigger("click"); // 选中
    await w.get(".quick-dex .ops .btn").trigger("click"); // ▶ 出发
    await flush();
    expect(api.startTask).toHaveBeenCalledWith(2);
    expect(w.get(".dialog-text").text()).toContain("就决定是你了");
  });

  it("快捷屏未选目标点出发：气泡提示先选目标，不调用 startTask", async () => {
    await import("@tauri-apps/api/dpi");
    current = null; // 无进行中任务 → 快捷屏默认不选中
    tasks = [task({ id: 2, title: "备选", status: "scheduled" })];
    const w = await mountPet();
    await w.get(".sprite-hit").trigger("click");
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    expect(w.find(".quick-dex").exists()).toBe(true);
    await w.get(".quick-dex .ops .btn").trigger("click"); // ▶ 出发
    await flush();
    expect(api.startTask).not.toHaveBeenCalled();
    expect(w.get(".dialog-text").text()).toBe("选一个捕捉目标吧！");
  });

  it("双击精灵：请求打开主窗口且不弹出快捷屏", async () => {
    const w = await mountPet();
    await w.get(".sprite-hit").trigger("dblclick");
    await flush();
    expect(api.openMainWindow).toHaveBeenCalled();
    expect(w.find(".quick-dex").exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(300); // 单击定时器已被取消，不会延迟弹出
    expect(w.find(".quick-dex").exists()).toBe(false);
  });

  it("番茄钟关闭时不自动倒计时", async () => {
    current = task({});
    vi.mocked(api.listAllSettings).mockResolvedValue({ pomodoro_enabled: "false" });
    const w = await mountPet();
    expect(w.find(".pomo-pill").exists()).toBe(false);
    expect(w.get(".dialog-text").text()).toContain("暂停中");
  });

  // ---- 两窗口状态同步：桌宠跟随 tasks-changed / settings-changed 事件 ----

  it("主程序开始任务后广播 tasks-changed，桌宠同步并开始倒计时", async () => {
    const w = await mountPet();
    expect(w.find(".pomo-pill").exists()).toBe(false);
    current = task({ id: 5, title: "主程序任务" });
    broadcast("tasks-changed");
    await flush();
    expect(w.get(".dialog-text").text()).toContain("正在捕捉：主程序任务");
    expect(w.get(".pomo-pill .px").text()).toContain("25:00");
    await vi.advanceTimersByTimeAsync(61_000);
    expect(api.addFocusSeconds).toHaveBeenCalledWith(5, 60);
  });

  it("主程序完成任务后广播 tasks-changed，桌宠收起番茄钟回待机", async () => {
    current = task({});
    const w = await mountPet();
    expect(w.find(".pomo-pill").exists()).toBe(true);
    current = null;
    broadcast("tasks-changed");
    await flush();
    expect(w.get(".dialog-text").text()).toBe("今天的冒险还没开始，点击我挑个目标吧");
    expect(w.find(".pomo-pill").exists()).toBe(false);
  });

  it("主程序保存设置后广播 settings-changed，桌宠去抖重载：番茄钟开关即时生效", async () => {
    current = task({});
    const w = await mountPet();
    expect(w.find(".pomo-pill").exists()).toBe(true);
    vi.mocked(api.listAllSettings).mockResolvedValue({ pomodoro_enabled: "false" });
    broadcast("settings-changed");
    await vi.advanceTimersByTimeAsync(250); // 越过 200ms 去抖
    await flush();
    expect(w.find(".pomo-pill").exists()).toBe(false);
  });

  it("主程序换分类精灵后广播 categories-changed，桌宠精灵跟着换", async () => {
    current = task({ categoryId: 2 });
    const w = await mountPet();
    expect(w.get(".pet-sprite").attributes("src")).toBe("/pokemon/psyduck.gif");
    current = task({ categoryId: 2 });
    vi.mocked(api.listCategories).mockResolvedValue([
      categories[0],
      { id: 2, name: "学习", pokemon: "妙蛙种子", sprite: "bulbasaur", enabled: true },
    ]);
    broadcast("categories-changed");
    await flush();
    expect(w.get(".pet-sprite").attributes("src")).toBe("/pokemon/bulbasaur.gif");
  });
});
