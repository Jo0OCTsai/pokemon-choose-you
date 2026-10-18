/**
 * dsh 内置判定通道（A7 无头 subagent，Phase B 落型）：ctx.subagents.startActivation
 * （provider=spawn 进程内全新子级）+ delivery='caller'（调用方等待结果，不发父级通知）
 * + outputSchema 结构化输出——child 直接返回建议数组，本执行器 selfLanding=false，
 * 由 orchestrator 走 domain/suggest 提交期强校验 + 落库（A21 校验失败修正重试同路径）。
 * 父 Agent = 装配后首次判定时经 ctx.agents.create 造的常驻无头 root agent（origin
 * 'subagent' 分类不进主会话列表；子级目录挂它名下，判定子会话可经宿主子智能体面查看）。
 * 行为对齐 CLI 侧基准（adapters.ts 顶注）：超时下限 10s（超时经 dispose 取消整棵
 * activation）、stopReason 非 completed 判失败、会话账本 sessionId = childId。
 * 零 dsh 依赖铁律：本文件是 dsh 适配层（原 subagentExecutorPlaceholder 的真实接面），
 * 服务面经结构化收窄（SubagentsFace/AgentsFace——不 import dsh 包，业务核心无感知）。
 */
import type { JudgeBatch, JudgeExecutor } from "../judge/adapters";
import type { AiSuggestion } from "../domain/suggest-types";

/** 判定超时（对齐 CLI 侧 agent 缺省 timeoutSecs=120；MIN_AGENT_TIMEOUT_SECS 10s 为下限远未触及） */
const JUDGE_TIMEOUT_MS = 120_000;

/** dsh ContentBlock 收窄（判定只用 text 块） */
interface TextBlock {
  type: "text";
  text: string;
}

/** ctx.subagents 消费面收窄（SubagentManager.startActivation——spawn/caller/结构化输出子集） */
export interface SubagentsFace {
  startActivation(spec: {
    provider: string;
    label: string;
    delivery: "caller";
    signal: AbortSignal;
    request: {
      prompt: TextBlock[];
      parent: unknown;
      outputSchema?: unknown;
    };
  }): Promise<{
    childId: string;
    result: Promise<{ structured?: unknown; stopReason: string; diagnostic?: string }>;
    dispose(): Promise<void>;
  }>;
}

/** ctx.agents 消费面收窄（AgentRegistry.create——root agent + origin 分类 + 模型组合子集） */
export interface AgentsFace {
  create(options: {
    sessionId: string;
    meta?: { origin?: "subagent" };
    agentOptions?: { provider: string; model: string; reasoningEffort?: string };
  }): Promise<{ agent: unknown }>;
}

/** ctx.agentDefaultModel 消费面收窄（部署默认模型——父 agent 组合的模型来源） */
export interface AgentDefaultModelFace {
  currentSelection(): { provider: string; model: string; reasoningEffort?: string };
}

/** 判定子会话的宿主目录标签（子智能体面里的任务名） */
const ACTIVATION_LABEL = "todo-judge";

/** 判定输出 schema（object 根——平台约束；AiSuggestion 字段子集，提交期校验兜底封闭性） */
const SUGGESTIONS_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "消息 ID，原样使用输入里的 [ID]" },
          action: { type: "string", description: "todo | update | followUp | none" },
          title: { type: "string", description: "待办标题（action=todo/update 时给）" },
          note: { type: "string" },
          category: { type: "string" },
          due: { type: "string", description: "截止时间（自然语言或日期）" },
          priority: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          reason: { type: "string" },
          confidence: { type: "string", description: "high | medium | low" },
        },
        required: ["messageId", "action"],
      },
    },
  },
  required: ["suggestions"],
} as const;

