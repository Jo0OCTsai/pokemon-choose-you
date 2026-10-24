/**
 * 判定协议 · 提交期（PROTOCOL.md §3 / AD §4.2）——行为基准 =
 * src-tauri/src/bin/pk/suggest.rs（validate_suggestion / suggest_batch_from_str）。
 * 整批原子：任一违规整批拒绝（JUDGE_INVALID_RESULT），错误文案含序号与 messageId
 * 供执行方自纠。假名还原发生在校验前（词表按真名匹配）。
 * 接受期解析/落库见 suggest-resolve.ts / suggest-apply.ts；claim 协议见 claim.ts。
 */
import { txImmediate, type Conn } from "../storage/db";
import { PkyError } from "../storage/errors";
import { restore } from "./anonymize";
import { dimensionIdByKey, listTags } from "./vocabulary";
import { applySuggestion } from "./suggest-apply";
import { isFollowUp, isTodo, isUpdate, normalizeProposedTag, type AiSuggestion } from "./suggest-types";

export type { AiSuggestion, ProposedTag } from "./suggest-types";

const VALID_PRIORITY = ["low", "normal", "high", "urgent"];
const VALID_CONFIDENCE = ["high", "medium", "low"];

function invalid(message: string): PkyError {
  return new PkyError("JUDGE_INVALID_RESULT", message);
}

// ---- 单条校验（六规则，各规则独立小函数） ----

/** 规则①：消息存在且 review_status='pending'（已人工确认过即拒绝——防重复分诊/重复挂跟进） */
function validateMessagePending(conn: Conn, s: AiSuggestion, at: string): void {
  const row = conn.prepare("SELECT review_status FROM chat_messages WHERE message_id=?").get(s.messageId) as
    { review_status: string } | undefined;
  if (row === undefined) {
    throw invalid(`${at}:消息不存在（id 须来自待判定消息列表）`);
  }
  if (row.review_status !== "pending") {
    throw invalid(`${at}:消息已人工确认过（review_status=${row.review_status}），不能重复提交建议`);
  }
}

/** 目标待办存在性校验（update/followUp 载荷） */
function ensureTask(conn: Conn, id: number, at: string): void {
  if (conn.prepare("SELECT 1 FROM tasks WHERE id=?").get(id) === undefined) {
    throw invalid(`${at}:待办 No.${id} 不存在（id 须来自待办清单）`);
  }
}

function requireTarget(conn: Conn, at: string, action: string, target: number | null | undefined): number {
  if (target === undefined || target === null) {
    throw invalid(`${at}:action=${action} 需要 ${action === "update" ? "updateTaskId" : "followUpTaskId"}`);
  }
  ensureTask(conn, target, at);
  return target;
}

/** 规则②：action 枚举封闭且载荷匹配（todo→title 非空；update/followUp→目标存在） */
function validateAction(conn: Conn, s: AiSuggestion, at: string): void {
  if (s.action === "todo") {
    if ((s.title ?? "").trim() === "") {
      throw invalid(`${at}:action=todo 需要 title`);
    }
    return;
  }
  if (s.action === "update") {
    requireTarget(conn, at, s.action, s.updateTaskId);
    return;
  }
  if (s.action === "followUp") {
    requireTarget(conn, at, s.action, s.followUpTaskId);
    return;
  }
  if (s.action !== "none" && s.action !== "") {
    throw invalid(`${at}:action「${s.action}」无效，可选 todo/update/followUp/none`);
  }
}

/** 规则③：priority/confidence 非空时命中枚举 */
function validateEnums(s: AiSuggestion, at: string): void {
  const priority = s.priority?.trim();
  if (priority !== undefined && priority !== "" && !VALID_PRIORITY.includes(priority)) {
    throw invalid(`${at}:优先级「${priority}」无效，可选 ${VALID_PRIORITY.join("/")}`);
  }
  const confidence = s.confidence?.trim();
  if (confidence !== undefined && confidence !== "" && !VALID_CONFIDENCE.includes(confidence)) {
    throw invalid(`${at}:confidence「${confidence}」无效，可选 ${VALID_CONFIDENCE.join("/")}`);
  }
}

/** 规则④：category 非空时命中启用分类 */
function validateCategory(conn: Conn, s: AiSuggestion, at: string): void {
  const category = s.category?.trim();
  if (category === undefined || category === "") {
    return;
  }
  const hit = conn.prepare("SELECT id FROM categories WHERE name=? AND enabled=1").get(category);
  if (hit === undefined) {
    throw invalid(`${at}:未找到启用中的分类「${category}」。可用分类见词表`);
  }
}

/** 规则⑤：isNew → 维度存在且剩余配额 >0；非 isNew → 名字在词表（维度+名精确或按名兜底） */
function validateTags(conn: Conn, s: AiSuggestion, at: string): void {
  const tags = (s.tags ?? []).map(normalizeProposedTag);
  if (tags.length === 0) {
    return;
  }
  const all = listTags(conn);
  for (const t of tags) {
    validateOneTag(conn, t, all, at);
  }
}

