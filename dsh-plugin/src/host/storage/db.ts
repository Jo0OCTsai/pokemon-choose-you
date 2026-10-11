/**
 * 连接与事务助手（AD §5.1：全插件唯一握连接的模块；AD §3.1「db/」）。
 * 连接级 PRAGMA 与主应用 db.rs CONN_PRAGMAS 逐字对齐（WAL 多进程并发 +
 * NORMAL 同步 + busy_timeout=5000——主应用 §7.1 条目 9 同款）。
 * 写路径铁律（PROTOCOL.md §1）：全部单条 BEGIN IMMEDIATE 短事务，禁止嵌套、
 * 禁止事务内子进程调用 / await。
 */
import { DatabaseSync } from "node:sqlite";

/** 连接类型别名（node:sqlite 同步 API，与 rusqlite 同构） */
export type Conn = DatabaseSync;

/** 连接级 PRAGMA（与 src-tauri/src/db.rs CONN_PRAGMAS 逐字一致） */
export const CONN_PRAGMAS = "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;";

/** 打开连接并立即执行连接级 PRAGMA（PROTOCOL.md §1「打开即执行」） */
export function open(path: string): Conn {
  const conn = new DatabaseSync(path) as Conn;
  conn.exec(CONN_PRAGMAS);
  return conn;
}

/** 正处于 txImmediate 事务中的连接（嵌套禁止的进程内守卫；跨进程由 SQLite 写锁兜底） */
const inTx = new WeakSet<object>();

/**
 * 单条 BEGIN IMMEDIATE 短事务助手（PROTOCOL.md §1）：立即取写锁——读到的一定是
 * 提交后的新鲜值（AD §5.3 guarded 取号依赖此语义）。fn 抛错整体回滚；
 * 嵌套调用（事务里再开事务）直接抛错，不用 SQLite 的隐式报错以给出明确指引。
 */
export function txImmediate<T>(conn: Conn, fn: () => T): T {
  if (inTx.has(conn)) {
    throw new Error("txImmediate 不允许嵌套——写路径必须是单条 BEGIN IMMEDIATE 短事务（PROTOCOL.md §1）");
  }
  conn.exec("BEGIN IMMEDIATE");
  inTx.add(conn);
  try {
    const result = fn();
    conn.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      conn.exec("ROLLBACK");
    } catch {
      // 连接级故障（如进程间锁升级失败）下 ROLLBACK 可能再抛——保留原始异常
    }
    throw error;
  } finally {
    inTx.delete(conn);
  }
}

/**
 * 当前时刻的 RFC3339 串（UTC，`+00:00` 后缀——与主应用 chrono to_rfc3339 同形态，
 * rfc3339 字典序与时间序一致，跨形态比较 lease/claim 时间戳不失真）。
 * 测试与契约场景注入确定性时钟时传入 date。
 */
export function nowRfc3339(date: Date = new Date()): string {
  return date.toISOString().replace("Z", "+00:00");
}

/** PRAGMA user_version（schema 版本单源，PROTOCOL.md §1） */
export function getUserVersion(conn: Conn): number {
  const row = conn.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version;
}
