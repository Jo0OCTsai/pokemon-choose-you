/**
 * 设置区功能对齐主应用（桌面为规格单源）：
 * - 桌宠：主宝可梦全图鉴搜索选择（裸 key + 可清回「跟随第一个分类」）/ 台词按精灵分组编辑
 *   （pokemon_quotes JSON map merge——平面写坏共享键的回归防线）/ petShow ready=false 警告
 * - 分类与标签：分类停用/启用（即时生效 + 失败行内错误）/ 标签管理卡（分组 + 维度迁移 +
 *   两段式删除 + ⚡ 派发 chip）
 * - Agent：预设下拉添加 + 附加参数/工作目录/超时 + SSH 远程执行组
 * 飞书分区用例 → settings-parity-feishu.spec.tsx（棘轮 max-lines 拆分，等量迁移）。
 * 渲染壳/分区导航/标签夹具 → settingsHarness（对照 reviewWizardHarness 手法）。
 */
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockHost } from "../../src/client/rpc";
import { makeCategory, makeData } from "./fixtures";
import { getPage, gotoSection, makeTag, renderSettings } from "./settingsHarness";

afterEach(cleanup);
vi.useFakeTimers();

describe("桌宠分区对齐（主宝可梦搜索 + 台词分组编辑）", () => {
  it("主宝可梦：下拉搜索选中写裸 key，清空档回到「跟随第一个分类」", async () => {
    const data = makeData();
    data.pokemonSearch = async (q) =>
      q === "" ? [] : [{ key: "togepi", name: "波克比", number: 175, english: "Togepi" }];
    const { host } = renderSettings(data);
    gotoSection("桌宠");
    const page = getPage("pets");
    const mainRow = within(page).getByTestId("main-pokemon-row");
    expect(mainRow.textContent).toContain("跟随第一个分类");
    // 展开选择器（按钮 aria-label = 主宝可梦）→ 搜索 → 点结果行（桌面 PokemonPicker 同交互）
    fireEvent.click(within(mainRow).getByLabelText("主宝可梦"));
    fireEvent.change(within(mainRow).getByLabelText("搜索宝可梦（1025 只 · 名称 / 编号 / 英文名）"), {
      target: { value: "波克比" },
    });
    // 搜索 promise 的 setState 在 act 外排队——act 内冲一把微任务再取结果
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    fireEvent.click(within(mainRow).getByText(/波克比/));
    expect(within(page).getByTestId("main-pokemon-row").textContent).toContain("波克比");
    // 保存 → main_pokemon 存 PokeAPI 裸 key
    fireEvent.click(screen.getByTestId("section-save"));
    await vi.runAllTimersAsync();
    const write = host.calls.find((c) => c.command === "configWrite");
    expect(write?.params).toEqual({ keyValues: { main_pokemon: "togepi" } });
    // 清空档（allowEmptyLabel）→ 回到「跟随第一个分类」
    fireEvent.click(within(mainRow).getByLabelText("主宝可梦"));
    fireEvent.click(within(mainRow).getByText("跟随第一个分类"));
    expect(within(page).getByTestId("main-pokemon-row").textContent).toContain("跟随第一个分类");
  });

  it("台词编辑器：按精灵分组 merge 写回（其他精灵保留、空文本删 key）", async () => {
    const data = makeData();
    data.config.pokemon_quotes = JSON.stringify({ pikachu: "皮卡皮卡！\n今天也拜托了！", eevee: "伊布台词" });
    const { host } = renderSettings(data);
    gotoSection("桌宠");
    const page = getPage("pets");
    // 默认选中皮卡丘（主宝可梦未设）——textarea 只显示该精灵的台词
    const editor = () => within(page).getByLabelText("🎙 宝可梦台词", { selector: "textarea" }) as HTMLTextAreaElement;
    const quotesButton = () => within(page).getByLabelText("🎙 宝可梦台词", { selector: "button" });
    expect(editor().value).toContain("皮卡皮卡！");
    // 切到伊布：展开台词选择器（本地名录兜底，空查询列内置 6 只）→ 点伊布行
    fireEvent.click(quotesButton());
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    fireEvent.click(within(page).getByText("伊布"));
    expect(editor().value).toBe("伊布台词");
    // 改写伊布台词 → 皮卡丘台词不受影响（merge 保留）
    fireEvent.change(editor(), { target: { value: "改写伊布" } });
    fireEvent.click(quotesButton());
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    fireEvent.click(within(page).getByText("皮卡丘"));
    expect(editor().value).toContain("皮卡皮卡！");
    // 清空皮卡丘台词 = 删除该 key；保存后 pokemon_quotes 只剩伊布
    fireEvent.change(editor(), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("section-save"));
    await vi.runAllTimersAsync();
    const write = host.calls.find((c) => c.command === "configWrite");
    expect(write?.params).toEqual({ keyValues: { pokemon_quotes: JSON.stringify({ eevee: "改写伊布" }) } });
  });

  it("显示桌宠：hello 握手 5 秒未完成（ready=false）行内警告", async () => {
    const host = mockHost();
    host.petShow = async () => ({ ok: true, data: { ok: true, ready: false } as { ok: boolean } });
    renderSettings(makeData(), host);
    gotoSection("桌宠");
    const page = getPage("pets");
    // 行标签「显示桌宠」+ 显示/隐藏两钮（可访问名 = aria-label 全称，可见文案为短动词）
    const row = within(page).getByTestId("pet-show-row");
    expect(row.textContent).toContain("显示桌宠");
    fireEvent.click(within(row).getByRole("button", { name: "显示桌宠" }));
    await vi.runAllTimersAsync();
    expect(within(page).getByTestId("pet-show-warn").textContent).toContain("桌宠未在 5 秒内完成启动握手");
    // 隐藏桌宠清掉警告
    fireEvent.click(within(row).getByRole("button", { name: "隐藏桌宠" }));
    expect(within(page).queryByTestId("pet-show-warn")).toBeNull();
  });

  it("显示桌宠状态行：petStatus 驱动「显示中/已隐藏」回显，动作后跟随刷新", async () => {
    const host = mockHost(); // petRunning 缺省 true（随宿主启动语义）
    renderSettings(makeData(), host);
    gotoSection("桌宠");
    const row = () => within(getPage("pets")).getByTestId("pet-show-row");
    // 挂载期 petStatus 查询的 setState 在 act 外排队——act 内冲一把微任务再取状态
    await act(async () => {});
    expect(row().textContent).toContain("显示中");
    fireEvent.click(within(row()).getByRole("button", { name: "隐藏桌宠" }));
    await vi.runAllTimersAsync();
    await act(async () => {});
    expect(host.state.petRunning).toBe(false);
    expect(row().textContent).toContain("已隐藏");
    fireEvent.click(within(row()).getByRole("button", { name: "显示桌宠" }));
    await vi.runAllTimersAsync();
    await act(async () => {});
    expect(host.state.petRunning).toBe(true);
    expect(row().textContent).toContain("显示中");
  });
});

