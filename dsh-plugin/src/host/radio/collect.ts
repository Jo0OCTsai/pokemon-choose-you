/**
 * 单会话消息采集（fetcher 的分页/渲染/语境层）——行为基准 =
 * src-tauri/src/feishu.rs 的 pull_new_messages 内层：消息分页、渲染前 mention
 * 代号预分配、发送者显示名（自己/单聊对方/应用消息/群成员缓存——每群每轮最多
 * 补拉一次成员名单，失败退化为短 id）、谁的消息送 AI 的语境规则。
 */
import { nowRfc3339, type Conn } from "../storage/db";
import { AnonRules } from "../domain/anonymize";
import { asArr, asObj, asStr, type LarkCli } from "./lark";
import { isMediaOnly, renderContent, shortId } from "./render";
import { chatTypeOf, type ChatSummary, type NewMessage } from "./fetcher";

/** 群成员列表翻页上限（MEMBERS_MAX_PAGES：单页 100，超出的大群发送者退化为短 id） */
const MEMBERS_MAX_PAGES = 3;

/** 一轮拉取的共享上下文（身份/规则包/名字缓存/窗口） */
export interface PullCtx {
  lark: LarkCli;
  conn: Conn;
  rules: AnonRules;
  myOpenId: string;
  myName: string;
  names: Map<string, string>;
  refreshed: Set<string>;
  startS: number;
  endS: number;
  nowMs: number;
}

/** 群成员名缓存（feishu_users.name；发送者显示名靠它） */
export function loadNames(conn: Conn): Map<string, string> {
  const names = new Map<string, string>();
  for (const row of conn.prepare("SELECT open_id, name FROM feishu_users").all() as Array<{
    open_id: string;
    name: string;
  }>) {
    names.set(row.open_id, row.name);
  }
  return names;
}

function saveNames(conn: Conn, members: Array<[string, string]>, now: string): void {
  if (members.length === 0) {
    return;
  }
  const stmt = conn.prepare(
    "INSERT INTO feishu_users (open_id, name, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(open_id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at",
  );
  for (const [oid, name] of members) {
    stmt.run(oid, name, now);
  }
}

/** 群成员列表翻页（≤3 页；失败不阻断——发送者退化为短 id） */
async function chatMembersAll(lark: LarkCli, chatId: string): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  let pageToken: string | null = null;
  for (let page = 0; page < MEMBERS_MAX_PAGES; page++) {
    try {
      const d = await lark.listMembers(chatId, pageToken);
      for (const item of asArr(d.items)) {
        const o = asObj(item);
        const id = asStr(o.member_id);
        if (id !== "") {
          out.push([id, asStr(o.name)]);
        }
      }
      pageToken = asStr(d.page_token);
      if (d.has_more !== true || pageToken === "") {
        return out;
      }
    } catch {
      return out;
    }
  }
  return out;
}

/** 发送者显示名：自己→我的名字；单聊→会话名；应用消息→「应用」；群成员缓存（每群每轮补一次） */
async function senderDisplayName(
  ctx: PullCtx,
  chat: ChatSummary,
  senderId: string,
  senderType: string,
  isSelf: boolean,
): Promise<string> {
  if (isSelf) {
    return ctx.myName;
  }
  if (chat.chatMode === "p2p") {
    return chat.name;
  }
  if (senderType !== "user") {
    return "应用";
  }
  const cached = ctx.names.get(senderId);
  if (cached !== undefined && cached !== "") {
    return cached;
  }
  if (!ctx.refreshed.has(chat.chatId)) {
    ctx.refreshed.add(chat.chatId);
    const members = await chatMembersAll(ctx.lark, chat.chatId);
    saveNames(ctx.conn, members, nowRfc3339(new Date(ctx.nowMs)));
    for (const [oid, name] of members) {
      ctx.names.set(oid, name);
    }
  }
  return ctx.names.get(senderId) || shortId(senderId);
}

