/**
 * dsh 远程装配段（从 hostEntry.ts 拆出以控文件行数棘轮；full-parity 2.9）：
 * RemoteCommandPlatform 组装（SshScopeHost 家族链连接 + 闭包 helper 制品权威源 +
 * dsh-ssh 家族探测投影）+ 断连守卫与周期就绪复核接线（AD §4.7）。
 * 零业务逻辑——平台胶水；coverage exclude 同 src/host/dsh/** 既有口径。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Context } from "@deepseek-ai/cordis";
import type { Plugin } from "../index";
import type { RemoteCommandPlatform } from "../commands/context";
import { listDeployments } from "../remote/deployments";
import { createRemoteDispatchGuard, type SshTerminalScope } from "../remote/sshExecutor";
import { createSshScopeHost } from "./sshScope";
import { probeDshCapabilities, sshFamilyOf, type DshCapabilityProbes, type SshFamilyProjection } from "./probeDsh";

/** 远程装配产物（platform + 断开事件挂接面 + 探测投影读取） */
export interface RemoteAssembly {
  platform: RemoteCommandPlatform;
  /** scope 断开事件注册（断连守卫挂接——AD §4.7） */
  onScopeDisconnected(listener: (deploymentId: string) => void): void;
  /** 家族探测投影（异步探测就绪后缓存；未就绪 = null 不显行） */
  familyProjection(): SshFamilyProjection | null;
  /** 全量平台探测结果（diagnosticsSnapshot.capabilities 数据源；异步就绪后缓存，未就绪 = null） */
  capabilities(): DshCapabilityProbes | null;
}

/** 闭包内 @deepseek-ai/dsh-ssh 包版本 + lib/helper.js 入口 sha256（provision/recheck 单源） */
function readClosureHelperArtifact(): { version: string; sha256: string } {
  const require = createRequire(import.meta.url);
  const pkg = require("@deepseek-ai/dsh-ssh/package.json") as { version?: unknown };
  // 包 exports 只暴露 "./helper"（→ lib/helper.js）——按导出名解析（真机暴露：
  // 裸 "./lib/helper.js" 子路径未导出，require.resolve 抛 ERR_PACKAGE_PATH_NOT_EXPORTED）
  const entry = require.resolve("@deepseek-ai/dsh-ssh/helper");
  const sha256 = createHash("sha256").update(readFileSync(entry)).digest("hex");
  return { version: typeof pkg.version === "string" ? pkg.version : "0.2.1-rc.3", sha256 };
}

/**
 * 组装 RemoteCommandPlatform：SshScopeHost（家族链连接；闭包权威摘要注入——实体 helper
 * 落后于闭包时先行直连，见 SshScopeHostOptions.helperHashAuthority）+ 闭包 helper 制品
 * （版本 + 权威 sha256 = 运行时读本机闭包 lib/helper.js 计算——spike 修正 C 口径）+ 家族探测。
 * 家族缺失时 sshFamilyAvailable() = false（远程命令按能力缺失降级，dispatch 走降级链判定）。
 */
export function remotePlatformOf(ctx: Context): RemoteAssembly {
  const scopeHost = createSshScopeHost(ctx, { helperHashAuthority: () => readClosureHelperArtifact().sha256 });
  let projection: SshFamilyProjection | null = null;
  let probes: DshCapabilityProbes | null = null;
  void probeDshCapabilities(ctx)
    .then((result) => {
      probes = result;
      projection = sshFamilyOf(result);
    })
    .catch((error: unknown) => {
      process.stderr.write(`[pokemon-choose-you] dsh-ssh 家族探测失败：${String(error)}\n`);
    });
  return {
    platform: {
      // DshSshScope 实际实现接口外扩充面（writeTerminal/terminateTerminal——交互重派/兜底收口）；
      // SshScopeHost 接口只声明基面，此处按实现事实收窄。未落定（provision 中）部署拿到
      // 的是直连 scope（无终端扩充面）——终端消费点均在就绪复核之后，直连形态不会流入
      scopeFor: (entity) => scopeHost.scopeFor(entity) as Promise<SshTerminalScope>,
      readHelperArtifact: readClosureHelperArtifact,
      sshFamilyAvailable: () => projection?.ok === true,
      disconnect: (id) => scopeHost.disconnect(id),
    },
    onScopeDisconnected: (listener) => scopeHost.onScopeDisconnected(listener),
    familyProjection: () => projection,
    capabilities: () => probes,
  };
}

/** 断连守卫 + 周期就绪复核（AD §4.7：5min；disconnected → ready 恢复挂迟到回传核对） */
export function wireRemoteGuard(ctx: Context, plugin: Plugin, remote: RemoteAssembly): void {
  const guard = createRemoteDispatchGuard(plugin.conn, remote.platform);
  remote.onScopeDisconnected((deploymentId) => {
    void guard.onScopeDisconnected(deploymentId).catch(() => undefined);
  });
  ctx.effect(() => ctx.interval(recheckReadyDeployments(plugin, guard), 5 * 60_000));
}

/** 周期复核回调（只复核 ready/disconnected 态部署；失败留实体态不炸循环） */
function recheckReadyDeployments(plugin: Plugin, guard: ReturnType<typeof createRemoteDispatchGuard>): () => void {
  return () => {
    for (const entity of Object.values(listDeployments(plugin.conn))) {
      if (entity.status === "ready" || entity.status === "disconnected") {
        void guard.recheck(entity.id).catch(() => undefined);
      }
    }
  };
}
