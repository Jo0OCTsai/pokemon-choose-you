/**
 * host 命令 · agent 工具面（3 条）：agentTest 连接探针（ai::test 同构——无头执行器跑
 * pk context，stdout 含 openTasks 即通；结果以数据面带回 connected + message，失败含
 * 可操作提示不占业务错误码）/ pkSkillCheck / pkSkillInstall（skills.rs 本机部分同构；
 * command/dir 覆盖 = 编辑态草稿值优先）。远端 SSH 操作无 provider 装配不提供。
 */
import type { CommandTable, HostCommandDeps } from "./context";
import { loadAgents, primaryAgent, type AgentConfig } from "../domain/settings";
import { bundledSkillVersion, kindForCommand, localSkillInstall, localSkillStatus, skillDirFor } from "../domain/skills";
import { createLocalExecutor } from "../dispatch/executor";
import { paramError } from "../storage/errors";

/** agent 连接测试探针提示词（ai::test 同字）：一次验证命令可用 + PATH + 数据库可达 */
const AGENT_TEST_PROBE = "执行命令 pk context，并把它的标准输出原样返回，不要添加任何解释。";

/** agent 定位公共段（按 id 精确找；缺省 primary） */
function resolveAgent(deps: Pick<HostCommandDeps, "conn">, agentId: string | undefined): AgentConfig {
  const agents = loadAgents(deps.conn);
  const agent =
    agentId !== undefined && agentId !== ""
      ? agents.find((a) => a.id === agentId)
      : (primaryAgent(deps.conn) ?? undefined);
  if (agent === undefined) {
    throw paramError("请先在设置中配置 AI Agent CLI");
  }
  return agent;
}

/** kind 推断（命令不可识别 → 带技能根目录指引的参数错） */
function kindOrThrow(command: string): string {
  const kind = kindForCommand(command);
  if (kind === null) {
    throw paramError(
      `无法从命令「${command}」推断技能目录：支持 claude / opencode / pi / dsh，其他 agent 请填「技能根目录」`,
    );
  }
  return kind;
}

/** 探针执行结果 → 数据面（成功 / 白名单指引 / 启动失败 / 超时四路文案） */
function probeMessage(stdout: string): { connected: boolean; message: string } {
  if (stdout.includes("openTasks")) {
    return { connected: true, message: "Agent 调用成功，pk 工具链已连通（context 正常返回）" };
  }
  const brief = stdout.trim().slice(0, 200);
  return {
    connected: false,
    message:
      "Agent 调用成功但未返回 pk context 输出——请确认 agent 无头模式允许执行 pk 命令" +
      "（工具白名单，如 claude 附加参数 --allowedTools Bash(pk:*)，注意参数按空白切分、不要加引号；" +
      `本机 pk 不在 agent 的 PATH 时先确认 pk 已安装）。agent 回复片段：${brief}`,
  };
}

/** 探针执行：执行器选择（注入 provider 优先）→ launch → 四路文案收口 */
async function probeAgent(deps: Pick<HostCommandDeps, "dispatchDeps">, agent: AgentConfig): Promise<{ connected: boolean; message: string }> {
  const executor =
    deps.dispatchDeps.executorFor?.(agent, {
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
    }) ?? createLocalExecutor();
  const outcome = await executor.launch({
    command: agent.command,
    args: agent.args ?? "",
    prompt: AGENT_TEST_PROBE,
    workdir: agent.workdir ?? "",
    timeoutSecs: agent.timeoutSecs,
    env: {},
  });
  if (outcome.error !== undefined) {
    return { connected: false, message: `Agent 启动失败：${outcome.error}` };
  }
  if (outcome.timedOut) {
    return { connected: false, message: `Agent 测试超时（${agent.timeoutSecs} 秒）未返回` };
  }
  return probeMessage(outcome.stdout);
}

export function agentToolsCommands(): CommandTable {
  return {
    agentTest: async (p, deps) => {
      const args = p as { agentId?: string };
      return probeAgent(deps, resolveAgent(deps, args.agentId));
    },
    pkSkillCheck: (p, deps) => {
      const args = p as { agentId?: string; command?: string; dir?: string };
      const agent = resolveAgent(deps, args.agentId);
      const kind = kindOrThrow(args.command ?? agent.command);
      const dir = skillDirFor(kind, args.dir ?? agent.skillDir);
      const status = localSkillStatus(dir);
      return {
        kind,
        dir,
        installed: status.installed,
        installedVersion: status.installedVersion,
        bundledVersion: bundledSkillVersion(),
      };
    },
    pkSkillInstall: (p, deps) => {
      const args = p as { agentId?: string; command?: string; dir?: string };
      const agent = resolveAgent(deps, args.agentId);
      const kind = kindOrThrow(args.command ?? agent.command);
      const dir = skillDirFor(kind, args.dir ?? agent.skillDir);
      const { previousVersion, path } = localSkillInstall(dir);
      return { kind, dir, previousVersion, version: bundledSkillVersion(), path };
    },
  };
}
