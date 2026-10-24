/**
 * 库装配入口：migrate + 种子（对齐主应用 db.rs init_conn 的「迁移 + 默认分类（幂等）」；
 * 只读模式跳过种子——不向超窗库写任何东西，FR-X2 浏览不损坏）。
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { open, type Conn } from "./db";
import { migrate, type MigrateResult } from "./migrate";
import { normalizeLegacyAgentPresets, seedDefaults } from "./seed";

/** 已迁移 + 已种子的连接（各模块测试的公共起点，对齐 Rust test_conn） */
export interface InitResult {
  conn: Conn;
  migration: MigrateResult;
}

/** 在已有连接上执行 guarded 迁移 + 种子（幂等；readonly 时不写种子）。
 * 种子段含存量 agent 预设升级标记（db.rs init_conn 全序：migrate → 种子 →
 * normalize_legacy_agent_presets，FR-X3 契约夹具锁定标记行）。 */
export function initConn(conn: Conn): MigrateResult {
  const migration = migrate(conn);
  if (migration.mode === "ok") {
    seedDefaults(conn);
    normalizeLegacyAgentPresets(conn);
  }
  return migration;
}

/** 打开（或冷启动创建）共享库并完成迁移 + 种子（D15：库文件不存在 → 建目录 → 建库） */
export function openAndInit(dbPath: string): InitResult {
  mkdirSync(dirname(dbPath), { recursive: true });
  const conn = open(dbPath);
  const migration = initConn(conn);
  return { conn, migration };
}
