/**
 * clientEntry 装配（Phase B 适配层）：apply(ctx) 的四 slot 注册——plugins.detail.section
 * （subject 自判：本包渲染面板 / 他包 null 零占位）、conversation.session.header.actions
 * （chip 挂载，无进行中任务零占位）、sidebar.panellist + main（侧边栏一级入口与主区
 * 全局面板：id/key 同源寻址、order、locale-aware 标签、chip 点击经 ctx.layout.selectPanel
 * 客户端闭环导航）；rpc 经 fake connection（mockHost + dsh 信封正向转换）走真实
 * transport 链路；slots.inject 的卸载清理形态。
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apply, type DshClientContext } from "../../src/client/dsh/clientEntry";
import {
  createPanelLabel,
  createPanelOpener,
  localeForTag,
  PANEL_ID,
  type PanelLayoutFace,
} from "../../src/client/dsh/sidebarPanel";
import type { DshConnectionResult, DshConnectionRpc } from "../../src/client/dsh/transport";
import { mockHost, type MockHost, type PkyResult } from "../../src/client/rpc";

/** slot 组件的 JSX 形态收窄（props 契约 = 槽 owner/标准件合成，测试只喂已知键） */
type SlotC = ComponentType<Record<string, unknown>>;

/** 记录形态：options 快照（list 槽 id / keyed 槽 key 归一到 id 便于寻址）+ 组件 */
type Registration = {
  name: string;
  id: string;
  order?: number;
  label?: () => string;
  component: (props: Record<string, unknown>) => unknown;
};

function panelOf(registrations: Registration[]): SlotC {
  const component = registrations.find((r) => r.id === "dsh-plugin#panel")?.component;
  expect(component).toBeDefined();
  return component as SlotC;
}

/** mockHost → fake dsh connection rpc（Typert Remote 迁移后 wire 形态：/api + pky/call + 双信封） */
function mockHostRpc(host: MockHost): DshConnectionRpc {
  return {
    async call(channel, endpoint, payload): Promise<DshConnectionResult> {
      const args = (payload as { args?: { command?: unknown; payload?: unknown } } | undefined)?.args;
      if (channel !== "/api" || endpoint !== "pky/call" || typeof args?.command !== "string") {
        return {
          ok: false,
          error: { code: "INVALID_ARGUMENT", message: `非 pky/call Remote 调用：${channel} ${endpoint}`, details: {} },
        };
      }
      const command = args.command;
      const fn = (host as unknown as Record<string, (p?: unknown) => Promise<PkyResult<unknown>>>)[command];
      if (typeof fn !== "function") {
        return { ok: false, error: { code: "INVALID_ARGUMENT", message: `未知命令 ${command}`, details: {} } };
      }
      // 业务信封原样透传（Remote 方法不抛错，错误走信封）
      return { ok: true, value: await fn(args.payload) };
    },
  };
}

/** slots 服务替身：inject 即执行贡献（本层贡献形态 = register 的单 disposer），register 记录并返回注销件 */
function fakeSlots() {
  const registrations: Registration[] = [];
  const slots: DshClientContext["slots"] = {
    inject(_key, contribute) {
      const dispose = contribute() as () => void;
      return () => {
        dispose();
      };
    },
    register(options, component) {
      const id = options.id ?? options.key ?? "";
      registrations.push({ name: options.name, id, order: options.order, label: options.label, component });
      return () => {
        const index = registrations.findIndex((r) => r.id === id);
        if (index !== -1) {
          registrations.splice(index, 1);
        }
      };
    },
  };
  return { slots, registrations };
}

/** apply 替身装配：可选注入宿主 locale 快照替身与 layout 替身（缺省不给——健壮性口径） */
function applyWith(host = mockHost(), faces: { locale?: unknown; layout?: PanelLayoutFace } = {}) {
  const slots = fakeSlots();
  const injectDisposers: Array<() => void> = [];
  const realInject = slots.slots.inject.bind(slots.slots);
  slots.slots.inject = (key, contribute) => {
    const dispose = realInject(key, contribute);
    injectDisposers.push(dispose);
    return dispose;
  };
  apply({
    slots: slots.slots,
    locale: faces.locale ?? null,
    connection: { rpc: mockHostRpc(host) },
    layout: faces.layout,
  });
  return { ...slots, injectDisposers };
}