/** 谁的消息送 AI（语境规则，pull_new_messages 同构）：bot→我发的；p2p→对方发的（发给自己视作备忘）；群→非我发的；纯媒体不送 */
function needsAiFor(chatType: string, isSelf: boolean, targetIsSelf: boolean, msgType: string): boolean {
  const byChat = chatType === "bot" ? isSelf : chatType === "p2p" ? !isSelf || targetIsSelf : !isSelf;
  return byChat && !isMediaOnly(msgType);
}

/** 渲染前预分配本条消息所有 mention 的代号（render 只读规则包，aliasOf 会写库） */
function preassignMentionAliases(ctx: PullCtx, mentions: unknown, now: string): void {
  for (const mm of asArr(mentions)) {
    const oid = asStr(asObj(mm).id) || asStr(asObj(asObj(mm).id).open_id);
    if (oid !== "") {
      ctx.rules.aliasOf(ctx.conn, oid, now);
    }
  }
}

/** 归属标注：显式 @ 到我 at；匿名版命中我的称呼 name；否则无标注 */
function atMeFlag(ctx: PullCtx, rendered: { atMe: boolean; anon: string }): "" | "at" | "name" {
  if (rendered.atMe) {
    return "at";
  }
  return ctx.rules.hintsMe(rendered.anon) ? "name" : "";
}

/** 单条消息 → NewMessage（渲染失败/空文本跳过；mention 代号先预分配再只读渲染） */
async function toNewMessage(
  ctx: PullCtx,
  m: Record<string, unknown>,
  chat: ChatSummary,
  targetIsSelf: boolean,
): Promise<NewMessage | null> {
  const messageId = asStr(m.message_id);
  if (messageId === "") {
    return null;
  }
  const now = nowRfc3339(new Date(ctx.nowMs));
  preassignMentionAliases(ctx, m.mentions, now);
  const rendered = renderContent(asStr(m.msg_type), asStr(asObj(m.body).content), m.mentions, {
    rules: ctx.rules,
    myOpenId: ctx.myOpenId,
    resolveName: (oid) => ctx.names.get(oid) ?? null,
  });
  if (rendered === null || rendered.display.trim() === "") {
    return null;
  }
  const sender = asObj(m.sender);
  const senderId = asStr(sender.id) || "unknown";
  const senderType = asStr(sender.sender_type) || "user";
  const sentAt = Number.parseInt(asStr(m.create_time), 10);
  const isSelf = senderType === "user" && senderId === ctx.myOpenId;
  const chatType = chatTypeOf(chat);
  return {
    messageId,
    chatId: chat.chatId,
    chatName: chat.name,
    chatType,
    senderId,
    senderName: await senderDisplayName(ctx, chat, senderId, senderType, isSelf),
    isSelf,
    sentAt: Number.isFinite(sentAt) ? sentAt : ctx.nowMs,
    content: rendered.display,
    contentAnon: rendered.anon,
    atMe: atMeFlag(ctx, rendered),
    needsAi: needsAiFor(chatType, isSelf, targetIsSelf, asStr(m.msg_type)),
  };
}

/** 单会话全分页消息（「发给自己的会话」我的消息视作备忘） */
export async function collectChat(ctx: PullCtx, chat: ChatSummary): Promise<NewMessage[]> {
  const out: NewMessage[] = [];
  const targetIsSelf = chat.chatMode === "p2p" && chat.p2pTargetId !== "" && chat.p2pTargetId === ctx.myOpenId;
  let pageToken: string | null = null;
  for (;;) {
    const page = await ctx.lark.listMessages(chat.chatId, ctx.startS, ctx.endS, pageToken);
    for (const m of asArr(page.items)) {
      const msg = await toNewMessage(ctx, asObj(m), chat, targetIsSelf);
      if (msg !== null) {
        out.push(msg);
      }
    }
    pageToken = asStr(page.page_token);
    if (page.has_more !== true || pageToken === "") {
      return out;
    }
  }
}
