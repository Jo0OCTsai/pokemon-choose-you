/**
 * 接受期解析与落库辅助（PROTOCOL.md §3 接受期解析集）——行为基准 =
 * src-tauri/src/commands/radio/suggest.rs（resolve_proposed_tags / resolve_category /
 * create_task_from_message / record_feedback）。发生在建议被接受采纳的解析阶段，
 * **非拒绝语义**：category 未中回落第一个启用分类、priority 非法回落 normal、
 * due 空白归 NULL。
 */
import { nowRfc3339, type Conn } from "../storage/db";
import { logChange } from "./task-audit";
import { firstEnabledCategoryId } from "./tasks";
import { createTagInternal, dimensionIdByKey } from "./vocabulary";
import { normalizeProposedTag, type ChatMessageLike, type ProposedTag } from "./suggest-types";

// ---- 接受期解析回落 ----

/** 分类名 → 分类 id（接受期：未匹配回落第一个启用分类——非拒绝语义） */
export function resolveCategory(conn: Conn, name: string | null | undefined): number {
  const trimmed = name?.trim();
  if (trimmed !== undefined && trimmed !== "") {
    const hit = conn.prepare("SELECT id FROM categories WHERE name=? AND enabled=1").get(trimmed) as
      { id: number } | undefined;
    if (hit !== undefined) {
      return Number(hit.id);
    }
  }
  return firstEnabledCategoryId(conn);
}

/** priority 接受期回落：非法/缺失回落 normal（非拒绝语义） */
export function validPriority(p: string | null | undefined): string {
  return p !== null && p !== undefined && ["low", "normal", "high", "urgent"].includes(p) ? p : "normal";
}

/** due 接受期归一：trim 后非空才算有截止（空串/纯空白 → null，防绕过草丛不变量） */
export function normalizeDue(due: string | null | undefined): string | null {
  const trimmed = due?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}

/** 词表内查找一条建议标签：按「维度+名」精确，未中按名全局兜底 */
function findTagHit(conn: Conn, p: ProposedTag): number | undefined {
  let hit: number | undefined;
  try {
    const dimId = dimensionIdByKey(conn, p.dimension ?? "topic");
    const exact = conn.prepare("SELECT id FROM tags WHERE name=? AND dimension_id=?").get(p.name, dimId) as
      { id: number } | undefined;
    hit = exact !== undefined ? Number(exact.id) : undefined;
  } catch {
    // 维度 key 非法：走全局按名兜底
  }
  if (hit === undefined) {
    const byName = conn.prepare("SELECT id FROM tags WHERE name=?").get(p.name) as { id: number } | undefined;
    hit = byName !== undefined ? Number(byName.id) : undefined;
  }
  return hit;
}

/**
 * AI 建议标签 → 标签 id 列表（捕捉建任务 / 应用更新共用）：
 * 词表内按「维度+名」精确命中、未中按名全局兜底；isNew 的词表外名字直接创建
 * （origin=ai，配额满/未知维度时跳过并告警——返回 skipped）；未标 isNew 的词表外
 * 名字跳过并告警（AI 违反协议的观测点）。
 */
export function resolveProposedTags(
  conn: Conn,
  proposed: ProposedTag[],
  now = nowRfc3339(),
): { ids: number[]; skipped: string[] } {
  const ids: number[] = [];
  const skipped: string[] = [];
  for (const raw of proposed) {
    const p = normalizeProposedTag(raw);
    if (p.name === "") {
      continue;
    }
    const hit = findTagHit(conn, p);
    if (hit !== undefined) {
      ids.push(hit);
      continue;
    }
    if (p.isNew) {
      try {
        ids.push(createTagInternal(conn, p.name, "", p.dimension ?? "topic", "ai", now).id);
      } catch {
        skipped.push(p.name); // 配额满/维度停用：跳过该标签并告警
      }
    } else {
      skipped.push(p.name); // 未标 isNew 的词表外名字：告警跳过
    }
  }
  return { ids, skipped };
}

/** suggested_tags 列（JSON）解析：坏数据按空处理；兼容旧纯字符串形态 */
export function parseProposedTagsJson(raw: string): ProposedTag[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((t) => normalizeProposedTag(t as ProposedTag | string));
  } catch {
    return [];
  }
}

// ---- 捕捉建任务与人工反馈 ----

/**
 * 用消息上的 AI 建议创建待办（含标签/优先级/截止），并回写消息状态
 * （review_status='accepted'、task_id 回填、逃走原因随状态清掉）。
 * 任务来源跟随消息类型：飞书消息 → feishu，本地捕捉 → capture。
 */
export function createTaskFromMessage(conn: Conn, msg: ChatMessageLike, origin = "dsh", now?: string): number {
  const stamp = (): string => now ?? nowRfc3339();
  const suggestedTitle = msg.suggestedTitle?.trim();
  const title =
    suggestedTitle !== undefined && suggestedTitle !== ""
      ? suggestedTitle
      : Array.from(msg.content).slice(0, 40).join("");
  const due = normalizeDue(msg.suggestedDue);
  const result = conn
    .prepare(
      "INSERT INTO tasks (title, note, category_id, status, priority, due_at, source, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      title,
      msg.suggestedNote,
      resolveCategory(conn, msg.suggestedCategory),
      due !== null ? "scheduled" : "inbox",
      validPriority(msg.suggestedPriority),
      due,
      msg.chatType === "local" ? "capture" : "feishu",
      stamp(),
    );
  const taskId = Number(result.lastInsertRowid);
  attachMessageTags(conn, msg, taskId, stamp());
  logChange(conn, taskId, "create", "title", null, title, origin, stamp());
  // 原因随状态一起清：已逃走消息被强制捕捉时不留陈旧原因
  conn
    .prepare("UPDATE chat_messages SET review_status='accepted', task_id=?, dismiss_reason='' WHERE id=?")
    .run(taskId, msg.id);
  return taskId;
}

function attachMessageTags(conn: Conn, msg: ChatMessageLike, taskId: number, now: string): void {
  const proposed = parseProposedTagsJson(msg.suggestedTags);
  if (proposed.length === 0) {
    return;
  }
  const { ids } = resolveProposedTags(conn, proposed, now);
  const stmt = conn.prepare("INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)");
  for (const tagId of ids) {
    stmt.run(taskId, tagId);
  }
}

/** 人工裁决落 chat_feedback（record_feedback 同构）：agent 名从 ai_agents 反查（尽力而为） */
export function recordFeedback(
  conn: Conn,
  msg: ChatMessageLike,
  action: string,
  reasonCode: string,
  now = nowRfc3339(),
): void {
  let agentName = "";
  try {
    const row = conn.prepare("SELECT value FROM settings WHERE key='ai_agents'").get() as { value: string } | undefined;
    const agents = row === undefined ? [] : (JSON.parse(row.value) as Array<{ id: string; name: string }>);
    agentName = agents.find((a) => a.id === msg.aiAgent)?.name ?? "";
  } catch {
    // 坏数据按未配置处理
  }
  conn
    .prepare(
      "INSERT INTO chat_feedback (chat_message_id, message_id, ai_action, action, reason_code, " +
        "agent_id, agent_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(msg.id, msg.messageId, msg.aiStatus, action, reasonCode, msg.aiAgent, agentName, now);
}
