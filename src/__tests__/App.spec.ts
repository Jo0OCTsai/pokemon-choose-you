import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia } from "pinia";
import App from "../App.vue";
import { api } from "../api";
import { i18n } from "../i18n";
import { useSettingsStore } from "../stores/settings";
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
    applyChatMessageUpdate: vi.fn(),
    batchReviewChatMessages: vi.fn(),
    listTags: vi.fn(),
    searchTasks: vi.fn(),
    listTaskNotes: vi.fn(),
    addTaskNote: vi.fn(),
    deleteTaskNote: vi.fn(),
    listTaskLogs: vi.fn(),
    createTag: vi.fn(),
    updateTag: vi.fn(),
    deleteTag: vi.fn(),
    listAllSettings: vi.fn(),
    testAiConfig: vi.fn(),
    openAgentHistory: vi.fn(),
    testFeishuConfig: vi.fn(),
    triggerFeishuPoll: vi.fn(),
    syncTodoist: vi.fn(),
    getIntegrationHealth: vi.fn(),
    listLogEntries: vi.fn(),
    buildSupportReport: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
    setCategoryEnabled: vi.fn(async () => {}),
    openMainWindow: vi.fn(),
    consumeQuickCapture: vi.fn(),
    checkUpdate: vi.fn(),
    installUpdate: vi.fn(),
    listBackups: vi.fn(),
    createBackupNow: vi.fn(),
    restoreBackup: vi.fn(),
    listAgentSessions: vi.fn(),
    exportJson: vi.fn(),
    importJson: vi.fn(),
    exportTasksCsv: vi.fn(),
    exportDailyMd: vi.fn(),
    openExportsDir: vi.fn(),
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

const categories = [
  { id: 1, name: "工作", pokemon: "皮卡丘", sprite: "pikachu", enabled: true },
  { id: 2, name: "学习", pokemon: "可达鸭", sprite: "psyduck", enabled: true },
];

