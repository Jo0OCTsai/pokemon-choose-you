/**
 * clientEntry 装配（Phase B 适配层）：apply(ctx) 的三 slot 注册——
 * conversation.session.header.actions（chip 挂载，无进行中任务零占位）、
 * sidebar.panellist + main（侧边栏一级入口与主区全局面板：id/key 同源寻址、order、
 * locale-aware 标签、chip 点击经 ctx.layout.selectPanel 客户端闭环导航）。
 * ctx.configForms 经 createPluginConfig 绑定随主面板 Context 注入（背包分区行消费，
 * 行为面见 dsh-plugin-config.spec.tsx）。plugins.detail.section 与 plugins.bundle.config
 * 两槽均不注册（用户裁决：详情页回归纯信息页，插件私有配置背包为唯一编辑面）；rpc 经
 * fake connection（mockHost + dsh 信封正向转换）走真实 transport 链路；slots.inject
 * 的卸载清理形态。装配替身见 client-entry-harness.ts；chipTiming 纯函数见
 * dsh-client-chip-timing.spec.ts、pageOpen 推送见 dsh-client-page-open.spec.tsx。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPanelLabel, createPanelOpener, localeForTag, PANEL_ID } from "../../src/client/dsh/sidebarPanel";
import { mockHost } from "../../src/client/rpc";
import { makeCategory, makeTask } from "./fixtures";
import { applyWith, fakeLocale, type SlotC } from "./client-entry-harness";

afterEach(cleanup);

describe("clientEntry · apply 三 slot 注册", () => {
  it("注册会话头 chip / 侧边栏一级入口 / 主区面板（list id + keyed key 同源寻址）；配置类槽不再注册", () => {
    const { registrations } = applyWith();
    expect(registrations.map((r) => `${r.name}#${r.id}`)).toEqual([
      "conversation.session.header.actions#pokemon-choose-you-dsh#chip",
      `sidebar.panellist#${PANEL_ID}`,
      `main#${PANEL_ID}`,
    ]);
    // 详情页纯信息页 + 插件私有配置背包唯一编辑面（plugins.bundle.config 槽已撤，用户裁决）
    expect(registrations.some((r) => r.name === "plugins.detail.section")).toBe(false);
    expect(registrations.some((r) => r.name === "plugins.bundle.config")).toBe(false);
  });

  it("slots.inject 卸载清理：注销后注册表清空", () => {
    const { registrations, injectDisposers } = applyWith();
    expect(injectDisposers).toHaveLength(3);
    for (const dispose of injectDisposers) {
      dispose();
    }
    expect(registrations).toEqual([]);
  });
});

describe("clientEntry · 会话头 chip（零占位）", () => {
  it("无进行中任务数据源（读命令/推送未落型）→ chip 不渲染", () => {
    const { registrations } = applyWith();
    const chip = registrations.find((r) => r.id === "pokemon-choose-you-dsh#chip")?.component;
    expect(chip).toBeDefined();
    const Chip = chip as SlotC;
    const { container } = render(<Chip sessionId="s1" />);
    expect(container.innerHTML).toBe("");
  });

  it("有进行中任务 → chip 渲染精灵名与计时；⏸ 暂停即调 taskPause 并回刷", async () => {
    const host = mockHost({
      tasks: [makeTask({ id: 3, status: "active", startedAt: "2026-10-11T08:30:00+08:00" })],
      categories: [makeCategory({ id: 1, name: "工作", pokemon: "pikachu" })],
    });
    const { registrations } = applyWith(host);
    const Chip = registrations.find((r) => r.id === "pokemon-choose-you-dsh#chip")?.component as SlotC;
    render(<Chip sessionId="s1" />);
    // panelSnapshot 异步链路后渲染（皮卡丘 = pikachu 的 zh-Hans 名，经 catalog 查名）
    const chipEl = await screen.findByTestId("conversation-chip");
    expect(chipEl.getAttribute("data-mode")).toBe("running");
    expect(chipEl.textContent).toContain("皮卡丘");
    expect(screen.getByTestId("chip-open")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /暂停/ }));
    await waitFor(() => {
      expect(host.calls).toContainEqual({ command: "taskPause", params: { taskId: 3 } });
    });
  });

  it("helper 番茄相位（petStatus.pomodoro）归属当前任务 → chip 显到期倒计时；break → ☕ resting", async () => {
    const endAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const host = mockHost({
      tasks: [makeTask({ id: 3, status: "active", startedAt: "2026-10-11T08:30:00+08:00" })],
      categories: [makeCategory({ id: 1, name: "工作", pokemon: "pikachu" })],
      pomodoro: { kind: "focus", endAt, durationMin: 25, taskId: 3 },
    });
    const { registrations } = applyWith(host);
    const Chip = registrations.find((r) => r.id === "pokemon-choose-you-dsh#chip")?.component as SlotC;
    render(<Chip sessionId="s1" />);
    const chipEl = await screen.findByTestId("conversation-chip");
    expect(chipEl.getAttribute("data-mode")).toBe("running");
    // 倒计时而非已专注时长（startedAt 在数天前——快照值会是巨大的分钟数）
    expect(chipEl.textContent).toMatch(/\b(09:5\d|10:00)\b/);
    expect(host.calls.some((c) => c.command === "petStatus")).toBe(true);
    cleanup();
    host.state.pomodoro = { kind: "break", endAt, durationMin: null, taskId: 3 };
    render(<Chip sessionId="s1" />);
    const resting = await screen.findByTestId("conversation-chip");
    await waitFor(() => expect(resting.getAttribute("data-mode")).toBe("resting"));
    expect(resting.textContent).toContain("☕");
  });
});

describe("clientEntry · 侧边栏一级入口 + 主区全局面板", () => {
  it("panellist 注册携带 order（排内置插件 0 / 自动化任务 10 之后）与 locale-aware 标签", () => {
    const { registrations } = applyWith(mockHost(), { locale: fakeLocale("zh-Hans-CN") });
    const entry = registrations.find((r) => r.name === "sidebar.panellist");
    expect(entry?.order).toBe(20);
    expect(entry?.label?.()).toBe("图鉴机");
  });

  it("标签随宿主 locale 快照映射三语：zh 繁体细分、非 zh 回落 en、形态不符回落 en", () => {
    expect(
      applyWith(mockHost(), { locale: fakeLocale("zh-TW") })
        .registrations.find((r) => r.name === "sidebar.panellist")
        ?.label?.(),
    ).toBe("圖鑑機");
    expect(
      applyWith(mockHost(), { locale: fakeLocale("en-US") })
        .registrations.find((r) => r.name === "sidebar.panellist")
        ?.label?.(),
    ).toBe("Pokédex");
    expect(
      applyWith(mockHost(), { locale: null })
        .registrations.find((r) => r.name === "sidebar.panellist")
        ?.label?.(),
    ).toBe("Pokédex");
    expect(localeForTag(null)).toBe("en");
    expect(localeForTag("zh-Hant-TW")).toBe("zh-Hant");
    expect(localeForTag("ja-JP")).toBe("en");
  });

  it("图标组件：装饰性精灵球 SVG 按请求尺寸渲染（aria-hidden，无障碍标签归侧边栏行壳）", () => {
    const { registrations } = applyWith();
    const Icon = registrations.find((r) => r.name === "sidebar.panellist")?.component as SlotC;
    expect(Icon).toBeDefined();
    const { container } = render(<Icon size={16} selected={true} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("16");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("主面板组件：经真实 transport 链路拉数据并渲染七段面板（图鉴机 UI 唯一载体）", async () => {
    const { registrations } = applyWith();
    const component = registrations.find((r) => r.name === "main")?.component;
    expect(component).toBeDefined();
    const Main = component as SlotC;
    render(<Main />);
    expect(await screen.findByTestId("segment-nav")).toBeTruthy();
    expect(screen.queryByTestId("pending-count")).toBeNull();
  });
});

describe("clientEntry · chip 点击导航（客户端闭环）", () => {
  it("createPanelOpener：调 layout.selectPanel 选中本面板 id", () => {
    const selectPanel = vi.fn();
    const open = createPanelOpener({ selectPanel });
    open();
    open("settings");
    expect(selectPanel).toHaveBeenCalledTimes(2);
    expect(selectPanel).toHaveBeenLastCalledWith(PANEL_ID);
  });

  it("layout 缺席（形态防御）：open 为 noop 不抛错", () => {
    const open = createPanelOpener(undefined);
    expect(() => open()).not.toThrow();
  });

  it("createPanelLabel 直连：宿主 locale 服务形态不符（无 getSnapshot）回落 en 标题", () => {
    expect(createPanelLabel({})()).toBe("Pokédex");
  });
});
