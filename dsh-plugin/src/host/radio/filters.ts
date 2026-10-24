/**
 * 会话过滤三态与快照——行为基准 = src-tauri/src/feishu.rs 的
 * filter_decision / pref_for_chat_type / MuteOutcome / write_chat_snapshot /
 * load_filter_prefs（feishu-chat-filter 契约：手动偏好优先，跟随态按免打扰推导，
 * 查询失败降级拉取 followDegraded；私聊固定跟随不可设）。
 * 决策核（filterDecision 等）单源在 domain/vocabulary-filters，此处再导出。
 */
import { txImmediate, nowRfc3339, type Conn } from "../storage/db";
import type { FilterPref, MuteOutcome } from "../domain/vocabulary-filters";

export { filterDecision, prefForChatType } from "../domain/vocabulary-filters";
export type { FilterPref, MuteOutcome, FilterEffect, FilterSource } from "../domain/vocabulary-filters";

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
