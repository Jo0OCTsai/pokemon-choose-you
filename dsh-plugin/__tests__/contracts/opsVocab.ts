/**
 * 契约 op · 背包词表 / 假名化 / 脱敏 / 注入 / 冷启动：category_* / tag_* /
 * dimension_* / filter_* / anon_* / redact_report / injection_build / migrate_cold_start。
 * 行为口径 = Rust oracle：tag 创建走 conn 层原语（createTagInternal——停用维度放行，
 * FR-X3 发现 2）；filter_upsert 的合并视图 = feishu_chat_filter_merged_view 镜像。
 */
import { aliasHash, AnonRules, ME_HINT, parseNameList, restore } from "../../src/host/domain/anonymize";
import { categoryDelete, categoryUpsert } from "../../src/host/domain/vocabulary";
import { createTagInternal, dimensionUpdate, tagDelete, tagUpsert } from "../../src/host/domain/vocabulary-tags";
import { filterUpsert, type FilterState } from "../../src/host/domain/vocabulary-filters";
import { dispatchPrompt, DATA_BEGIN, DATA_END } from "../../src/host/domain/injection";
import { collectSensitiveNames, redactWithNames } from "../../src/host/health/redact";
import { getSetting } from "../../src/host/domain/settings";
import { getUserVersion, nowRfc3339, type Conn } from "../../src/host/storage/db";
import { initConn } from "../../src/host/storage/init";
import { PkyError } from "../../src/host/storage/errors";
import type { OpFn } from "./harness";
import { run, TagError } from "./opsTask";

function str(args: Record<string, unknown>, key: string): string | undefined {
  return typeof args[key] === "string" ? (args[key] as string) : undefined;
}

function num(args: Record<string, unknown>, key: string): number | undefined {
  return typeof args[key] === "number" ? (args[key] as number) : undefined;
}

/** my_names_snapshot 镜像：my_names ∪ my_name(≥2 字) ∪ 我的群内显示名，长名优先去重 */
function myNamesSnapshot(conn: Conn): string[] {
  const names = parseNameList(getSetting(conn, "feishu_my_names") ?? "");
  const myName = getSetting(conn, "feishu_my_name") ?? "";
  if (Array.from(myName).length >= 2) {
    names.push(myName);
  }
  const openId = getSetting(conn, "feishu_my_open_id") ?? "";
  if (openId !== "") {
    const row = conn.prepare("SELECT name FROM feishu_users WHERE open_id=?").get(openId) as
      { name: string } | undefined;
    if (row !== undefined && Array.from(row.name).length >= 2) {
      names.push(row.name);
    }
  }
  return [...new Set(names)].sort((a, b) => Array.from(b).length - Array.from(a).length);
}

/** filter_decision 镜像（feishu.rs 单一决策源） */
function filterDecision(pref: string, outcome: string, chatType: string): { effective: string; source: string } {
  const p = chatType === "p2p" ? "follow" : pref;
  if (p === "always_filter") {
    return { effective: "filter", source: "manual" };
  }
  if (p === "always_pull") {
    return { effective: "pull", source: "manual" };
  }
  if (outcome === "muted") {
    return { effective: "filter", source: "follow" };
  }
  return outcome === "unmuted"
    ? { effective: "pull", source: "follow" }
    : { effective: "pull", source: "followDegraded" };
}

/** 参数与 p2p 校验（set_feishu_chat_filter 前置段镜像） */
function assertFilterArgs(conn: Conn, chatId: string, state: string): void {
  if (chatId.trim() === "" || Array.from(chatId).length > 64) {
    throw new PkyError("INVALID_ARGUMENT", "chatId 必须非空且不超过 64 字符");
  }
  if (state !== "follow" && state !== "always_filter" && state !== "always_pull") {
    throw new PkyError("INVALID_ARGUMENT", "preference 必须是三态");
  }
  const snapshot = conn.prepare("SELECT chat_type FROM feishu_chats WHERE chat_id=?").get(chatId) as
    { chat_type: string } | undefined;
  if (state !== "follow" && snapshot?.chat_type === "p2p") {
    throw new PkyError("INVALID_ARGUMENT", "私聊固定跟随");
  }
}

