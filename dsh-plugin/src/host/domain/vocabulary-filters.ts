/**
 * 背包词表 · 会话过滤三态（AD §5.2 / feishu.rs）：always_filter / always_pull /
 * follow（= 无偏好行，不落库）；私聊（p2p）固定跟随不可设（API 层拦截）。
 */
import { nowRfc3339, type Conn } from "../storage/db";
import { paramError } from "../storage/errors";

// ---- 会话过滤（三态，feishu.rs） ----

export interface FilterItem {
  chatId: string;
  chatName: string;
  chatType: string;
  /** follow = 无偏好行（「跟随」不落库）；always_filter / always_pull 来自偏好表 */
  state: "follow" | "always_filter" | "always_pull";
  updatedAt: string | null;
}

/**
 * 会话过滤清单（dsh 契约：排除私聊——p2p 固定跟随不可设）：快照表
 * （feishu_chats，行随每轮拉取整表替换）左连偏好表（chat_filter_prefs）。
 */
export function filterList(conn: Conn): { chats: FilterItem[]; counts: Record<string, number> } {
  const rows = conn
    .prepare(
      "SELECT c.chat_id, c.chat_name, c.chat_type, p.preference, p.updated_at " +
        "FROM feishu_chats c LEFT JOIN chat_filter_prefs p ON p.chat_id = c.chat_id " +
        "WHERE c.chat_type != 'p2p' ORDER BY c.chat_id",
    )
    .all() as Array<Record<string, unknown>>;
  const chats: FilterItem[] = rows.map((r) => ({
    chatId: String(r.chat_id),
    chatName: String(r.chat_name),
    chatType: String(r.chat_type),
    state: r.preference === "always_filter" || r.preference === "always_pull" ? r.preference : "follow",
    updatedAt: (r.updated_at as string | null) ?? null,
  }));
  const counts = { follow: 0, always_filter: 0, always_pull: 0 };
  for (const c of chats) {
    counts[c.state] += 1;
  }
  return { chats, counts };
}

export type FilterState = "follow" | "always_filter" | "always_pull";

/**
 * 会话过滤三态写入（dsh 契约：follow = 删偏好行；p2p 私聊拒写——固定跟随，
 * API 层拦截）。chat_type 取最近一轮拉取快照；快照无行的会话按群聊放行（用户
 * 显式操作优先，快照缺失不阻断）。
 */
export function filterUpsert(conn: Conn, chatId: string, state: FilterState, now = nowRfc3339()): FilterItem {
  const snapshot = conn.prepare("SELECT chat_type FROM feishu_chats WHERE chat_id=?").get(chatId) as
    { chat_type: string } | undefined;
  assertNotP2p(snapshot);
  writePreference(conn, chatId, state, now);
  return readFilterItem(conn, chatId, snapshot);
}

/** 私聊（p2p）固定跟随免打扰，不可设偏好（快照无行的会话不阻断——群聊未知时放行） */
function assertNotP2p(snapshot: { chat_type: string } | undefined): void {
  if (snapshot?.chat_type === "p2p") {
    throw paramError("私聊固定跟随免打扰，不支持设置过滤偏好");
  }
}

/** follow = 删偏好行（「跟随」不落库）；其余两态 upsert（CHECK 只收这两个值） */
function writePreference(conn: Conn, chatId: string, state: FilterState, now: string): void {
  if (state === "follow") {
    conn.prepare("DELETE FROM chat_filter_prefs WHERE chat_id=?").run(chatId);
    return;
  }
  conn
    .prepare(
      "INSERT INTO chat_filter_prefs (chat_id, preference, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(chat_id) DO UPDATE SET preference=excluded.preference, updated_at=excluded.updated_at",
    )
    .run(chatId, state, now);
}

/** preference 列 → 三态（无行/无偏好 = follow） */
function prefToState(preference: unknown): FilterState {
  return preference === "always_filter" || preference === "always_pull" ? preference : "follow";
}

/** 写后回读单项（快照行缺失时仅回偏好态） */
function readFilterItem(conn: Conn, chatId: string, snapshot: { chat_type: string } | undefined): FilterItem {
  const after = conn
    .prepare(
      "SELECT c.chat_id, c.chat_name, c.chat_type, p.preference, p.updated_at " +
        "FROM feishu_chats c LEFT JOIN chat_filter_prefs p ON p.chat_id = c.chat_id WHERE c.chat_id=?",
    )
    .get(chatId) as Record<string, unknown> | undefined;
  return {
    chatId,
    chatName: String(after?.chat_name ?? ""),
    chatType: String(after?.chat_type ?? snapshot?.chat_type ?? ""),
    state: prefToState(after?.preference),
    updatedAt: (after?.updated_at as string | null) ?? null,
  };
}
