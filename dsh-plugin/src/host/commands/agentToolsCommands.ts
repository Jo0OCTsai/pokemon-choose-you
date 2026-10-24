/**
 * host 命令 · agent 工具面（3 条）：agentTest 连接探针（ai::test 同构——无头执行器跑
 * pk context，stdout 含 openTasks 即通；结果以数据面带回 connected + message，失败含
 * 可操作提示不占业务错误码；远端 SSH agent 无 provider 装配时明确报告、不以本机同名 CLI
 * 回落冒充）/ pkSkillCheck / pkSkillInstall（skills.rs 本机部分同构；
 * command/dir 覆盖 = 编辑态草稿值优先）。远端 SSH 操作无 provider 装配不提供。
 */
import type { CommandTable, HostCommandDeps } from "./context";
import { loadAgents, primaryAgent, type AgentConfig } from "../domain/settings";
import {
  bundledSkillVersion,
  kindForCommand,
  localSkillInstall,
  localSkillStatus,
  skillDirFor,
} from "../domain/skills";
import { createLocalExecutor } from "../dispatch/executor";
import { resolveAgentEnv } from "../dispatch/localEnv";
import { agentMinimalRoute } from "../dispatch/routes";
import { extractPayload } from "../judge/adapters";
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

/** 探针执行结果 → 数据面（成功 / 白名单指引 / 启动失败 / 超时四路文案）。
 * 先经 extractPayload 解 claude `--output-format json` 信封：真实回复包在后段 `result`
 * 字段里，直接截 stdout 前 200 字符永远停在 `{"duration_api_ms":…` 头部看不到真因。 */
function probeMessage(stdout: string): { connected: boolean; message: string } {
  const { content } = extractPayload(stdout);
  if (content.includes("openTasks")) {
    return { connected: true, message: "Agent 调用成功，pk 工具链已连通（context 正常返回）" };
  }
  const brief = content.slice(0, 200);
  return {
    connected: false,
    message:
      "Agent 调用成功但未返回 pk context 输出——请确认 agent 无头模式允许执行 pk 命令" +
      "（工具白名单，如 claude 附加参数 --allowedTools Bash(pk:*)，注意参数按空白切分、不要加引号；" +
      `本机 pk 目录已自动注入 agent 的 PATH，仍报找不到 pk 时先确认 pk 已落位）。agent 回复片段：${brief}`,
  };
}

/** 远端执行世界标识（部署绑定别名；空串 = 本地——resolve_remote_target 同语义） */
function remoteTarget(agent: AgentConfig): string {
  return (agent.deployment ?? "").trim();
}

/**
 * 探针执行：执行器选择（注入 provider 优先）→ launch → 四路文案收口。
 * 路由随 agent 部署绑定合成（agentMinimalRoute）——远端 agent 必须路由到部署执行器；
 * 装配层无 provider 或计划被拒（部署不可用/SSH 组件缺失）时返回 null，明确报告——
 * 本机同名 CLI 跑出的结果指向错误目标，不能冒充远端探测（本机回落只给无部署绑定的 agent）。
 */
async function probeAgent(
  deps: Pick<HostCommandDeps, "conn" | "dispatchDeps">,
  agent: AgentConfig,
): Promise<{ connected: boolean; message: string }> {
  const route = agentMinimalRoute(deps.conn, agent);
  const injected = deps.dispatchDeps.executorFor?.(agent, route);
  const target = remoteTarget(agent);
  if ((injected === null || injected === undefined) && target !== "") {
    return {
      connected: false,
      message:
        `该 agent 配置为远端 SSH 执行（${target}），当前会话无法在其部署上执行` +
        "（SSH 执行 provider 未装配或部署不可用），不能用本机同名 CLI 冒充代测——" +
        "请在桌面主应用中测试，或解除该 agent 的部署绑定改回本机执行",
    };
  }
  const executor = injected ?? createLocalExecutor();
  const outcome = await executor.launch({
    command: agent.command,
    args: agent.args ?? "",
    prompt: AGENT_TEST_PROBE,
    workdir: route.workdir,
    timeoutSecs: agent.timeoutSecs,
    // dsh 形态凭据环境（与判定/派发同一注入链）：探针不通时才能排除凭据因素
    env: await resolveAgentEnv(deps.dispatchDeps.agentEnv, agent.command),
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
