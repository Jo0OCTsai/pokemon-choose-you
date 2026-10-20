/**
 * 判定编排——行为基准 = src-tauri/src/commands/radio/judge.rs 的 classify_and_apply
 * （claim→执行→回读消费守卫→失败挽救）与 mark_ai_error_conn / filter_by_claim_conn /
 * salvage_claimed_batch_conn（A22 claim 守卫、A6 超时回收在 claim.ts）：
 * 待判定批 → claim（pending 子集）→ prompt 组装 → 执行方适配器调用 →
 * 结构化结果经 domain/suggest 提交期校验+落库（claim 守卫 + 假名还原）→
 * 未提及消息兜底 none → 失败留档 error（可重判）→ 校验失败回执行方修正重试
 * 自限 ≤2（A21，超限整批落 error）→ 失败挽救后 30s 迟到回看（lateRecheck.ts）。
 */
import { nowRfc3339, type Conn } from "../storage/db";
import { PkyError } from "../storage/errors";
import { claimJudging, markAiError } from "../domain/claim";
import { dedupBatchTodos, suggestBatch, type AiSuggestion } from "../domain/suggest";
import { applySuggestion } from "../domain/suggest-apply";
import { buildAiMessages, buildJudgePrompt } from "./prompt";
import {
  loadSuggestionsFor,
  logJudgeSession,
  sessionIdOfError,
  type JudgeExecutor,
  type JudgeRunOutcome,
} from "./adapters";
import { scheduleLateRecheck, type LateRecheckDeps } from "./lateRecheck";
import { AI, type HealthState } from "../health/snapshot";

/** 校验失败回执行方修正的重试上限（A21：执行方会话内 ≤2 次——初跑 + 2 重试） */
export const MAX_VALIDATE_RETRIES = 2;

/** 单批消息上限（Rust actionable.chunks(20)：避免超 token） */
export const JUDGE_BATCH_SIZE = 20;

export interface OrchestrateResult {
  claimed: number;
  todo: number;
  update: number;
  followUp: number;
  none: number;
  /** 标记为判定失败（error，可重判）的条数 */
  markedError: number;
  /** claim 失配丢弃的 message_id（迟到孤儿不采纳不污染，A22） */
  dropped: string[];
}

/** 编排依赖（onWrites / scheduleLateRecheck 归迟到回看面，见 lateRecheck.ts） */
export interface OrchestrateDeps extends LateRecheckDeps {
  executor: JudgeExecutor;
  health?: HealthState;
  now?: () => string;
}

function emptyResult(): OrchestrateResult {
  return { claimed: 0, todo: 0, update: 0, followUp: 0, none: 0, markedError: 0, dropped: [] };
}

function countActions(suggestions: AiSuggestion[]): Pick<OrchestrateResult, "todo" | "update" | "followUp" | "none"> {
  const todo = suggestions.filter((s) => s.action === "todo").length;
  const update = suggestions.filter((s) => s.action === "update").length;
  const followUp = suggestions.filter((s) => s.action === "followUp").length;
  return { todo, update, followUp, none: suggestions.length - todo - update - followUp };
}

