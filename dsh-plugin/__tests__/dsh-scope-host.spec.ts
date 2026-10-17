/**
 * dsh/sshScopeHost：scopeFor 路由判定（acceptance §4 已知项 1）——helper 落定状态
 * 二分：helperPath + helperHash 均落定 → dsh-ssh isolate 装配（存活复用 / 配置漂移
 * 重建 / 断连事件收口）；任一未落定（provision 前置步）→ 直连 scope 工厂。直连与
 * isolate 工厂均注入 fake 锁路由（不触碰真实家族装载——真机验证归 spike + profile 冒烟）。
 */
import { describe, expect, it } from "vitest";
import type { DeploymentEntity } from "../src/host/remote/deployments";
import type { SshScope, SshSpawnResult } from "../src/host/remote/sshScope";
import {
  createSshScopeHost,
  familyProvisioned,
  type CordisHostContext,
  type SshFamilyConfig,
} from "../src/host/dsh/sshScope";

/** 计数 fake scope（disconnect 收口 / 断开事件断言面；connect 注入按队列出队） */
class FakeScope implements SshScope {
  disconnectCalls = 0;
  onDisconnected?: (id: string) => void;
  constructor(readonly connectedValue = true) {}
  get connected(): boolean {
    return this.connectedValue;
  }
  async spawn(): Promise<SshSpawnResult> {
    return { code: 0, stdout: "", stderr: "", durationMs: 1 };
  }
  async spawnTerminal(): Promise<{ sessionId: string }> {
    return { sessionId: "fake" };
  }
  async shell(): Promise<{ code: number; stdout: string; stderr: string }> {
    return { code: 0, stdout: "", stderr: "" };
  }
  async writeFile(): Promise<{ sha256: string }> {
    return { sha256: "0".repeat(64) };
  }
  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
  }
}

function entity(
  overrides: Partial<Pick<DeploymentEntity, "helperPath" | "helperHash" | "workdir" | "alias">> = {},
): DeploymentEntity {
  return {
    id: "dep-1",
    alias: overrides.alias ?? "dev-box",
    nodePath: "/usr/local/bin/node",
    helperPath: overrides.helperPath ?? "",
    helperHash: overrides.helperHash ?? null,
    workdir: overrides.workdir ?? "/srv/app",
    note: "",
    status: "not_ready",
    lastError: null,
    provision: null,
    degraded: false,
  };
}

/** fake ctx（isolate 装配注入面接管后不再被触碰——占位满足结构类型） */
const fakeCtx: CordisHostContext = {
  isolate: () => fakeCtx,
  plugin: () => Object.assign(Promise.resolve(), { dispose: () => Promise.resolve() }),
};

/** 受测宿主装配：注入直连/isolate 双工厂记录（connect 按队列出队 scope） */
function setupHost(opts: { scopes?: FakeScope[] } = {}) {
  const queue = [...(opts.scopes ?? [new FakeScope()])];
  const directAliases: string[] = [];
  const connectCalls: Array<{ deploymentId: string; config: SshFamilyConfig }> = [];
  const host = createSshScopeHost(fakeCtx, {
    directScopeFor: (alias) => {
      directAliases.push(alias);
      return new FakeScope();
    },
    connect: (_ctx, _labels, deploymentId, config, _workdir, onDisconnected) => {
      connectCalls.push({ deploymentId, config });
      const made = queue.length > 0 ? queue.shift()! : new FakeScope();
      made.onDisconnected = onDisconnected;
      return Promise.resolve({ configKey: JSON.stringify(config), scope: made });
    },
  });
  return { host, directAliases, connectCalls, scopes: opts.scopes ?? [] };
}

describe("familyProvisioned（helper 落定判定单源）", () => {
  it("helperPath 与 helperHash 均落定 → true；任一未落定 → false（双向）", () => {
    expect(familyProvisioned(entity({ helperPath: "/h", helperHash: "a".repeat(64) }))).toBe(true);
    expect(familyProvisioned(entity({ helperPath: "", helperHash: "a".repeat(64) }))).toBe(false);
    expect(familyProvisioned(entity({ helperPath: "/h", helperHash: null }))).toBe(false);
    expect(familyProvisioned(entity())).toBe(false);
  });
});

