/**
 * dsh 插件宿主半边入口（AD §3.1 index：插件 apply/启动装配 · 能力探测 + 兼容拒绝）。
 *
 * apply 期只做能力探测与惰性注册（NFR-8：宿主冷启动增量 ≤1 秒——DB 连接/字典装载/
 * helper 拉起全部延迟到 activate/idle）；惰性装配工厂 `createPlugin(deps)` 见
 * assembly.ts（本文件再出口，消费面 import 路径不变）。
 *
 * 真实 dsh（Cordis）Context 的桥接留接口注释、不引 dsh 包：dsh 适配层后续把
 * tools/commands/pageOpen/chip 投影到真实平台面（timer/subagent/worktrees/ssh/
 * storage/slots/terminal 表面探测同在适配层落位，键已入 CAPABILITY_KEYS 锁一致性）。
 */
import { createRequire } from "node:module";

export { createPlugin, type Plugin, type PluginDeps } from "./assembly";

/** 宿主上下文（骨架占位：真实 Cordis Context 随插件装配任务落型） */
export type HostContext = Record<string, unknown>;

// ---- 能力探测（AD NFR-3 ②；清单与 docs/compatibility.md 矩阵一致性由单测断言） ----

/**
 * apply 期能力探测清单全集（单源）：键与 docs/compatibility.md 矩阵「探测键」列
 * 逐字一致（NFR-3 ③——矩阵与探测项不一致即红）。node:sqlite / node 运行时在本仓
 * 可直接探测；dsh 表面（timer/subagent/worktrees/ssh/storage/slots/terminal）探测
 * 挂真实 dsh Context 的适配层（本任务不接真 dsh，键先入清单锁一致性）。
 */
export const CAPABILITY_KEYS = [
  "node-runtime",
  "node-sqlite",
  "dsh",
  "dsh-timer",
  "dsh-subagent",
  "dsh-worktrees",
  "dsh-ssh",
  "dsh-storage",
  "dsh-slots",
  "dsh-terminal",
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

/** node:sqlite 可用性探测结果（A1 / AD NFR-3 ②） */
export interface SqliteCapability {
  ok: boolean;
  /** 探测时的宿主 Node 版本（如 "24.21.0"） */
  nodeVersion: string;
  /** 不可用时的失败详情（可用时为 undefined） */
  detail?: string;
}

/** Node 运行时基线（node:sqlite 22.5+ 引入且长期 experimental；工具链基线 ≥24） */
const NODE_MAJOR_BASELINE = 24;

/** 宿主 Node 运行时探测（≥24 基线；矩阵 node-runtime 行） */
export function probeNodeRuntime(): { ok: boolean; nodeVersion: string; detail?: string } {
  const nodeVersion = process.versions.node;
  const major = Number(nodeVersion.split(".")[0]);
  if (!Number.isFinite(major) || major < NODE_MAJOR_BASELINE) {
    return { ok: false, nodeVersion, detail: `Node ≥ ${NODE_MAJOR_BASELINE} 基线不满足` };
  }
  return { ok: true, nodeVersion };
}

/**
 * 探测宿主 Node 运行时的 node:sqlite（DatabaseSync）可开可用。
 * A1：dsh desktop 由 Electron 托管、内嵌 Node 未必 ≥ 24——探测失败按 AD A1 回落链处理
 * （better-sqlite3 + 按 ABI 分发预编译产物）。
 */
export function probeNodeSqlite(): SqliteCapability {
  const nodeVersion = process.versions.node;
  try {
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
      DatabaseSync: new (location: string) => { close(): void };
    };
    const db = new DatabaseSync(":memory:");
    db.close();
    return { ok: true, nodeVersion };
  } catch (error) {
    return { ok: false, nodeVersion, detail: String(error) };
  }
}

/** 缺关键能力时的载入拒绝错误（不静默半工作——AD NFR-3 ②） */
export function unsupportedSqliteError(capability: SqliteCapability): Error {
  const detail = capability.detail ? `：${capability.detail}` : "";
  return new Error(
    `[dsh-plugin] node:sqlite 不可用（宿主 Node ${capability.nodeVersion}${detail}）。` +
      "指引：将 dsh 宿主的 Node 运行时升级到 ≥ 24；仍不可用（如 Electron 裁剪内建模块）时按 AD A1 回落 better-sqlite3 + electron-rebuild。",
  );
}

/**
 * 插件 apply：能力探测 + 惰性注册骨架。
 * 探测清单全集见 CAPABILITY_KEYS（dsh 表面探测随真实 dsh Context 适配层落位，
 * 骨架期对可独立探测的 node:sqlite 硬拒绝——缺关键能力载入失败 + 指引，不静默半工作）。
 */
export function apply(ctx: HostContext, probe: () => SqliteCapability = probeNodeSqlite): void {
  void ctx; // 骨架期无消费面；真实装配任务接入 Cordis Context
  const capability = probe();
  if (!capability.ok) {
    throw unsupportedSqliteError(capability);
  }
}
