/**
 * guarded 迁移（AD §5.3 双执行方协议 · D29 迁移执行权收编）：
 * - 事务内取号（BEGIN IMMEDIATE 下读 user_version，读到的一定是提交后的新鲜值）；
 * - 迁移 SQL 单源 = `contracts/schema/`（编号顺序执行），迁移与版本号同事务
 *   （中途崩溃不留下「改了表但没记版本」的中间态，与主应用 db.rs migrate 同语义）；
 * - **迁移封顶 = 插件打包的最新契约版（D29 语义，取代 A19「封顶 minSchema」）**：
 *   冷启动与旧库升级一律迁到 `SCHEMA_FILES.length`（打包窗口上限）。独立分发后插件
 *   是唯一迁移执行方；双形态并存 = 插件推到打包上限、主应用可推更高、任一方窗口外
 *   只读保护（FR-X2 语义不变）。contracts 追加迁移时窗口常量与内嵌 SQL 必须同版发版
 *   （`__tests__/migrate.spec.ts` 同版断言是发布检查单的机器面）；
 * - 库版本 > maxSchema → 只读模式标记（DB_SCHEMA_TOO_NEW，浏览不损坏——FR-X2）；
 *   写命令前置检查由适配层消费该标记。
 *
 * SQL 内容双 loader（PROTOCOL.md §1）：编译期内嵌（vite `?raw`，经 registerEmbeddedSchemas
 * 注册——schema-raw.ts）优先；运行时（直跑 node / 内嵌缺失）回落按相对路径读磁盘文件。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getUserVersion, txImmediate, type Conn } from "./db";

/** 契约 schema 文件（编号顺序 = 迁移顺序；MIGRATIONS[i] 把 user_version 从 i 升到 i+1） */
export const SCHEMA_FILES = ["001_v1.sql", "002_dispatch_coord.sql"] as const;

/** 插件兼容窗口下限（dbStatus 呈现面；低于此值的库直接迁到打包上限——不再按下限停步） */
export const MIN_SCHEMA = 2;

/** 插件兼容窗口上限：库版本超出 → 只读模式（DB_SCHEMA_TOO_NEW）。
 *  铁律（D29 同版发版）：本值恒等于打包的契约 SQL 数——contracts 追加 003 而未同步
 *  本常量与 schema-raw.ts 时，migrate.spec.ts 同版断言红。 */
export const MAX_SCHEMA = SCHEMA_FILES.length;

/** fs 回落的候选目录（源码树 / 打包布局的常见相对位置，逐个尝试） */
const FS_SCHEMA_DIRS = [
  "../../../../contracts/schema", // <repo>/contracts/schema（源码树：src/host/storage → 仓库根）
  "../../../contracts/schema", // dsh-plugin/ 为包根的布局
  "../../contracts/schema", // contracts 与 storage 同级并入包的布局
];

let embeddedSchemas: Record<string, string> | null = null;

/** 注册编译期内嵌的契约 SQL（插件入口 / 测试装配时调用一次；vite `?raw` 链路） */
export function registerEmbeddedSchemas(map: Record<string, string>): void {
  embeddedSchemas = { ...map };
}

export type SchemaSource = "embedded" | "fs";

/**
 * 读取一份契约 schema SQL：内嵌注册表优先，fs 相对路径兜底。
 * 两种来源都找不到时抛错（schema 单源缺失属装配错误，不静默降级）。
 */
export function loadSchemaSql(file: string): { sql: string; source: SchemaSource } {
  const embedded = embeddedSchemas?.[file];
  if (embedded !== undefined) {
    return { sql: embedded, source: "embedded" };
  }
  const base = dirname(fileURLToPath(import.meta.url));
  for (const dir of FS_SCHEMA_DIRS) {
    try {
      return { sql: readFileSync(join(base, dir, file), "utf8"), source: "fs" };
    } catch {
      // 候选目录不存在：试下一个
    }
  }
  throw new Error(`找不到契约 schema 文件 ${file}（contracts/schema/ 单源缺失——内嵌未注册且磁盘相对路径不可达）`);
}

/** guarded 迁移结果：mode=readonly 即只读模式（适配层对全部写命令前置 DB_SCHEMA_TOO_NEW） */
export interface MigrateResult {
  mode: "ok" | "readonly";
  userVersion: number;
  /** 插件声明的兼容窗口（dbStatus 命令的响应面） */
  pluginWindow: { min: number; max: number };
}

/**
 * guarded 迁移主入口（幂等）：v > maxSchema → 只读标记（不迁移不动库）；
 * v < SCHEMA_FILES.length → 逐条迁移到打包上限（每步一个 BEGIN IMMEDIATE 事务，SQL 与
 * 版本号同事务提交；D29：独立分发后插件是唯一迁移执行方，冷启动与旧库一律迁满打包窗口）；
 * 区间内 → no-op。只读判定同样在 BEGIN IMMEDIATE 内取号（读到的一定是提交后的新鲜值，
 * AD §5.3 步骤 1）。
 */
export function migrate(conn: Conn): MigrateResult {
  const version = txImmediate(conn, () => {
    let v = getUserVersion(conn);
    if (v > MAX_SCHEMA) {
      return v;
    }
    while (v < SCHEMA_FILES.length) {
      // SCHEMA_FILES[v] 负责把 user_version 从 v 升到 v+1（编号顺序铁律：只追加不修改）
      const { sql } = loadSchemaSql(SCHEMA_FILES[v]);
      conn.exec(sql);
      conn.exec(`PRAGMA user_version = ${v + 1};`);
      v += 1;
    }
    return v;
  });
  if (version > MAX_SCHEMA) {
    return { mode: "readonly", userVersion: version, pluginWindow: { min: MIN_SCHEMA, max: MAX_SCHEMA } };
  }
  return { mode: "ok", userVersion: version, pluginWindow: { min: MIN_SCHEMA, max: MAX_SCHEMA } };
}

/** 库状态（host 命令 dbStatus 的响应面；userVersion + 窗口 + 模式） */
export function dbStatus(conn: Conn): MigrateResult {
  const version = getUserVersion(conn);
  return version > MAX_SCHEMA
    ? { mode: "readonly", userVersion: version, pluginWindow: { min: MIN_SCHEMA, max: MAX_SCHEMA } }
    : { mode: "ok", userVersion: version, pluginWindow: { min: MIN_SCHEMA, max: MAX_SCHEMA } };
}
