/**
 * 面板实体读投影（Phase B 契约缺口补齐的读原语）：chat_messages → 建议卡消息行
 * （含代号还原与五分组归属）、agent_sessions → 账本行、feishu 链路 → 收音机健康
 * 四元组。命令装配（信封/参数）见 commands/readCommands.ts；本模块纯读。
 *
 * 语义基准：消息五分组 = 前端 suggestionGroups 口径（skipped 上下文消息不进面板
 * ——list_chat_messages 同构，倒序 300）；会话 kind 空/未知归 legacy
 * （session_group_sql「其他」口径）；健康 = radioHealth 四元组 + 六态 level 归并
 * 三档（down→fail / paused·degraded→warn）。代号还原（anonymize restore）作用在
 * 显示文本（正文 + 建议载荷文本字段）——pk suggest restore 同款兜底（NFR：还原
 * 只在本机 UI）。
 */
import { restore } from "./anonymize";
import { parseProposedTagsJson } from "./suggest-resolve";
import { ESCAPE_REASONS, type ProposedTag } from "./suggest-types";
import { getSetting } from "./settings";
import { level as linkLevel, radioHealth, FEISHU, type HealthState } from "../health/snapshot";
import type { Conn } from "../storage/db";

/** 建议卡消息行（chat_messages 列投影 + 代号还原后的显示文本；client RadioMessage 契约同构） */
export interface PanelMessage {
  messageId: string;
  content: string;
  chatName: string;
  senderName: string;
  receivedAt: string;
  aiStatus: "pending" | "judging" | "todo" | "update" | "followup" | "none" | "error" | "skipped";
  reviewStatus: "pending" | "accepted" | "dismissed";
  suggestedTitle: string | null;
  suggestedNote: string | null;
  suggestedCategory: string | null;
  suggestedDue: string | null;
  suggestedPriority: string | null;
  suggestedTags: ProposedTag[];
  confidence: "high" | "medium" | "low" | null;
  reason: string | null;
  dismissReason: (typeof ESCAPE_REASONS)[number] | "";
  taskId: number | null;
  updateTaskId: number | null;
}

/** 收音机健康（client RadioHealth 契约形态：三档 level + RFC3339 nextPollAt） */
export interface PanelRadioHealth {
  level: "ok" | "warn" | "fail";
  lastSuccessAt: string | null;
  nextPollAt: string | null;
  consecutiveFailures: number;
  pendingCount: number;
}

/** agent 会话账本行（kind 空 = 早期记录归 legacy——session_group_sql「其他」口径） */
export interface PanelSession {
  id: number;
  taskId: number | null;
  agentId: string;
  sessionId: string | null;
  kind: "classify" | "capture" | "dispatch_headless" | "dispatch_interactive" | "pk" | "legacy";
  durationMs: number | null;
  costUsd: number | null;
  exitCode: number | null;
  createdAt: string;
  /** 执行命令快照（行卡摘要行；无命令的早期行为 null） */
  summary: string | null;
}

// ---- 消息行投影与五分组 ----

const MSG_COLS =
  "message_id, chat_name, sender, content, suggested_title, suggested_note, suggested_category, " +
  "suggested_due, suggested_priority, suggested_tags, ai_status, review_status, task_id, " +
  "update_task_id, suggested_reason, suggested_confidence, dismiss_reason, created_at";

type MsgRow = Record<string, unknown>;

/** 可空文本列读取（SQLite → string | null） */
function textOrNull(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

/** 置信档列读取（非三档枚举值归 null——坏数据不进 UI 枚举面） */
function confidenceOf(v: unknown): "high" | "medium" | "low" | null {
  const s = textOrNull(v);
  return s === "high" || s === "medium" || s === "low" ? s : null;
}

function rowToPanelMessage(conn: Conn, row: MsgRow): PanelMessage {
  // 代号还原只作用在显示文本（正文 + 建议载荷文本字段）——restore 对真名是幂等空换
  const restoreText = (v: unknown): string | null => {
    const s = textOrNull(v);
    return s === null ? null : restore(conn, s);
  };
  const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    messageId: String(row.message_id),
    content: restore(conn, String(row.content)),
    chatName: String(row.chat_name ?? ""),
    senderName: String(row.sender ?? ""),
    receivedAt: String(row.created_at ?? ""),
    aiStatus: String(row.ai_status) as PanelMessage["aiStatus"],
    reviewStatus: String(row.review_status) as PanelMessage["reviewStatus"],
    suggestedTitle: restoreText(row.suggested_title),
    suggestedNote: restoreText(row.suggested_note),
    suggestedCategory: textOrNull(row.suggested_category),
    suggestedDue: textOrNull(row.suggested_due),
    suggestedPriority: textOrNull(row.suggested_priority),
    suggestedTags: parseProposedTagsJson(String(row.suggested_tags ?? "[]")),
    confidence: confidenceOf(row.suggested_confidence),
    reason: restoreText(row.suggested_reason),
    dismissReason: String(row.dismiss_reason ?? "") as PanelMessage["dismissReason"],
    taskId: numOrNull(row.task_id),
    updateTaskId: numOrNull(row.update_task_id),
  };
}

