/**
 * 回放路由（FR-C2 / AD §4.1 sessionReplay；从 sessions.ts 拆出——棘轮 max-lines，
 * 等量迁移；sessions.ts 为统一再出口，消费面不变）——行为基准 = src-tauri/src/
 * commands/integrations.rs 的 resume_route 回放三分支。**执行世界**快照压过当前配置
 * （会话在哪台机器录的就回哪台）；**agent 命令**按 agent_id 解析 ai_agents 配置
 * （删除回落主 agent——desktop open_recorded_session 同构，行内 command 不是回放
 * 命令来源）。
 */
import type { Conn } from "../storage/db";
import { notFound, paramError } from "../storage/errors";
import { PkyError } from "../storage/errors";
import { loadAgents, primaryAgent, type AgentConfig } from "../domain/settings";
import { SESSION_COLS, rowToSession, type SessionSqlRow } from "./sessionsPage";

/** 回放分支：tmux attach 优先 → `--resume <会话id>` → agent 自带历史选择器兜底 */
export type ReplayBranch = "tmux" | "resume" | "picker";

/**
 * 远端 PTY 句柄落账本的标记前缀：agent_sessions.session_id 列复用承载 dsh-ssh 终端
 * 会话句柄（同任务重派写回同一 PTY——sshExecutorTerminal），它不是 agent 会话 id——
 * 回放不得组 `--resume <句柄>`（claude 报未知会话）。桌面无此形态（Rust 账本无 pty 行）。
 */
export const PTY_SESSION_REF_PREFIX = "pty:";

export function ptySessionRef(handle: string): string {
  return `${PTY_SESSION_REF_PREFIX}${handle}`;
}

export function isPtySessionRef(sessionId: string | null): boolean {
  return sessionId !== null && sessionId.startsWith(PTY_SESSION_REF_PREFIX);
}

/** 标记句柄 → 裸 PTY 句柄（无标记原样返回——存量未标记行兼容） */
export function ptyHandleOf(sessionRef: string): string {
  return isPtySessionRef(sessionRef) ? sessionRef.slice(PTY_SESSION_REF_PREFIX.length) : sessionRef;
}

/**
 * 执行世界：本机 / 某部署（快照 target 解析出的部署别名）/ **ssh 别名**（快照三元组
 * 自包含——桌面 agent-remote 来源的行，解析不到部署实体时按快照 host/port/key 直连
 * 回放，desktop open_agent_in_terminal 远端分支同构）。
 */
export type ReplayWorld = "local" | { deploymentAlias: string } | { sshTarget: string };

/** 错误语义 tag（命令装配层 2.9 映射到 PROTOCOL §2 错误码；domain 不定义错误码） */
export type ReplayErrorTag = "DEPLOYMENT_NOT_READY" | "DISPATCH_LAUNCH_FAILED" | "SSH_AUTH_REQUIRED";

/** 部署实体引用（由装配层注入 resolveDeployment 从 dsh:deployments 实体解析） */
export interface ReplayDeploymentRef {
  alias: string;
  ready: boolean;
}

/**
 * 本机回放唤起参数（三分支由 branch 给出，命令行组装归注入实现）。agentCommand/
 * historyArgs 来自 **ai_agents 按 agent_id 解析的配置**（删除回落主 agent——desktop
 * open_recorded_session 同构），不是行内记录的派发命令行：判定行（command 空）与
 * 派发行（command 含 prompt）都按 agent 配置回放。
 */
export interface LocalReplayLaunch {
  branch: ReplayBranch;
  agentId: string;
  /** agent 配置命令（裸命令，如 claude） */
  agentCommand: string;
  /** agent 配置历史参数（会话 id 注入位——adapt_history_args 同构） */
  historyArgs: string;
  sessionId: string | null;
  tmuxSession: string | null;
  workdir: string;
}

/** 远端回放唤起参数（对应部署；快照三元组自包含） */
export interface RemoteReplayLaunch {
  branch: ReplayBranch;
  /** 快照 remote_host（部署 target——路由自包含，不依赖实体在位） */
  target: string;
  deploymentAlias: string;
  agentId: string;
  agentCommand: string;
  historyArgs: string;
  sessionId: string | null;
  tmuxSession: string | null;
  workdir: string;
  port: number;
  keyPath: string;
}

