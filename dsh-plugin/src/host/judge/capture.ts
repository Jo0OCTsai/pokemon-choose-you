/**
 * 快速捕捉链路（host 命令 captureTodo / 5 秒撤销）——行为基准 =
 * src-tauri/src/commands/radio/capture.rs 的 capture_todo / undo_chat_review：
 * 用户输入落成 chat_type='local' 消息（content 真名用户可见、content_anon 代号化）
 * → 走同一判定管线（CAPTURE 系统 prompt，手动捕捉未走 claim 协议——消息由本命令
 * 创建，无并发判定方）→ todo 直接建待办（意图明确无需再确认，撤销窗口兜底）；
 * update/followUp/none（判重命中现有待办）留在收音机待人工确认（生成更新卡不
 * 重复建）；失败标 error 可强制捕捉或逃走。会话账本 kind='capture'。
 */
import { randomUUID } from "node:crypto";
import { nowRfc3339, txImmediate, type Conn } from "../storage/db";
import { paramError, PkyError } from "../storage/errors";
import { AnonRules, ME } from "../domain/anonymize";
import { markAiError } from "../domain/claim";
import { getMessage } from "../domain/review";
import { createTaskFromMessage, recordFeedback } from "../domain/suggest-resolve";
import { suggestBatch, type AiSuggestion } from "../domain/suggest";
import { buildCapturePrompt } from "./prompt";
import { logJudgeSession, sessionIdOfError, type JudgeExecutor } from "./adapters";
import { MAX_VALIDATE_RETRIES, executorLabel, logJudgeEvent } from "./orchestrator";
import { AI, type HealthState } from "../health/snapshot";

/** 捕捉输入上限（capture.rs MAX_CAPTURE_CHARS） */
export const MAX_CAPTURE_CHARS = 500;

export interface CaptureOutcome {
  messageId: string;
  /** todo：已自动落成待办（5 秒撤销窗口）；suggestion：留收音机待确认的更新/跟进/none 卡 */
  outcome: "task" | "suggestion";
  taskId: number | null;
}

export interface CaptureDeps {
  conn: Conn;
  executor: JudgeExecutor;
  health?: HealthState;
  /** 运行日志出口（背包-诊断-运行日志；缺省丢弃）——快捕判定成败随行 */
  log?: (level: "info" | "warn", message: string) => void;
  now?: () => string;
  nowMs?: () => number;
}

/** 落库成 local 消息（capture.rs 同构：message_id=cap_uuid、sender=我、is_self=1） */
function insertLocalMessage(conn: Conn, text: string, anon: string, nowMs: number, now: string): string {
  const messageId = `cap_${randomUUID()}`;
  conn
    .prepare(
      "INSERT INTO chat_messages (message_id, chat_id, chat_name, chat_type, sender, sender_id, content, content_anon, " +
        "sent_at, is_self, ai_status, review_status, created_at) VALUES (?, '', '', 'local', '我', '', ?, ?, ?, 1, 'pending', 'pending', ?)",
    )
    .run(messageId, text, anon, nowMs, now);
  return messageId;
}

/** 捕捉判定（无 claim：手动捕捉无并发判定方）：selfLanding 读回、内存态走提交期校验（A21 重试 ≤2） */
async function runCapture(
  deps: CaptureDeps,
  prompt: string,
  messageId: string,
): Promise<{ hit: AiSuggestion; sessionId: string | null }> {
  let feedback: string | undefined;
  for (let attempt = 0; ; attempt++) {
    const outcome = await deps.executor.run({ prompt, messageIds: [messageId], feedback });
    const hit = outcome.suggestions.find(
      (s) => s.messageId === messageId && (!deps.executor.selfLanding || s.action !== "pending"),
    );
    if (hit === undefined) {
      throw new Error("agent 未返回捕捉判定");
    }
    if (deps.executor.selfLanding) {
      return { hit, sessionId: outcome.sessionId };
    }
    try {
      suggestBatch(deps.conn, [hit], deps.executor.id);
      return { hit, sessionId: outcome.sessionId };
    } catch (error) {
      if (error instanceof PkyError && error.code === "JUDGE_INVALID_RESULT" && attempt < MAX_VALIDATE_RETRIES) {
        feedback = error.message;
        continue;
      }
      throw error;
    }
  }
}

/** 输入校验：非空、≤500 字（capture_todo 同口径；违规不落消息） */
function assertCaptureInput(text: string): void {
  if (text === "") {
    throw paramError("请输入待办内容");
  }
  if (Array.from(text).length > MAX_CAPTURE_CHARS) {
    throw paramError(`捕捉内容太长（最多 ${MAX_CAPTURE_CHARS} 字），拆成几条分别记吧`);
  }
}