/** 宿主 locale 服务替身（快照携带生效 locale id） */
function fakeLocale(tag: string): unknown {
  return { getSnapshot: () => ({ locale: tag }) };
}

afterEach(cleanup);

describe("clientEntry · apply 四 slot 注册", () => {
  it("注册 detail section / 会话头 chip / 侧边栏一级入口 / 主区面板（list id + keyed key 同源寻址）", () => {
    const { registrations } = applyWith();
    expect(registrations.map((r) => `${r.name}#${r.id}`)).toEqual([
      "plugins.detail.section#dsh-plugin#panel",
      "conversation.session.header.actions#dsh-plugin#chip",
      `sidebar.panellist#${PANEL_ID}`,
      `main#${PANEL_ID}`,
    ]);
  });

  it("slots.inject 卸载清理：注销后注册表清空", () => {
    const { registrations, injectDisposers } = applyWith();
    expect(injectDisposers).toHaveLength(4);
    for (const dispose of injectDisposers) {
      dispose();
    }
    expect(registrations).toEqual([]);
  });
});

describe("clientEntry · 面板 section（subject 自判 + 数据装配）", () => {
  const foreign = { kind: "bundle", pkg: { name: "@acme/other" } };
  const self = { kind: "bundle", pkg: { name: "dsh-plugin" } };

  it("他包 subject（bundle/row/item）渲染 null——detail 页零占位", () => {
    const { registrations } = applyWith();
    const panel = registrations.find((r) => r.id === "dsh-plugin#panel")?.component;
    expect(panel).toBeDefined();
    expect(panel?.({ subject: foreign })).toBeNull();
    expect(panel?.({ subject: { kind: "row", pkg: { name: "@acme/other" }, row: {} } })).toBeNull();
    expect(panel?.({ subject: { kind: "item", id: "settings-shell" } })).toBeNull();
    expect(panel?.({})).toBeNull();
  });

  it("本包 subject：经真实 transport 链路拉数据并渲染七段面板", async () => {
    const { registrations } = applyWith();
    const Panel = panelOf(registrations);
    render(<Panel subject={self} />);
    // 快照拉取异步完成 → 面板落地（SegmentNav 七段）
    expect(await screen.findByTestId("segment-nav")).toBeTruthy();
    expect(screen.getByTestId("pending-count")).toBeTruthy();
  });

  it("本包 subject（row 形态，pkg 同名）同样渲染", async () => {
    const { registrations } = applyWith();
    const Panel = panelOf(registrations);
    render(<Panel subject={{ kind: "row", pkg: { name: "dsh-plugin" }, row: { rowId: "host" } }} />);
    expect(await screen.findByTestId("segment-nav")).toBeTruthy();
  });
});

describe("clientEntry · 会话头 chip（零占位）", () => {
  it("无进行中任务数据源（读命令/推送未落型）→ chip 不渲染", () => {
    const { registrations } = applyWith();
    const chip = registrations.find((r) => r.id === "dsh-plugin#chip")?.component;
    expect(chip).toBeDefined();
    const Chip = chip as SlotC;
    const { container } = render(<Chip sessionId="s1" />);
    expect(container.innerHTML).toBe("");
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

  it("主面板组件：经真实 transport 链路拉数据并渲染七段面板（与 detail section 同一组件双载体）", async () => {
    const { registrations } = applyWith();
    const component = registrations.find((r) => r.name === "main")?.component;
    expect(component).toBeDefined();
    const Main = component as SlotC;
    render(<Main />);
    expect(await screen.findByTestId("segment-nav")).toBeTruthy();
    expect(screen.getByTestId("pending-count")).toBeTruthy();
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