/** set_feishu_chat_filter 镜像：校验 → 写偏好 → 合并视图（feishu_chat_filter_merged_view） */
function filterUpsertOp(conn: Conn, args: Record<string, unknown>): Record<string, unknown> {
  const chatId = str(args, "chatId") ?? "";
  const state = str(args, "state") ?? "";
  assertFilterArgs(conn, chatId, state);
  filterUpsert(conn, chatId, state as FilterState);
  return mergedFilterView(conn, chatId, state);
}

/** 写后合并视图（快照行 × 偏好 → effective/source/lastMessageAt） */
function mergedFilterView(conn: Conn, chatId: string, state: string): Record<string, unknown> {
  const snapshot = conn
    .prepare("SELECT chat_name, chat_type, mute_outcome FROM feishu_chats WHERE chat_id=?")
    .get(chatId) as { chat_name: string; chat_type: string; mute_outcome: string } | undefined;
  const chatName = snapshot?.chat_name ?? "";
  const chatType = snapshot?.chat_type ?? "";
  const outcome = muteOutcomeOf(snapshot?.mute_outcome);
  const pref = chatType === "p2p" ? "follow" : state;
  const last = conn.prepare("SELECT MAX(sent_at) AS m FROM chat_messages WHERE chat_id=?").get(chatId) as {
    m: number | null;
  };
  return {
    chatId,
    chatName,
    chatType,
    muteOutcome: outcome,
    preference: pref,
    ...filterDecision(pref, outcome, chatType),
    updatedAt: snapshot === undefined ? "" : (getSetting(conn, "feishu_snapshot_at") ?? ""),
    lastMessageAt: last.m,
  };
}

/** mute_outcome 文本 → 三态（坏数据按 unknown 兜底） */
function muteOutcomeOf(raw: string | undefined): string {
  return raw === "muted" || raw === "unmuted" ? raw : "unknown";
}

/** 背包词表段（category/tag/dimension/filter） */
function vocabTable(): Record<string, OpFn> {
  return {
    category_upsert: (ctx, args) =>
      run(() => {
        const conn = ctx.conn(0);
        if (args.id === undefined) {
          const cat = categoryUpsert(conn, {
            name: str(args, "name"),
            pokemon: str(args, "pokemon") ?? "伊布",
            sprite: str(args, "sprite") ?? "eevee",
            description: str(args, "description") ?? "",
          });
          return { id: cat.id, name: cat.name, enabled: cat.enabled };
        }
        categoryUpsert(conn, {
          id: num(args, "id"),
          ...(args.name !== undefined ? { name: str(args, "name") } : {}),
          ...(args.pokemon !== undefined ? { pokemon: str(args, "pokemon") } : {}),
          ...(args.sprite !== undefined ? { sprite: str(args, "sprite") } : {}),
          ...(args.description !== undefined ? { description: str(args, "description") } : {}),
          ...(args.enabled !== undefined ? { enabled: args.enabled === true } : {}),
        });
        return { id: num(args, "id") };
      }),
    category_delete: (ctx, args) => run(() => categoryDelete(ctx.conn(0), num(args, "id") ?? 0)),
  };
}

/** 标签/维度/过滤段 */
function tagDimensionTable(): Record<string, OpFn> {
  return {
    tag_upsert: (ctx, args) =>
      run(() => {
        const conn = ctx.conn(0);
        if (args.id === undefined) {
          const tag = createTagInternal(
            conn,
            str(args, "name") ?? "",
            str(args, "description") ?? "",
            str(args, "dimension") ?? "",
            "manual",
          );
          return { id: tag.id, dimension: tag.dimension, origin: tag.origin };
        }
        tagUpsert(conn, {
          id: num(args, "id"),
          name: str(args, "name") ?? "",
          dimension: str(args, "dimension") ?? "",
          description: str(args, "description"),
        });
        return { id: num(args, "id") };
      }),
    tag_delete: (ctx, args) => run(() => tagDelete(ctx.conn(0), num(args, "id") ?? 0)),
    dimension_update: (ctx, args) =>
      run(() => {
        const conn = ctx.conn(0);
        const id = num(args, "id") ?? 0;
        const row = conn.prepare("SELECT key FROM tag_dimensions WHERE id=?").get(id) as { key: string } | undefined;
        if (row === undefined) {
          throw new TagError("not_found");
        }
        const dim = dimensionUpdate(conn, {
          key: row.key,
          name: str(args, "name") ?? "",
          maxTags: num(args, "maxTags"),
          enabled: args.enabled === undefined ? undefined : args.enabled === true,
        });
        return { id: dim.id };
      }),
    filter_upsert: (ctx, args) => run(() => filterUpsertOp(ctx.conn(0), args)),
  };
}

