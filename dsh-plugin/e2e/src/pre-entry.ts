/**
 * harness pre：在 dist/client.js 之前就位的三件事——
 * ① window.__ModuleLoader__ shim（dsh 宿主装载面的等价物；require 面 = react 系 external）；
 * ② mockHost 伪 rpc（connection.call → pky/call → mock HostClient 命令分发）；
 * ③ 伪 dsh ctx（slots/locale/connection/layout/configForms——clientEntry apply 消费面）。
 * 测试编排面 = window.__pky（mock 态注入 / clientExports / 槽组件注册表）。
 */
import { mockHost } from "../../src/client/mockHost";
import { makeData } from "../../__tests__/client/fixtures";
import type { MockHost } from "../../src/client/mockHost";

declare global {
  interface Window {
    __ModuleLoader__: { load(mod: { id: string; factory: (require: (name: string) => unknown) => unknown }): void };
    __pky: {
      mock: MockHost;
      rpc: {
        call(
          channel: string,
          endpoint: string,
          payload?: unknown,
        ): Promise<{ ok: boolean; value?: unknown; error?: unknown }>;
      };
      ctx: unknown;
      clientExports: { inject?: string[]; apply?: (ctx: unknown) => void } | null;
      registry: Record<string, (props: Record<string, unknown>) => unknown>;
    };
    React: typeof import("react");
    ReactDOM: typeof import("react-dom");
  }
}

const pky: Window["__pky"] = {
  mock: mockHost(),
  rpc: undefined as never,
  ctx: undefined as never,
  clientExports: null,
  registry: {},
};
window.__pky = pky;

/** mock 初始态：fixtures.makeData 投影 + full-parity 增量态（部署/能力矩阵/sshFamily） */
function seedMockState(): void {
  const data = makeData();
  Object.assign(pky.mock.state, {
    tasks: data.tasks,
    categories: data.categories,
    settings: { ...data.config },
  });
  pky.mock.state.deployments = [
    {
      id: "dep-1",
      alias: "gpu-1",
      nodePath: "/usr/local/bin/node",
      helperPath: "/home/dev/.dsh-helper/pky-0.1.0/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js",
      helperHash: "9d7c7403056a",
      workdir: "/srv/work",
      note: "训练机",
      status: "ready",
      lastError: null,
      provision: { "probe-ssh": "done", "probe-node": "done", upload: "done", verify: "done" },
      degraded: false,
    },
  ];
  pky.mock.state.sshAliases = ["gpu-1", "pky-remote"];
  pky.mock.state.helperCaps = {
    "sys-tray": true,
    "sys-shortcut": true,
    "sys-notify": true,
    "sys-tts": true,
    "sys-dialog": true,
    "sys-open": true,
    "input-count": false,
    "mac-auth": true,
  };
  pky.mock.state.sshFamily = { ok: true, detail: null };
  pky.mock.state.shortcutRegistered = true;
  seedSessionRows();
}

/** 会话账本行工厂（缺省字段全零值——e2e 断言只消费差异字段） */
function sessionRow(
  id: number,
  over: Partial<MockHost["state"]["sessionRows"][number]>,
): MockHost["state"]["sessionRows"][number] {
  return {
    id,
    taskId: null,
    agentId: "agent-1",
    agentName: "Claude Code",
    sessionId: null,
    command: "claude",
    exitCode: 0,
    status: "ok",
    durationMs: null,
    costUsd: null,
    inputTokens: null,
    outputTokens: null,
    kind: "dispatch_headless",
    workdir: "",
    tmuxSession: "",
    remoteHost: "",
    remotePort: 0,
    remoteKey: "",
    createdAt: "2026-10-17T08:00:00+08:00",
    ...over,
  };
}

