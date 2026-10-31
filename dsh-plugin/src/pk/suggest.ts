/**
 * suggest 子命令（对齐 bin/pk/suggest.rs）：AI 判定写回（单条 / 批量）、校验与假名还原。
 * 落库经 domain/suggest-apply（apply_suggestion_conn 同构）；batch 整批先校验再单事务落库。
 */
import { readSync } from "node:fs";
import type { Conn } from "../host/storage/db";
import { txImmediate } from "../host/storage/db";
import { restore } from "../host/domain/anonymize";
import { applySuggestion } from "../host/domain/suggest-apply";
import { isFollowUp, isTodo, isUpdate, type AiSuggestion, type ProposedTag } from "../host/domain/suggest-types";
import { listTags, dimensionIdByKey, dimensionRemaining } from "../host/domain/vocabulary-tags";
import { CliError, cliLog, flag, parseArgs, usageErr, validateChoice, VALID_CONFIDENCE, VALID_PRIORITY } from "./cli";
import { resolveCategory } from "./tag";
import { ensureTask } from "./task";

export function runSuggest(conn: Conn, rest: readonly string[]): unknown {
  const sub = rest[0];
  if (sub === undefined) {
    throw usageErr("缺少 suggest 子命令（todo / update / follow-up / none / batch）");
  }
  const rest2 = rest.slice(1);
  if (sub === "batch") {
    const p = parseArgs(rest2);
    const agent = flag(p, "agent");
    return runSuggestBatch(conn, agent);
  }
  if (sub === "todo" || sub === "update" || sub === "none") {
    return runSuggestSingle(conn, sub, rest2);
  }
  if (sub === "follow-up" || sub === "followup") {
    return runSuggestSingle(conn, "followUp", rest2);
  }
  throw usageErr(`未知 suggest 子命令「${sub}」，用法见 pk help`);
}

function runSuggestSingle(conn: Conn, action: string, rest: readonly string[]): unknown {
  const p = parseArgs(rest);
  const message = flag(p, "message");
  if (message === undefined || message === "") {
    throw usageErr("suggest 需要 --message <消息id>（待判定消息列表里的 id）");
  }
  const taskRaw = flag(p, "task");
  let taskId: number | undefined;
  if (taskRaw !== undefined && taskRaw !== "") {
    const n = Number(taskRaw);
    if (!Number.isInteger(n)) throw usageErr("--task 必须是待办 id 数字");
    taskId = n;
  }
  const s = buildSingleSuggestion(p, action, message, taskId);
  const agent = nonEmptyFlag(p, "agent") ?? "cli";
  const restored = restoreSuggestion(conn, s);
  validateSuggestion(conn, restored, 1);
  applySuggestion(conn, restored, agent);
  return { applied: restored.action, message: restored.messageId, agent };
}

/** 非空旗标值（空串视为未提供） */
function nonEmptyFlag(p: Parameters<typeof flag>[0], k: string): string | undefined {
  const v = flag(p, k);
  return v !== undefined && v !== "" ? v : undefined;
}

/** 单条提交的 AiSuggestion 组装（--tags 只有名字：按 topic 维度、词表内解析） */
function buildSingleSuggestion(
  p: Parameters<typeof flag>[0],
  action: string,
  message: string,
  taskId: number | undefined,
): AiSuggestion {
  const tagsRaw = flag(p, "tags");
  const tags: ProposedTag[] =
    tagsRaw !== undefined && tagsRaw !== ""
      ? tagsRaw
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter((t) => t !== "")
          .map((name) => ({ name, dimension: "topic", isNew: false }))
      : [];
  const opt = (k: string): string | null => nonEmptyFlag(p, k) ?? null;
  const taskRef = (a: string): number | null => (action === a ? (taskId ?? null) : null);
  return {
    messageId: message,
    action,
    title: opt("title"),
    note: opt("note"),
    category: opt("category"),
    priority: opt("priority"),
    due: opt("due"),
    tags,
    followUpTaskId: taskRef("followUp"),
    updateTaskId: taskRef("update"),
    reason: opt("reason"),
    confidence: opt("confidence"),
  };
}

