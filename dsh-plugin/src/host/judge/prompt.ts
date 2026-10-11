/**
 * 判定 prompt 组装——行为基准 = src-tauri/src/ai/prompts.rs（TOOLS/CAPTURE 系统提示词、
 * render_messages、mention_note、build_tools_prompt/build_capture_prompt 的
 * `<AGENT_ID>` 替换）与 src-tauri/src/commands/radio/context.rs（chat_label /
 * chat_label_anon / chat_context_lines / format_context_lines：30 分钟同会话上下文、
 * 最多 10 条、上下文行 200 字符截断）。
 * 假名化调 domain/anonymize（人名→代号、群名保留，A12/D17）；系统提示词经
 * domain/prompt-overrides resolve（4 键三态回落——坏覆盖回落默认不挂管道）。
 */
import { nowRfc3339, type Conn } from "../storage/db";
import { AnonRules, ME } from "../domain/anonymize";
import { PROMPT_SPECS, resolveOverride, type PromptSpec } from "../domain/prompt-overrides";

/** 送判的一条消息（AiMessage 同构：内容/发送者/上下文均已假名化，真名不进 prompt） */
export interface AiMessage {
  messageId: string;
  /** 发送者代号（「我」= 用户本人，其余为 成员_xxxx） */
  sender: string;
  /** 来源标签，如 "飞书·群聊「项目群」"（群名不脱敏） */
  chatLabel: string;
  content: string;
  /** 同会话上下文（"[HH:MM] 发送者: 内容" 行，按时间升序） */
  context: string[];
  /** 归属标注行（空 = 无标注） */
  mentionNote: string;
}

/** AI 判定附带的同会话上下文窗口（feishu.rs 常量）：往前 30 分钟、最多 10 条 */
export const CONTEXT_WINDOW_MS = 30 * 60 * 1000;
export const CONTEXT_MAX_MESSAGES = 10;

/** 上下文行内容截断（format_context_lines 的 200 字符） */
const CONTEXT_CLIP_CHARS = 200;

/** 归属标注（mention_note 同构）：at_me 分级；同名风险只叠加在已有提及之上 */
export function mentionNote(atMe: string, sameNameRisk: boolean): string {
  const base = atMe === "at" ? "提及：@我（显式）" : atMe === "name" ? "提及：疑似@我（本地名字匹配，可能有误差）" : "";
  if (base === "") {
    return "";
  }
  return sameNameRisk ? `${base}；注意：群内存在同名成员，请结合上下文谨慎判断归属` : base;
}

/** 来源标签（chat_label 同构；用户可见语境） */
export function chatLabel(chatType: string, chatName: string): string {
  switch (chatType) {
    case "bot":
      return "飞书·机器人私聊";
    case "p2p":
      return `飞书·私聊「${chatName}」`;
    case "group":
      return `飞书·群聊「${chatName}」`;
    case "local":
      return "手动输入·快速捕捉";
    default:
      return chatName === "" ? "飞书" : `飞书「${chatName}」`;
  }
}

/** 来源标签匿名版（chat_label_anon 同构）：群名不脱敏直接用真名；单聊对方名过词表 scrub */
export function chatLabelAnon(rules: AnonRules, chatType: string, chatName: string): string {
  if (chatType === "p2p") {
    return `飞书·私聊「${rules.scrub(chatName)}」`;
  }
  if (chatType === "group" || chatType === "bot" || chatType === "local") {
    return chatLabel(chatType, chatName);
  }
  return chatName === "" ? "飞书" : `飞书「${rules.scrub(chatName)}」`;
}

interface MsgRow {
  message_id: string;
  chat_id: string;
  chat_type: string;
  chat_name: string;
  sender_id: string;
  is_self: number;
  content: string;
  content_anon: string;
  at_me: string;
  sent_at: number | null;
}

function loadRows(conn: Conn, messageIds: string[]): MsgRow[] {
  const stmt = conn.prepare(
    "SELECT message_id, chat_id, chat_type, chat_name, sender_id, is_self, content, content_anon, at_me, sent_at " +
      "FROM chat_messages WHERE message_id=?",
  );
  const out: MsgRow[] = [];
  for (const id of messageIds) {
    const row = stmt.get(id) as MsgRow | undefined;
    if (row !== undefined) {
      out.push(row);
    }
  }
  return out;
}

