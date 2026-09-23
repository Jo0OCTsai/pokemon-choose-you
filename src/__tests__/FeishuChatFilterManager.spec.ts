import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import FeishuChatFilterManager from "../components/FeishuChatFilterManager.vue";
import { api } from "../api";
import { i18n } from "../i18n";
import { useSettingsStore } from "../stores/settings";
import type { FeishuChatFilterOverview, FeishuChatFilterView } from "../types";

vi.mock("../api", () => ({
  api: {
    getFeishuChatFilterOverview: vi.fn(),
    setFeishuChatFilter: vi.fn(),
    triggerFeishuPoll: vi.fn(async () => 3),
  },
  errorMessage: vi.fn((e: unknown) => `前缀${e instanceof Error ? e.message : String(e)}`),
}));

/** 捕获注册的 Tauri 事件监听，模拟后端广播（feishu-chat-filter-changed / settings-changed） */
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
function broadcast(event: string) {
  (eventHandlers.get(event) ?? []).forEach((cb) => cb({ event, id: 0, payload: null }));
}

function view(partial: Partial<FeishuChatFilterView> & { chatId: string; chatName: string }): FeishuChatFilterView {
  return {
    chatType: "group",
    muteOutcome: "unmuted",
    preference: "follow",
    effective: "pull",
    source: "follow",
    updatedAt: "2026-09-23T08:00:00+00:00",
    ...partial,
  };
}

function overview(chats: FeishuChatFilterView[], ageMin = 1): FeishuChatFilterOverview {
  return {
    chats,
    counts: {
      total: chats.length,
      pulling: chats.filter((c) => c.effective === "pull").length,
      filtered: chats.filter((c) => c.effective === "filter").length,
      manual: chats.filter((c) => c.preference !== "follow").length,
    },
    snapshotAt: new Date(Date.now() - ageMin * 60000).toISOString(),
  };
}