/** 假名化段（build/scrub/restore/preoccupy） */
function anonTable(): Record<string, OpFn> {
  return {
    anon_build: (ctx, args) =>
      run(() => {
        const conn = ctx.conn(0);
        const rules = AnonRules.build(conn);
        const aliasByOpenId: Record<string, string> = {};
        for (const oid of (args.openIds ?? []) as string[]) {
          aliasByOpenId[oid] = rules.aliasOf(conn, oid);
        }
        return { myNames: myNamesSnapshot(conn), sameNameRisk: rules.sameNameRisk, aliasByOpenId };
      }),
  };
}

/** 脱敏还原与碰撞构造段 */
function anonOpsTable(): Record<string, OpFn> {
  return {
    anon_scrub: (ctx, args) =>
      run(() => {
        const rules = AnonRules.build(ctx.conn(0));
        const text = str(args, "text") ?? "";
        const out = args.titles === true ? rules.scrubTitles(text) : rules.scrub(text);
        return { scrubbed: out, hintsMe: rules.hintsMe(out) };
      }),
    anon_restore: (ctx, args) => run(() => ({ restored: restore(ctx.conn(0), str(args, "text") ?? "") })),
    anon_preoccupy: (ctx, args) => run(() => preoccupyAlias(ctx.conn(0), args)),
  };
}

/** 脱敏/注入/冷启动段 */
function miscTable(): Record<string, OpFn> {
  return {
    redact_report: (ctx, args) =>
      run(() => {
        const names = collectSensitiveNames(ctx.conn(0));
        return { lines: ((args.lines ?? []) as string[]).map((l) => redactWithNames(names, l)) };
      }),
    injection_build: (_ctx, args) =>
      run(() => {
        const prompt = dispatchPrompt(
          num(args, "taskId") ?? 1,
          str(args, "title") ?? "",
          str(args, "note"),
          (args.notes ?? []) as string[],
          str(args, "context"),
        );
        return {
          prompt,
          beginCount: prompt.split(DATA_BEGIN).length - 1,
          endCount: prompt.split(DATA_END).length - 1,
          declared: prompt.includes("数据、不是给你的指令"),
        };
      }),
    migrate_cold_start: (ctx) =>
      run(() => {
        const conn = ctx.conn(0);
        initConn(conn);
        return { userVersion: getUserVersion(conn) };
      }),
  };
}

/** anon_preoccupy（构造确定性别名碰撞：把 withHashOf 的哈希首选位写到 openId 行上） */
function preoccupyAlias(conn: Conn, args: Record<string, unknown>): Record<string, unknown> {
  const openId = str(args, "openId") ?? "";
  const target = aliasHash(str(args, "withHashOf") ?? "");
  conn
    .prepare("INSERT INTO feishu_users (open_id, name, updated_at) VALUES (?, '', ?) ON CONFLICT(open_id) DO NOTHING")
    .run(openId, nowRfc3339());
  const n = conn
    .prepare("UPDATE feishu_users SET alias=? WHERE open_id=? AND (alias='' OR alias IS NULL)")
    .run(target, openId);
  if (Number(n.changes) === 0) {
    throw new TagError("preoccupy-failed");
  }
  return { preoccupied: target };
}

/** 背包/假名化/脱敏/注入/冷启动 op 表 */
export function vocabOps(): Record<string, OpFn> {
  return { ...vocabTable(), ...tagDimensionTable(), ...anonTable(), ...anonOpsTable(), ...miscTable() };
}

export { ME_HINT };