/** 建议回写的文本字段反向还原：模型看到与输出的是代号，落库给用户看的必须是真名（未知代号原样保留） */
function restoreSuggestion(conn: Conn, s: AiSuggestion): AiSuggestion {
  const r = { ...s, tags: (s.tags ?? []).map((t) => ({ ...t })) };
  if (r.title != null) r.title = restore(conn, r.title);
  if (r.note != null) r.note = restore(conn, r.note);
  if (r.reason != null) r.reason = restore(conn, r.reason);
  for (const t of r.tags) {
    t.name = restore(conn, t.name);
  }
  return r;
}

function runSuggestBatch(conn: Conn, agentFlag: string | undefined): unknown {
  const body = readStdinSync();
  if (body.trim() === "") {
    throw usageErr("batch 需要从标准输入传入 JSON，如：pk suggest batch < suggestions.json");
  }
  return suggestBatchFromStr(conn, body, agentFlag);
}

/** 同步读 stdin 至 EOF（CLI 一次性输入；pipe 或重定向均覆盖） */
function readStdinSync(): string {
  try {
    const chunks: Buffer[] = [];
    while (true) {
      const buf = Buffer.alloc(65536);
      const read = readSync(0, buf, 0, buf.length, null);
      if (read === 0) break;
      chunks.push(buf.subarray(0, read));
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch (e) {
    throw new CliError(`读取标准输入失败: ${e instanceof Error ? e.message : String(e)}`, 1);
  }
}

/** batch 的解析与落库（与 stdin 读取分离，便于测试）：整批先校验再单事务落库，一损俱损 */
export function suggestBatchFromStr(conn: Conn, body: string, agentFlag: string | undefined): unknown {
  const list = parseBatch(body);
  if (list.length === 0) {
    throw usageErr("results 为空，无可提交的建议");
  }
  const restored = list.map((s) => restoreSuggestion(conn, s));
  restored.forEach((s, i) => validateSuggestion(conn, s, i + 1));
  const agent = agentFlag !== undefined && agentFlag !== "" ? agentFlag : "cli";
  const nTodo = restored.filter(isTodo).length;
  const nUpdate = restored.filter(isUpdate).length;
  const nFollow = restored.filter(isFollowUp).length;
  txImmediate(conn, () => {
    for (const s of restored) {
      applySuggestion(conn, s, agent);
    }
  });
  cliLog(
    "INFO",
    `suggest batch 提交 ${restored.length} 条（todo ${nTodo} / update ${nUpdate} / followUp ${nFollow} / none ${restored.length - nTodo - nUpdate - nFollow}）agent=${agent}`,
  );
  return {
    submitted: restored.length,
    todo: nTodo,
    update: nUpdate,
    followUp: nFollow,
    none: restored.length - nTodo - nUpdate - nFollow,
    agent,
  };
}

/** batch 输入：{"results":[...]} 或顶层数组（与应用文本协议同构）；同批重复 messageId 提前拒绝 */
function parseBatch(body: string): AiSuggestion[] {
  let v: unknown;
  try {
    v = JSON.parse(body.trim());
  } catch (e) {
    throw new CliError(`batch 输入不是合法 JSON: ${e instanceof Error ? e.message : String(e)}`, 2);
  }
  const arr = Array.isArray(v)
    ? v
    : v !== null && typeof v === "object" && Array.isArray((v as { results?: unknown }).results)
      ? (v as { results: unknown[] }).results
      : undefined;
  if (arr === undefined) {
    throw new CliError('batch 输入应为 {"results":[...]} 或顶层数组', 2);
  }
  const list = arr.map((item, i) => toSuggestion(item, i + 1));
  const seen = new Set<string>();
  list.forEach((s, i) => {
    if (seen.has(s.messageId)) {
      throw new CliError(`第 ${i + 1} 条与前面的条目 messageId 重复（${s.messageId}）`, 2);
    }
    seen.add(s.messageId);
  });
  return list;
}

/** 单条输入 → AiSuggestion（serde 宽松反序列化同构：camelCase 字段 + 纯字符串标签兼容） */
function toSuggestion(item: unknown, idx: number): AiSuggestion {
  if (item === null || typeof item !== "object") {
    throw new CliError(`第 ${idx} 条不是对象`, 2);
  }
  const o = item as Record<string, unknown>;
  if (typeof o.messageId !== "string" || typeof o.action !== "string") {
    throw new CliError(`建议条目解析失败: 第 ${idx} 条缺 messageId/action`, 2);
  }
  const str = (k: string): string | null =>
    typeof o[k] === "string" && (o[k] as string) !== "" ? (o[k] as string) : null;
  const num = (k: string): number | null => (typeof o[k] === "number" ? (o[k] as number) : null);
  const tags = Array.isArray(o.tags)
    ? o.tags.map((t) => (typeof t === "string" ? { name: t, dimension: "topic", isNew: false } : (t as ProposedTag)))
    : [];
  return {
    messageId: o.messageId,
    action: o.action,
    title: str("title"),
    note: str("note"),
    category: str("category"),
    priority: str("priority"),
    due: str("due"),
    tags,
    followUpTaskId: num("followUpTaskId"),
    updateTaskId: num("updateTaskId"),
    reason: str("reason"),
    confidence: str("confidence"),
  };
}

/** 提交前统一校验：消息存在且未被人工确认、action/枚举合法、分类/标签存在、目标待办存在 */
function validateSuggestion(conn: Conn, s: AiSuggestion, idx: number): void {
  const at = `第 ${idx} 条（messageId=${s.messageId}）`;
  const row = conn.prepare("SELECT review_status FROM chat_messages WHERE message_id=?").get(s.messageId) as
    { review_status: string } | undefined;
  if (row === undefined) {
    throw new CliError(`${at}:消息不存在（id 须来自待判定消息列表）`, 1);
  }
  if (row.review_status !== "pending") {
    throw new CliError(`${at}:消息已人工确认过（review_status=${row.review_status}），不能重复提交建议`, 1);
  }
  validateSuggestionAction(conn, s, at);
  if (s.priority != null && s.priority !== "") validateChoice(s.priority, VALID_PRIORITY, "优先级");
  if (s.confidence != null && s.confidence !== "") validateChoice(s.confidence, VALID_CONFIDENCE, "confidence");
  if (s.category != null && s.category !== "") resolveCategory(conn, s.category);
  validateSuggestionTags(conn, s, at);
}

/** action 面校验：todo 要 title、update/followUp 要目标待办（ensureTask 报序号上下文） */
function validateSuggestionAction(conn: Conn, s: AiSuggestion, at: string): void {
  switch (s.action) {
    case "todo":
      if (s.title == null || s.title.trim() === "") {
        throw new CliError(`${at}:action=todo 需要 title`, 2);
      }
      break;
    case "update": {
      if (s.updateTaskId == null) {
        throw new CliError(`${at}:action=update 需要 updateTaskId`, 2);
      }
      ensureTask(conn, s.updateTaskId, at);
      break;
    }
    case "followUp": {
      if (s.followUpTaskId == null) {
        throw new CliError(`${at}:action=followUp 需要 followUpTaskId`, 2);
      }
      ensureTask(conn, s.followUpTaskId, at);
      break;
    }
    case "none":
    case "":
      break;
    default:
      throw new CliError(`${at}:action「${s.action}」无效，可选 todo/update/followUp/none`, 2);
  }
}

/** 标签面校验：新标签维度须存在且未满；词表内标签按名+维度兜底命中 */
function validateSuggestionTags(conn: Conn, s: AiSuggestion, at: string): void {
  const tags = s.tags ?? [];
  if (tags.length > 0) {
    const all = listTags(conn);
    for (const t of tags) {
      if (t.isNew) {
        // 新标签：维度必须存在且未满（提前报错让 agent 自纠）
        const dimId = dimensionIdByKey(conn, t.dimension ?? "topic");
        if (dimensionRemaining(conn, dimId) <= 0) {
          throw new CliError(`${at}:维度「${t.dimension ?? "topic"}」标签已满，不能新建「${t.name}」`, 1);
        }
      } else {
        const hit =
          all.find((x) => x.name === t.name && x.dimension === (t.dimension ?? "topic")) ??
          all.find((x) => x.name === t.name);
        if (hit === undefined) {
          throw new CliError(
            `${at}:未知标签「${t.name}」。词表内标签见 pk tag list；新标签须 isNew=true 并带 dimension`,
            1,
          );
        }
      }
    }
  }
}