/**
 * 唤起执行体注入缝（真实实现归组 2.8 接线）：本机 = dsh 终端面板唤起（能力缺失
 * 抛 PkyError(DISPATCH_LAUNCH_FAILED)）；远端 = 对应部署唤起（免密/连接失败抛
 * PkyError(SSH_AUTH_REQUIRED)）；部署解析（target → 实体）由装配层提供。
 */
export interface ReplayLauncher {
  resolveDeployment(target: string): ReplayDeploymentRef | null;
  launchLocal(launch: LocalReplayLaunch): void;
  launchRemote(launch: RemoteReplayLaunch): void;
  /** ssh 别名回放（快照三元组自包含——desktop 载体弹外部终端 / web 回传命令行） */
  launchAlias(launch: RemoteReplayLaunch): void;
}

export type SessionReplayOutcome =
  | { kind: "routed"; world: ReplayWorld; branch: ReplayBranch }
  | { kind: "error"; tag: ReplayErrorTag; message: string; hint?: string };

/** 路由三分支判定（桌面 integrations.rs resume_route 同构；PTY 句柄非会话 id → picker） */
export function replayBranchOf(row: { tmuxSession: string; sessionId: string | null }): ReplayBranch {
  if (row.tmuxSession.trim() !== "") {
    return "tmux";
  }
  if (row.sessionId !== null && row.sessionId.trim() !== "" && !isPtySessionRef(row.sessionId)) {
    return "resume";
  }
  return "picker";
}

/** 注入执行体错误的转发映射：预期两码转为 tag，其余原样上抛（不吞非预期错误） */
function launcherErrorToOutcome(error: unknown): SessionReplayOutcome {
  if (error instanceof PkyError && (error.code === "SSH_AUTH_REQUIRED" || error.code === "DISPATCH_LAUNCH_FAILED")) {
    const tag = error.code;
    return error.hint === undefined
      ? { kind: "error", tag, message: error.message }
      : { kind: "error", tag, message: error.message, hint: error.hint };
  }
  throw error;
}

/** 本机三分支唤起收口（异常经转发映射转 error outcome） */
function launchLocalReplay(launcher: ReplayLauncher, launch: LocalReplayLaunch): SessionReplayOutcome {
  try {
    launcher.launchLocal(launch);
    return { kind: "routed", world: "local", branch: launch.branch };
  } catch (error) {
    return launcherErrorToOutcome(error);
  }
}

/** 远端部署唤起收口（异常经转发映射转 error outcome） */
function launchRemoteReplay(launcher: ReplayLauncher, launch: RemoteReplayLaunch): SessionReplayOutcome {
  try {
    launcher.launchRemote(launch);
    return { kind: "routed", world: { deploymentAlias: launch.deploymentAlias }, branch: launch.branch };
  } catch (error) {
    return launcherErrorToOutcome(error);
  }
}

/**
 * 回放 agent 解析（desktop open_recorded_session 同构）：按行 agent_id 查 ai_agents
 * （agent_by_id 语义——不筛 enabled），命中不到回落主 agent（ai_agent_id → 首个启用）；
 * 全无可用配置 = 明确报错（桌面同款文案语义）。
 */
function replayAgentOf(conn: Conn, agentId: string): AgentConfig {
  const byId = loadAgents(conn).find((a) => a.id === agentId);
  const agent = byId ?? primaryAgent(conn);
  if (agent === null) {
    throw paramError("会话所属 agent 已删除且无可用 agent 配置，无法回放");
  }
  return agent;
}

/** ssh 别名回放载荷（RemoteReplayLaunch 形状——target 即别名，port/key 来自快照） */
function aliasPayload(
  row: { agentId: string; workdir: string; remotePort: number; remoteKey: string },
  target: string,
  branch: ReplayBranch,
  handles: { sessionId: string | null; tmuxSession: string | null },
  agent: AgentConfig,
): RemoteReplayLaunch {
  return {
    branch,
    target,
    deploymentAlias: target,
    agentId: row.agentId,
    agentCommand: agent.command,
    historyArgs: agent.historyArgs,
    sessionId: handles.sessionId,
    tmuxSession: handles.tmuxSession,
    workdir: row.workdir,
    port: row.remotePort,
    keyPath: row.remoteKey,
  };
}

