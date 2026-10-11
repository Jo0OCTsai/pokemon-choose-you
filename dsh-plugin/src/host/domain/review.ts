/**
 * 收音机分诊 CAS（AD §5.4）：accept / applyUpdate / dismiss / restore 全部
 * compare-and-swap（pending 守卫；restore 为 dismissed→pending），affected=0 →
 * SUGGESTION_ALREADY_RESOLVED。基准 = src-tauri/src/commands/radio/review.rs
 * （§7.1 条目 4 加守卫后的形态）；accept 事务内建任务回填 task_id。
 */
import { nowRfc3339, txImmediate, type Conn } from "../storage/db";
import { notFound, PkyError } from "../storage/errors";
import { createTaskFromMessage, parseProposedTagsJson, recordFeedback, resolveProposedTags } from "./suggest-resolve";
import { validEscapeReason, type ChatMessageLike } from "./suggest-types";
import { updateTask, type TaskPatch } from "./tasks";

const MSG_COLS =
  "id, message_id, content, suggested_title, suggested_note, suggested_category, suggested_due, " +
  "suggested_priority, suggested_tags, ai_status, review_status, task_id, update_task_id, " +
  "followup_task_id, ai_agent, dismiss_reason, chat_type";

type MsgRow = Record<string, unknown>;

/** 可空数值列读取（SQLite → number | null） */
function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

function rowToMessage(row: MsgRow): ChatMessageLike {
  return {
    id: Number(row.id),
    messageId: String(row.message_id),
    content: String(row.content),
    suggestedTitle: (row.suggested_title as string | null) ?? null,
    suggestedNote: (row.suggested_note as string | null) ?? null,
    suggestedCategory: (row.suggested_category as string | null) ?? null,
    suggestedDue: (row.suggested_due as string | null) ?? null,
    suggestedPriority: (row.suggested_priority as string | null) ?? null,
    suggestedTags: String(row.suggested_tags ?? "[]"),
    aiStatus: String(row.ai_status),
    reviewStatus: String(row.review_status),
    taskId: numOrNull(row.task_id),
    updateTaskId: numOrNull(row.update_task_id),
    followupTaskId: numOrNull(row.followup_task_id),
    aiAgent: String(row.ai_agent ?? ""),
    dismissReason: String(row.dismiss_reason ?? ""),
    chatType: String(row.chat_type ?? ""),
  };
}

/** 按消息 id 取消息（dsh 契约面以 messageId 寻址；host 命令与工具共用） */
export function getMessage(conn: Conn, messageId: string): ChatMessageLike {
  const row = conn.prepare(`SELECT ${MSG_COLS} FROM chat_messages WHERE message_id=?`).get(messageId);
  if (row === undefined) {
    throw notFound(`消息 ${messageId} 不存在`);
  }
  return rowToMessage(row as MsgRow);
}

/** 已处置的幂等反馈（CAS affected=0：另一形态已抢先处置） */
function alreadyResolved(): PkyError {
  return new PkyError("SUGGESTION_ALREADY_RESOLVED", "该建议已在另一处处置");
}

/**
 * 捕捉：pending → accepted 先行原子抢占，CAS 与建任务同一 BEGIN IMMEDIATE 事务，
 * 建任务失败整体回滚（消息回 pending，不留孤儿已接受态）；成功返回新建任务 id。
 */
export function acceptMessage(conn: Conn, messageId: string, origin = "dsh", now?: string): number {
  const msg = getMessage(conn, messageId);
  if (msg.taskId !== null) {
    throw new PkyError("INVALID_ARGUMENT", "该消息已创建过待办");
  }
  return txImmediate(conn, () => {
    const n = conn
      .prepare(
        "UPDATE chat_messages SET review_status='accepted', dismiss_reason='' " +
          "WHERE id=? AND review_status='pending'",
      )
      .run(msg.id);
    if (Number(n.changes) === 0) {
      throw alreadyResolved();
    }
    const taskId = createTaskFromMessage(conn, msg, origin, now);
    recordFeedback(conn, msg, "accepted", "", now);
    return taskId;
  });
}

/** 逃走：pending → dismissed 原子写 + 原因码（6 枚举白名单）落反馈；affected=0 幂等反馈 */
export function dismissMessage(conn: Conn, messageId: string, reasonCode?: string | null, now = nowRfc3339()): void {
  const reason = validEscapeReason(reasonCode ?? null);
  const msg = getMessage(conn, messageId);
  const n = conn
    .prepare(
      "UPDATE chat_messages SET review_status='dismissed', dismiss_reason=? WHERE id=? AND review_status='pending'",
    )
    .run(reason, msg.id);
  if (Number(n.changes) === 0) {
    throw alreadyResolved();
  }
  recordFeedback(conn, msg, "dismissed", reason, now);
}

/** 删掉该消息最近一条反馈（误操作的 accepted/dismissed 不该污染判重分析） */
function deleteLastFeedback(conn: Conn, chatMessageId: number): void {
  conn
    .prepare(
      "DELETE FROM chat_feedback WHERE id = (" +
        "SELECT id FROM chat_feedback WHERE chat_message_id=? ORDER BY id DESC LIMIT 1)",
    )
    .run(chatMessageId);
}

/** 撤销逃走（restore）：仅 dismissed → pending（CAS 守卫，affected=0 幂等反馈），并清掉误操作反馈。 */
export function restoreMessage(conn: Conn, messageId: string): void {
  const msg = getMessage(conn, messageId);
  const n = conn
    .prepare(
      "UPDATE chat_messages SET review_status='pending', dismiss_reason='' WHERE id=? AND review_status='dismissed'",
    )
    .run(msg.id);
  if (Number(n.changes) === 0) {
    throw alreadyResolved();
  }
  deleteLastFeedback(conn, msg.id);
}