/** 测试内维护的迷你任务库 */
let tasks: Task[];
/** 本地今天 09:00 的 due 值（冒险页 = 进行中 + 当天到期含逾期） */
function dueToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T09:00`;
}
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
    tags: t.tags ?? [],
  }));
}

/** 让 mock api 表现得像真的 Rust 后端 */
function wireBackend() {
  tasks = [];
  categories.forEach((c) => (c.enabled = true));
  vi.mocked(api.listCategories).mockResolvedValue(categories);
  vi.mocked(api.setCategoryEnabled).mockImplementation(async (id: number, enabled: boolean) => {
    const c = categories.find((x) => x.id === id);
    if (c) c.enabled = enabled;
  });
  vi.mocked(api.listTags).mockResolvedValue([]);
  vi.mocked(api.listChatMessages).mockResolvedValue([]);
  vi.mocked(api.getIntegrationHealth).mockResolvedValue([]);
  vi.mocked(api.listLogEntries).mockResolvedValue([]);
  vi.mocked(api.buildSupportReport).mockResolvedValue("mock report");
  vi.mocked(api.batchReviewChatMessages).mockResolvedValue({ ok: 0, failed: [] });
  vi.mocked(api.searchTasks).mockImplementation(async (q: string) => tasks.filter((t) => t.title.includes(q)));
  vi.mocked(api.listTaskNotes).mockResolvedValue([]);
  vi.mocked(api.listTaskLogs).mockResolvedValue([]);
  vi.mocked(api.listAllSettings).mockResolvedValue({});
  vi.mocked(api.consumeQuickCapture).mockResolvedValue(false);
  vi.mocked(api.checkUpdate).mockResolvedValue("");
  vi.mocked(api.listBackups).mockResolvedValue([]);
  vi.mocked(api.listAgentSessions).mockResolvedValue([]);
  vi.mocked(api.exportJson).mockResolvedValue("pokemon-knock-full-x.json");
  vi.mocked(api.importJson).mockResolvedValue(0);
  vi.mocked(api.exportTasksCsv).mockResolvedValue("pokemon-knock-tasks-x.csv");
  vi.mocked(api.exportDailyMd).mockResolvedValue("pokemon-knock-daily-x.md");
  vi.mocked(api.openExportsDir).mockResolvedValue(undefined);
  vi.mocked(api.installUpdate).mockResolvedValue(undefined);
  vi.mocked(api.listTasks).mockImplementation(async (filter: string) => {
    if (filter === "done") return tasks.filter((t) => t.status === "done" || t.status === "cancelled");
    if (filter === "open") return tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
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
      tags: [],
    };
    tasks.push(t);
    return t;
  });
  vi.mocked(api.updateTask).mockImplementation(async (patch) => {
    const t = tasks.find((x) => x.id === patch.id)!;
    Object.assign(t, patch);
    if (patch.status === "done" && !t.completedAt) t.completedAt = "2026-09-12T10:00:00Z";
    if (patch.status === "cancelled" && !t.cancelledAt) t.cancelledAt = "2026-09-12T10:00:00Z";
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
  const w = mount(App, { global: { plugins: [createPinia(), i18n] } });
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
    expect(labels[1]).toContain("路线");
    expect(labels[2]).toContain("草丛");
    expect(labels[3]).toContain("图鉴");
    expect(labels[4]).toContain("收音机");
  });

  it("列表渲染任务条目：编号、标题、分类徽章", async () => {
    tasks = seed([
      { title: "写周报", status: "scheduled", dueAt: dueToday() },
      { title: "背单词", status: "inbox" },
    ]);
    const w = await mountApp();
    // 冒险页 = 进行中 + 当天到期：草丛任务（无时间）不在此页
    const entries = w.findAll(".entry");
    expect(entries).toHaveLength(1);
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
    // 草丛任务（无时间）出现在草丛页而非冒险页
    await w.findAll(".menu-btn")[2].trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(w.findAll(".entry")).toHaveLength(1);
  });

  it("设置截止时间后按钮变「加入路线」，新建任务进路线（scheduled）", async () => {
    const w = await mountApp();
    // 默认无时间：按钮文案为「丢进草丛」
    expect(w.get("form.add button[type='submit']").text()).toContain("丢进草丛");
    // DexDateTime 选好时间后 v-model 更新 newDue
    await w.getComponent({ name: "DexDateTime" }).vm.$emit("update:modelValue", "2026-09-13T09:00");
    expect(w.get("form.add button[type='submit']").text()).toContain("加入路线");
    await w.get("form.add input").setValue("路线任务");
    await w.get("form.add").trigger("submit");
    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "路线任务", dueAt: "2026-09-13T09:00", scheduled: true }),
    );
  });

  it("完成/撤销任务：✔ 置 done 并写 completedAt，图鉴页可撤销", async () => {
    tasks = seed([
      { title: "今天做完", status: "scheduled", dueAt: dueToday() },
      { title: "还没做完", status: "scheduled", dueAt: dueToday() },
    ]);
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
    tasks = seed([{ title: "专注", status: "scheduled", dueAt: dueToday() }]);
    const w = await mountApp();
    await w.get(".ops .btn").trigger("click"); // ▶ 出发
    await new Promise((r) => setTimeout(r));
    expect(api.startTask).toHaveBeenCalledWith(1);
  });

  it("删除任务（放生）", async () => {
    tasks = seed([{ title: "放生我", status: "inbox" }]);
    const w = await mountApp();
    await w.findAll(".menu-btn")[2].trigger("click"); // 草丛页
    await new Promise((r) => setTimeout(r));
    await w.get(".ops .btn.del").trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(api.deleteTask).toHaveBeenCalledWith(1);
    expect(w.findAll(".entry")).toHaveLength(0);
  });

  it("搜索待办：输入关键词切换为跨库搜索结果", async () => {
    tasks = seed([
      { title: "写季度报告", status: "inbox" },
      { title: "修登录bug", status: "inbox" },
    ]);
    const w = await mountApp();
    await w.findAll(".menu-btn")[2].trigger("click"); // 草丛页
    await new Promise((r) => setTimeout(r));
    await w.get(".search-input").setValue("季度");
    await new Promise((r) => setTimeout(r));
    expect(api.searchTasks).toHaveBeenCalledWith("季度");
    expect(w.findAll(".entry")).toHaveLength(1);
    expect(w.get(".entry .title").text()).toBe("写季度报告");
    // 清空关键词回到当前页列表
    await w.get(".search-input").setValue("");
    await new Promise((r) => setTimeout(r));
    expect(w.findAll(".entry")).toHaveLength(2);
  });

  it("编辑弹窗：全字段编辑并保存", async () => {
    vi.mocked(api.listTags).mockResolvedValue([{ id: 3, name: "重要", description: "核心目标" }]);
    tasks = seed([{ title: "写周报", status: "scheduled", dueAt: dueToday() }]);
    const w = await mountApp();
    const editBtn = w.findAll(".entry .ops .btn").find((b) => b.text() === "✎")!;
    await editBtn.trigger("click");
    expect(w.get(".card h3").text()).toContain("编辑待办");
    expect(w.text()).toContain("跟进记录");
    expect(w.text()).toContain("操作历史"); // 历史区块可见
    expect(w.text()).toContain("重要"); // 标签可选
    await w.get(".card input").setValue("新标题");
    vi.mocked(api.updateTask).mockResolvedValue(tasks[0]);
    await w.findAll(".card .btn-row .btn")[0].trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(api.updateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 1, title: "新标题", tagIds: [] }));
    expect(api.updateTask).toHaveBeenCalledWith(expect.not.objectContaining({ status: expect.anything() }));
  });

  it("收音机页显示全部电波（含无待办消息）并可捕捉", async () => {
    tasks = seed([]);
    vi.mocked(api.listChatMessages).mockResolvedValue([
      {
        id: 7,
        messageId: "m1",
        chatName: "项目群",
        sender: "张三",
        content: "明天上午10点开周会",
        suggestedTitle: "参加周会",
        suggestedCategory: "工作",
        suggestedDue: "2026-09-13T10:00",
        suggestedPriority: "high",
        suggestedNote: null,
        suggestedTags: ["重要"],
        aiStatus: "todo",
        reviewStatus: "pending",
        taskId: null,
        createdAt: "2026-09-11T00:00:00Z",
      },
      {
        id: 8,
        messageId: "m2",
        chatName: "项目群",
        sender: "李四",
        content: "哈哈哈",
        suggestedTitle: null,
        suggestedCategory: null,
        suggestedDue: null,
        suggestedPriority: null,
        suggestedNote: null,
        suggestedTags: [],
        aiStatus: "none",
        reviewStatus: "pending",
        taskId: null,
        createdAt: "2026-09-11T00:01:00Z",
      },
    ]);
    const w = await mountApp();
    await w.findAll(".menu-btn")[4].trigger("click");
    const cards = w.findAll(".im-card");
    expect(cards).toHaveLength(2); // 未识别为待办的消息也展示
    expect(w.get(".im-content").text()).toContain("明天上午10点开周会");
    expect(w.text()).toContain("参加周会");
    expect(w.text()).toContain("无待办"); // AI 状态徽章可见
    // 第一张卡（倒序在前的 m2 无建议）没有捕捉按钮，捕捉按钮在 m1 卡上
    const catchBtn = w.findAll(".im-actions .btn").find((b) => b.text() === "◎ 捕捉")!;
    await catchBtn.trigger("click");
    expect(api.acceptChatMessage).toHaveBeenCalledWith(7);
  });

  it("收音机建议显示置信档位与理由；逃走可选原因码落反馈", async () => {
    tasks = seed([]);
    vi.mocked(api.listChatMessages).mockResolvedValue([
      {
        id: 9,
        messageId: "m9",
        chatName: "项目群",
        sender: "张三",
        content: "明天上午10点开周会",
        suggestedTitle: "参加周会",
        suggestedTags: [],
        suggestedReason: "张三明确安排了会议时间",
        suggestedConfidence: "high",
        aiStatus: "todo",
        reviewStatus: "pending",
        taskId: null,
        createdAt: "2026-09-11T00:00:00Z",
      },
    ]);
    const w = await mountApp();
    await w.findAll(".menu-btn")[4].trigger("click");
    expect(w.get(".sug-conf").text()).toBe("高置信");
    expect(w.text()).toContain("张三明确安排了会议时间");

    // 直接逃走：不填原因
    vi.mocked(api.dismissChatMessage).mockResolvedValue(undefined);
    await w
      .findAll(".im-actions .btn")
      .find((b) => b.text() === "✕ 逃走")!
      .trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(api.dismissChatMessage).toHaveBeenCalledWith(9, undefined);

    // ▾ 展开原因选择，选「已有类似待办」带原因码逃走
    vi.mocked(api.listChatMessages).mockResolvedValue([
      {
        id: 9,
        messageId: "m9",
        chatName: "项目群",
        sender: "张三",
        content: "明天上午10点开周会",
        suggestedTitle: "参加周会",
        suggestedTags: [],
        suggestedReason: "张三明确安排了会议时间",
        suggestedConfidence: "high",
        aiStatus: "todo",
        reviewStatus: "pending",
        taskId: null,
        createdAt: "2026-09-11T00:00:00Z",
      },
    ]);
    await w
      .findAll(".im-actions .btn")
      .find((b) => b.text() === "▾")!
      .trigger("click");
    expect(w.find(".escape-reasons").exists()).toBe(true);
    await w
      .findAll(".er-chip")
      .find((b) => b.text() === "已有类似待办")!
      .trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(api.dismissChatMessage).toHaveBeenCalledWith(9, "duplicate");
  });

  it("自然语言快速捕捉：预览识别结果，提交带解析字段，单击取消后按原文提交", async () => {
    tasks = seed([]);
    const w = await mountApp();
    const input = w.get("form.add input");
    await input.setValue("明天 17:00 交周报 #工作");
    expect(w.find(".nl-preview").exists()).toBe(true);
    expect(w.get(".nl-title").text()).toBe("「交周报」");
    expect(w.text()).toContain("🗂 工作");

    await w.get("form.add").trigger("submit");
    await new Promise((r) => setTimeout(r));
    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "交周报",
        dueAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T17:00$/),
        scheduled: true,
      }),
    );
    expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 1 }));

    // 单击「取消识别」后同文本按原文提交（不拆字段）
    await input.setValue("后天下午3点半 复盘会 #学习");
    await w.get(".nl-cancel").trigger("click");
    expect(w.find(".nl-preview").exists()).toBe(false);
    await w.get("form.add").trigger("submit");
    await new Promise((r) => setTimeout(r));
    expect(api.createTask).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: "后天下午3点半 复盘会 #学习",
        scheduled: false,
      }),
    );
  });

  it("设置页通用区：数据备份卡片可立即备份并展示列表", async () => {
    vi.mocked(api.listBackups).mockResolvedValue([
      { file: "pokemon-knock-20260913-080000.db", size: 20480, createdAt: "2026-09-13T08:00:00+08:00" },
    ]);
    vi.mocked(api.createBackupNow).mockResolvedValue("pokemon-knock-20260913-120000.db");
    const w = await mountApp();
    await w.findAll(".menu-btn")[5].trigger("click"); // 设置
    await w.findAll(".stab")[6].trigger("click"); // 通用
    await new Promise((r) => setTimeout(r)); // 挂载时异步拉取备份列表
    expect(w.text()).toContain("数据备份");
    expect(w.findAll(".backup-row")).toHaveLength(1);
    expect(w.text()).toContain("pokemon-knock-20260913-080000.db");

    await w
      .findAll(".btn")
      .find((b) => b.text() === "立即备份")!
      .trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(api.createBackupNow).toHaveBeenCalled();
    expect(w.text()).toContain("已备份 pokemon-knock-20260913-120000.db");
  });

  it("设置页通用区：导出三件套与打开目录", async () => {
    const w = await mountApp();
    await w.findAll(".menu-btn")[5].trigger("click"); // 设置
    await w.findAll(".stab")[6].trigger("click"); // 通用
    await w
      .findAll(".btn")
      .find((b) => b.text() === "全量 JSON")!
      .trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(api.exportJson).toHaveBeenCalled();
    expect(w.text()).toContain("已导出 pokemon-knock-full-x.json");

    await w
      .findAll(".btn")
      .find((b) => b.text() === "今日日报")!
      .trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(api.exportDailyMd).toHaveBeenCalledWith();
  });

  it("自然语言快速捕捉：设置关闭后不出现预览", async () => {
    tasks = seed([]);
    vi.mocked(api.listAllSettings).mockResolvedValue({ nl_capture_enabled: "false" });
    const w = await mountApp();
    await w.get("form.add input").setValue("明天 5pm 交周报");
    expect(w.find(".nl-preview").exists()).toBe(false);
  });

  it("编辑弹窗展示 Agent 执行记录（时长/成本/退出码）并可跳转会话", async () => {
    tasks = seed([{ title: "修登录bug", status: "inbox" }]);
    vi.mocked(api.listAgentSessions).mockResolvedValue([
      {
        id: 1,
        taskId: 1,
        agentId: "claude-code",
        agentName: "Claude Code",
        sessionId: "sess-1",
        command: "claude -p 修登录bug",
        exitCode: 0,
        status: "ok",
        durationMs: 61_000,
        costUsd: 0.12,
        inputTokens: 1000,
        outputTokens: 2000,
        createdAt: "2026-09-13T02:00:00Z",
      },
    ]);
    const w = await mountApp();
    await w.findAll(".menu-btn")[2].trigger("click"); // 草丛页
    await new Promise((r) => setTimeout(r));
    const editBtn = w.findAll(".entry .ops .btn").find((b) => b.text() === "✎")!;
    await editBtn.trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(w.text()).toContain("Agent 执行");
    expect(w.text()).toContain("用时 1m");
    expect(w.text()).toContain("$0.12");
    expect(w.text()).toContain("exit 0");
    await w.get(".run-open").trigger("click");
    expect(api.openAgentHistory).toHaveBeenCalledWith("claude-code", "sess-1");
  });

  it("逾期 fresh start：冒险页折叠为一行，可展开，一键归草丛清截止时间", async () => {
    tasks = seed([
      { title: "逾期的活", status: "scheduled", dueAt: "2026-09-10T09:00" },
      { title: "今天到期", status: "scheduled", dueAt: dueToday() },
    ]);
    const w = await mountApp();
    // 逾期被折叠：列表只见「今天到期」，折叠行带数量
    expect(w.findAll(".entry")).toHaveLength(1);
    expect(w.get(".overdue-toggle").text()).toContain("1");
    // 展开可见逾期条目
    await w.get(".overdue-toggle").trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(w.findAll(".entry")).toHaveLength(2);
    // 展开态一键归草丛：清截止时间
    vi.mocked(api.updateTask).mockResolvedValue(tasks[0]);
    await w.get(".overdue-fresh").trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(api.updateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 1, dueAt: null }));
  });

  it("任务卡截止时间显示相对距离并按临近程度变色", async () => {
    const overdue = new Date(Date.now() - 5 * 3_600_000);
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    tasks = seed([{ title: "逾期任务", status: "scheduled", dueAt: iso(overdue) }]);
    const w = await mountApp();
    const due = w.get(".entry .due");
    expect(due.text()).toContain("已逾期 5 小时");
    expect(due.classes()).toContain("due-overdue");
    // title 提示保留绝对时间
    expect(due.attributes("title")).toMatch(/\d{4}-\d{2}-\d{2}/);

    // 关闭开关回绝对时间
    const settings = useSettingsStore();
    settings.values.due_relative = "false";
    await new Promise((r) => setTimeout(r));
    expect(w.get(".entry .due").text()).not.toContain("已逾期");
  });

  it("设置页飞书引擎切换：lark-cli 模式隐藏 App ID/Secret 并显示指引", async () => {
    const w = await mountApp();
    await w.findAll(".menu-btn")[5].trigger("click"); // 设置
    await w.findAll(".stab")[4].trigger("click"); // 集成
    expect(w.text()).toContain("App ID");
    const settings = useSettingsStore();
    settings.values.feishu_engine = "cli";
    await new Promise((r) => setTimeout(r));
    expect(w.text()).not.toContain("App Secret");
    expect(w.text()).toContain("npm install -g @larksuite/cli");
    settings.values.feishu_engine = "builtin";
  });

  it("设置页七个分区可选且默认显示专注", async () => {
    const w = await mountApp();
    await w.findAll(".menu-btn")[5].trigger("click");
    const stabs = w.findAll(".stab");
    expect(stabs).toHaveLength(7);
    expect(w.text()).toContain("番茄钟");
    await stabs[3].trigger("click"); // 显示
    expect(w.text()).toContain("日期格式");
    await stabs[1].trigger("click"); // 分类
    expect(w.text()).toContain("皮卡丘");
  });

  it("诊断页展示集成健康与日志，支持报告可复制", async () => {
    vi.mocked(api.getIntegrationHealth).mockResolvedValue([
      {
        provider: "feishu",
        configured: true,
        enabled: true,
        status: "degraded",
        lastSuccessAt: "2026-09-12T08:00:00Z",
        lastError: "poll failed: 500",
        lastErrorAt: "2026-09-12T09:00:00Z",
        consecutiveFailures: 1,
        nextPollAt: Date.now() + 60_000,
        pendingCount: 3,
        primaryAgent: "",
      },
      {
        provider: "ai",
        configured: true,
        enabled: true,
        status: "ok",
        lastSuccessAt: "2026-09-12T09:00:00Z",
        lastError: null,
        lastErrorAt: null,
        consecutiveFailures: 0,
        nextPollAt: null,
        pendingCount: 0,
        primaryAgent: "Claude Code",
      },
    ]);
    vi.mocked(api.listLogEntries).mockResolvedValue([
      { time: "2026-09-12 08:00:00", level: "info", target: "app_lib", message: "db migrated to v8" },
      { time: "2026-09-12 09:00:00", level: "warn", target: "app_lib::feishu", message: "feishu poll failed: 500" },
    ]);
    const w = await mountApp();
    await w.findAll(".menu-btn")[5].trigger("click");
    await w.findAll(".stab")[5].trigger("click"); // 诊断
    expect(w.text()).toContain("飞书电波");
    expect(w.text()).toContain("降级重试中");
    expect(w.text()).toContain("待确认建议 3");
    expect(w.text()).toContain("分类 Agent：Claude Code");
    // 日志倒序：最新（warn）在最上
    expect(w.findAll(".log-line")[0].text()).toContain("feishu poll failed");
    expect(api.listLogEntries).toHaveBeenCalled();

    const reportBtn = w.findAll(".btn").find((b) => b.text().includes("复制支持报告"))!;
    await reportBtn.trigger("click");
    expect(api.buildSupportReport).toHaveBeenCalled();
  });

  it("设置页集成分区：AI agent 配置增删、主 agent 选择与测试链路", async () => {
    const w = await mountApp();
    await w.findAll(".menu-btn")[5].trigger("click");
    await w.findAll(".stab")[4].trigger("click"); // 集成
    expect(w.text()).toContain("AI Agent CLI");

    // 默认无 agent；按预设添加一个（Claude Code 预设填充命令与参数）
    expect(w.findAll(".agent-block")).toHaveLength(0);
    await w
      .findAll(".btn")
      .find((b) => b.text().includes("添加 Agent"))!
      .trigger("click");
    const blocks = w.findAll(".agent-block");
    expect(blocks).toHaveLength(1);
    const cmd = blocks[0].find(".agent-cmd").element as HTMLInputElement;
    expect(cmd.value).toBe("claude");
    expect(w.html()).toContain("-p {prompt}"); // 附加参数预设（i18n 字面量转义后渲染）

    // 选为主 agent 并点测试：先落库（setSetting 带 ai_agents JSON）再调后端测试
    await blocks[0].find('input[name="primary-agent"]').setValue();
    await w
      .findAll(".btn")
      .find((b) => b.text() === "测试")!
      .trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(api.setSetting).toHaveBeenCalledWith("ai_agents", expect.stringContaining("claude"));
    expect(api.setSetting).toHaveBeenCalledWith("ai_agent_id", expect.any(String));
    expect(api.testAiConfig).toHaveBeenCalledTimes(1);

    // 删除后列表清空
    await w
      .findAll(".btn")
      .find((b) => b.text() === "删除")!
      .trigger("click");
    expect(w.findAll(".agent-block")).toHaveLength(0);
  });

  it("AI agent 支持配置 SSH 远程执行并序列化进 ai_agents", async () => {
    const w = await mountApp();
    await w.findAll(".menu-btn")[5].trigger("click"); // 设置
    await w.findAll(".stab")[4].trigger("click"); // 集成
    // 添加一个 Claude Code 预设
    await w
      .findAll(".btn")
      .find((b) => b.text().includes("添加 Agent"))!
      .trigger("click");
    const block = w.findAll(".agent-block")[0];
    // 开启 SSH：出现 host/port/key 输入
    const sshToggle = block
      .findAll('input[type="checkbox"]')
      .find((c) => (c.element as HTMLInputElement).closest(".chk-line"))!;
    await sshToggle.setValue(true);
    expect(block.find(".ssh-row").exists()).toBe(true);
    const [host, , key] = block.findAll(".ssh-row input");
    await host.setValue("dev@buildbox");
    await key.setValue("~/.ssh/id_ed25519");
    // 保存：ai_agents JSON 携带 remote
    await block
      .findAll(".btn")
      .find((b) => b.text() === "保存")!
      .trigger("click");
    await new Promise((r) => setTimeout(r));
    const saved = vi.mocked(api.setSetting).mock.calls.find((c) => c[0] === "ai_agents")?.[1] ?? "";
    const parsed = JSON.parse(saved);
    expect(parsed[0].remote).toMatchObject({
      host: "dev@buildbox",
      port: 22,
      keyPath: "~/.ssh/id_ed25519",
    });
    // 关闭 SSH：remote 清空
    await sshToggle.setValue(false);
    expect(block.find(".ssh-row").exists()).toBe(false);
  });

  it("设置页分类分区：进入即列出内置分类，停用开关调用后端", async () => {
    const w = await mountApp();
    await w.findAll(".menu-btn")[5].trigger("click");
    await w.findAll(".stab")[1].trigger("click"); // 分类
    const rows = w.findAll(".cat-row");
    expect(rows).toHaveLength(2); // 进入分区即加载分类列表（回归：曾显示为空）
    // 停用第一个分类
    await rows[0].get(".dex-toggle").trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(api.setCategoryEnabled).toHaveBeenCalledWith(1, false);
    // 保存成功后编辑行重建，重新查询确认停用置灰
    expect(w.findAll(".cat-row")[0].classes()).toContain("off");
  });

  // ---- 两窗口状态同步：主面板跟随 tasks-changed 事件 ----

  it("桌宠侧改动广播 tasks-changed 后，主面板列表与进度同步刷新", async () => {
    tasks = seed([{ title: "原有任务", status: "scheduled", dueAt: dueToday() }]);
    const w = await mountApp();
    expect(w.findAll(".entry")).toHaveLength(1);
    expect(w.text()).toContain("CAUGHT 0/1");

    tasks = seed([
      { title: "原有任务", status: "scheduled", dueAt: dueToday() },
      { title: "桌宠完成的任务", status: "done" },
    ]);
    broadcast("tasks-changed");
    await new Promise((r) => setTimeout(r));
    expect(w.findAll(".entry")).toHaveLength(1);
    expect(w.text()).toContain("CAUGHT 1/2");
  });

  // ---- 状态机 v4：页面过滤规则与逃走流程 ----

  it("冒险页只显示进行中与当天（含逾期）到期；路线页显示全部未完任务", async () => {
    const future = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
    tasks = seed([
      { title: "未来任务", status: "scheduled", dueAt: `${future}T09:00` },
      { title: "今天到期", status: "scheduled", dueAt: dueToday() },
      { title: "进行中", status: "active" },
      { title: "草丛任务", status: "inbox" },
    ]);
    const w = await mountApp();
    // 冒险页：今天到期 + 进行中（未来与草丛不显示）
    expect(
      w
        .findAll(".entry .title")
        .map((e) => e.text())
        .sort(),
    ).toEqual(["今天到期", "进行中"]);

    await w.findAll(".menu-btn")[1].trigger("click"); // 路线页
    await new Promise((r) => setTimeout(r));
    expect(
      w
        .findAll(".entry .title")
        .map((e) => e.text())
        .sort(),
    ).toEqual(["今天到期", "未来任务", "进行中"]);

    await w.findAll(".menu-btn")[2].trigger("click"); // 草丛页
    await new Promise((r) => setTimeout(r));
    expect(w.findAll(".entry .title").map((e) => e.text())).toEqual(["草丛任务"]);
  });

  it("逃走流程：取消后只在图鉴页出现，可筛选，可撤销恢复", async () => {
    tasks = seed([{ title: "不做了", status: "scheduled", dueAt: dueToday() }]);
    const w = await mountApp();
    const escBtn = w.findAll(".entry .ops .btn").find((b) => b.text() === "🚪")!;
    await escBtn.trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(api.updateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 1, status: "cancelled" }));
    // 取消后不在冒险页，逃走不计入捕捉进度
    expect(w.findAll(".entry")).toHaveLength(0);
    expect(w.text()).toContain("CAUGHT 0/0");

    await w.findAll(".menu-btn")[3].trigger("click"); // 图鉴页
    await new Promise((r) => setTimeout(r));
    expect(w.findAll(".entry")).toHaveLength(1);
    expect(w.text()).toContain("已逃走");

    // 筛选"已捕捉"时隐藏逃走任务
    const filterBtns = w.findAll(".filter-btn");
    await filterBtns[1].trigger("click");
    expect(w.findAll(".entry")).toHaveLength(0);
    await filterBtns[2].trigger("click"); // 只看已逃走
    expect(w.findAll(".entry")).toHaveLength(1);

    // 撤销恢复
    await w.get(".entry .ops .btn").trigger("click"); // ↩ 撤销
    await new Promise((r) => setTimeout(r));
    expect(api.updateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 1, status: "scheduled" }));
  });
});