/** 消费侧 claim 守卫（filter_by_claim_conn 同构）：令牌匹配采纳；失配 judging 留给持有方、已落态回置 pending 待重判 */
function filterByClaim(
  conn: Conn,
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
    if (row !== undefined && row.judge_claimed_at === claimTs) {
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

/** 批内判重兜底的库内降级（run_and_collect 同款 UPDATE：重复 todo 清载荷置 none） */
function demoteDuplicateTodos(conn: Conn, suggestions: AiSuggestion[]): void {
  const demoted = dedupBatchTodos(suggestions);
  const stmt = conn.prepare(
    "UPDATE chat_messages SET ai_status='none', suggested_title=NULL, suggested_note=NULL, suggested_category=NULL, " +
      "suggested_due=NULL, suggested_priority=NULL, suggested_tags='[]', suggested_reason=? WHERE message_id=?",
  );
  for (const id of demoted) {
    const s = suggestions.find((x) => x.messageId === id);
    stmt.run(s?.reason ?? null, id);
  }
}

/** 执行 + 提交期校验/落库（非 selfLanding）：校验失败回执行方修正，重试自限 A21 */
async function runWithValidationRetry(
  deps: OrchestrateDeps,
  messageIds: string[],
  prompt: string,
  claimTs: string,
): Promise<JudgeRunOutcome> {
  let feedback: string | undefined;
  for (let attempt = 0; ; attempt++) {
    const outcome = await deps.executor.run({ prompt, messageIds, feedback });
    if (deps.executor.selfLanding) {
      return outcome;
    }
    const prepared = outcome.suggestions.slice();
    dedupBatchTodos(prepared);
    try {
      suggestBatch(deps.conn, prepared, deps.executor.id, { claimTs });
      return { ...outcome, suggestions: prepared };
    } catch (error) {
      if (error instanceof PkyError && error.code === "JUDGE_INVALID_RESULT" && attempt < MAX_VALIDATE_RETRIES) {
        feedback = error.message;
        continue;
      }
      throw error;
    }
  }
}

/** 未被提及/未落库的 claim 行兜底 none（AI 没给判定不等于跳过） */
function fallbackNone(conn: Conn, claimTs: string, agentId: string, now: string): void {
  const rows = conn
    .prepare("SELECT message_id FROM chat_messages WHERE ai_status='judging' AND judge_claimed_at=?")
    .all(claimTs) as Array<{ message_id: string }>;
  for (const row of rows) {
    applySuggestion(conn, { messageId: row.message_id, action: "none", tags: [] }, agentId, { claimTs, now });
  }
}

/** 失败挽救（salvage_claimed_batch_conn 同构，selfLanding 路径）：已落库且令牌匹配的收下，未落库标 error，失配不采纳；
 * missed = 本次标 error 的行（迟到回看对象） */
function salvageClaimed(
  deps: OrchestrateDeps,
  claimed: string[],
  claimTs: string,
): { result: OrchestrateResult; missed: string[] } {
  const { conn } = deps;
  const { kept, dropped } = filterByClaim(conn, loadSuggestionsFor(conn, claimed), claimTs);
  const landed = kept.filter((s) => s.action !== "pending");
  const missed = kept.filter((s) => s.action === "pending").map((s) => s.messageId);
  const markedError = markAiError(conn, missed, claimTs);
  return { result: { claimed: claimed.length, ...countActions(landed), markedError, dropped }, missed };
}

function handleFailure(
  deps: OrchestrateDeps,
  claimed: string[],
  claimTs: string,
  started: number,
  error: unknown,
): OrchestrateResult {
  const message = error instanceof Error ? error.message : String(error);
  logJudgeSession(deps.conn, {
    agentId: deps.executor.id,
    agentName: deps.executor.name,
    // 执行方挂在错误上的会话 id（预生成 / 内置通道会话 / dsh 捕获）——失败会话同样可回放
    sessionId: sessionIdOfError(error),
    durationMs: Date.now() - started,
    status: "error",
  });
  deps.health?.recordFailure(AI, message);
  if (deps.executor.selfLanding) {
    const { result, missed } = salvageClaimed(deps, claimed, claimTs);
    scheduleLateRecheck(deps, missed);
    return result;
  }
  const markedError = markAiError(deps.conn, claimed, claimTs);
  return { claimed: claimed.length, todo: 0, update: 0, followUp: 0, none: 0, markedError, dropped: [] };
}

/**
 * 一批消息的判定管道（轮询与重判共用）：claim 落空的消息属其他形态/下一轮（不报错），
 * 只对 claim 到的子集组 prompt 送执行方；成功登记会话账本与 AI 链路健康。
 */
export async function orchestrateBatch(deps: OrchestrateDeps, messageIds: string[]): Promise<OrchestrateResult> {
  if (messageIds.length === 0) {
    return emptyResult();
  }
  const claimTs = deps.now?.() ?? nowRfc3339();
  const claimed = claimJudging(deps.conn, messageIds, claimTs);
  if (claimed.length === 0) {
    return emptyResult();
  }
  const prompt = buildJudgePrompt(deps.conn, deps.executor.id, buildAiMessages(deps.conn, claimed, claimTs));
  const started = Date.now();
  try {
    const outcome = await runWithValidationRetry(deps, claimed, prompt, claimTs);
    const now = deps.now?.() ?? nowRfc3339();
    logJudgeSession(deps.conn, {
      agentId: deps.executor.id,
      agentName: deps.executor.name,
      sessionId: outcome.sessionId,
      durationMs: Date.now() - started,
      status: "ok",
    });
    deps.health?.recordSuccess(AI, now);
    let counts: Pick<OrchestrateResult, "todo" | "update" | "followUp" | "none">;
    let dropped: string[] = [];
    if (deps.executor.selfLanding) {
      // 回读以库为准（执行方落库与进程退出是两件事；run_and_collect 同款口径）
      const filtered = filterByClaim(deps.conn, loadSuggestionsFor(deps.conn, claimed), claimTs);
      demoteDuplicateTodos(deps.conn, filtered.kept);
      counts = countActions(filtered.kept);
      dropped = filtered.dropped;
    } else {
      counts = countActions(outcome.suggestions);
    }
    fallbackNone(deps.conn, claimTs, deps.executor.id, now);
    return { claimed: claimed.length, ...counts, markedError: 0, dropped };
  } catch (error) {
    return handleFailure(deps, claimed, claimTs, started, error);
  }
}

/** 库内全部待判定消息 id（ai_status='pending'） */
export function pendingJudgeIds(conn: Conn): string[] {
  return (
    conn.prepare("SELECT message_id FROM chat_messages WHERE ai_status='pending'").all() as Array<{
      message_id: string;
    }>
  ).map((r) => r.message_id);
}

/** 轮询触发入口：pending 全集按 20 条分批送判（结果合并） */
export async function judgePending(deps: OrchestrateDeps, ids?: string[]): Promise<OrchestrateResult> {
  const list = ids ?? pendingJudgeIds(deps.conn);
  const merged = emptyResult();
  for (let i = 0; i < list.length; i += JUDGE_BATCH_SIZE) {
    const part = await orchestrateBatch(deps, list.slice(i, i + JUDGE_BATCH_SIZE));
    merged.claimed += part.claimed;
    merged.todo += part.todo;
    merged.update += part.update;
    merged.followUp += part.followUp;
    merged.none += part.none;
    merged.markedError += part.markedError;
    merged.dropped.push(...part.dropped);
  }
  return merged;
}

/**
 * 批量重判「AI 判定失败」（retryJudge）：error 且未分诊的消息重置 pending（清掉不可信
 * 残留建议）后重新送判；非 error / 已分诊的逐条计入 dropped 汇报。
 */
export async function retryJudge(deps: OrchestrateDeps, messageIds: string[]): Promise<OrchestrateResult> {
  const resettable: string[] = [];
  const reset = deps.conn.prepare(
    "UPDATE chat_messages SET ai_status='pending', suggested_title=NULL, suggested_note=NULL, suggested_category=NULL, " +
      "suggested_due=NULL, suggested_priority=NULL, suggested_tags='[]', suggested_reason=NULL, suggested_confidence=NULL, " +
      "update_task_id=NULL WHERE message_id=? AND ai_status='error' AND review_status='pending'",
  );
  const dropped: string[] = [];
  for (const id of messageIds) {
    if (Number(reset.run(id).changes) === 0) {
      dropped.push(id);
    } else {
      resettable.push(id);
    }
  }
  const result = await judgePending(deps, resettable);
  return { ...result, dropped: [...dropped, ...result.dropped] };
}
