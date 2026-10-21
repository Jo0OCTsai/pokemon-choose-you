/**
 * 判定执行方适配器（AD §4.5：内置通道 / 外部 agent CLI）——CLI 侧行为基准 =
 * src-tauri/src/ai/invocation.rs（args 中 {prompt} 替换、未出现走 stdin）、
 * src-tauri/src/ai/runner.rs（超时下限 10s、{"result","session_id"} 信封解包、
 * agent 经 pk suggest batch 写回后从库回读——结果落库与进程退出是两件事）、
 * src-tauri/src/commands/radio/judge.rs 的 run_and_collect（整批遗漏判失败）。
 * 会话账本落 agent_sessions（kind=classify，sessions.rs log_session_conn 同构）；会话 id
 * 三源与失败回链见 sessionId.ts（claude/pi 预生成、dsh 事件流捕获、信封回填优先）。
 * 执行世界 = agent 绑定部署（judge.rs resolve_remote_target 同构）：绑定部署的 agent 经注入
 * 的远端 DispatchExecutor 在部署上执行（pk 隧道写回），账本如实记 remote_host；未注入
 * 远端执行器时明确报错，不静默回落本机（判定世界与账本必须一致）。
 * 零 dsh 依赖：spawn 可注入；dsh 内置通道真实桥在适配层 dsh/sessionExecutor.ts
 * （root 会话一批一会话 + 非 selfLanding 落库，本文件 fake 仍为测试替身）。
 * CLI 执行面（realAgentSpawn / buildAgentInvocation / 本机与远端两条执行路径）拆在 cliRun.ts，
 * 本文件统一再出口（消费面不变）。
 */
import type { AgentEnvProvider } from "../dispatch/localEnv";
import { parseDshSessionId } from "../dispatch/dshSession";
import type { DispatchExecutor } from "../dispatch/executor";
import { kindForCommand } from "../dispatch/sessions";
import { pregenSessionId, withSessionId } from "./sessionId";
import {
  MIN_AGENT_TIMEOUT_SECS,
  realAgentSpawn,
  resolveRemoteExecutor,
  spawnLocalJudge,
  spawnRemoteJudge,
  type AgentSpawn,
  type JudgeInvocation,
} from "./cliRun";
import { nowRfc3339, type Conn } from "../storage/db";
import { primaryAgent, type AgentConfig } from "../domain/settings";
import { parseProposedTagsJson } from "../domain/suggest-resolve";
import type { AiSuggestion } from "../domain/suggest-types";

// CLI 执行面再出口（拆件前的导出面——消费方 import 路径不变）
export { MIN_AGENT_TIMEOUT_SECS, buildAgentInvocation, realAgentSpawn, type AgentSpawn } from "./cliRun";

/** 判定批（prompt + 目标消息；feedback 为校验失败回执行方的修正提示，A21） */
export interface JudgeBatch {
  prompt: string;
  messageIds: string[];
  feedback?: string;
}

export interface JudgeRunOutcome {
  suggestions: AiSuggestion[];
  sessionId: string | null;
}

// 失败回链原语（执行方挂 id / 编排层回读）——实现在 sessionId.ts，消费方 import 路径不变
export { sessionIdOfError, withSessionId } from "./sessionId";

/**
 * 执行方接口：selfLanding = 执行方自行经唯一出口（todo_suggest_batch / pk suggest
 * batch）把判定写库——orchestrator 对其做回读 + claim 守卫采纳；false = 返回内存
 * 结构化结果，由 orchestrator 走 domain/suggest 提交期校验+落库。
 */
export interface JudgeExecutor {
  readonly id: string;
  /** 展示名（会话账本 agent_name） */
  readonly name: string;
  readonly selfLanding: boolean;
  /** 执行世界（会话账本 remote_host）：部署 alias；本机 / 内置通道缺省 */
  readonly remoteHost?: string | null;
  run(batch: JudgeBatch): Promise<JudgeRunOutcome>;
}

// ---- 本地 fake 执行方（测试替身：内存结构化结果） ----

/** fake 执行方：fn 收批返回结构化建议（selfLanding=false——由编排层校验落库） */
export function fakeSubagentExecutor(
  id: string,
  fn: (batch: JudgeBatch) => AiSuggestion[] | Promise<AiSuggestion[]>,
): JudgeExecutor {
  return {
    id,
    name: id,
    selfLanding: false,
    async run(batch) {
      return { suggestions: await fn(batch), sessionId: null };
    },
  };
}

// ---- 输出信封解包 ----

/** agent 输出信封解包（extract_payload 同构）：claude JSON 把回答包在 {"result"} 里 */
export function extractPayload(content: string): { content: string; sessionId: string | null } {
  const trimmed = content.trim();
  try {
    const v = JSON.parse(trimmed) as { result?: unknown; session_id?: unknown };
    if (typeof v.result === "string") {
      return { content: v.result, sessionId: typeof v.session_id === "string" ? v.session_id : null };
    }
  } catch {
    // 非 JSON 输出按原文处理
  }
  return { content: trimmed, sessionId: null };
}

// ---- 库回读（load_suggestions_conn 同构：pending 语义行标记遗漏） ----