/** 捕捉会话账本（kind=capture，成败两态共用；sessionId = 执行方会话（内置通道会话 id / CLI 信封）；remoteHost = 执行方执行世界） */
function logCaptureSession(deps: CaptureDeps, started: number, status: "ok" | "error", sessionId: string | null): void {
  logJudgeSession(deps.conn, {
    agentId: deps.executor.id,
    agentName: deps.executor.name,
    sessionId,
    durationMs: Date.now() - started,
    status,
    kind: "capture",
    remoteHost: deps.executor.remoteHost,
    workdir: deps.executor.workdir,
  });
}

/**
 * 快速捕捉：输入校验（非空、≤500 字）→ local 消息入库 → 同一判定管线 →
 * todo 建待办（含 accepted 反馈）/ 判重类结果留收音机 / 失败标 error 并抛出。
 */
export async function captureTodo(deps: CaptureDeps, input: string): Promise<CaptureOutcome> {
  const text = input.trim();
  assertCaptureInput(text);
  const now = deps.now?.() ?? nowRfc3339();
  const nowMs = deps.nowMs?.() ?? Date.now();
  const anon = AnonRules.build(deps.conn).scrub(text);
  const messageId = insertLocalMessage(deps.conn, text, anon, nowMs, now);
  const prompt = buildCapturePrompt(deps.conn, deps.executor.id, {
    messageId,
    sender: ME,
    chatLabel: "手动输入·快速捕捉",
    content: anon,
    context: [],
    mentionNote: "",
  });
  const started = Date.now();
  try {
    const { hit: suggestion, sessionId } = await runCapture(deps, prompt, messageId);
    logCaptureSession(deps, started, "ok", sessionId);
    deps.health?.recordSuccess(AI, now);
    logJudgeEvent(
      deps,
      "info",
      `快捕判定完成：${suggestion.action} · 执行方 ${executorLabel(deps.executor)} · ${Date.now() - started}ms`,
    );
    return suggestion.action === "todo"
      ? finishCapture(deps.conn, messageId, now)
      : { messageId, outcome: "suggestion", taskId: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markAiError(deps.conn, [messageId]);
    // 执行方挂在错误上的会话 id（预生成 / 内置通道会话）——失败捕捉会话同样可回放
    logCaptureSession(deps, started, "error", sessionIdOfError(error));
    deps.health?.recordFailure(AI, message);
    logJudgeEvent(deps, "warn", `快捕判定失败（执行方 ${executorLabel(deps.executor)}）：${message.slice(0, 200)}`);
    throw error;
  }
}

/** todo → 直接建待办 + accepted 反馈（capture_todo 的收尾段） */
function finishCapture(conn: Conn, messageId: string, now: string): CaptureOutcome {
  const msg = getMessage(conn, messageId);
  const taskId = createTaskFromMessage(conn, msg, "dsh", now);
  recordFeedback(conn, msg, "accepted", "", now);
  return { messageId, outcome: "task", taskId };
}

/**
 * 5 秒撤销（undo_chat_review accepted 分支同构）：删掉捕捉刚建的任务
 * （只回滚 source ∈ {feishu, capture} 的「收音机原样」任务，id 被复用则拒绝保安全；
 * 任务已被手动删则只回消息状态）+ 消息回 pending 并清掉误操作反馈。
 */
export function undoCapture(conn: Conn, messageId: string): void {
  const msg = getMessage(conn, messageId);
  if (msg.reviewStatus !== "accepted") {
    throw paramError("该消息不是已接受状态，无可撤销内容");
  }
  if (msg.taskId === null) {
    throw paramError("该消息没有可撤销的待办（应用更新/跟进不支持撤销）");
  }
  const source = conn.prepare("SELECT source FROM tasks WHERE id=?").get(msg.taskId) as { source: string } | undefined;
  if (source !== undefined && source.source !== "feishu" && source.source !== "capture") {
    throw paramError("该待办不是收音机捕捉创建的，拒绝删除（任务 id 可能已被复用）");
  }
  if (source !== undefined) {
    txImmediate(conn, () => {
      conn.prepare("DELETE FROM task_tags WHERE task_id=?").run(msg.taskId);
      conn.prepare("DELETE FROM task_logs WHERE task_id=?").run(msg.taskId);
      conn.prepare("DELETE FROM task_notes WHERE task_id=?").run(msg.taskId);
      conn.prepare("DELETE FROM tasks WHERE id=?").run(msg.taskId);
    });
  }
  txImmediate(conn, () => {
    conn
      .prepare("UPDATE chat_messages SET review_status='pending', task_id=NULL, dismiss_reason='' WHERE id=?")
      .run(msg.id);
    conn
      .prepare(
        "DELETE FROM chat_feedback WHERE id=(SELECT id FROM chat_feedback WHERE chat_message_id=? ORDER BY id DESC LIMIT 1)",
      )
      .run(msg.id);
  });
}
