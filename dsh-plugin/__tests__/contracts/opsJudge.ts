/**
 * 契约 op · 判定面（suggest_batch / claim_judge / judge_reclaim / apply_judge_result）：
 * suggest_batch 走 domain/suggest（提交期校验+落库一体），JUDGE_INVALID_RESULT 的
 * 中文文案 → oracle 的机器稳定 tag（关键词映射表）；claim/reclaim 走 domain/claim；
 * apply_judge_result 为 harness 组合（回读 → claim 守卫过滤 → 批内判重 → 未提及兜底
 * —— judge/orchestrator filterByClaim 的只读镜像，私有函数不出口故此处镜像）。
 */
import { nowRfc3339 } from "../../src/host/storage/db";
import { PkyError } from "../../src/host/storage/errors";
import { claimJudging, reclaimStaleJudging } from "../../src/host/domain/claim";
import { dedupBatchTodos, restoreSuggestion, suggestBatch } from "../../src/host/domain/suggest";
import { applySuggestion } from "../../src/host/domain/suggest-apply";
import { loadSuggestionsFor } from "../../src/host/judge/adapters";
import type { AiSuggestion } from "../../src/host/domain/suggest-types";
import type { OpFn } from "./harness";
import { run } from "./opsTask";

/** 校验错误文案关键词 → oracle tag（有序规则表；目标不存在类按批内 action 消歧） */
const SUGGEST_TAG_RULES: Array<[string, string]> = [
  ["messageId 重复", "message-id-duplicated"],
  ["消息不存在", "message-not-found"],
  ["已人工确认过", "review-status-not-pending"],
  ["需要 title", "todo-missing-title"],
  ["需要 updateTaskId", "update-missing-task-id"],
  ["需要 followUpTaskId", "followup-missing-task-id"],
  ["action「", "action-invalid"],
  ["优先级「", "priority-invalid"],
  ["confidence「", "confidence-invalid"],
  ["未找到启用中的分类", "category-not-enabled"],
  ["标签已满", "tag-dimension-full"],
  ["未知标签维度", "tag-dimension-unknown"],
  ["未知标签", "tag-unknown"],
];

/** 校验错误 → oracle tag（validate_suggestion_mirror 的 tag 面；规则序两侧同构） */
function suggestErrorTag(error: unknown, results: AiSuggestion[]): string {
  if (!(error instanceof PkyError)) {
    return "db";
  }
  if (error.code === "INVALID_ARGUMENT" && error.message.includes("results 为空")) {
    return "results-empty";
  }
  for (const [needle, tag] of SUGGEST_TAG_RULES) {
    if (error.message.includes(needle)) {
      return tag;
    }
  }
  return notFoundTag(error.message, results);
}

/** 「待办 No.X 不存在」按批内该条 action 消歧（TS 文案不含 action 字样） */
function notFoundTag(message: string, results: AiSuggestion[]): string {
  if (!message.includes("不存在（id 须来自待办清单）")) {
    return "JUDGE_INVALID_RESULT";
  }
  const hit = /messageId=([^）]+)）/.exec(message)?.[1];
  const action = results.find((s) => s.messageId === hit)?.action;
  return action === "followUp" ? "followup-task-not-found" : "update-task-not-found";
}

/** suggest_batch（oracle：restore→校验→单事务落库；agent 缺省 dsh:test） */
const suggestBatchOp: OpFn = (ctx, args) => {
  const conn = ctx.conn(0);
  const agent = typeof args.agent === "string" && args.agent !== "" ? args.agent : "dsh:test";
  const results = (args.results ?? []) as AiSuggestion[];
  try {
    const outcome = suggestBatch(conn, results, agent);
    return {
      ok: true,
      value: {
        submitted: outcome.submitted,
        todo: outcome.todo,
        update: outcome.update,
        followUp: outcome.followUp,
        none: outcome.none,
      },
    };
  } catch (error) {
    return { ok: false, error: suggestErrorTag(error, results) };
  }
};

