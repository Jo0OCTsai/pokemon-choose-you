/**
 * 一轮拉取（拉取步零 LLM）——行为基准 = src-tauri/src/feishu.rs 的
 * pull_new_messages + poll_once_inner：增量（since=共享水位，回退 2 分钟容错、首拉
 * 回看 24h）、会话过滤三态、免打扰跳过、纯媒体只作上下文（skipped）、
 * INSERT OR IGNORE（message_id UNIQUE）去重入库、60 天超期清理、水位 CAS 推进。
 * 子进程调用全部在事务外（PROTOCOL §1）；单会话消息采集/渲染见 collect.ts，
 * 消息体渲染见 render.ts，过滤决策见 filters.ts。判定触发不在此层：返回本轮
 * 新入库的 pending 子集，由 pollLoop 交 judge。
 */
import { nowRfc3339, txImmediate, type Conn } from "../storage/db";
import { AnonRules } from "../domain/anonymize";
import { setSetting } from "../domain/settings";
import { asArr, asObj, asStr, type LarkCli } from "./lark";
import { filterDecision, loadFilterPrefs, writeChatSnapshot, type MuteOutcome } from "./filters";
import { collectChat, loadNames, type PullCtx } from "./collect";
import { advanceWatermark, readWatermark } from "./watermark";

/** 会话概要（list 接口投影；空串 = 字段缺省） */
export interface ChatSummary {
  chatId: string;
  name: string;
  chatMode: string;
  p2pTargetType: string;
  p2pTargetId: string;
}

/** 入库前的一条消息（含会话/发送者元数据与是否送 AI） */
export interface NewMessage {
  messageId: string;
  chatId: string;
  chatName: string;
  chatType: string;
  senderId: string;
  senderName: string;
  isSelf: boolean;
  sentAt: number;
  content: string;
  contentAnon: string;
  atMe: "" | "at" | "name";
  needsAi: boolean;
}

export interface PullOutcome {
  inserted: number;
  /** 本轮新入库且待 AI 判定的子集（needsAi），交 judge 编排 */
  pendingIds: string[];
  cursor: number;
  filteredOut: number;
}

const CHATS_PAGE_SIZE = 100;
const CHATS_MAX = 500;

/** 会话类型词表（bot = 与机器人的单聊；快照与消息入库共用同一推导） */
export function chatTypeOf(chat: ChatSummary): "bot" | "p2p" | "group" {
  if (chat.chatMode === "p2p") {
    return chat.p2pTargetType === "bot" ? "bot" : "p2p";
  }
  return "group";
}

/** 拉取窗口（秒）：增量回退 2 分钟容错；首拉回看 24 小时（window_secs 同构） */
export function windowSecs(sinceMs: number | null, nowMs: number): [number, number] {
  const start = sinceMs !== null ? sinceMs - 120_000 : nowMs - 24 * 3_600_000;
  return [Math.floor(start / 1000), Math.floor(nowMs / 1000)];
}

/** 会话列表翻页聚合（500 条上限防失控） */
export async function listAllChats(lark: LarkCli): Promise<ChatSummary[]> {
  const out: ChatSummary[] = [];
  let pageToken: string | null = null;
  for (;;) {
    const d = await lark.listChats(CHATS_PAGE_SIZE, pageToken);
    for (const item of asArr(d.items)) {
      const o = asObj(item);
      const chatId = asStr(o.chat_id);
      if (chatId !== "") {
        out.push({
          chatId,
          name: asStr(o.name) || "未命名会话",
          chatMode: asStr(o.chat_mode) || "group",
          p2pTargetType: asStr(o.p2p_target_type),
          p2pTargetId: asStr(o.p2p_target_id),
        });
      }
    }
    pageToken = asStr(d.page_token);
    if (d.has_more !== true || pageToken === "" || out.length > CHATS_MAX) {
      return out;
    }
  }
}

/** 免打扰批量查询（10 会话/批）：批次失败该批全部 unknown（降级不过滤，不阻断） */
export async function chatMuteOutcomes(lark: LarkCli, chatIds: string[]): Promise<Map<string, MuteOutcome>> {
  const out = new Map<string, MuteOutcome>();
  for (let i = 0; i < chatIds.length; i += 10) {
    const chunk = chatIds.slice(i, i + 10);
    try {
      const d = await lark.chatUserSettings(chunk);
      const muted = new Set(
        asArr(d.items)
          .map(asObj)
          .filter((it) => it.is_muted === true)
          .map((it) => asStr(it.chat_id)),
      );
      for (const id of chunk) {
        out.set(id, muted.has(id) ? "muted" : "unmuted");
      }
    } catch {
      for (const id of chunk) {
        out.set(id, "unknown");
      }
    }
  }
  return out;
}

