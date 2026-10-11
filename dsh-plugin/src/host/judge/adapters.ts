/**
 * 判定执行方适配器（AD §4.5：无头 subagent / 外部 agent CLI）——CLI 侧行为基准 =
 * src-tauri/src/ai/invocation.rs（args 中 {prompt} 替换、未出现走 stdin）、
 * src-tauri/src/ai/runner.rs（超时下限 10s、{"result","session_id"} 信封解包、
 * agent 经 pk suggest batch 写回后从库回读——结果落库与进程退出是两件事）、
 * src-tauri/src/commands/radio/judge.rs 的 run_and_collect（整批遗漏判失败）。
 * 会话账本落 agent_sessions（kind=classify，sessions.rs log_session_conn 同构）。
 * 零 dsh 依赖：spawn 可注入；subagent 真实桥后续装配（占位 + 本地 fake）。
 */
import { spawn } from "node:child_process";
import { nowRfc3339, type Conn } from "../storage/db";
import { PkyError } from "../storage/errors";
import type { AgentConfig } from "../domain/settings";
import { parseProposedTagsJson } from "../domain/suggest-resolve";
import type { AiSuggestion } from "../domain/suggest-types";

/** 单次 agent 调用的超时下限（秒，runner.rs MIN_TIMEOUT_SECS） */
export const MIN_AGENT_TIMEOUT_SECS = 10;

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
  run(batch: JudgeBatch): Promise<JudgeRunOutcome>;
}

// ---- 本地 fake subagent（测试替身：内存结构化结果） ----

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

/** 真实 dsh subagent 桥的接口占位（后续装配任务落型；调用即明确报错不静默） */
export function subagentExecutorPlaceholder(): JudgeExecutor {
  return {
    id: "subagent",
    name: "subagent",
    selfLanding: true,
    async run() {
      throw new Error("dsh subagent 桥未装配：判定执行方请在设置中选择外部 agent CLI 或等待 subagent 装配");
    },
  };
}

// ---- 子进程执行面（可注入） ----

export interface AgentSpawn {
  (
    program: string,
    argv: string[],
    opts: { stdin?: string; cwd?: string; timeoutMs: number },
  ): Promise<{
    stdout: string;
    stderr: string;
  }>;
}

export const realAgentSpawn: AgentSpawn = (program, argv, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(program, argv, { cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new PkyError("JUDGE_TIMEOUT", `Agent「${program}」执行超时（${opts.timeoutMs / 1000} 秒），可在设置中调大超时`),
      );
    }, opts.timeoutMs);
    child.stdout?.on("data", (c: Buffer) => out.push(c));
    child.stderr?.on("data", (c: Buffer) => err.push(c));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Agent「${program}」执行失败: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
      } else {
        const detail =
          Buffer.concat(err).toString("utf8").trim().slice(0, 300) ||
          Buffer.concat(out).toString("utf8").trim().slice(0, 300);
        reject(new Error(`Agent「${program}」退出码 ${code ?? -1}：${detail}`));
      }
    });
    if (opts.stdin !== undefined) {
      child.stdin?.write(opts.stdin);
      child.stdin?.end();
    }
  });

/** 命令行组装（build_invocation 本地分支同构）：args 按空白切分、{prompt} 替换；未出现走 stdin */
export function buildAgentInvocation(
  agent: Pick<AgentConfig, "command" | "args">,
  prompt: string,
): { program: string; argv: string[]; stdin?: string } {
  const args = agent.args.split(/\s+/).filter((a) => a !== "");
  const hasPromptSlot = args.some((a) => a.includes("{prompt}"));
  const argv = args.map((a) => a.replaceAll("{prompt}", prompt));
  return { program: agent.command, argv, stdin: hasPromptSlot ? undefined : prompt };
}

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

/** 会话账本（agent_sessions；log_session_conn 同构的判定字段集）——kind：classify 收音机分类 / capture 快速捕捉 */
export function logJudgeSession(
  conn: Conn,
  rec: {
    agentId: string;
    agentName: string;
    sessionId: string | null;
    durationMs: number | null;
    status: "ok" | "error";
    kind?: "classify" | "capture";
  },
  now = nowRfc3339(),
): void {
  conn
    .prepare(
      "INSERT INTO agent_sessions (agent_id, agent_name, session_id, status, duration_ms, kind, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(rec.agentId, rec.agentName, rec.sessionId, rec.status, rec.durationMs, rec.kind ?? "classify", now);
}

/** CLI 执行方（selfLanding=true：agent 经 pk suggest batch 写回，适配器从库回读） */
export function cliJudgeExecutor(args: { conn: Conn; agent: AgentConfig; spawnFn?: AgentSpawn }): JudgeExecutor {
  const { conn, agent } = args;
  const spawnFn = args.spawnFn ?? realAgentSpawn;
  const timeoutMs = Math.max(agent.timeoutSecs, MIN_AGENT_TIMEOUT_SECS) * 1000;
  return {
    id: agent.id,
    name: agent.name,
    selfLanding: true,
    async run(batch) {
      const inv = buildAgentInvocation(
        agent,
        batch.feedback !== undefined
          ? `${batch.prompt}\n\n上次提交校验失败，请修正后重试：${batch.feedback}`
          : batch.prompt,
      );
      const out = await spawnFn(inv.program, inv.argv, {
        stdin: inv.stdin,
        cwd: agent.workdir === "" ? undefined : agent.workdir,
        timeoutMs,
      });
      const { sessionId } = extractPayload(out.stdout);
      const suggestions = loadSuggestionsFor(conn, batch.messageIds);
      if (landedCount(suggestions) === 0 && batch.messageIds.length > 0) {
        throw new Error(
          `agent「${agent.name}」执行完成但没有任何判定落库（${batch.messageIds.length} 条全部遗漏）——请确认其无头模式允许执行 pk 命令（工具白名单）`,
        );
      }
      return { suggestions, sessionId };
    },
  };
}
