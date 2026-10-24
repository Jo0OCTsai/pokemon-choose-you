/**
 * dsh 内置判定通道（root 会话形态，2026-10-19 裁决：一批一会话）：每批判定经
 * ctx.agents.create 造一个顶层 root agent（无 origin 分类、meta.cwd 归组项目）→
 * followup 投递判定 prompt → whenIdle 跑到静默 → 从 session 事件读最终 assistant
 * 文本与 turn 终态 → sessions.flush 落盘 → dispose 归还运行时（会话文件留档，
 * 进主会话列表、可回放——执行配方同 dsh-headless）。root 会话无 outputSchema
 * 结构化约束：prompt 要求裸 JSON 返回 + 围栏容忍解析；本执行器 selfLanding=false，
 * 由 orchestrator 走 domain/suggest 提交期强校验 + 落库（A21 校验失败修正重试同路径）。
 * 行为对齐 CLI 侧基准（adapters.ts 顶注）：超时下限 10s（判定用 120s，经 dispose
 * 取消整个 agent）、turn 终态非 completed 判失败、会话账本 sessionId = 会话 id（失败
 * 路径经 withSessionId 回链）。判定上下文（pk context 同构 JSON）由接线层以 conn 现取
 * 注入 prompt——root 会话无插件工具装配，这是 agent 唯一的判重/词表输入。
 * 零 dsh 依赖铁律：本文件是 dsh 适配层，服务面经结构化收窄（AgentsFace/SessionsFace
 * ——不 import dsh 包，业务核心无感知）。
 */
import { withSessionId, type JudgeBatch, type JudgeExecutor } from "../judge/adapters";
import type { AiSuggestion } from "../domain/suggest-types";

/** 判定超时（对齐 CLI 侧 agent 缺省 timeoutSecs=120；MIN_AGENT_TIMEOUT_SECS 10s 为下限远未触及） */
const JUDGE_TIMEOUT_MS = 120_000;

/** 会话事件收窄（判定只消费 assistant 文本块与 turn 终态） */
interface SessionEventFace {
  type: string;
  data?: unknown;
}

/** 运行时 Agent 消费面收窄（followup 投递 / whenIdle 静默 / session 事件读取） */
export interface AgentFace {
  followup(message: unknown): void;
  whenIdle(): Promise<void>;
  readonly session: {
    readonly seq: number;
    eventAt(seq: number): SessionEventFace | undefined;
  };
}

/** ctx.agents 消费面收窄（AgentRegistry.create——root agent + cwd 归组 + 模型组合子集） */
export interface AgentsFace {
  create(options: {
    sessionId: string;
    meta?: { cwd?: string };
    agentOptions?: { provider: string; model: string; reasoningEffort?: string };
  }): Promise<{ agent: AgentFace; dispose(): Promise<void> }>;
}

/** ctx.sessions 消费面收窄（SessionStore.flush——durability 先于运行时归还） */
export interface SessionsFace {
  flush(session: unknown): Promise<void>;
}

/** ctx.agentDefaultModel 消费面收窄（部署默认模型——root agent 组合的模型来源） */
export interface AgentDefaultModelFace {
  currentSelection(): { provider: string; model: string; reasoningEffort?: string };
}

/** assistant 文本 → JSON（整段 ``` 围栏容忍；失败报可读错——垃圾输出=通道失败） */
function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/.exec(trimmed);
  try {
    return JSON.parse(fenced?.[1] ?? trimmed);
  } catch {
    throw new Error("dsh 内置通道返回非 JSON 文本（判定结果无法解析）");
  }
}

/** JSON → AiSuggestion[]（形状守卫；深度校验归 orchestrator 提交期） */
function parseSuggestions(text: string, messageIds: string[]): AiSuggestion[] {
  const rows = (parseJsonLoose(text) as { suggestions?: unknown } | null)?.suggestions;
  if (!Array.isArray(rows)) {
    throw new Error("dsh 内置通道返回缺失 suggestions 数组（JSON 形态不符）");
  }
  const known = new Set(messageIds);
  return rows.map((row) => row as AiSuggestion).filter((row) => known.has(row.messageId));
}

/**
 * prompt 组装（头行标记供会话列表辨识 + 判定上下文 + 禁工具 + 裸 JSON 返回指令）。
 * 上下文 = 执行器预取的 pk context 同构 JSON（root 会话无插件工具装配，agent 自己跑不了
 * `pk context`——判重/分类/标签/相对时间全靠这一段，与 CLI 侧 agent 自取的输入对齐）。
 */
function sessionPrompt(batch: JudgeBatch, context: string | undefined): string {
  const lines = ["【pk 待办判定】"];
  if (context !== undefined) {
    lines.push(
      "判定上下文（等价 `pk context` 输出：判重对照 openTasks、分类取 categories、标签取 tags/dimensions、相对时间以 now 为基准）：",
      context,
      "",
    );
  }
  lines.push(
    batch.prompt,
    "",
    `本次判定不使用任何工具（包括 pk 命令行${context === undefined ? "" : "——判定上下文已在上方给出"}）：阅读上述消息后，直接返回 JSON 判定结果（裸 JSON，不要代码围栏、不要解释文本）。`,
    '顶层形如 {"suggestions":[…]}，每项含 messageId（原样使用消息 ID）、action（todo/update/followUp/none）',
    "与可选的 title/note/category/due/priority/tags/reason/confidence；不蕴含待办的消息 action=none，逐条都给。",
  );
  if (batch.feedback !== undefined) {
    lines.push("", `上次提交校验失败，请修正后重试：${batch.feedback}`);
  }
  return lines.join("\n");
}