/** 同会话近期上下文原料（chat_context_lines 同构）：[sent_at-30min, sent_at) 最近 10 条升序 */
function contextRows(conn: Conn, chatId: string, sentAt: number, excludeId: string): MsgRow[] {
  if (chatId === "" || sentAt <= 0) {
    return [];
  }
  const rows = conn
    .prepare(
      "SELECT message_id, chat_id, chat_type, chat_name, sender_id, is_self, content, content_anon, at_me, sent_at " +
        "FROM chat_messages WHERE chat_id=? AND sent_at IS NOT NULL AND sent_at >= ? AND sent_at < ? AND message_id != ? " +
        "ORDER BY sent_at DESC LIMIT ?",
    )
    .all(chatId, sentAt - CONTEXT_WINDOW_MS, sentAt, excludeId, CONTEXT_MAX_MESSAGES) as unknown as MsgRow[];
  return rows.reverse();
}

/** 上下文行匿名化格式化（format_context_lines 同构）：发送者代号、老数据现场 scrub、200 字符截断 */
function formatContextLine(conn: Conn, rules: AnonRules, row: MsgRow, now: string): string {
  const who = row.is_self !== 0 ? ME : row.sender_id === "" ? "成员" : rules.aliasOf(conn, row.sender_id, now);
  const text = row.content_anon === "" ? rules.scrub(row.content) : row.content_anon;
  const clipped = Array.from(text).slice(0, CONTEXT_CLIP_CHARS).join("");
  const time = new Date(row.sent_at ?? 0).toTimeString().slice(0, 5);
  return `[${time}] ${who}: ${clipped}`;
}

/** 单条消息行 → AiMessage（retry/轮询共用语境；与 feishu 轮询组批同构） */
function toAiMessage(conn: Conn, rules: AnonRules, row: MsgRow, now: string): AiMessage {
  const content = row.content_anon === "" ? rules.scrub(row.content) : row.content_anon;
  const sender = row.is_self !== 0 ? ME : row.sender_id === "" ? "成员" : rules.aliasOf(conn, row.sender_id, now);
  return {
    messageId: row.message_id,
    sender,
    chatLabel: chatLabelAnon(rules, row.chat_type, row.chat_name),
    content,
    context: contextRows(conn, row.chat_id, row.sent_at ?? 0, row.message_id).map((r) =>
      formatContextLine(conn, rules, r, now),
    ),
    mentionNote: mentionNote(row.at_me, rules.sameNameRisk),
  };
}

/** 待判定批组装：按 messageIds 读库（假名化 + 30 分钟上下文 + 归属标注），真名不进 prompt */
export function buildAiMessages(conn: Conn, messageIds: string[], now = nowRfc3339()): AiMessage[] {
  const rules = AnonRules.build(conn);
  return loadRows(conn, messageIds).map((row) => toAiMessage(conn, rules, row, now));
}

/** 消息列表渲染（render_messages 同构）：[id] + 来源 + 发送者 + 归属标注 + 内容 + 同会话上下文 */
export function renderMessages(batch: AiMessage[]): string {
  const lines: string[] = ["消息："];
  for (const m of batch) {
    lines.push(`[${m.messageId}] 来源：${m.chatLabel}`);
    lines.push(`发送者：${m.sender}`);
    if (m.mentionNote !== "") {
      lines.push(m.mentionNote);
    }
    lines.push(`内容：${m.content}`);
    if (m.context.length > 0) {
      lines.push("同会话上下文（仅供参考）：");
      for (const line of m.context) {
        lines.push(`  ${line}`);
      }
    }
  }
  return lines.join("\n");
}

function specById(id: string): PromptSpec {
  const spec = PROMPT_SPECS.find((s) => s.id === id);
  if (spec === undefined) {
    throw new Error(`未知提示词规格：${id}`);
  }
  return spec;
}

/** tools 模式 prompt：系统提示词（override resolve 三态回落）+ 消息列表 + `<AGENT_ID>` 替换 */
export function buildJudgePrompt(conn: Conn, agentId: string, batch: AiMessage[]): string {
  const resolved = resolveOverride(conn, specById("im_classify"));
  return `${resolved.text}\n\n${renderMessages(batch)}`.replaceAll("<AGENT_ID>", agentId);
}

/** 快速捕捉 prompt（sender 恒为「我」、常量来源标签、无上下文；CAPTURE 系统 prompt） */
export function buildCapturePrompt(conn: Conn, agentId: string, input: AiMessage): string {
  const resolved = resolveOverride(conn, specById("capture"));
  return `${resolved.text}\n\n${renderMessages([input])}`.replaceAll("<AGENT_ID>", agentId);
}
