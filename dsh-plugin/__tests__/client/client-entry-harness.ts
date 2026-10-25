/**
 * clientEntry 装配测试共享 harness（apply(ctx) 的 slots/configForms/connection/effect
 * 替身）：mockHost → fake dsh connection rpc（Typert Remote wire 形态：/api + pky/call +
 * 双信封）、slots 服务替身（inject 即执行贡献 + register 记录）、locale 快照替身。
 * 消费方：dsh-client-entry.spec.tsx / dsh-client-page-open.spec.tsx。
 */
import type { ComponentType } from "react";
import { apply, type DshClientContext } from "../../src/client/dsh/clientEntry";
import type { ConfigFormsFace } from "../../src/client/dsh/pluginConfig";
import type { PanelLayoutFace } from "../../src/client/dsh/sidebarPanel";
import type { DshConnectionResult, DshConnectionRpc } from "../../src/client/dsh/transport";
import { mockHost, type MockHost, type PkyResult } from "../../src/client/rpc";

/** slot 组件的 JSX 形态收窄（props 契约 = 槽 owner/标准件合成，测试只喂已知键） */
export type SlotC = ComponentType<Record<string, unknown>>;

/** 记录形态：options 快照（list 槽 id / keyed 槽 key 归一到 id 便于寻址）+ 组件 */
export type Registration = {
  name: string;
  id: string;
  order?: number;
  label?: () => string;
  component: (props: Record<string, unknown>) => unknown;
};

/** mockHost → fake dsh connection rpc（Typert Remote 迁移后 wire 形态：/api + pky/call + 双信封） */
export function mockHostRpc(host: MockHost): DshConnectionRpc {
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

/** slots 服务替身：inject 即执行贡献（贡献形态 = 单 disposer 或 disposer 数组——配置槽
 * 双键并注返回数组），register 记录并返回注销件 */
export function fakeSlots() {
  const registrations: Registration[] = [];
  const slots: DshClientContext["slots"] = {
    inject(_key, contribute) {
      const contributed = contribute();
      const dispose = Array.isArray(contributed)
        ? () => {
            for (const off of contributed) off();
          }
        : (contributed as () => void);
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

/** apply 替身装配：可选注入宿主 locale 快照替身、layout 替身与 remote 替身（缺省不给——健壮性口径；
 * configForms 缺省给 unavailable 态替身——注册面断言不渲染配置区，行为面归
 * dsh-config-section.spec.tsx）；effect 记录注册的 disposer（pageOpen 流订阅的回收位） */
export function applyWith(
  host = mockHost(),
  faces: { locale?: unknown; layout?: PanelLayoutFace; configForms?: ConfigFormsFace; remote?: unknown } = {},
) {
  const slots = fakeSlots();
  const injectDisposers: Array<() => void> = [];
  const effectDisposers: Array<() => void> = [];
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
    configForms:
      faces.configForms ??
      ({
        get: () => ({
          getSnapshot: () => ({ status: "unavailable", writable: false }),
          subscribe: () => () => undefined,
          set: () => Promise.resolve(false),
        }),
      } as ConfigFormsFace),
    layout: faces.layout,
    remote: faces.remote as DshClientContext["remote"],
    effect(callback) {
      const dispose = callback();
      effectDisposers.push(dispose);
      return dispose;
    },
  });
  return { ...slots, injectDisposers, effectDisposers };
}

/** 宿主 locale 服务替身（快照携带生效 locale id） */
export function fakeLocale(tag: string): unknown {
  return { getSnapshot: () => ({ locale: tag }) };
}