/** assistant/message 事件的文本块拼接（无可见文本 = 空串） */
function assistantTextOf(event: SessionEventFace): string {
  const blocks = (event.data as { message?: { content?: unknown } } | undefined)?.message?.content as
    Array<{ type: string; text?: string }> | undefined;
  return (
    blocks
      ?.filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("") ?? ""
  );
}

/** turn 终态归一（dsh 0.2.1-rc.2 起 reason 为 {kind} 对象，更早宿主为字符串——收敛为 kind 字符串） */
function turnReasonOf(event: SessionEventFace): string | undefined {
  const raw = (event.data as { reason?: unknown } | undefined)?.reason;
  if (typeof raw === "string") {
    return raw;
  }
  const kind = (raw as { kind?: unknown } | null | undefined)?.kind;
  return typeof kind === "string" ? kind : undefined;
}

/** 会话事件折叠（同 dsh-headless summarize）：末段非空 assistant 文本 + turn 终态 reason */
function summarize(session: AgentFace["session"], firstSeq: number): { text: string; reason: string | undefined } {
  let text = "";
  let reason: string | undefined;
  for (let seq = firstSeq; seq < session.seq; seq++) {
    const event = session.eventAt(seq);
    if (event?.type === "assistant/message") {
      const joined = assistantTextOf(event);
      if (joined !== "") text = joined;
    } else if (event?.type === "turn/end") {
      reason = turnReasonOf(event);
    }
  }
  return { text, reason };
}

/** 用户消息（与 @deepseek-ai/dsh-llm createUserMessage 产物同构——适配层不 import dsh 包） */
function userMessage(text: string): unknown {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `msg-${Date.now().toString(36)}`,
    role: "user",
    content: [{ type: "text", text }],
    source: { kind: "user" },
  };
}

/** 会话 id（宿主 SessionId 为不透明串——pky-judge 前缀便于会话列表辨识） */
function judgeSessionId(): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `judge-${Date.now().toString(36)}`;
  return `pky-judge-${uuid}`;
}

/** hostEntry 接线面：dsh ctx → 内置通道执行器（收窄 cast 收在本文件，hostEntry 免类型面）。
 * buildContext 独立参数而非 deps 字段：deps 实为 ctx 代理，读非服务属性会触发 cordis
 * 「without inject」拦截（真机踩坑）。 */
export function dshSessionExecutorOf(ctx: unknown, buildContext?: () => string): JudgeExecutor {
  return dshSessionExecutor(
    ctx as unknown as {
      agents: AgentsFace;
      sessions: SessionsFace;
      agentDefaultModel?: AgentDefaultModelFace;
    },
    buildContext,
  );
}

/** 等 turn 静默（120s 超时）并折叠末段文本；turn 终态非 completed 判失败 */
async function awaitTurn(agent: AgentFace, firstSeq: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      agent.whenIdle(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`dsh 内置通道判定超时（${JUDGE_TIMEOUT_MS / 1000}s）`)),
          JUDGE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  const outcome = summarize(agent.session, firstSeq);
  if (outcome.reason !== "completed") {
    throw new Error(`dsh 内置通道未完成判定（reason=${outcome.reason ?? "无 turn 终态"}）`);
  }
  return outcome.text;
}

/** dsh 内置判定执行器（faces 缺席时调用即报错不静默——接线层保证 inject 在场）；
 * buildContext = 每批现取的判定上下文 JSON（缺省不注入，prompt 退回纯消息形态） */
export function dshSessionExecutor(
  deps: {
    agents: AgentsFace;
    sessions: SessionsFace;
    agentDefaultModel?: AgentDefaultModelFace;
  },
  buildContext?: () => string,
): JudgeExecutor {
  return {
    id: "session",
    name: "dsh 内置通道",
    selfLanding: false,
    async run(batch) {
      // 上下文先于建会话取：库读失败即失败，不留空转会话
      const context = buildContext?.();
      // 一批一会话：root agent（无 origin 分类进主会话列表；cwd 归组项目；模型组合
      // 必须显式给——无 agentOptions 时 prompt 装配报 {{model}} 无值）
      const sessionId = judgeSessionId();
      const handle = await deps.agents.create({
        sessionId,
        meta: { cwd: process.cwd() },
        agentOptions: deps.agentDefaultModel?.currentSelection(),
      });
      const agent = handle.agent;
      const firstSeq = agent.session.seq;
      try {
        agent.followup(userMessage(sessionPrompt(batch, context)));
        const text = await awaitTurn(agent, firstSeq);
        return { suggestions: parseSuggestions(text, batch.messageIds), sessionId };
      } catch (error) {
        // 会话已建且 finally 会 flush 留档——失败账本行也要回链到可回放的会话 id
        throw withSessionId(error, sessionId);
      } finally {
        // 失败/超时也先 flush（部分转录留档可回放），flush/dispose 失败不遮蔽主错误
        await deps.sessions.flush(agent.session).catch(() => undefined);
        await handle.dispose().catch(() => undefined);
      }
    },
  };
}