/** ssh 别名回放收口（异常经转发映射转 error outcome） */
function launchAliasReplay(launcher: ReplayLauncher, launch: RemoteReplayLaunch): SessionReplayOutcome {
  try {
    launcher.launchAlias(launch);
    return { kind: "routed", world: { sshTarget: launch.target }, branch: launch.branch };
  } catch (error) {
    return launcherErrorToOutcome(error);
  }
}

/** 行 → 回放句柄（sessionId/tmuxSession 空串收敛为 null；PTY 句柄不是会话 id，收敛为 null） */
function replayHandles(row: { sessionId: string | null; tmuxSession: string }): {
  sessionId: string | null;
  tmuxSession: string | null;
} {
  const raw = (row.sessionId ?? "").trim();
  const sessionId = raw !== "" && !isPtySessionRef(raw) ? raw : null;
  const tmuxSession = row.tmuxSession.trim() !== "" ? row.tmuxSession.trim() : null;
  return { sessionId, tmuxSession };
}

/** 部署缺失/未就绪的拒绝 outcome（hint 给替代面） */
function deploymentNotReplayable(target: string, dep: ReplayDeploymentRef | null): SessionReplayOutcome {
  return {
    kind: "error",
    tag: "DEPLOYMENT_NOT_READY",
    message: `会话的执行部署「${target}」${dep === null ? "已被移除" : "未就绪"}，无法回放`,
    hint: "可在本机打开该会话所属 agent 的历史选择器回放，或重新开通该部署后再试",
  };
}

/**
 * 回放路由（domain 层）：按账本行的执行世界快照路由——remote_host 空 = 本机三分支
 * 唤起；非空 = 对应部署唤起；**快照压过当前配置**（完全不读 ai_agents 当前配置，
 * 会话在哪台机器录的就回哪台）。无回放句柄（session_id 与 tmux 会话名皆无）落 picker
 * 分支兜底（agent 自带历史选择器——desktop resume_route 同构，交互行不再拦不可回放）；
 * 部署已删/未就绪产出 DEPLOYMENT_NOT_READY tag（hint 给替代）。
 */
export function sessionReplay(conn: Conn, rowId: number, launcher: ReplayLauncher): SessionReplayOutcome {
  const raw = conn.prepare(`SELECT ${SESSION_COLS} FROM agent_sessions WHERE id=?`).get(rowId);
  if (raw === undefined) {
    throw notFound(`会话记录 No.${rowId} 不存在`);
  }
  const row = rowToSession(raw as SessionSqlRow);
  const agent = replayAgentOf(conn, row.agentId);
  const branch = replayBranchOf(row);
  const handles = replayHandles(row);
  if (row.remoteHost.trim() === "") {
    return launchLocalReplay(launcher, {
      branch,
      agentId: row.agentId,
      agentCommand: agent.command,
      historyArgs: agent.historyArgs,
      sessionId: handles.sessionId,
      tmuxSession: handles.tmuxSession,
      workdir: row.workdir,
    });
  }
  const target = row.remoteHost.trim();
  const dep = launcher.resolveDeployment(target);
  if (dep === null) {
    // agent-remote 来源（快照带真实端口/密钥）→ ssh 别名直连回放（desktop 同构）；
    // 部署路由来源（port=0 且无密钥）的部署缺失 → 维持 DEPLOYMENT_NOT_READY 契约
    if (row.remotePort > 0 || row.remoteKey.trim() !== "") {
      return launchAliasReplay(launcher, aliasPayload(row, target, branch, handles, agent));
    }
    return deploymentNotReplayable(target, null);
  }
  if (!dep.ready) {
    return deploymentNotReplayable(target, dep);
  }
  return launchRemoteReplay(launcher, {
    branch,
    target,
    deploymentAlias: dep.alias,
    agentId: row.agentId,
    agentCommand: agent.command,
    historyArgs: agent.historyArgs,
    sessionId: handles.sessionId,
    tmuxSession: handles.tmuxSession,
    workdir: row.workdir,
    port: row.remotePort,
    keyPath: row.remoteKey,
  });
}
