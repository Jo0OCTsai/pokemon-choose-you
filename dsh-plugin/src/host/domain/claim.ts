/**
 * 判定 claim 协议（A22/A5/A6）——行为基准 = src-tauri/src/commands/radio/judge.rs（0B 落地）：
 * pending → judging 原子抢占写令牌、judging 超 10 分钟回收回 pending、
 * claim 口径的 error 标记（只翻转本 claim 抢到的行——迟到/失配不污染其他形态判定）。
 */
import { nowRfc3339, type Conn } from "../storage/db";

/** 判定 claim 超时回收窗口（分钟，A6）：claim 后崩溃/被杀不会自己恢复 */
export const JUDGING_TIMEOUT_MINUTES = 10;

const ERROR_CLEAR_SET =
  "suggested_title=NULL, suggested_note=NULL, suggested_category=NULL, suggested_due=NULL, " +
  "suggested_priority=NULL, suggested_tags='[]', suggested_reason=NULL, suggested_confidence=NULL, " +
  "update_task_id=NULL";

/**
 * 判定 claim：pending → judging 原子抢占并写 claim 令牌（judge_claimed_at 时间戳，
 * 本批共用一个）。返回实际 claim 到的子集——claim 落空的消息属其他形态/下一轮
 * （不报错），调用方只对子集继续判定。
 */
export function claimJudging(conn: Conn, messageIds: string[], claimTs: string): string[] {
  const claimed: string[] = [];
  const stmt = conn.prepare(
    "UPDATE chat_messages SET ai_status='judging', judge_claimed_at=? WHERE message_id=? AND ai_status='pending'",
  );
  for (const id of messageIds) {
    const n = stmt.run(claimTs, id);
    if (Number(n.changes) > 0) {
      claimed.push(id);
    }
  }
  return claimed;
}

/**
 * judging 超时回收（A6）：超过 10 分钟的行回置 pending（令牌清空）待重判，
 * 任一形态在轮询/重判开头调用即可崩溃自愈（rfc3339 字典序与时间序一致）。
 */
export function reclaimStaleJudging(conn: Conn, now = nowRfc3339()): number {
  const cutoff = nowRfc3339(new Date(new Date(now).getTime() - JUDGING_TIMEOUT_MINUTES * 60 * 1000));
  const n = conn
    .prepare(
      "UPDATE chat_messages SET ai_status='pending', judge_claimed_at='' " +
        "WHERE ai_status='judging' AND judge_claimed_at <> '' AND judge_claimed_at < ?",
    )
    .run(cutoff);
  return Number(n.changes);
}

/** 把消息标记为「AI 判定失败」（mark_ai_error_conn 同构）：只翻转仍未落库判定的消息 */
export function markAiError(conn: Conn, messageIds: string[], claimTs?: string): number {
  let marked = 0;
  const noClaim = conn.prepare(
    `UPDATE chat_messages SET ai_status='error', ${ERROR_CLEAR_SET} WHERE message_id=? AND ai_status='pending'`,
  );
  const withClaim = conn.prepare(
    `UPDATE chat_messages SET ai_status='error', ${ERROR_CLEAR_SET} WHERE message_id=? AND ai_status='judging' AND judge_claimed_at=?`,
  );
  for (const id of messageIds) {
    const n = claimTs === undefined ? noClaim.run(id) : withClaim.run(id, claimTs);
    marked += Number(n.changes);
  }
  return marked;
}