/** 可空文本列读取（NULL → null） */
function strOrNull(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

function rowToSuggestion(id: string, r: Record<string, unknown>): AiSuggestion {
  const status = String(r.ai_status);
  const action = status === "todo" || status === "update" || status === "followup" ? status : "pending";
  return {
    messageId: id,
    action,
    title: strOrNull(r.suggested_title),
    note: strOrNull(r.suggested_note),
    category: strOrNull(r.suggested_category),
    due: strOrNull(r.suggested_due),
    priority: strOrNull(r.suggested_priority),
    tags: parseProposedTagsJson(String(r.suggested_tags ?? "[]")),
    reason: strOrNull(r.suggested_reason),
    confidence: strOrNull(r.suggested_confidence),
    followUpTaskId: r.followup_task_id === null ? null : Number(r.followup_task_id),
    updateTaskId: r.update_task_id === null ? null : Number(r.update_task_id),
  };
}

/** 回读一批消息的判定（已落库态 + pending 语义行；缺失的消息按 none 兜底行） */
export function loadSuggestionsFor(conn: Conn, messageIds: string[]): AiSuggestion[] {
  const stmt = conn.prepare(
    "SELECT ai_status, suggested_title, suggested_note, suggested_category, suggested_due, " +
      "suggested_priority, suggested_tags, suggested_reason, suggested_confidence, update_task_id, followup_task_id " +
      "FROM chat_messages WHERE message_id=?",
  );
  return messageIds.map((id) => {
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return row === undefined ? { messageId: id, action: "none", tags: [] } : rowToSuggestion(id, row);
  });
}

/** 一批里已落库（非 pending）的判定数（run_and_collect 的 landed 口径） */
export function landedCount(suggestions: AiSuggestion[]): number {
  return suggestions.filter((s) => s.action !== "pending").length;
}

/** 会话账本（agent_sessions；log_session_conn 同构的判定字段集）——kind：classify 收音机分类 / capture 快速捕捉；
 *  remoteHost = 执行世界快照（部署 alias；本机空——与派发行 executionWorld 同口径） */
export function logJudgeSession(
  conn: Conn,
  rec: {
    agentId: string;
    agentName: string;
    sessionId: string | null;
    durationMs: number | null;
    status: "ok" | "error";
    kind?: "classify" | "capture";
    remoteHost?: string | null;
  },
  now = nowRfc3339(),
): void {
  conn
    .prepare(
      "INSERT INTO agent_sessions (agent_id, agent_name, session_id, status, duration_ms, kind, remote_host, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      rec.agentId,
      rec.agentName,
      rec.sessionId,
      rec.status,
      rec.durationMs,
      rec.kind ?? "classify",
      (rec.remoteHost ?? "").trim(),
      now,
    );
}

/** CLI 执行方（selfLanding=true：agent 经 pk suggest batch 写回，适配器从库回读） */
export function cliJudgeExecutor(args: {
  conn: Conn;
  agent: AgentConfig;
  spawnFn?: AgentSpawn;
  /** agent 子进程凭据环境（dsh 形态 DEEPSEEK_API_KEY 注入；缺省不注入） */
  agentEnv?: AgentEnvProvider;
  /**
   * 远端执行器工厂（agent 绑定部署时消费；装配层按 planRemoteRoute 选型——部署缺失/家族
   * 缺失由工厂抛 PkyError 前置拒绝）。绑定部署而工厂缺席 = 远程平台面未装配 → 明确报错，
   * 不回落本机。
   */
  remoteExecutorFor?: (agent: AgentConfig) => DispatchExecutor | null;
}): JudgeExecutor {
  const { conn, agent } = args;
  const spawnFn = args.spawnFn ?? realAgentSpawn;
  const timeoutMs = Math.max(agent.timeoutSecs, MIN_AGENT_TIMEOUT_SECS) * 1000;
  const kind = kindForCommand(agent.command);
  const remoteHost = agent.deployment?.trim() ?? "";
  return {
    id: agent.id,
    name: agent.name,
    selfLanding: true,
    remoteHost: remoteHost === "" ? null : remoteHost,
    async run(batch) {
      const prompt =
        batch.feedback !== undefined
          ? `${batch.prompt}\n\n上次提交校验失败，请修正后重试：${batch.feedback}`
          : batch.prompt;
      const pregen = pregenSessionId(kind);
      const env = args.agentEnv === undefined ? undefined : await args.agentEnv(agent.command);
      const remote = remoteHost === "" ? null : resolveRemoteExecutor(args.remoteExecutorFor, agent);
      const inv: JudgeInvocation = { agent, prompt, kind, pregen, timeoutMs, env };
      // 会话 id 三源（信封回填 > dsh 事件流捕获 > 预生成）；失败也经 withSessionId 回链到账本
      let sessionId = pregen;
      try {
        const stdout = remote === null ? await spawnLocalJudge(spawnFn, inv) : await spawnRemoteJudge(remote, inv);
        sessionId = extractPayload(stdout).sessionId ?? parseDshSessionId(stdout) ?? pregen;
        const suggestions = loadSuggestionsFor(conn, batch.messageIds);
        if (landedCount(suggestions) === 0 && batch.messageIds.length > 0) {
          throw new Error(
            `agent「${agent.name}」执行完成但没有任何判定落库（${batch.messageIds.length} 条全部遗漏）——请确认其无头模式允许执行 pk 命令（工具白名单）`,
          );
        }
        return { suggestions, sessionId };
      } catch (error) {
        throw withSessionId(error, sessionId);
      }
    },
  };
}

/** 判定执行方工厂缺省实现：主 agent（收音机分类指定/首个启用）CLI 形态
 * （导出面 = dsh 适配层 volatile 活读的 cli 分支单源，hostEntry 消费；remoteExecutorFor
 * 由装配层按远程平台面注入——绑定部署的主 agent 在部署上判定） */
export function defaultJudgeExecutor(
  conn: Conn,
  agentEnv?: AgentEnvProvider,
  remoteExecutorFor?: (agent: AgentConfig) => DispatchExecutor | null,
): JudgeExecutor | null {
  const agent = primaryAgent(conn);
  return agent === null
    ? null
    : cliJudgeExecutor({
        conn,
        agent,
        ...(agentEnv === undefined ? {} : { agentEnv }),
        ...(remoteExecutorFor === undefined ? {} : { remoteExecutorFor }),
      });
}