describe("scopeFor 路由：未落定 → 直连工厂", () => {
  it("helperPath 空（全新部署）→ 直连工厂吃 alias、零家族装配；返回直连 scope", async () => {
    const { host, directAliases, connectCalls } = setupHost();
    const scope = await host.scopeFor(entity());
    expect(directAliases).toEqual(["dev-box"]);
    expect(connectCalls).toHaveLength(0);
    expect(scope.connected).toBe(true);
  });

  it("helperHash null（upload 已装未校验）→ 同样走直连（步④ verify 仍是前置步传输）", async () => {
    const { host, directAliases, connectCalls } = setupHost();
    await host.scopeFor(entity({ helperPath: "/home/dev/.dsh-helper/pky-0.1.0/x/helper.js" }));
    expect(directAliases).toHaveLength(1);
    expect(connectCalls).toHaveLength(0);
  });

  it("未落定不占 live 槽（直连无长连）：落定后首取即走家族装配", async () => {
    const { host, directAliases, connectCalls } = setupHost();
    await host.scopeFor(entity({ helperPath: "/h", helperHash: "a".repeat(64) }));
    expect(directAliases).toHaveLength(0);
    expect(connectCalls).toHaveLength(1);
  });
});

describe("scopeFor 路由：落定 → isolate 装配", () => {
  it("helper 五元组组装（host=alias/node/helper/workspace；workdir 空 → 登录目录 '.'）", async () => {
    const { host, connectCalls } = setupHost();
    await host.scopeFor(entity({ helperPath: "/h/helper.js", helperHash: "a".repeat(64), workdir: "" }));
    expect(connectCalls).toHaveLength(1);
    expect(connectCalls[0]).toMatchObject({
      deploymentId: "dep-1",
      config: {
        host: "dev-box",
        node: "/usr/local/bin/node",
        helper: "/h/helper.js",
        helperHash: "a".repeat(64),
        workspace: ".",
      },
    });
  });

  it("存活连接复用：同实体第二次 scopeFor 零新装配、同实例（NFR-15 部署级复用）", async () => {
    const scope = new FakeScope();
    const { host, connectCalls } = setupHost({ scopes: [scope] });
    const first = await host.scopeFor(entity({ helperPath: "/h", helperHash: "a".repeat(64) }));
    const second = await host.scopeFor(entity({ helperPath: "/h", helperHash: "a".repeat(64) }));
    expect(connectCalls).toHaveLength(1);
    expect(second).toBe(first);
    expect(second).toBe(scope);
  });
});

describe("scopeFor 路由：漂移 / 断连 / 装配失败", () => {
  it("配置漂移（workdir 变更）→ 旧 scope disconnect 后重建", async () => {
    const scope = new FakeScope();
    const { host, connectCalls } = setupHost({ scopes: [scope, new FakeScope()] });
    await host.scopeFor(entity({ helperPath: "/h", helperHash: "a".repeat(64) }));
    const rebuilt = await host.scopeFor(
      entity({ helperPath: "/h", helperHash: "a".repeat(64), workdir: "/srv/other" }),
    );
    expect(connectCalls).toHaveLength(2);
    expect(scope.disconnectCalls).toBe(1);
    expect(rebuilt.connected).toBe(true);
  });

  it("live scope 已断开（connected=false）→ 不复用、重装配", async () => {
    const broken = new FakeScope(false);
    const { host, connectCalls } = setupHost({ scopes: [broken, new FakeScope(true)] });
    await host.scopeFor(entity({ helperPath: "/h", helperHash: "a".repeat(64) }));
    const rebuilt = await host.scopeFor(entity({ helperPath: "/h", helperHash: "a".repeat(64) }));
    expect(connectCalls).toHaveLength(2);
    expect(broken.disconnectCalls).toBe(1);
    expect(rebuilt.connected).toBe(true);
  });

  it("断开事件：onDisconnected → live 注销 + 监听器收到部署 id；下次 scopeFor 重装配", async () => {
    const scope = new FakeScope();
    const { host, connectCalls } = setupHost({ scopes: [scope, new FakeScope()] });
    const events: string[] = [];
    host.onScopeDisconnected((id) => events.push(id));
    await host.scopeFor(entity({ helperPath: "/h", helperHash: "a".repeat(64) }));
    scope.onDisconnected?.("dep-1");
    expect(events).toEqual(["dep-1"]);
    await host.scopeFor(entity({ helperPath: "/h", helperHash: "a".repeat(64) }));
    expect(connectCalls).toHaveLength(2); // 注销后重建
  });

  it("装配失败 → 向上抛（调用方按「连接建立失败」映射）", async () => {
    const host = createSshScopeHost(fakeCtx, {
      directScopeFor: () => new FakeScope(),
      connect: () => Promise.reject(new Error("helper 摘要不符")),
    });
    await expect(host.scopeFor(entity({ helperPath: "/h", helperHash: "a".repeat(64) }))).rejects.toThrow(/摘要不符/);
  });
});