/** 五分组归属键（前端 suggestionGroups 同口径：已处置 > 判定失败 > 待处理 > 无动作） */
export type RadioGroupKey = "pending" | "none" | "error" | "escaped" | "accepted";

function radioGroupOf(message: PanelMessage): RadioGroupKey {
  if (message.reviewStatus === "accepted") {
    return "accepted";
  }
  if (message.reviewStatus === "dismissed") {
    return "escaped";
  }
  if (message.aiStatus === "error") {
    return "error";
  }
  if (
    message.aiStatus === "judging" ||
    message.aiStatus === "pending" ||
    message.aiStatus === "todo" ||
    message.aiStatus === "update"
  ) {
    return "pending";
  }
  return "none";
}

/** 收音机五分组（skipped 上下文消息不进面板——倒序 300，list_chat_messages 同构） */
export function radioGroups(conn: Conn): Record<RadioGroupKey, PanelMessage[]> {
  const groups: Record<RadioGroupKey, PanelMessage[]> = { pending: [], none: [], error: [], escaped: [], accepted: [] };
  const rows = conn
    .prepare(`SELECT ${MSG_COLS} FROM chat_messages WHERE ai_status != 'skipped' ORDER BY id DESC LIMIT 300`)
    .all() as MsgRow[];
  for (const row of rows) {
    const message = rowToPanelMessage(conn, row);
    groups[radioGroupOf(message)].push(message);
  }
  return groups;
}

// ---- 会话账本行投影 ----

const SESSION_COLS = "id, task_id, agent_id, session_id, kind, duration_ms, cost_usd, exit_code, command, created_at";

const KNOWN_KINDS = new Set(["classify", "capture", "dispatch_headless", "dispatch_interactive", "pk"]);

function rowToPanelSession(row: Record<string, unknown>): PanelSession {
  const kind = String(row.kind ?? "");
  const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    id: Number(row.id),
    taskId: numOrNull(row.task_id),
    agentId: String(row.agent_id ?? ""),
    sessionId: textOrNull(row.session_id),
    kind: (KNOWN_KINDS.has(kind) ? kind : "legacy") as PanelSession["kind"],
    durationMs: numOrNull(row.duration_ms),
    costUsd: numOrNull(row.cost_usd),
    exitCode: numOrNull(row.exit_code),
    createdAt: String(row.created_at ?? ""),
    summary: textOrNull(row.command),
  };
}

/** 会话账本行读取（sql 自带排序/过滤——全局倒序 limit 或任务时间线升序） */
export function panelSessions(conn: Conn, sql: string, ...params: Array<string | number>): PanelSession[] {
  return (conn.prepare(sql).all(...params) as Array<Record<string, unknown>>).map(rowToPanelSession);
}

/** 全局会话账本 SQL（倒序 500——panelSnapshot logs） */
export const SQL_SESSION_LOGS = `SELECT ${SESSION_COLS} FROM agent_sessions ORDER BY id DESC LIMIT 500`;

/** 任务执行时间线 SQL（升序——list_agent_sessions_conn 任务口径） */
export const SQL_SESSION_TIMELINE = `SELECT ${SESSION_COLS} FROM agent_sessions WHERE task_id=? ORDER BY id`;

// ---- 收音机健康 ----

/** 六态 → client 三档（ok/idle → ok；paused/degraded → warn；down → fail） */
function healthLevelOf(status: string): PanelRadioHealth["level"] {
  if (status === "down") {
    return "fail";
  }
  return status === "paused" || status === "degraded" ? "warn" : "ok";
}

/** feishu 链路健康（radioHealth 四元组 + 六态 level；epoch nextPollAt 归一 RFC3339 串） */
export function panelRadioHealth(conn: Conn, state: HealthState, feishuConfigured: boolean): PanelRadioHealth {
  const base = radioHealth(conn, state);
  const enabled = getSetting(conn, "feishu_enabled") === "true";
  const h = state.snapshot(FEISHU);
  const ran = h.lastSuccessAt !== null || h.lastErrorAt !== null;
  return {
    level: healthLevelOf(linkLevel(feishuConfigured, enabled, ran, h.consecutiveFailures)),
    lastSuccessAt: base.lastSuccessAt,
    nextPollAt: base.nextPollAt === null ? null : new Date(base.nextPollAt).toISOString(),
    consecutiveFailures: base.consecutiveFailures,
    pendingCount: base.pendingCount,
  };
}