/** 结构化返回 → AiSuggestion[]（形状守卫；深度校验归 orchestrator 提交期） */
function parseSuggestions(structured: unknown, messageIds: string[]): AiSuggestion[] {
  const rows = (structured as { suggestions?: unknown } | null | undefined)?.suggestions;
  if (!Array.isArray(rows)) {
    throw new Error("dsh 内置通道返回缺失 suggestions 数组（结构化输出形态不符）");
  }
  const known = new Set(messageIds);
  return rows.map((row) => row as AiSuggestion).filter((row) => known.has(row.messageId));
}

/** prompt 追加结构化返回指令（系统提示词默认面向 pk 工具——本通道禁用工具直接回 JSON） */
function subagentPrompt(batch: JudgeBatch): string {
  const lines = [
    batch.prompt,
    "",
    "本次判定不使用任何工具（包括 pk 命令行）：阅读上述消息后，直接以结构化结果返回判定。",
    "suggestions 数组每项含 messageId（原样使用消息 ID）、action（todo/update/followUp/none）",
    "与可选的 title/note/category/due/priority/tags/reason/confidence；不蕴含待办的消息 action=none，逐条都给。",
  ];
  if (batch.feedback !== undefined) {
    lines.push("", `上次提交校验失败，请修正后重试：${batch.feedback}`);
  }
  return lines.join("\n");
}

/** 会话 id（宿主 SessionId 为不透明串——pky-judge 前缀便于辨识） */
function judgeSessionId(): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `judge-${Date.now().toString(36)}`;
  return `pky-judge-${uuid}`;
}

/** hostEntry 接线面：dsh ctx → 内置通道执行器（收窄 cast 收在本文件，hostEntry 免类型面） */
export function dshSubagentExecutorOf(ctx: unknown): JudgeExecutor {
  return dshSubagentExecutor(
    ctx as unknown as {
      agents: AgentsFace;
      subagents: SubagentsFace;
      agentDefaultModel?: AgentDefaultModelFace;
    },
  );
}

/** dsh 内置判定执行器（faces 缺席时调用即报错不静默——接线层保证 inject 在场） */
export function dshSubagentExecutor(deps: {
  agents: AgentsFace;
  subagents: SubagentsFace;
  agentDefaultModel?: AgentDefaultModelFace;
}): JudgeExecutor {
  // 常驻父 agent：首次判定懒建（root、origin=subagent 分类、部署默认模型组合——
  // 无 agentOptions 时子级 prompt 装配报 {{model}} 无值），后续批复用（子级挂它目录）
  let parentPromise: Promise<unknown> | undefined;
  const parentOf = (): Promise<unknown> =>
    (parentPromise ??= deps.agents
      .create({
        sessionId: judgeSessionId(),
        meta: { origin: "subagent" },
        agentOptions: deps.agentDefaultModel?.currentSelection(),
      })
      .then((handle) => handle.agent));
  return {
    id: "subagent",
    name: "dsh 内置通道",
    selfLanding: false,
    async run(batch) {
      let activation: Awaited<ReturnType<SubagentsFace["startActivation"]>> | undefined;
      try {
        const started = (activation = await deps.subagents.startActivation({
          provider: "spawn",
          label: ACTIVATION_LABEL,
          delivery: "caller",
          signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
          request: {
            prompt: [{ type: "text", text: subagentPrompt(batch) }],
            parent: await parentOf(),
            outputSchema: SUGGESTIONS_SCHEMA,
          },
        }));
        const result = await started.result;
        if (result.stopReason !== "completed") {
          throw new Error(
            `dsh 内置通道未完成判定（stopReason=${result.stopReason}${result.diagnostic === undefined ? "" : `：${result.diagnostic}`}）`,
          );
        }
        return { suggestions: parseSuggestions(result.structured, batch.messageIds), sessionId: started.childId };
      } catch (error) {
        // 超时/解析失败后释放整棵 activation（子级资源与容量归还——README 失败与恢复约定）
        await activation?.dispose().catch(() => undefined);
        throw error instanceof Error ? error : new Error(String(error));
      }
    },
  };
}
