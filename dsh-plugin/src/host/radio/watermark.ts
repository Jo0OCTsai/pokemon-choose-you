/**
 * 共享水位（AD §4.5 / D14 分支 A）：读取与 CAS 推进——拉取自由并发（D11 消息级
 * 幂等），双形态只靠水位 compare-and-swap 收敛：UPDATE 带 WHERE cursor=old，
 * affected=0 即他形态已推进 → 重读合并（单调不回退，取 max）。
 * 写入 = sync_state + settings.feishu_cursor 双写（poll_once_inner 尾部两笔写入的
 * 事务化收敛）；读取基准 = src-tauri/src/feishu.rs（since 读 settings.feishu_cursor）。
 */
import { nowRfc3339, txImmediate, type Conn } from "../storage/db";
import { getSetting, setSetting } from "../domain/settings";

/** 水位 provider 键（sync_state 主键） */
export const WATERMARK_PROVIDER = "feishu";

/** 水位在 settings 表的镜像键（Rust poll_once_inner 读取源） */
export const WATERMARK_SETTING_KEY = "feishu_cursor";

export interface WatermarkOutcome {
  /** 本轮写入是否生效（CAS 失配合并后新值未胜出 = false） */
  advanced: boolean;
  /** 合并后的库内水位（毫秒） */
  cursor: number;
}

function readSyncStateCursor(conn: Conn): number | null {
  const row = conn.prepare("SELECT cursor FROM sync_state WHERE provider=?").get(WATERMARK_PROVIDER) as
    { cursor: string | null } | undefined;
  if (row === undefined || row.cursor === null || row.cursor === "") {
    return null;
  }
  const n = Number(row.cursor);
  return Number.isFinite(n) ? n : null;
}

/**
 * 读当前水位（毫秒）：settings.feishu_cursor 优先（Rust 同源），sync_state 兜底
 * （崩溃可能留下半写——两处本应同值，读面双保险）。
 */
export function readWatermark(conn: Conn): number | null {
  const raw = getSetting(conn, WATERMARK_SETTING_KEY);
  if (raw !== null && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return readSyncStateCursor(conn);
}

function writeBoth(conn: Conn, cursor: number, now: string): void {
  conn
    .prepare(
      "INSERT INTO sync_state (provider, cursor, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(provider) DO UPDATE SET cursor=excluded.cursor, updated_at=excluded.updated_at",
    )
    .run(WATERMARK_PROVIDER, String(cursor), now);
  setSetting(conn, WATERMARK_SETTING_KEY, String(cursor));
}

/** CAS 失配后的合并：水位单调不回退（两形态时钟略偏也收敛到 max） */
function mergeAfterConflict(conn: Conn, newCursor: number, now: string): WatermarkOutcome {
  const current = readSyncStateCursor(conn);
  const merged = current !== null && current >= newCursor ? current : newCursor;
  writeBoth(conn, merged, now);
  return { advanced: merged === newCursor, cursor: merged };
}

/**
 * CAS 推进水位（单条 BEGIN IMMEDIATE）：oldCursor=null 走首拉 INSERT 抢占，
 * 否则 UPDATE ... WHERE cursor=old；affected=0（他形态已推进/行结构漂移）→
 * 重读合并。返回合并后水位与本轮是否生效。
 */
export function advanceWatermark(
  conn: Conn,
  oldCursor: number | null,
  newCursor: number,
  now = nowRfc3339(),
): WatermarkOutcome {
  return txImmediate(conn, () => {
    if (oldCursor === null) {
      const n = conn
        .prepare(
          "INSERT INTO sync_state (provider, cursor, updated_at) VALUES (?, ?, ?) " +
            "ON CONFLICT(provider) DO NOTHING",
        )
        .run(WATERMARK_PROVIDER, String(newCursor), now);
      if (Number(n.changes) > 0) {
        setSetting(conn, WATERMARK_SETTING_KEY, String(newCursor));
        return { advanced: true, cursor: newCursor };
      }
      return mergeAfterConflict(conn, newCursor, now);
    }
    const n = conn
      .prepare("UPDATE sync_state SET cursor=?, updated_at=? WHERE provider=? AND cursor=?")
      .run(String(newCursor), now, WATERMARK_PROVIDER, String(oldCursor));
    if (Number(n.changes) > 0) {
      setSetting(conn, WATERMARK_SETTING_KEY, String(newCursor));
      return { advanced: true, cursor: newCursor };
    }
    return mergeAfterConflict(conn, newCursor, now);
  });
}
