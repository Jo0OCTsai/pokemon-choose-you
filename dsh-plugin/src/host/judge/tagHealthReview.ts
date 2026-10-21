/**
 * 标签体检 LLM 复核（tag_health.rs tag_checkup 的 agent 半边）：本地预筛报告 → 主 agent
 * 一次性执行（生效提示词 + 词表 + 候选对；经派发本地执行器——agentTest / 聊聊同一条
 * 「主 agent CLI 一次性执行」通道，凭据环境同链注入）→ verdict 解析与防幻觉过滤 →
 * judged=true。任何一步失败不致命：记 warn、按本地预筛结果展示（judged=false）。
 * 远端部署绑定的主 agent 在 provider 未装配时不以本机同名 CLI 冒充（agentTest 同口径）。
 */
import type { Conn } from "../storage/db";
import { primaryAgent, type AgentConfig } from "../domain/settings";
import { listTags } from "../domain/vocabulary-tags";
import { localReport, type TagCheckupReport } from "../domain/tag-health";
import { applyTagHealthVerdict, buildTagHealthPrompt, parseTagHealthVerdict } from "../domain/tag-health-verdict";
import { editableSpecByKey, resolveOverride } from "../domain/prompt-overrides";
import { createLocalExecutor, type DispatchExecutor, type ExecOutcome } from "../dispatch/executor";
import { resolveAgentEnv } from "../dispatch/localEnv";
import type { HeadlessDeps } from "../dispatch/headless";
import type { ResolvedDispatchRoute } from "../dispatch/routes";
import { extractPayload } from "./adapters";

export interface TagHealthReviewDeps {
  conn: Conn;
  /** 执行器选择与凭据环境（命令层 dispatchDeps 透传；executorFor 注入优先于本地子进程） */
  dispatchDeps: Pick<HeadlessDeps, "executorFor" | "agentEnv">;
  log(level: "debug" | "info" | "warn" | "error", target: string, message: string): void;
}

/** 复核用派发路由（缺省路由形态：本机 / 单槽 / 无 deployment——agentTest probeRoute 同形） */
function reviewRoute(agent: AgentConfig): ResolvedDispatchRoute {
  return {
    agent,
    source: "default",
    projectTag: "",
    workdir: agent.workdir ?? "",
    context: null,
    maxConcurrent: 1,
    worktree: false,
    auto: false,
    deployment: null,
    hostKey: "",
  };
}

/** 执行器选择：注入 provider 优先；远端绑定 agent 无 provider → null（不冒充） */
function executorOf(deps: TagHealthReviewDeps, agent: AgentConfig): DispatchExecutor | null {
  const injected = deps.dispatchDeps.executorFor?.(agent, reviewRoute(agent));
  if (injected !== undefined && injected !== null) {
    return injected;
  }
  return (agent.deployment ?? "").trim() === "" ? createLocalExecutor() : null;
}

/** 无头结果校验：启动失败/超时/非零退出 → 抛错（判定失败统一走 catch 兜底） */
function assertOutcomeOk(outcome: ExecOutcome, agent: AgentConfig): void {
  if (outcome.error !== undefined) {
    throw new Error(`agent 启动失败：${outcome.error}`);
  }
  if (outcome.timedOut) {
    throw new Error(`agent 超时（${agent.timeoutSecs} 秒）未返回`);
  }
  if (outcome.exitCode !== 0) {
    throw new Error(`agent 退出码 ${String(outcome.exitCode)}`);
  }
}

/** 体检入口（命令层消费）：本地预筛 + 可选 LLM 复核 */
export async function tagCheckupReviewed(deps: TagHealthReviewDeps): Promise<TagCheckupReport> {
  const tags = listTags(deps.conn);
  const report = localReport(tags);
  const agent = primaryAgent(deps.conn);
  if (agent === null) {
    return report;
  }
  const executor = executorOf(deps, agent);
  if (executor === null) {
    deps.log(
      "warn",
      "tag-health",
      `主 agent「${agent.name}」绑定远端部署而 SSH 执行 provider 未装配，按本地预筛结果展示`,
    );
    return report;
  }
  const spec = editableSpecByKey("ai_prompt_tag_health");
  if (spec === null) {
    return report;
  }
  try {
    const outcome = await executor.launch({
      command: agent.command,
      args: agent.args ?? "",
      prompt: buildTagHealthPrompt(resolveOverride(deps.conn, spec).text, tags, report.merges),
      workdir: agent.workdir ?? "",
      timeoutSecs: agent.timeoutSecs,
      env: await resolveAgentEnv(deps.dispatchDeps.agentEnv, agent.command),
    });
    assertOutcomeOk(outcome, agent);
    return applyTagHealthVerdict(report, parseTagHealthVerdict(extractPayload(outcome.stdout).content), tags);
  } catch (error) {
    deps.log(
      "warn",
      "tag-health",
      `LLM 判定失败，按本地预筛结果展示: ${String(error instanceof Error ? error.message : error)}`,
    );
    return report;
  }
}
