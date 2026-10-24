/**
 * 背包词表 · 会话过滤三态（AD §5.2 / feishu.rs）：always_filter / always_pull /
 * follow（= 无偏好行，不落库）；私聊（p2p）固定跟随不可设（API 层拦截）。
 * 生效合并视图（effective/source）读取时现算不落库——决策核单一源在本模块，
 * radio/filters 再导出供拉取链路复用。
 */
// nowRfc3339 走零依赖 clock（本模块经 mockPanels 进 client bundle——引 db 会把
// node:sqlite 拖进浏览器 bundle）；Conn 是纯类型别名（编译期擦除），从 db 复用同一定义。
import { nowRfc3339 } from "../storage/clock";
import type { Conn } from "../storage/db";
import { paramError } from "../storage/errors";

// ---- 会话过滤（三态，feishu.rs） ----

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

/** mute_outcome 文本 → 三值态（坏数据按 unknown 兜底，契约镜像同构） */
function muteOutcomeOf(raw: unknown): MuteOutcome {
  return raw === "muted" || raw === "unmuted" ? raw : "unknown";
}

export interface FilterItem {
  chatId: string;
  chatName: string;
  chatType: string;
  /** follow = 无偏好行（「跟随」不落库）；always_filter / always_pull 来自偏好表 */
  state: "follow" | "always_filter" | "always_pull";
  /** 生效合并视图（桌面同构后端直出：手动=always_*；跟随按免打扰，查询失败降级） */
  effective: FilterEffect;
  source: FilterSource;
  updatedAt: string | null;
}

/**
 * 会话过滤清单（dsh 契约：排除私聊——p2p 固定跟随不可设）：快照表
 * （feishu_chats，行随每轮拉取整表替换）左连偏好表（chat_filter_prefs），
 * effective/source 读取时现算（filterDecision，快照缺行按 unmuted 兜底）。
 */
export function filterList(conn: Conn): { chats: FilterItem[]; counts: Record<string, number> } {
  const rows = conn
    .prepare(
      "SELECT c.chat_id, c.chat_name, c.chat_type, c.mute_outcome, p.preference, p.updated_at " +
        "FROM feishu_chats c LEFT JOIN chat_filter_prefs p ON p.chat_id = c.chat_id " +
        "WHERE c.chat_type != 'p2p' ORDER BY c.chat_id",
    )
    .all() as Array<Record<string, unknown>>;
  const chats: FilterItem[] = rows.map((r) => {
    const state: FilterItem["state"] =
      r.preference === "always_filter" || r.preference === "always_pull" ? r.preference : "follow";
    const decision = filterDecision(state, muteOutcomeOf(r.mute_outcome), String(r.chat_type));
    return {
      chatId: String(r.chat_id),
      chatName: String(r.chat_name),
      chatType: String(r.chat_type),
      state,
      effective: decision.effect,
      source: decision.source,
      updatedAt: (r.updated_at as string | null) ?? null,
    };
  });
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
  // p2p 只拦非 follow（set_feishu_chat_filter 同构：Follow = 删偏好行无害放行，
  // 手动偏好才拒绝——FR-X3 夹具 filter-p2p-fixed-follow 锁定）
  if (state !== "follow") {
    assertNotP2p(snapshot);
  }
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

/** 快照行的免打扰观测（无行 = unmuted 兜底，拉取链路同构） */
function snapMuteOf(snapRow: Record<string, unknown> | undefined): MuteOutcome {
  return snapRow === undefined ? "unmuted" : muteOutcomeOf(snapRow.mute_outcome);
}

/** 写后回读单项（偏好/快照分表读：快照无行时手动偏好仍直出，契约镜像 mergedFilterView 同构） */
function readFilterItem(conn: Conn, chatId: string, snapshot: { chat_type: string } | undefined): FilterItem {
  const prefRow = conn.prepare("SELECT preference, updated_at FROM chat_filter_prefs WHERE chat_id=?").get(chatId) as
    { preference: unknown; updated_at: string | null } | undefined;
  const snapRow = conn
    .prepare("SELECT chat_name, chat_type, mute_outcome FROM feishu_chats WHERE chat_id=?")
    .get(chatId) as Record<string, unknown> | undefined;
  const state = prefToState(prefRow?.preference);
  const chatType = String(snapRow?.chat_type ?? snapshot?.chat_type ?? "");
  const decision = filterDecision(state, snapMuteOf(snapRow), chatType);
  return {
    chatId,
    chatName: String(snapRow?.chat_name ?? ""),
    chatType,
    state,
    effective: decision.effect,
    source: decision.source,
    updatedAt: (prefRow?.updated_at as string | null) ?? null,
  };
}