/** INSERT OR IGNORE 入库（message_id UNIQUE 去重）；返回新入库数与待判定子集 */
function insertMessages(conn: Conn, messages: NewMessage[], nowMs: number): { inserted: number; pendingIds: string[] } {
  const created = nowRfc3339(new Date(nowMs));
  const stmt = conn.prepare(
    "INSERT OR IGNORE INTO chat_messages (message_id, chat_id, chat_name, chat_type, sender, sender_id, " +
      "content, content_anon, at_me, sent_at, is_self, ai_status, review_status, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
  );
  let inserted = 0;
  const pendingIds: string[] = [];
  txImmediate(conn, () => {
    for (const m of messages) {
      const r = stmt.run(
        m.messageId,
        m.chatId,
        m.chatName,
        m.chatType,
        m.senderName,
        m.senderId,
        m.content,
        m.contentAnon,
        m.atMe,
        m.sentAt,
        m.isSelf ? 1 : 0,
        m.needsAi ? "pending" : "skipped",
        created,
      );
      if (Number(r.changes) > 0) {
        inserted += 1;
        if (m.needsAi) {
          pendingIds.push(m.messageId);
        }
      }
    }
  });
  return { inserted, pendingIds };
}

/** 清理超过 60 天仍未创建待办的消息（task_id IS NULL） */
function cleanupExpired(conn: Conn, nowMs: number): void {
  const cutoff = nowRfc3339(new Date(nowMs - 60 * 24 * 3_600_000));
  conn.prepare("DELETE FROM chat_messages WHERE task_id IS NULL AND created_at < ?").run(cutoff);
}

/** 过滤决策 retain（快照写在 retain 前、含被过滤者） */
function retainChats(
  conn: Conn,
  chats: ChatSummary[],
  outcomes: Map<string, MuteOutcome>,
): {
  survivors: ChatSummary[];
  filteredOut: number;
} {
  const prefs = loadFilterPrefs(conn);
  const survivors: ChatSummary[] = [];
  let filteredOut = 0;
  for (const chat of chats) {
    const decision = filterDecision(
      prefs.get(chat.chatId) ?? "follow",
      outcomes.get(chat.chatId) ?? "unmuted",
      chatTypeOf(chat),
    );
    if (decision.effect === "pull") {
      survivors.push(chat);
    } else {
      filteredOut += 1;
    }
  }
  return { survivors, filteredOut };
}

/**
 * 一轮完整拉取：身份落 settings（pk context 脱敏词源）→ 会话聚合 → 免打扰三值态 →
 * 快照（含被过滤者）→ 过滤决策 retain → 幸存会话分页拉消息（渲染/语境规则）→
 * 入库去重 → 超期清理 → 水位 CAS 推进。
 */
export async function pullOnce(conn: Conn, lark: LarkCli, opts: { nowMs?: number } = {}): Promise<PullOutcome> {
  const nowMs = opts.nowMs ?? Date.now();
  const { openId, name } = await lark.userIdentity();
  const now = nowRfc3339(new Date(nowMs));
  txImmediate(conn, () => {
    setSetting(conn, "feishu_my_open_id", openId);
    setSetting(conn, "feishu_my_name", name);
  });
  const chats = await listAllChats(lark);
  const outcomes = await chatMuteOutcomes(
    lark,
    chats.map((c) => c.chatId),
  );
  writeChatSnapshot(
    conn,
    chats.map((c) => ({
      chatId: c.chatId,
      chatName: c.name,
      chatType: chatTypeOf(c),
      muteOutcome: outcomes.get(c.chatId) ?? "unmuted",
    })),
    now,
  );
  const { survivors, filteredOut } = retainChats(conn, chats, outcomes);
  const since = readWatermark(conn);
  const [startS, endS] = windowSecs(since, nowMs);
  const ctx: PullCtx = {
    lark,
    conn,
    rules: AnonRules.build(conn),
    myOpenId: openId,
    myName: name,
    names: loadNames(conn),
    refreshed: new Set(),
    startS,
    endS,
    nowMs,
  };
  const collected: NewMessage[] = [];
  for (const chat of survivors) {
    collected.push(...(await collectChat(ctx, chat)));
  }
  const { inserted, pendingIds } = insertMessages(conn, collected, nowMs);
  cleanupExpired(conn, nowMs);
  const watermark = advanceWatermark(conn, since, nowMs, now);
  return { inserted, pendingIds, cursor: watermark.cursor, filteredOut };
}