/** 默认种子：1 手动过滤群 + 1 跟随群 + 1 降级 bot */
function seedChats(): FeishuChatFilterView[] {
  return [
    view({ chatId: "c1", chatName: "团队群" }),
    view({ chatId: "c2", chatName: "灌水群", preference: "always_filter", effective: "filter", source: "manual" }),
    view({ chatId: "c3", chatName: "告警机器人", chatType: "bot", muteOutcome: "unknown", source: "followDegraded" }),
  ];
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

async function mountManager(opts: { enabled?: boolean; intervalSec?: number } = {}): Promise<VueWrapper> {
  const pinia = createPinia();
  setActivePinia(pinia);
  const settings = useSettingsStore();
  settings.values.feishu_enabled = opts.enabled === false ? "false" : "true";
  if (opts.intervalSec) settings.values.feishu_poll_interval = String(opts.intervalSec);
  const w = mount(FeishuChatFilterManager, { global: { plugins: [pinia, i18n] } });
  await flush();
  return w;
}

beforeEach(() => {
  vi.clearAllMocks();
  eventHandlers.clear();
  vi.mocked(api.getFeishuChatFilterOverview).mockResolvedValue(overview(seedChats()));
  // set 默认回声：返回手动合并视图（具体测试按需覆盖名字等字段）
  vi.mocked(api.setFeishuChatFilter).mockImplementation((chatId, preference) =>
    Promise.resolve(
      view({
        chatId,
        chatName: chatId,
        preference,
        effective: preference === "always_filter" ? "filter" : "pull",
        source: "manual",
      }),
    ),
  );
});

describe("FeishuChatFilterManager 会话过滤卡", () => {
  it("挂载即本地读取并渲染：手动置顶排序、类型徽章、双信息行、摘要计数", async () => {
    const w = await mountManager();
    expect(api.getFeishuChatFilterOverview).toHaveBeenCalledTimes(1);
    const rows = w.findAll(".cf-row");
    expect(rows).toHaveLength(3);
    // 排序：手动设置置顶 → 其余按类型（群 → bot）
    expect(rows[0].get(".cf-name").text()).toBe("灌水群");
    expect(rows[1].get(".cf-name").text()).toBe("团队群");
    expect(rows[2].get(".cf-name").text()).toBe("告警机器人");
    // 类型徽章复用 im.type.*
    expect(rows[0].get(".cf-badge").text()).toBe("群聊");
    expect(rows[2].get(".cf-badge").text()).toBe("机器人");
    // 生效 chip = 系统决策（过滤·手动 / 拉取·跟随 / 拉取·降级⚠）
    expect(rows[0].get(".cf-eff").classes()).toContain("mute");
    expect(rows[0].get(".cf-eff").text()).toContain("手动");
    expect(rows[1].get(".cf-eff").classes()).toContain("pull");
    expect(rows[1].get(".cf-eff").text()).toContain("跟随");
    expect(rows[2].get(".cf-eff").classes()).toContain("degraded");
    expect(rows[2].get(".cf-eff").text()).toContain("降级");
    // 摘要计数 + 新鲜时间戳
    expect(w.get(".cf-counts").text()).toBe("共 3 个会话：2 拉取 · 1 过滤 · 手动 1");
    expect(w.get(".cf-snaptime").text()).toContain("以上一轮拉取为准");
  });

  it("降级行：chip title 完整说明 + sr-only 节点经同行三段 aria-describedby 键盘可达", async () => {
    const w = await mountManager();
    const row = w.findAll(".cf-row")[2];
    expect(row.get(".cf-eff").attributes("title")).toContain("免打扰查询失败");
    const sr = row.get(".sr-only");
    expect(sr.attributes("id")).toBe("cf-dg-c3");
    expect(sr.text()).toContain("免打扰查询失败");
    expect(row.get(".cf-seg").attributes("aria-describedby")).toBe("cf-dg-c3");
    // 非降级行不挂 describedby
    expect(w.findAll(".cf-row")[0].get(".cf-seg").attributes("aria-describedby")).toBeUndefined();
  });

  it("三段选择器：radiogroup 语义 + roving tabindex 单停点 + 方向键/Home/End 即选即写", async () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    const w = await mountManager();
    const seg = w.findAll(".cf-seg")[1]; // 团队群（跟随态；灌水群手动置顶在首行）
    expect(seg.attributes("role")).toBe("radiogroup");
    expect(seg.attributes("aria-label")).toBe("团队群：过滤偏好");
    const btns = seg.findAll("button");
    expect(btns.map((b) => b.attributes("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(btns.map((b) => b.attributes("tabindex"))).toEqual(["0", "-1", "-1"]);

    // ArrowRight：即移动并选中（与点击同一写入路径）
    await seg.trigger("keydown", { key: "ArrowRight" });
    await flush();
    expect(api.setFeishuChatFilter).toHaveBeenCalledWith("c1", "always_pull");
    // End 跳末段、Home 跳首段（当前已选中则仅移动焦点，不重复写）
    await seg.trigger("keydown", { key: "End" });
    await flush();
    expect(api.setFeishuChatFilter).toHaveBeenLastCalledWith("c1", "always_filter");
    await seg.trigger("keydown", { key: "Home" });
    await flush();
    expect(api.setFeishuChatFilter).toHaveBeenLastCalledWith("c1", "follow");
    // 键盘写入后焦点跟随当前选中段（roving 不丢焦；test-utils 离屏挂载，经 focus 调用断言）
    const focused = focusSpy.mock.instances.at(-1) as HTMLElement | undefined;
    expect(focused?.getAttribute("aria-checked")).toBe("true");
    expect(focused?.textContent).toBe("跟随");
    focusSpy.mockRestore();
  });

  it("乐观写入：三段即时切换，成功后用返回行视图校正 chip 与计数", async () => {
    const w = await mountManager();
    let resolve!: (v: FeishuChatFilterView) => void;
    vi.mocked(api.setFeishuChatFilter).mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const btns = w.findAll(".cf-seg")[1].findAll("button"); // 团队群（跟随）
    await btns[2].trigger("click"); // → 过滤
    // 乐观：不等命令返回，选中态已切换（手动计数随草稿偏好即时 +1）
    expect(btns[2].attributes("aria-checked")).toBe("true");
    expect(w.get(".cf-counts").text()).toBe("共 3 个会话：2 拉取 · 1 过滤 · 手动 2");
    resolve(
      view({ chatId: "c1", chatName: "团队群", preference: "always_filter", effective: "filter", source: "manual" }),
    );
    await flush();
    // 返回值校正：chip 变「🔇 过滤 · 手动」，摘要计数同步（生效状态切换）
    expect(w.findAll(".cf-eff")[1].classes()).toContain("mute");
    expect(w.findAll(".cf-eff")[1].text()).toContain("手动");
    expect(w.get(".cf-counts").text()).toBe("共 3 个会话：1 拉取 · 2 过滤 · 手动 2");
    expect(w.find(".cf-toast").exists()).toBe(false);
  });

  it("写入失败：该行回滚为原选中态 + role=status 错误 toast（技术原文不吞）", async () => {
    const w = await mountManager();
    vi.mocked(api.setFeishuChatFilter).mockRejectedValueOnce(new Error("db locked"));
    const btns = w.findAll(".cf-seg")[1].findAll("button"); // 团队群（跟随）
    await btns[1].trigger("click"); // → 拉取
    await flush();
    expect(btns[0].attributes("aria-checked")).toBe("true"); // 回滚
    expect(w.get(".cf-counts").text()).toBe("共 3 个会话：2 拉取 · 1 过滤 · 手动 1");
    const toast = w.get(".cf-toast");
    expect(toast.attributes("role")).toBe("status");
    expect(toast.text()).toContain("设置未生效");
    expect(toast.text()).toContain("db locked");
  });

  it("搜索与筛选 chips：本地过滤即时生效，摘要计数保持全量统计", async () => {
    const w = await mountManager();
    // 搜索：名称子串（团队群 / 灌水群 命中「群」，告警机器人不命中）
    await w.get(".cf-search").setValue("群");
    expect(w.findAll(".cf-row")).toHaveLength(2);
    await w.get(".cf-search").setValue("团队");
    expect(w.findAll(".cf-row")).toHaveLength(1);
    expect(w.get(".cf-counts").text()).toBe("共 3 个会话：2 拉取 · 1 过滤 · 手动 1");
    await w.get(".cf-search").setValue("");
    // 筛选 chip：被过滤（覆盖手动 + 跟随两种过滤来源）
    const chips = w.findAll(".cf-chip");
    expect(chips.map((c) => c.text())).toEqual(["全部 3", "被过滤 1", "手动设置 1"]);
    await chips[1].trigger("click");
    expect(chips[1].attributes("aria-pressed")).toBe("true");
    expect(w.findAll(".cf-row")).toHaveLength(1);
    expect(w.findAll(".cf-row")[0].get(".cf-name").text()).toBe("灌水群");
    // 手动设置档
    await w.findAll(".cf-chip")[2].trigger("click");
    expect(w.findAll(".cf-row")).toHaveLength(1);
  });

  it("计数为 0 的 chip 禁用；选中档计数降 0 自动回退「全部」", async () => {
    const w = await mountManager({ intervalSec: 120 });
    // 快照内无跟随态被过滤行时「被过滤」=1；构造 manual=0 场景：把唯一手动行改回跟随
    vi.mocked(api.setFeishuChatFilter).mockResolvedValue(
      view({ chatId: "c2", chatName: "灌水群", preference: "follow", effective: "filter", source: "follow" }),
    );
    const chips = w.findAll(".cf-chip");
    // 手动档当前 1 条 → 选中
    await chips[2].trigger("click");
    expect(w.findAll(".cf-row")).toHaveLength(1);
    // 唯一手动行点回「跟随」→ manual 降 0 → 选中档自动回退「全部」，列表非空无空态
    const btns = w.findAll(".cf-row")[0].findAll(".cf-seg button");
    await btns[0].trigger("click");
    await flush();
    const after = w.findAll(".cf-chip");
    expect(after[2].attributes("disabled")).toBeDefined(); // 手动设置 0 → 禁用
    expect(after[0].attributes("aria-pressed")).toBe("true"); // 回退全部
    expect(w.findAll(".cf-row")).toHaveLength(3);
  });

  it("四种空态可区分：未启用 / 无快照（带立即拉取）/ 快照为空 / 搜索无匹配", async () => {
    // 未启用：不取数，仅引导文案
    const w0 = await mountManager({ enabled: false });
    expect(api.getFeishuChatFilterOverview).not.toHaveBeenCalled();
    expect(w0.get(".cf-statebox").text()).toContain("启用飞书后台轮询后");
    expect(w0.find(".cf-row").exists()).toBe(false);
    w0.unmount();

    // 无快照：snapshotAt=null + 按钮（唯一带按钮的空态断言基准）
    vi.mocked(api.getFeishuChatFilterOverview).mockResolvedValueOnce({
      chats: [],
      counts: { total: 0, pulling: 0, filtered: 0, manual: 0 },
      snapshotAt: null,
    });
    const w1 = await mountManager();
    expect(w1.get(".cf-statebox").text()).toContain("还没有拉取快照");
    expect(w1.get(".cf-statebox .btn").text()).toBe("立即拉取一次");
    w1.unmount();

    // 快照为空：snapshotAt 有值 + 空列表
    vi.mocked(api.getFeishuChatFilterOverview).mockResolvedValueOnce({
      chats: [],
      counts: { total: 0, pulling: 0, filtered: 0, manual: 0 },
      snapshotAt: new Date().toISOString(),
    });
    const w2 = await mountManager();
    expect(w2.get(".cf-statebox").text()).toContain("上一轮拉取未发现会话");
    w2.unmount();

    // 搜索无匹配
    const w3 = await mountManager();
    await w3.get(".cf-search").setValue("不存在的会话");
    expect(w3.get(".cf-statebox").text()).toContain("没有匹配「不存在的会话」的会话");
    // 清空搜索恢复
    await w3.get(".cf-search").setValue("");
    expect(w3.findAll(".cf-row")).toHaveLength(3);
  });

  it("无快照空态点「立即拉取一次」：触发拉取并重读总览回就绪", async () => {
    vi.mocked(api.getFeishuChatFilterOverview)
      .mockResolvedValueOnce({ chats: [], counts: { total: 0, pulling: 0, filtered: 0, manual: 0 }, snapshotAt: null })
      .mockResolvedValueOnce(overview(seedChats()));
    const w = await mountManager();
    expect(w.get(".cf-statebox").text()).toContain("还没有拉取快照");
    await w.get(".cf-statebox .btn").trigger("click");
    await flush();
    expect(api.triggerFeishuPoll).toHaveBeenCalledTimes(1);
    expect(w.findAll(".cf-row")).toHaveLength(3);
    expect(w.get(".cf-toast").text()).toContain("本轮新增 3 条建议");
  });

  it("读取失败：错误行 + 技术原文 + 重试按钮，重试成功回就绪", async () => {
    vi.mocked(api.getFeishuChatFilterOverview).mockRejectedValueOnce(new Error("db busy"));
    const w = await mountManager();
    const box = w.get(".cf-statebox");
    expect(box.text()).toContain("会话列表读取失败");
    expect(box.text()).toContain("db busy");
    expect(box.get(".btn").text()).toBe("重试");
    await box.get(".btn").trigger("click");
    await flush();
    expect(w.findAll(".cf-row")).toHaveLength(3);
  });

  it("陈旧阈值随轮询间隔推导：max(5min, 2.5×interval)，15 分钟档不误报", async () => {
    // 默认 2 分钟档（阈值 5 分钟）：8 分钟龄 → ⚠ 横幅 + 分钟数 + 立即拉取
    const w = await mountManager();
    expect(w.find(".cf-snaptime").exists()).toBe(true);
    vi.mocked(api.getFeishuChatFilterOverview).mockResolvedValue(overview(seedChats(), 8));
    broadcast("feishu-chat-filter-changed");
    await flush();
    expect(w.get(".cf-stale-banner").text()).toContain("距上一轮拉取已 8 分钟");
    expect(w.get(".cf-stale-banner .btn").text()).toBe("立即拉取一次");
    w.unmount();

    // 15 分钟档（阈值 37.5 分钟）：20 分钟龄健康不误报，40 分钟升级横幅
    vi.mocked(api.getFeishuChatFilterOverview).mockResolvedValue(overview(seedChats(), 20));
    const w15 = await mountManager({ intervalSec: 900 });
    expect(w15.find(".cf-stale-banner").exists()).toBe(false);
    expect(w15.get(".cf-snaptime").text()).toContain("以上一轮拉取为准");
    vi.mocked(api.getFeishuChatFilterOverview).mockResolvedValue(overview(seedChats(), 40));
    broadcast("feishu-chat-filter-changed");
    await flush();
    expect(w15.get(".cf-stale-banner").text()).toContain("距上一轮拉取已 40 分钟");
  });

  it("事件刷新：feishu-chat-filter-changed 重拉数据且保留当前搜索词与筛选档", async () => {
    const w = await mountManager();
    await w.get(".cf-search").setValue("团队");
    await w.findAll(".cf-chip")[0].trigger("click"); // 全部
    // 新一轮快照：灌水群被解禁、新增一群
    vi.mocked(api.getFeishuChatFilterOverview).mockResolvedValue(
      overview([
        view({ chatId: "c1", chatName: "团队群" }),
        view({ chatId: "c2", chatName: "灌水群", preference: "always_pull", effective: "pull", source: "manual" }),
        view({ chatId: "c4", chatName: "项目群" }),
      ]),
    );
    broadcast("feishu-chat-filter-changed");
    await flush();
    // 工具行状态保留：搜索词未重置
    expect((w.get(".cf-search").element as HTMLInputElement).value).toBe("团队");
    expect(w.findAll(".cf-chip")[0].attributes("aria-pressed")).toBe("true");
    // 数据已刷新（仍只剩团队群命中搜索）
    expect(w.findAll(".cf-row")).toHaveLength(1);
    expect(w.get(".cf-counts").text()).toBe("共 3 个会话：3 拉取 · 0 过滤 · 手动 1");
  });

  it("停用联动：feishu_enabled 关闭立即转空·未启用，重新启用经事件回就绪", async () => {
    const w = await mountManager();
    expect(w.findAll(".cf-row")).toHaveLength(3);
    const settings = useSettingsStore();
    // 草稿关闭（开关就在上方卡片）：任意态 → 空·未启用，摘要/列表/横幅隐藏，不取数
    settings.values.feishu_enabled = "false";
    await flush();
    expect(w.get(".cf-statebox").text()).toContain("启用飞书后台轮询后");
    expect(w.find(".cf-list-box").exists()).toBe(false);
    expect(w.find(".cf-stale-banner").exists()).toBe(false);
    const callsBefore = vi.mocked(api.getFeishuChatFilterOverview).mock.calls.length;
    broadcast("feishu-chat-filter-changed");
    await flush();
    expect(vi.mocked(api.getFeishuChatFilterOverview).mock.calls.length).toBe(callsBefore); // 停用态不取数
    // 重新启用（settings-changed 路径）：重读总览回就绪
    settings.values.feishu_enabled = "true";
    await flush();
    expect(w.findAll(".cf-row")).toHaveLength(3);
  });
});
