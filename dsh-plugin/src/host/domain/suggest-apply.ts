/**
 * 判定落库原语（apply_suggestion_conn 同构）——todo/update 覆盖写建议列、followUp
 * 直接挂跟进（(message_id, claim 令牌) 幂等）、none 记状态。claimTs 提供时所有落态
 * UPDATE 携带 claim 守卫（judge.rs 0B 行为，A22）：affected=0 = claim 已被回收/重归属
 * → 本次结果丢弃（返回 false），不污染新判定。
 */
import { nowRfc3339, type Conn } from "../storage/db";
import { paramError } from "../storage/errors";
import { isFollowUp, isTodo, isUpdate, normalizeProposedTag, type AiSuggestion } from "./suggest-types";
import { normalizeDue } from "./suggest-resolve";

/** 落态 UPDATE 的守卫片段：无 claim = 不限定 ai_status；有 claim = judging + 令牌匹配 */
function claimGuard(claimTs?: string): string {
  return claimTs === undefined ? "" : " AND ai_status='judging' AND judge_claimed_at=?";
}

/** 跟进并入（attach_followup 同构）：插入跟进记录并把消息标记为已并入 */
export function attachFollowup(
  conn: Conn,
  messageId: string,
  taskId: number,
  content: string,
  now = nowRfc3339(),
): void {
  conn
    .prepare("INSERT INTO task_notes (task_id, content, source, created_at) VALUES (?, ?, 'ai', ?)")
    .run(taskId, content, now);
  conn
    .prepare(
      "UPDATE chat_messages SET ai_status='followup', followup_task_id=?, review_status='accepted', " +
        "dismiss_reason='' WHERE message_id=?",
    )
    .run(taskId, messageId);
}

function applyTodo(
  conn: Conn,
  s: AiSuggestion,
  agentId: string,
  guard: string,
  guardArgs: string[],
  due: string | null,
  tagsJson: string,
): boolean {
  const n = conn
    .prepare(
      "UPDATE chat_messages SET suggested_title=?, suggested_category=?, suggested_due=?, " +
        `suggested_priority=?, suggested_note=?, suggested_tags=?, suggested_reason=?, suggested_confidence=?, ai_agent=?, ai_status='todo' WHERE message_id=?${guard}`,
    )
    .run(
      s.title ?? null,
      s.category ?? null,
      due,
      s.priority ?? null,
      s.note ?? null,
      tagsJson,
      s.reason ?? null,
      s.confidence ?? null,
      agentId,
      s.messageId,
      ...guardArgs,
    );
  return Number(n.changes) > 0;
}

function applyUpdate(
  conn: Conn,
  s: AiSuggestion,
  agentId: string,
  guard: string,
  guardArgs: string[],
  due: string | null,
  tagsJson: string,
): boolean {
  const n = conn
    .prepare(
      "UPDATE chat_messages SET suggested_title=?, suggested_category=?, suggested_due=?, " +
        `suggested_priority=?, suggested_note=?, suggested_tags=?, update_task_id=?, suggested_reason=?, suggested_confidence=?, ai_agent=?, ai_status='update' WHERE message_id=?${guard}`,
    )
    .run(
      s.title ?? null,
      s.category ?? null,
      due,
      s.priority ?? null,
      s.note ?? null,
      tagsJson,
      s.updateTaskId ?? null,
      s.reason ?? null,
      s.confidence ?? null,
      agentId,
      s.messageId,
      ...guardArgs,
    );
  return Number(n.changes) > 0;
}

function applyFollowup(
  conn: Conn,
  s: AiSuggestion,
  agentId: string,
  guard: string,
  guardArgs: string[],
  claimTs: string | undefined,
  now: string,
): boolean {
  // 幂等：已应用过（followup + accepted）不重复挂跟进
  const applied = conn
    .prepare("SELECT ai_status FROM chat_messages WHERE message_id=? AND review_status='accepted'")
    .get(s.messageId) as { ai_status: string } | undefined;
  if (applied?.ai_status === "followup") {
    return true;
  }
  // claim 路径：先校验令牌归属，失配丢弃
  if (claimTs !== undefined) {
    const owned = conn
      .prepare("SELECT 1 FROM chat_messages WHERE message_id=? AND ai_status='judging' AND judge_claimed_at=?")
      .get(s.messageId, claimTs);
    if (owned === undefined) {
      return false;
    }
  }
  const contentRow = conn.prepare("SELECT content FROM chat_messages WHERE message_id=?").get(s.messageId) as
    { content: string } | undefined;
  if (contentRow === undefined) {
    throw paramError(`消息 ${s.messageId} 不存在`);
  }
  attachFollowup(conn, s.messageId, s.followUpTaskId ?? 0, contentRow.content, now);
  conn
    .prepare(
      `UPDATE chat_messages SET suggested_reason=?, suggested_confidence=?, ai_agent=? WHERE message_id=?${guard}`,
    )
    .run(s.reason ?? null, s.confidence ?? null, agentId, s.messageId, ...guardArgs);
  return true;
}

function applyNone(conn: Conn, s: AiSuggestion, agentId: string, guard: string, guardArgs: string[]): boolean {
  const n = conn
    .prepare(
      `UPDATE chat_messages SET suggested_reason=?, suggested_confidence=?, ai_agent=?, ai_status='none' WHERE message_id=?${guard}`,
    )
    .run(s.reason ?? null, s.confidence ?? null, agentId, s.messageId, ...guardArgs);
  return Number(n.changes) > 0;
}

/**
 * 把一条 AI 判定落到 chat_messages（apply_suggestion_conn 同构）。
 * claimTs 提供时落库携带 claim 守卫（A22），affected=0 → 返回 false
 * （本次结果丢弃，由调用方记审计）。
 */
export function applySuggestion(
  conn: Conn,
  s: AiSuggestion,
  agentId: string,
  opts: { claimTs?: string; now?: string } = {},
): boolean {
  const now = opts.now ?? nowRfc3339();
  const guard = claimGuard(opts.claimTs);
  const guardArgs = opts.claimTs === undefined ? [] : [opts.claimTs];
  const due = normalizeDue(s.due);
  const tagsJson = JSON.stringify((s.tags ?? []).map((t) => normalizeProposedTag(t)));
  if (isTodo(s)) {
    return applyTodo(conn, s, agentId, guard, guardArgs, due, tagsJson);
  }
  if (isUpdate(s)) {
    return applyUpdate(conn, s, agentId, guard, guardArgs, due, tagsJson);
  }
  if (isFollowUp(s)) {
    return applyFollowup(conn, s, agentId, guard, guardArgs, opts.claimTs, now);
  }
  return applyNone(conn, s, agentId, guard, guardArgs);
}