/** 日志段会话账本种子（回放 handoff 交互 e2e：本机 headless / 本机 tmux 交互 / 远端就绪） */
function seedSessionRows(): void {
  pky.mock.state.sessionRows = [
    sessionRow(1, { sessionId: "sess-e2e-1", workdir: "/srv/work", durationMs: 61000, costUsd: 0.012 }),
    sessionRow(2, { kind: "dispatch_interactive", sessionId: null, tmuxSession: "pky-e2e", durationMs: 120000 }),
    sessionRow(3, { sessionId: "sess-e2e-3", workdir: "/srv/work", remoteHost: "gpu-1", remotePort: 22 }),
  ];
}

/** pky/call → mock HostClient 分发（传输层信封 ok；业务错误在 value 信封内） */
function installRpc(): void {
  pky.rpc = {
    async call(_channel, endpoint, payload) {
      if (endpoint !== "pky/call") {
        return {
          ok: false,
          error: { code: "INVALID_ARGUMENT", message: `harness 只接 pky/call（got ${endpoint}）`, details: {} },
        };
      }
      const { args } = (payload ?? {}) as { args?: { command?: string; payload?: unknown } };
      const command = args?.command;
      const table = pky.mock as unknown as Record<string, ((p?: unknown) => Promise<unknown>) | undefined>;
      const fn = command === undefined ? undefined : table[command];
      if (typeof fn !== "function") {
        return {
          ok: false,
          error: { code: "INVALID_ARGUMENT", message: `mock 无命令 ${String(command)}`, details: {} },
        };
      }
      return { ok: true, value: await fn.call(pky.mock, args?.payload) };
    },
  };
}

/** dsh 宿主装载面等价物：捕获 client bundle 的 {inject, apply}（require = external 三件） */
function installModuleLoader(): void {
  const React = window.React;
  function jsxOf(type: unknown, props: Record<string, unknown> | null, key?: string): unknown {
    return React.createElement(type as never, key === undefined ? props : { ...props, key });
  }
  const jsxRuntime = { jsx: jsxOf, jsxs: jsxOf, Fragment: React.Fragment };
  const requireOf = (name: string): unknown => {
    if (name === "react") return React;
    if (name === "react-dom") return window.ReactDOM;
    if (name === "react/jsx-runtime") return jsxRuntime;
    throw new Error(`harness require 面外: ${name}`);
  };
  window.__ModuleLoader__ = {
    load(mod) {
      // bundle 的 factory 自建 module/exports 并以返回值递出（banner 形态）——优先取返回值
      const returned = mod.factory(requireOf) as Window["__pky"]["clientExports"];
      pky.clientExports = returned ?? ({} as Window["__pky"]["clientExports"]);
    },
  };
}

/** 伪 dsh ctx（slots 注册表落 __pky.registry；MAIN 槽按 key = PANEL_ID 寻址） */
function installCtx(): void {
  pky.ctx = {
    slots: {
      inject(_key: string, contribute: () => unknown): () => void {
        contribute();
        return () => undefined;
      },
      register(
        options: { key?: string; id?: string; name?: string },
        component: (props: Record<string, unknown>) => unknown,
      ): () => void {
        pky.registry[options.key ?? options.id ?? options.name ?? "unknown"] = component;
        return () => undefined;
      },
    },
    locale: { tag: "zh-Hans" },
    connection: { rpc: pky.rpc },
    layout: { selectPanel: () => undefined },
    // configForms 假件（clientEntry 装配期即消费 get()）：unavailable 固定快照——
    // 背包配置分区行不渲染（E2E 无该面用例；真值面经 mock rpc settings 键）。
    // getSnapshot 必须返回缓存引用（useSyncExternalStore 契约——新对象会渲染死循环）
    configForms: {
      get: () => ({
        subscribe: (): (() => void) => () => undefined,
        getSnapshot: () => CONFIG_FORMS_UNAVAILABLE,
        set: async () => false,
      }),
    },
  };
}

/** configForms unavailable 固定快照（引用稳定——useSyncExternalStore 缓存契约） */
const CONFIG_FORMS_UNAVAILABLE = { status: "unavailable" as const, writable: false };

seedMockState();
installRpc();
installModuleLoader();
installCtx();
