/**
 * dsh 插件宿主半边入口（AD §3.1 index：插件 apply/启动装配 · 能力探测 + 兼容拒绝）。
 *
 * apply 期只做能力探测与惰性注册（NFR-8：宿主冷启动增量 ≤1 秒——DB 连接/字典装载/helper
 * 拉起全部延迟到 activate/idle，骨架期尚无这些子系统）。
 */
import { createRequire } from "node:module";

/** 宿主上下文（骨架占位：真实 Cordis Context 随插件装配任务落型） */
export type HostContext = Record<string, unknown>;

/** node:sqlite 可用性探测结果（A1 / AD NFR-3 ②） */
export interface SqliteCapability {
  ok: boolean;
  /** 探测时的宿主 Node 版本（如 "24.21.0"） */
  nodeVersion: string;
  /** 不可用时的失败详情（可用时为 undefined） */
  detail?: string;
}

/**
 * 探测宿主 Node 运行时的 node:sqlite（DatabaseSync）可开可用。
 * A1：dsh desktop 由 Electron 托管、内嵌 Node 未必 ≥ 24（node:sqlite 22.5+ 引入且长期
 * experimental）——探测失败按 AD A1 回落链处理（better-sqlite3 + 按 ABI 分发预编译产物）。
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
 *
 * 能力探测（AD NFR-3 ②）：当前仅探测 node:sqlite（storage/ 的前置）；timer / subagent /
 * worktrees / ssh / storage / slots / terminal 表面与宿主 Node 运行时全集随域核心任务补全，
 * 探测清单与 docs/compatibility.md 矩阵的一致性由单测断言——挂点清单见 src/host/README.md。
 */
export function apply(ctx: HostContext, probe: () => SqliteCapability = probeNodeSqlite): void {
  void ctx; // 骨架期无消费面；真实装配任务接入 Cordis Context
  const capability = probe();
  if (!capability.ok) {
    throw unsupportedSqliteError(capability);
  }
  // 惰性注册：骨架期无可注册面；storage/domain/radio/judge/anonymize/dispatch/health/pet/i18n
  // 各模块装配随并行组 1 后续任务落位（specs/dsh-plugin/plan.md）。
}
