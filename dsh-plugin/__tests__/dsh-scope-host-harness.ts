/**
 * dsh/sshScopeHost 测试替身（从 dsh-scope-host.spec 抽出——棘轮 max-lines；
 * dsh-scope-host-stale.spec 共用）：计数 fake scope / 部署实体工厂 / 占位 ctx /
 * 受测宿主装配（直连与 isolate 双工厂记录，connect 按队列出队）。
 */
import type { DeploymentEntity } from "../src/host/remote/deployments";
import type { SshScope, SshSpawnResult } from "../src/host/remote/sshScope";
import { createSshScopeHost, type CordisHostContext, type SshFamilyConfig } from "../src/host/dsh/sshScope";

/** 计数 fake scope（disconnect 收口 / 断开事件断言面；connect 注入按队列出队） */
export class FakeScope implements SshScope {
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

export function entity(
  overrides: Partial<Pick<DeploymentEntity, "helperPath" | "helperHash" | "workdir" | "alias" | "provision">> = {},
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
    provision: overrides.provision ?? null,
    degraded: false,
    pkTunnel: null,
  };
}

/** fake ctx（isolate 装配注入面接管后不再被触碰——占位满足结构类型） */
export const fakeCtx: CordisHostContext = {
  isolate: () => fakeCtx,
  plugin: () => Object.assign(Promise.resolve(), { dispose: () => Promise.resolve() }),
};

/** 受测宿主装配：注入直连/isolate 双工厂记录（connect 按队列出队 scope）；权威摘要可选注入 */
export function setupHost(opts: { scopes?: FakeScope[]; helperHashAuthority?: () => string } = {}) {
  const queue = [...(opts.scopes ?? [new FakeScope()])];
  const directAliases: string[] = [];
  const connectCalls: Array<{ deploymentId: string; config: SshFamilyConfig }> = [];
  const host = createSshScopeHost(fakeCtx, {
    helperHashAuthority: opts.helperHashAuthority,
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
