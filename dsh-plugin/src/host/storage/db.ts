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

// ---- 单调实时时钟（FR-X3 契约回放对齐，见下方 nowRfc3339 注释） ----

/** 进程内单调时钟状态：同毫秒内以微秒序号递增（连续调用值必不同） */
let lastMs = 0;
let lastSeq = 0;

function formatRfc3339(ms: number, seq: number): string {
  const base = new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "");
  return `${base}.${String((ms % 1000) * 1000 + seq).padStart(6, "0")}+00:00`;
}

function monotonicNowRfc3339(): string {
  let ms = Date.now();
  if (ms <= lastMs) {
    // 同毫秒（或时钟回拨）：序号 +1 保严格单调；序号超出 6 位小数承载时借下一毫秒
    ms = lastMs;
    lastSeq += 1;
    if (lastSeq > 999_999) {
      ms += 1;
      lastSeq = 0;
    }
  } else {
    lastSeq = 0;
  }
  lastMs = ms;
  return formatRfc3339(ms, lastSeq);
}

/**
 * 当前时刻的 RFC3339 串（UTC，`+00:00` 后缀——与主应用 chrono to_rfc3339 同形态，
 * rfc3339 字典序与时间序一致，跨形态比较 lease/claim 时间戳不失真）。
 * 传入 date = 纯格式化（测试与契约场景注入确定性时钟）；缺省 = 实时单调时钟
 * （微秒精度、连续调用值必不同——Rust oracle 每写点独立 db::now()（chrono 纳秒
 * 精度），毫秒共享会让契约回放的 <ts:N> 归一把「应各占一位的时间戳」塌缩成同值，
 * FR-X3 按夹具对齐）。
 */
export function nowRfc3339(date?: Date): string {
  if (date !== undefined) {
    return date.toISOString().replace("Z", "+00:00");
  }
  return monotonicNowRfc3339();
}

/**
 * RFC3339 串整体平移秒数（保留微秒小数——单调时钟的亚毫秒精度不入 Date 毫秒截断）。
 * 槽租约时长推导用（acquired + leaseSecs —— Rust `t + Duration` 同语义）。
 */
export function shiftRfc3339Seconds(s: string, secs: number): string {
  const frac = /\.(\d{6})\+00:00$/.exec(s)?.[1] ?? "000000";
  const shifted = new Date(Date.parse(s) + secs * 1000);
  return `${shifted.toISOString().replace(/\.\d{3}Z$/, "")}.${frac}+00:00`;
}

/** PRAGMA user_version（schema 版本单源，PROTOCOL.md §1） */
export function getUserVersion(conn: Conn): number {
  const row = conn.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version;
}