/** 消费侧 claim 守卫（orchestrator filterByClaim 镜像：令牌匹配采纳；失配已落态回 pending） */
function filterByClaim(
  conn: Parameters<typeof loadSuggestionsFor>[0],
  suggestions: AiSuggestion[],
  claimTs: string,
): { kept: AiSuggestion[]; dropped: string[] } {
  const kept: AiSuggestion[] = [];
  const dropped: string[] = [];
  const reset = conn.prepare(
    "UPDATE chat_messages SET ai_status='pending', judge_claimed_at='', suggested_title=NULL, suggested_note=NULL, " +
      "suggested_category=NULL, suggested_due=NULL, suggested_priority=NULL, suggested_tags='[]', suggested_reason=NULL, " +
      "suggested_confidence=NULL, update_task_id=NULL WHERE message_id=?",
  );
  for (const s of suggestions) {
    const row = conn
      .prepare("SELECT ai_status, judge_claimed_at FROM chat_messages WHERE message_id=?")
      .get(s.messageId) as { ai_status: string; judge_claimed_at: string } | undefined;
    if (claimOwned(row, claimTs)) {
      kept.push(s);
      continue;
    }
    dropped.push(s.messageId);
    if (row !== undefined && row.ai_status !== "judging") {
      reset.run(s.messageId);
    }
  }
  return { kept, dropped };
}

/** claim 令牌归属判定（行存在且令牌匹配） */
function claimOwned(row: { ai_status: string; judge_claimed_at: string } | undefined, claimTs: string): boolean {
  return row !== undefined && row.judge_claimed_at === claimTs;
}

/** apply_judge_result（oracle harness 组合的镜像：回读→守卫→判重→逐条落库） */
/** 批内判重的库内降级（重复 todo 清载荷置 none——run_and_collect 同款 UPDATE） */
function demoteKept(conn: Parameters<typeof loadSuggestionsFor>[0], kept: AiSuggestion[]): string[] {
  const demoted = dedupBatchTodos(kept);
  const stmt = conn.prepare(
    "UPDATE chat_messages SET ai_status='none', suggested_title=NULL, suggested_note=NULL, " +
      "suggested_category=NULL, suggested_due=NULL, suggested_priority=NULL, suggested_tags='[]', suggested_reason=?2 " +
      "WHERE message_id=?1",
  );
  for (const id of demoted) {
    stmt.run(id, kept.find((s) => s.messageId === id)?.reason ?? null);
  }
  return demoted;
}

/** 逐条落库（跳过 claim 失配丢弃；未提及按 none 兜底行） */
function applyKept(
  conn: Parameters<typeof loadSuggestionsFor>[0],
  ids: string[],
  kept: AiSuggestion[],
  dropped: string[],
  agent: string,
): string[] {
  const byId = new Map(kept.map((s) => [s.messageId, s]));
  const applied: string[] = [];
  for (const id of ids) {
    if (dropped.includes(id)) {
      continue;
    }
    const s = byId.get(id) ?? ({ messageId: id, action: "none", tags: [] } as AiSuggestion);
    applySuggestion(conn, s, agent);
    applied.push(id);
  }
  return applied;
}

const applyJudgeResult: OpFn = (ctx, args) => {
  const conn = ctx.conn(0);
  return run(() => {
    const ids = (args.messageIds ?? []) as string[];
    const agent = typeof args.agent === "string" && args.agent !== "" ? args.agent : "dsh:test";
    const loaded = loadSuggestionsFor(conn, ids);
    const { kept, dropped } =
      typeof args.claimTs === "string"
        ? filterByClaim(conn, loaded, args.claimTs)
        : { kept: loaded, dropped: [] as string[] };
    const demoted = demoteKept(conn, kept);
    const applied = applyKept(conn, ids, kept, dropped, agent);
    return { kept: kept.map((s) => s.messageId), dropped, demoted, applied };
  });
};

/** 判定面 op 表 */
export function judgeOps(): Record<string, OpFn> {
  return {
    suggest_batch: suggestBatchOp,
    claim_judge: (ctx, args) =>
      run(() => {
        const ids = (args.messageIds ?? []) as string[];
        const ts = args.now === "now" ? nowRfc3339() : String(args.now ?? "");
        return { claimed: claimJudging(ctx.conn(0), ids, ts) };
      }),
    judge_reclaim: (ctx) => run(() => ({ reclaimed: reclaimStaleJudging(ctx.conn(0)) })),
    apply_judge_result: applyJudgeResult,
  };
}

export { restoreSuggestion };
