/**
 * clientEntry 装配（Phase B 适配层）：apply(ctx) 的双 slot 注册——plugins.detail.section
 * （subject 自判：本包渲染面板 / 他包 null 零占位）与 conversation.session.header.actions
 * （chip 挂载，无进行中任务零占位）；rpc 经 fake connection（mockHost + dsh 信封正向
 * 转换）走真实 transport 链路；slots.inject 的卸载清理形态。
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { apply, type DshClientContext } from "../../src/client/dsh/clientEntry";
import type { DshConnectionResult, DshConnectionRpc } from "../../src/client/dsh/transport";
import { mockHost, type MockHost, type PkyResult } from "../../src/client/rpc";

/** slot 组件的 JSX 形态收窄（props 契约 = 槽 owner/标准件合成，测试只喂已知键） */
type SlotC = ComponentType<Record<string, unknown>>;

function panelOf(registrations: Array<{ id: string; component: (props: Record<string, unknown>) => unknown }>): SlotC {
  const component = registrations.find((r) => r.id === "dsh-plugin#panel")?.component;
  expect(component).toBeDefined();
  return component as SlotC;
}

/** mockHost → fake dsh connection rpc（host 侧 rpcDispatch 的正向信封转换镜像） */
function mockHostRpc(host: MockHost): DshConnectionRpc {
  return {
    async call(channel, endpoint, payload): Promise<DshConnectionResult> {
      if (channel !== "/api" || !endpoint.startsWith("pky/")) {
        return { ok: false, error: { code: "INVALID_ARGUMENT", message: `非 pky/ 端点：${endpoint}`, details: {} } };
      }
      const command = endpoint.slice("pky/".length);
      const fn = (host as unknown as Record<string, (p?: unknown) => Promise<PkyResult<unknown>>>)[command];
      if (typeof fn !== "function") {
        return { ok: false, error: { code: "INVALID_ARGUMENT", message: `未知命令 ${command}`, details: {} } };
      }
      const result = await fn(payload);
      return result.ok
        ? { ok: true, value: result.data }
        : {
            ok: false,
            error: {
              code: result.error.code,
              message: result.error.message,
              details: result.error.hint === undefined ? {} : { hint: result.error.hint },
            },
          };
    },
  };
}

/** slots 服务替身：inject 即执行贡献（本层贡献形态 = register 的单 disposer），register 记录并返回注销件 */
function fakeSlots() {
  const registrations: Array<{ name: string; id: string; component: (props: Record<string, unknown>) => unknown }> = [];
  const slots: DshClientContext["slots"] = {
    inject(_key, contribute) {
      const dispose = contribute() as () => void;
      return () => {
        dispose();
      };
    },
    register(options, component) {
      registrations.push({ name: options.name, id: options.id, component });
      return () => {
        const index = registrations.findIndex((r) => r.id === options.id);
        if (index !== -1) {
          registrations.splice(index, 1);
        }
      };
    },
  };
  return { slots, registrations };
}

function applyWith(host = mockHost()) {
  const slots = fakeSlots();
  const injectDisposers: Array<() => void> = [];
  const realInject = slots.slots.inject.bind(slots.slots);
  slots.slots.inject = (key, contribute) => {
    const dispose = realInject(key, contribute);
    injectDisposers.push(dispose);
    return dispose;
  };
  apply({ slots: slots.slots, locale: null, connection: { rpc: mockHostRpc(host) } });
  return { ...slots, injectDisposers };
}

afterEach(cleanup);

describe("clientEntry · apply 双 slot 注册", () => {
  it("注册 plugins.detail.section 与 conversation.session.header.actions（list 槽 id 形态）", () => {
    const { registrations } = applyWith();
    expect(registrations.map((r) => `${r.name}#${r.id}`)).toEqual([
      "plugins.detail.section#dsh-plugin#panel",
      "conversation.session.header.actions#dsh-plugin#chip",
    ]);
  });

  it("slots.inject 卸载清理：注销后注册表清空", () => {
    const { registrations, injectDisposers } = applyWith();
    expect(injectDisposers).toHaveLength(2);
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
