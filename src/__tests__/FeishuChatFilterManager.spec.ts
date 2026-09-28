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
    lastMessageAt: null,
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

/** 默认种子：1 手动过滤群（2 天前活跃）+ 1 跟随群（1 小时前活跃）+ 1 降级 bot（从未拉到消息） */
function seedChats(): FeishuChatFilterView[] {
  return [
    view({ chatId: "c1", chatName: "团队群", lastMessageAt: Date.now() - 3600_000 }),
    view({
      chatId: "c2",
      chatName: "灌水群",
      preference: "always_filter",
      effective: "filter",
      source: "manual",
      lastMessageAt: Date.now() - 2 * 86400_000,
    }),
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

/** DexSelect 操作：展开下拉取选项列表（保持展开）；选择第 index 项后自动收起 */
async function openOptions(w: VueWrapper, sel: string) {
  await w.get(`${sel} .ds-btn`).trigger("click");
  return w.findAll(`${sel} .ds-list li`);
}
async function pick(w: VueWrapper, sel: string, index: number) {
  if (!w.find(`${sel} .ds-list`).exists()) await w.get(`${sel} .ds-btn`).trigger("click");
  await w.findAll(`${sel} .ds-list li`)[index].trigger("click");
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
    // 排序：手动设置置顶 → 跟随行按最近活跃倒序 → 从未拉到消息的沉底
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

  it("排序：手动置顶 → 最近活跃倒序 → 无消息沉底（按名称）→ 名称兜底；类型不参与排序", async () => {
    vi.mocked(api.getFeishuChatFilterOverview).mockResolvedValue(
      overview([
        view({ chatId: "a", chatName: "旧群", lastMessageAt: 1000 }),
        view({ chatId: "b", chatName: "新群", chatType: "p2p", lastMessageAt: 9000 }),
        view({ chatId: "c", chatName: "乙死群" }),
        view({ chatId: "d", chatName: "甲死群", chatType: "p2p" }),
        view({ chatId: "e", chatName: "手动群", preference: "always_pull", source: "manual" }),
      ]),
    );
    const w = await mountManager();
    // 手动群置顶（无消息也置顶）→ 9000 > 1000 活跃倒序（跨类型，类型分组归筛选 chips）→ 死群沉底按名称
    expect(w.findAll(".cf-name").map((n) => n.text())).toEqual(["手动群", "新群", "旧群", "甲死群", "乙死群"]);
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

  it("搜索与状态筛选 chips（生效/偏好两组）：本地过滤正交组合，摘要计数保持全量统计", async () => {
    const w = await mountManager();
    // 搜索：名称子串（团队群 / 灌水群 命中「群」，告警机器人不命中）
    await w.get(".cf-search").setValue("群");
    expect(w.findAll(".cf-row")).toHaveLength(2);
    await w.get(".cf-search").setValue("");
    expect(w.get(".cf-counts").text()).toBe("共 3 个会话：2 拉取 · 1 过滤 · 手动 1");
    // 生效状态下拉：全部 / 拉取 / 被过滤
    const effLis = await openOptions(w, ".cf-sel-eff");
    expect(effLis.map((c) => c.text().replace("▶", ""))).toEqual(["全部 3", "拉取 2", "被过滤 1"]);
    await effLis[1].trigger("click"); // 拉取
    expect(w.get(".cf-sel-eff .ds-btn").text()).toContain("拉取 2"); // 关闭态显示选中项
    expect(w.findAll(".cf-row").map((r) => r.get(".cf-name").text())).toEqual(["团队群", "告警机器人"]);
    // 偏好设置下拉（与生效正交）：全部偏好 / 跟随 / 手动设置
    const prefLis = await openOptions(w, ".cf-sel-pref");
    expect(prefLis.map((c) => c.text().replace("▶", ""))).toEqual(["全部偏好 3", "跟随 2", "手动设置 1"]);
    await prefLis[1].trigger("click"); // 跟随 ∩ 拉取 → 团队群 + 告警机器人
    expect(w.findAll(".cf-row")).toHaveLength(2);
    await pick(w, ".cf-sel-eff", 2); // 被过滤 ∩ 跟随 → 交集空（灌水群是手动）
    expect(w.get(".cf-statebox").text()).toContain("当前筛选组合下没有会话");
    await pick(w, ".cf-sel-pref", 2); // 被过滤 ∩ 手动设置 → 灌水群
    expect(w.findAll(".cf-row")).toHaveLength(1);
    expect(w.findAll(".cf-row")[0].get(".cf-name").text()).toBe("灌水群");
  });

  it("类型筛选下拉：按会话类型本地过滤，0 计数档禁用，与生效/偏好/搜索正交组合", async () => {
    const w = await mountManager();
    const tLis = await openOptions(w, ".cf-sel-type");
    expect(tLis.map((c) => c.text().replace("▶", ""))).toEqual(["全部类型 3", "群聊 2", "私聊 0", "机器人 1"]);
    expect(tLis[2].classes()).toContain("disabled"); // 种子无私聊 → 禁用
    await tLis[2].trigger("click"); // 禁用项不可选
    expect(w.get(".cf-sel-type .ds-btn").text()).toContain("全部类型"); // 选中值未变
    await pick(w, ".cf-sel-type", 1); // 群聊
    expect(w.findAll(".cf-row")).toHaveLength(2);
    expect(w.findAll(".cf-badge").map((b) => b.text())).toEqual(["群聊", "群聊"]); // 手动置顶的灌水群在前
    // 与生效档组合：群聊 ∩ 被过滤 → 灌水群
    await pick(w, ".cf-sel-eff", 2);
    expect(w.findAll(".cf-row")).toHaveLength(1);
    expect(w.findAll(".cf-row")[0].get(".cf-name").text()).toBe("灌水群");
    // 搜索叠加：机器人档下搜「团队」→ 组合无匹配走搜索空态文案
    await pick(w, ".cf-sel-type", 3);
    await w.get(".cf-search").setValue("团队");
    expect(w.get(".cf-statebox").text()).toContain("没有匹配「团队」的会话");
    // 摘要计数保持全量统计
    expect(w.get(".cf-counts").text()).toBe("共 3 个会话：2 拉取 · 1 过滤 · 手动 1");
  });

  it("类型与偏好档交集为空：显示筛选组合空态（非搜索空态），清空筛选恢复", async () => {
    const w = await mountManager();
    await pick(w, ".cf-sel-type", 3); // 机器人
    await pick(w, ".cf-sel-pref", 2); // 手动设置（告警机器人为跟随降级 → 交集 0）
    expect(w.get(".cf-statebox").text()).toContain("当前筛选组合下没有会话");
    await pick(w, ".cf-sel-pref", 0); // 回全部偏好 → 只剩机器人
    expect(w.findAll(".cf-row")).toHaveLength(1);
    expect(w.findAll(".cf-row")[0].get(".cf-name").text()).toBe("告警机器人");
  });

  it("私聊行固定跟随：静态 chip 替代三段选择器（无写入通道），群/机器人保持三段", async () => {
    vi.mocked(api.getFeishuChatFilterOverview).mockResolvedValue(
      overview([
        view({ chatId: "c1", chatName: "团队群" }),
        view({ chatId: "c2", chatName: "张三", chatType: "p2p" }),
        view({ chatId: "c3", chatName: "告警机器人", chatType: "bot" }),
      ]),
    );
    const w = await mountManager();
    const rowOf = (name: string) => w.findAll(".cf-row").find((r) => r.get(".cf-name").text() === name)!;
    // 私聊行：静态 chip（title 说明规则），无 radiogroup / 按钮 / 写入
    const fixed = rowOf("张三").get(".cf-seg-fixed");
    expect(fixed.text()).toBe("跟随");
    expect(fixed.attributes("title")).toContain("私聊固定跟随");
    expect(rowOf("张三").find(".cf-seg[role='radiogroup']").exists()).toBe(false);
    expect(rowOf("张三").findAll("button")).toHaveLength(0);
    // 群/机器人行不受影响：仍渲染三段选择器
    expect(rowOf("团队群").findAll(".cf-seg button")).toHaveLength(3);
    expect(rowOf("告警机器人").findAll(".cf-seg button")).toHaveLength(3);
    expect(api.setFeishuChatFilter).not.toHaveBeenCalled();
  });

  it("筛选激活时显示匹配计数行（n / 全量 total），默认隐藏，0 命中时与空态并存", async () => {
    const w = await mountManager();
    expect(w.find(".cf-match").exists()).toBe(false); // 全维 all + 空搜索 → 不显示
    await pick(w, ".cf-sel-type", 1); // 群聊 → 2 / 3
    expect(w.get(".cf-match").text()).toBe("符合筛选条件：2 / 3 个会话");
    await w.get(".cf-search").setValue("灌水"); // 群聊 ∩ 名称 → 1 / 3
    expect(w.get(".cf-match").text()).toBe("符合筛选条件：1 / 3 个会话");
    await w.get(".cf-search").setValue("不存在"); // 0 命中：计数行与搜索空态并存
    expect(w.get(".cf-match").text()).toBe("符合筛选条件：0 / 3 个会话");
    expect(w.get(".cf-statebox").text()).toContain("没有匹配「不存在」的会话");
    await w.get(".cf-search").setValue(""); // 清空 + 回全部类型 → 隐藏
    await pick(w, ".cf-sel-type", 0);
    expect(w.find(".cf-match").exists()).toBe(false);
  });

  it("选中类型档计数降 0（快照刷新后该类型消失）自动回退「全部类型」", async () => {
    const w = await mountManager();
    await pick(w, ".cf-sel-type", 3); // 机器人
    expect(w.findAll(".cf-row")).toHaveLength(1);
    // 事件刷新：新一轮快照已无 bot 会话
    vi.mocked(api.getFeishuChatFilterOverview).mockResolvedValue(
      overview([
        view({ chatId: "c1", chatName: "团队群" }),
        view({ chatId: "c2", chatName: "灌水群", preference: "always_filter", effective: "filter", source: "manual" }),
      ]),
    );
    broadcast("feishu-chat-filter-changed");
    await flush();
    const after = await openOptions(w, ".cf-sel-type");
    expect(after[3].classes()).toContain("disabled"); // 机器人 0 → 禁用
    expect(w.get(".cf-sel-type .ds-btn").text()).toContain("全部类型 2"); // 回退全部类型（新计数）
    expect(w.findAll(".cf-row")).toHaveLength(2);
  });

  it("选中档计数降 0 自动回退「全部」（生效/偏好两下拉同守卫）", async () => {
    const w = await mountManager({ intervalSec: 120 });
    // 偏好：把唯一手动行（灌水群）改回跟随 → manual 降 0
    vi.mocked(api.setFeishuChatFilter).mockResolvedValue(
      view({ chatId: "c2", chatName: "灌水群", preference: "follow", effective: "filter", source: "follow" }),
    );
    await pick(w, ".cf-sel-pref", 2); // 手动设置当前 1 条 → 选中
    expect(w.findAll(".cf-row")).toHaveLength(1);
    const btns = w.findAll(".cf-row")[0].findAll(".cf-seg button");
    await btns[0].trigger("click"); // 唯一手动行点回「跟随」
    await flush();
    const afterPref = await openOptions(w, ".cf-sel-pref");
    expect(afterPref[2].classes()).toContain("disabled"); // 手动设置 0 → 禁用
    expect(w.get(".cf-sel-pref .ds-btn").text()).toContain("全部偏好 3"); // 回退全部偏好
    expect(w.findAll(".cf-row")).toHaveLength(3);

    // 生效同守卫：唯一被过滤行（灌水群）改「总是拉取」→ filtered 降 0
    vi.mocked(api.setFeishuChatFilter).mockResolvedValue(
      view({ chatId: "c2", chatName: "灌水群", preference: "always_pull", effective: "pull", source: "manual" }),
    );
    await pick(w, ".cf-sel-eff", 2); // 被过滤当前 1 条 → 选中
    expect(w.findAll(".cf-row")).toHaveLength(1);
    const segBtns = w.findAll(".cf-row")[0].findAll(".cf-seg button");
    await segBtns[1].trigger("click"); // → 总是拉取
    await flush();
    const afterEff = await openOptions(w, ".cf-sel-eff");
    expect(afterEff[2].classes()).toContain("disabled"); // 被过滤 0 → 禁用
    expect(w.get(".cf-sel-eff .ds-btn").text()).toContain("全部 3"); // 回退全部
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
    await pick(w, ".cf-sel-eff", 0); // 全部
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
    expect(w.get(".cf-sel-eff .ds-btn").text()).toContain("全部 3");
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