function validateOneTag(
  conn: Conn,
  t: { name: string; dimension?: string; isNew?: boolean },
  all: Array<{ name: string; dimension: string }>,
  at: string,
): void {
  if (!t.isNew) {
    const hit = all.find((x) => x.name === t.name && x.dimension === t.dimension) ?? all.find((x) => x.name === t.name);
    if (hit === undefined) {
      throw invalid(`${at}:未知标签「${t.name}」。词表内标签见词表清单；新标签须 isNew=true 并带 dimension`);
    }
    return;
  }
  // 新标签：维度必须存在且未满（提前报错让 agent 自纠，改选现有标签或换维度）
  const dimId = dimensionIdByKey(conn, t.dimension ?? "topic");
  const row = conn
    .prepare(
      "SELECT (SELECT max_tags FROM tag_dimensions WHERE id=?) AS max_tags, " +
        "(SELECT COUNT(*) FROM tags WHERE dimension_id=?) AS used",
    )
    .get(dimId, dimId) as { max_tags: number; used: number };
  if (Number(row.max_tags) - Number(row.used) <= 0) {
    throw invalid(`${at}:维度「${t.dimension}」标签已满，不能新建「${t.name}」`);
  }
}

/** 单条提交前校验入口（validate_suggestion 同构） */
export function validateSuggestion(conn: Conn, s: AiSuggestion, idx: number): void {
  const at = `第 ${idx} 条（messageId=${s.messageId}）`;
  validateMessagePending(conn, s, at);
  validateAction(conn, s, at);
  validateEnums(s, at);
  validateCategory(conn, s, at);
  validateTags(conn, s, at);
}

/** 规则⑥：批内 messageId 重复整批拒绝（follow-up 场景防重复挂跟进） */
export function assertNoDuplicateMessageIds(list: AiSuggestion[]): void {
  const seen = new Set<string>();
  list.forEach((s, i) => {
    if (seen.has(s.messageId)) {
      throw invalid(`第 ${i + 1} 条与前面的条目 messageId 重复（${s.messageId}）`);
    }
    seen.add(s.messageId);
  });
}

// ---- 假名还原与批内判重 ----

/** 建议回写的文本字段反向还原：模型看到与输出的是代号，落库给用户看的必须是真名 */
export function restoreSuggestion(conn: Conn, s: AiSuggestion): AiSuggestion {
  const restored: AiSuggestion = { ...s };
  if (s.title != null) {
    restored.title = restore(conn, s.title);
  }
  if (s.note != null) {
    restored.note = restore(conn, s.note);
  }
  if (s.reason != null) {
    restored.reason = restore(conn, s.reason);
  }
  restored.tags = (s.tags ?? []).map((t) => {
    const normalized = normalizeProposedTag(t);
    return { ...normalized, name: restore(conn, normalized.name) };
  });
  return restored;
}

function normalizeTitle(title: string | null | undefined): string {
  // 规范化 = trim + 折叠空白为单空格 + 小写（Rust split_whitespace 不产空 token）
  return (title ?? "").trim().split(/\s+/).join(" ").toLowerCase();
}

/**
 * 批内判重兜底（types.rs dedup_batch_todos 同构）：规范化标题相同的多个 todo
 * 只留最先出现的一条，其余降级 none 并让 reason 指向保留的那条消息。
 * 返回被降级的消息 id。
 */
export function dedupBatchTodos(suggestions: AiSuggestion[]): string[] {
  const firstSeen = new Map<string, string>();
  const demoted: string[] = [];
  for (const s of suggestions) {
    if (!isTodo(s)) {
      continue;
    }
    const key = normalizeTitle(s.title);
    if (key === "") {
      continue;
    }
    const keptId = firstSeen.get(key);
    if (keptId === undefined) {
      firstSeen.set(key, s.messageId);
      continue;
    }
    s.action = "none";
    s.title = null;
    s.category = null;
    s.due = null;
    s.priority = null;
    s.note = null;
    s.tags = [];
    s.followUpTaskId = null;
    s.updateTaskId = null;
    s.reason = `与消息 ${keptId} 的待办重复`;
    demoted.push(s.messageId);
  }
  return demoted;
}

// ---- 批量提交入口 ----

export interface SuggestBatchOutcome {
  submitted: number;
  todo: number;
  update: number;
  followUp: number;
  none: number;
  agent: string;
}

function countAction(s: AiSuggestion, counts: { todo: number; update: number; followUp: number }): void {
  if (isTodo(s)) {
    counts.todo += 1;
  } else if (isUpdate(s)) {
    counts.update += 1;
  } else if (isFollowUp(s)) {
    counts.followUp += 1;
  }
}

/**
 * 判定批量提交（suggest_batch_from_str 同构，输入为已解析的数组）：
 * 代号先反向还原成真名（发生在校验前——词表按真名匹配）→ 逐条校验（整批原子）→
 * 单事务逐条落库（一损俱损）。claimTs 提供时落库携带 claim 守卫。
 */
export function suggestBatch(
  conn: Conn,
  results: AiSuggestion[],
  agentId = "cli",
  opts: { claimTs?: string; now?: string } = {},
): SuggestBatchOutcome {
  if (results.length === 0) {
    throw new PkyError("INVALID_ARGUMENT", "results 为空，无可提交的建议");
  }
  const restored = results.map((s) => restoreSuggestion(conn, s));
  assertNoDuplicateMessageIds(restored);
  restored.forEach((s, i) => validateSuggestion(conn, s, i + 1));
  const counts = { todo: 0, update: 0, followUp: 0 };
  txImmediate(conn, () => {
    for (const s of restored) {
      applySuggestion(conn, s, agentId, opts);
      countAction(s, counts);
    }
  });
  return {
    submitted: restored.length,
    todo: counts.todo,
    update: counts.update,
    followUp: counts.followUp,
    none: restored.length - counts.todo - counts.update - counts.followUp,
    agent: agentId,
  };
}