describe("分类与标签分区对齐（停用开关 + 标签管理卡）", () => {
  it("分类停用/启用：categoryUpsert 即时生效", async () => {
    const data = makeData();
    const host = mockHost();
    host.state.categories = data.categories; // mock 库与面板夹具同源（upsert 局部覆盖需要存量行）
    renderSettings(data, host);
    gotoSection("分类与标签");
    const page = getPage("taxonomy");
    const card = within(page).getAllByTestId("category-ui.card")[0];
    fireEvent.click(within(card).getByRole("switch", { name: "停用/启用" }));
    await vi.runAllTimersAsync();
    const call = host.calls.find((c) => c.command === "categoryUpsert");
    expect(call?.params).toMatchObject({ id: 1, enabled: false });
  });

  it("分类停用失败（只读库）：行内错误不弹窗", async () => {
    const host = mockHost();
    host.state.dbStatus.mode = "ro";
    renderSettings(makeData(), host);
    gotoSection("分类与标签");
    const page = getPage("taxonomy");
    const card = within(page).getAllByTestId("category-ui.card")[0];
    fireEvent.click(within(card).getByRole("switch", { name: "停用/启用" }));
    await vi.runAllTimersAsync();
    expect(within(card).getByRole("alert").textContent).toContain("需升级插件后才能写入");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("标签管理卡：分组配额/单选标记/⚡ chip/维度迁移保存/两段式删除/新标签", async () => {
    const data = makeData();
    data.dimensions = [
      { id: 1, key: "project", name: "项目", cardinality: "single", maxTags: 3, sort: 1, enabled: true },
      { id: 2, key: "topic", name: "主题", cardinality: "multi", maxTags: 12, sort: 2, enabled: true },
    ];
    data.tags = [
      makeTag({ id: 1, name: "pokemon-choose-you", dimension: "project", description: "本项目" }),
      makeTag({ id: 2, name: "生活", dimension: "topic" }),
    ];
    data.routes = [{ tag: "pokemon-choose-you", agentId: "a1", workdir: "", context: "" }];
    const { host } = renderSettings(data);
    gotoSection("分类与标签");
    const page = getPage("taxonomy");
    // 组头：维度名 + {used}/{max} 配额 + 项目维度「单选」标记
    expect(within(page).getByText("1/3 · 单选")).toBeTruthy();
    expect(within(page).getByText("1/12")).toBeTruthy();
    // ⚡ chip：已配置项目派发的标签（配置入口在 Agent 分区）
    const tagRow = within(page).getAllByTestId("tag-row")[0];
    expect(tagRow.querySelector('span[title*="项目派发"]')?.textContent).toBe("⚡");
    // 行内改名 + 维度迁移 → tagUpsert 带目标 dimension
    fireEvent.change(within(tagRow).getByLabelText("标签名"), { target: { value: "pcy" } });
    fireEvent.change(within(tagRow).getByLabelText("🗂 标签维度"), { target: { value: "topic" } });
    fireEvent.click(within(tagRow).getByText("保存"));
    await vi.runAllTimersAsync();
    const upsert = host.calls.find((c) => c.command === "tagUpsert");
    expect(upsert?.params).toEqual({ id: 1, name: "pcy", dimension: "topic", description: "本项目" });
    // 两段式删除：先确认弹层、再删
    const lifeRow = within(page).getAllByTestId("tag-row")[1];
    fireEvent.click(within(lifeRow).getByText("删除"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "删除" }));
    await vi.runAllTimersAsync();
    expect(host.calls.some((c) => c.command === "tagDelete" && (c.params as { id: number }).id === 2)).toBe(true);
    // 维度组尾「＋ 新标签」：tagUpsert 无 id
    fireEvent.click(within(page).getAllByText("＋ 新标签")[0]);
    await vi.runAllTimersAsync();
    const create = host.calls.filter((c) => c.command === "tagUpsert").pop();
    expect(create?.params).toEqual({ name: "新标签", dimension: "project", description: "" });
  });

  it("分类卡形态：停用行降透明（data-off）", () => {
    const data = makeData();
    data.categories = [makeCategory({ id: 1, name: "工作" }), makeCategory({ id: 2, name: "生活", enabled: false })];
    renderSettings(data);
    gotoSection("分类与标签");
    const page = getPage("taxonomy");
    const off = within(page).getAllByTestId("category-ui.card")[1];
    expect(off.getAttribute("data-off")).toBe("true");
  });
});

describe("Agent 分区对齐（预设 + 全字段 + SSH 组）", () => {
  it("预设下拉添加：预填 name/command/args；SSH 组与超时/工作目录字段保存", async () => {
    const data = makeData();
    data.agents = [];
    const { host } = renderSettings(data);
    gotoSection("Agent");
    const page = getPage("agents");
    fireEvent.click(within(page).getByText("＋ 添加 Agent"));
    // 折叠态卡：开关 label 与摘要行都带预设名（多处出现即可）
    expect(within(page).getAllByText(/Claude Code/).length).toBeGreaterThan(0);
    // 展开编辑：预设字段已预填
    fireEvent.click(within(page).getByText("编辑"));
    expect((within(page).getByLabelText("附加参数") as HTMLInputElement).value).toContain("--output-format json");
    expect((within(page).getByLabelText("超时（秒）") as HTMLInputElement).value).toBe("120");
    // 开 SSH → host/端口/私钥/反向隧道/常驻隧道
    fireEvent.click(within(page).getByRole("switch", { name: "SSH 远程执行" }));
    fireEvent.change(within(page).getByLabelText("user@host"), { target: { value: "user@server" } });
    fireEvent.change(within(page).getByLabelText("反向隧道端口"), { target: { value: "10022" } });
    fireEvent.click(within(page).getByRole("switch", { name: "常驻隧道" }));
    const card = within(page).getByTestId("agent-ui.card");
    fireEvent.click(within(card).getByText("保存"));
    await vi.runAllTimersAsync();
    const upsert = host.calls.find((c) => c.command === "agentUpsert");
    expect(upsert?.params).toMatchObject({
      agent: {
        name: "Claude Code",
        command: "claude",
        timeoutSecs: 120,
        remote: { host: "user@server", tunnel: 10022, persistent: true },
      },
    });
  });
  // pk 技能行与连接测试的用例 → settings-agent-tools.spec.tsx（棘轮拆分，等量迁移）
});