// ---- 更新建议 → 待办补丁（update_patch_from_message 同构，只含 AI 明确给出的字段） ----

function patchTitle(msg: ChatMessageLike, patch: TaskPatch): void {
  const title = msg.suggestedTitle?.trim();
  if (title !== undefined && title !== "") {
    patch.title = title;
  }
  const note = msg.suggestedNote?.trim();
  if (note !== undefined && note !== "") {
    patch.note = note;
  }
}

function patchSchedule(msg: ChatMessageLike, patch: TaskPatch): void {
  if (msg.suggestedDue !== null && msg.suggestedDue !== undefined && msg.suggestedDue !== "") {
    patch.dueAt = msg.suggestedDue;
  }
  if (msg.suggestedPriority !== null && ["low", "normal", "high", "urgent"].includes(msg.suggestedPriority)) {
    patch.priority = msg.suggestedPriority;
  }
}

function patchCategory(conn: Conn, msg: ChatMessageLike, patch: TaskPatch): void {
  // 分类只认启用中的同名分类，认不出就不动（不同于新建的回落策略）
  const category = msg.suggestedCategory?.trim();
  if (category === undefined || category === "") {
    return;
  }
  const hit = conn.prepare("SELECT id FROM categories WHERE name=? AND enabled=1").get(category) as
    { id: number } | undefined;
  if (hit !== undefined) {
    patch.categoryId = Number(hit.id);
  }
}

/** 由消息上的更新建议构建待办补丁（留空的字段一律不动） */
function updatePatchFromMessage(conn: Conn, msg: ChatMessageLike): TaskPatch {
  if (msg.updateTaskId === null) {
    throw new PkyError("INVALID_ARGUMENT", "更新建议缺少目标待办");
  }
  // 目标已删除则无法应用（提前报错，避免先接受再失败）
  if (conn.prepare("SELECT title FROM tasks WHERE id=?").get(msg.updateTaskId) === undefined) {
    throw notFound(`目标待办 No.${msg.updateTaskId} 已不存在，无法应用更新`);
  }
  const patch: TaskPatch = { id: msg.updateTaskId };
  patchTitle(msg, patch);
  patchSchedule(msg, patch);
  patchCategory(conn, msg, patch);
  // AI 给了新标签数组（非空）才全量替换
  const proposed = parseProposedTagsJson(msg.suggestedTags);
  if (proposed.length > 0) {
    patch.tagIds = resolveProposedTags(conn, proposed).ids;
  }
  if (Object.keys(patch).length === 1) {
    throw new PkyError("INVALID_ARGUMENT", "更新建议没有任何可应用的变更");
  }
  return patch;
}

/**
 * 应用更新建议：pending+update 前置校验 → CAS 抢占（affected=0 幂等反馈）→
 * 把建议字段明确给出的部分打补丁到目标待办（复用 updateTask 的校验/草丛不变量/
 * 字段级审计）→ 消息标记已接受。返回目标待办 id。
 */
export function applyUpdateMessage(conn: Conn, messageId: string, origin = "dsh", now?: string): number {
  const msg = getMessage(conn, messageId);
  if (msg.reviewStatus !== "pending" || msg.aiStatus !== "update") {
    throw new PkyError("INVALID_ARGUMENT", "该消息不是待确认的更新建议");
  }
  const patch = updatePatchFromMessage(conn, msg);
  const n = conn
    .prepare(
      "UPDATE chat_messages SET review_status='accepted' WHERE id=? AND review_status='pending' AND ai_status='update'",
    )
    .run(msg.id);
  if (Number(n.changes) === 0) {
    throw alreadyResolved();
  }
  recordFeedback(conn, msg, "accepted", "", now);
  updateTask(conn, patch, origin, now);
  return patch.id;
}

// ---- 批量分诊 ----

export interface BatchFailure {
  messageId: string;
  error: string;
}

export interface BatchReviewResult {
  ok: number;
  failed: BatchFailure[];
}

type BatchAction = "accept" | "dismiss";

/** 批量分诊的单条处理（accept 内分 update/todo 两路；dismiss 带 reason） */
function reviewOne(
  conn: Conn,
  messageId: string,
  action: BatchAction,
  reason: string,
  origin: string,
  now: string,
): void {
  if (action === "dismiss") {
    dismissMessage(conn, messageId, reason === "" ? null : reason, now);
    return;
  }
  const msg = getMessage(conn, messageId);
  if (msg.reviewStatus === "pending" && msg.aiStatus === "update") {
    applyUpdateMessage(conn, messageId, origin, now);
    return;
  }
  acceptMessage(conn, messageId, origin, now);
}

/**
 * 批量分诊：accept = todo 建议落成待办 / update 建议应用更新；dismiss = 批量逃走。
 * 单条失败（已建过/目标已删等）不影响其余，结果逐条汇报（成败结果集）。
 */
export function batchReview(
  conn: Conn,
  messageIds: string[],
  action: BatchAction,
  reasonCode?: string | null,
  origin = "dsh",
  now = nowRfc3339(),
): BatchReviewResult {
  if (messageIds.length === 0) {
    throw new PkyError("INVALID_ARGUMENT", "未选择任何消息");
  }
  const reason = validEscapeReason(reasonCode ?? null);
  const result: BatchReviewResult = { ok: 0, failed: [] };
  for (const messageId of messageIds) {
    try {
      reviewOne(conn, messageId, action, reason, origin, now);
      result.ok += 1;
    } catch (error) {
      result.failed.push({
        messageId,
        error: error instanceof PkyError ? error.message : String(error),
      });
    }
  }
  return result;
}
