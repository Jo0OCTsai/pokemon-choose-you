/**
 * 会话过滤三态与快照——行为基准 = src-tauri/src/feishu.rs 的
 * filter_decision / pref_for_chat_type / MuteOutcome / write_chat_snapshot /
 * load_filter_prefs（feishu-chat-filter 契约：手动偏好优先，跟随态按免打扰推导，
 * 查询失败降级拉取 followDegraded；私聊固定跟随不可设）。
 */
import { txImmediate, nowRfc3339, type Conn } from "../storage/db";

/** 手动偏好三态（follow = 无偏好行，不落库） */
export type FilterPref = "follow" | "always_filter" | "always_pull";

/** 免打扰查询结果三值态（unknown = 所在查询批次失败，降级不过滤） */
export type MuteOutcome = "muted" | "unmuted" | "unknown";

export type FilterEffect = "pull" | "filter";
export type FilterSource = "manual" | "follow" | "followDegraded";

/** 私聊（p2p）固定跟随免打扰：手动偏好仅对群聊/机器人开放（bot 不归一） */
export function prefForChatType(chatType: string, pref: FilterPref): FilterPref {
  return chatType === "p2p" ? "follow" : pref;
}

/**
 * 过滤决策纯函数（单一决策源）：先按 chat_type 归一手动偏好（私聊一律跟随），
 * 再按优先级决策——手动覆盖不读免打扰；跟随态 muted→过滤 / unmuted→拉取 /
 * unknown→降级拉取（followDegraded）。
 */
export function filterDecision(
  pref: FilterPref,
  outcome: MuteOutcome,
  chatType: string,
): { effect: FilterEffect; source: FilterSource } {
  const normalized = prefForChatType(chatType, pref);
  if (normalized === "always_filter") {
    return { effect: "filter", source: "manual" };
  }
  if (normalized === "always_pull") {
    return { effect: "pull", source: "manual" };
  }
  if (outcome === "muted") {
    return { effect: "filter", source: "follow" };
  }
  return { effect: "pull", source: outcome === "unknown" ? "followDegraded" : "follow" };
}

/** 每轮一次的全量偏好读（无行 = follow 跟随态；坏数据忽略） */
export function loadFilterPrefs(conn: Conn): Map<string, FilterPref> {
  const out = new Map<string, FilterPref>();
  for (const row of conn.prepare("SELECT chat_id, preference FROM chat_filter_prefs").all() as Array<{
    chat_id: string;
    preference: string;
  }>) {
    if (row.preference === "always_filter" || row.preference === "always_pull") {
      out.set(row.chat_id, row.preference);
    }
  }
  return out;
}

/** 快照行：该轮的观测事实（会话 + 免打扰查询结果）；生效状态读取时现算不落库 */
export interface ChatSnapshotRow {
  chatId: string;
  chatName: string;
  chatType: string;
  muteOutcome: MuteOutcome;
}

/**
 * 快照事务（write_chat_snapshot 同构，单事务原子）：整表替换 feishu_chats
 * （含被过滤者——管理界面要列全部）+ UPSERT settings.feishu_snapshot_at
 * （快照时间唯一载体：零会话轮也推进，区分「从未成功拉取」与「零会话账号」）。
 */
export function writeChatSnapshot(conn: Conn, rows: ChatSnapshotRow[], now = nowRfc3339()): void {
  txImmediate(conn, () => {
    conn.prepare("DELETE FROM feishu_chats").run();
    const insert = conn.prepare(
      "INSERT INTO feishu_chats (chat_id, chat_name, chat_type, mute_outcome) VALUES (?, ?, ?, ?)",
    );
    for (const r of rows) {
      insert.run(r.chatId, r.chatName, r.chatType, r.muteOutcome);
    }
    conn
      .prepare(
        "INSERT INTO settings (key, value) VALUES ('feishu_snapshot_at', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(now);
  });
}
