/**
 * harness pre：在 dist/client.js 之前就位的三件事——
 * ① window.__ModuleLoader__ shim（dsh 宿主装载面的等价物；require 面 = react 系 external）；
 * ② mockHost 伪 rpc（connection.call → pky/call → mock HostClient 命令分发）；
 * ③ 伪 dsh ctx（slots/locale/connection/layout——clientEntry apply 消费面）。
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
  };
}

seedMockState();
installRpc();
installModuleLoader();
installCtx();
