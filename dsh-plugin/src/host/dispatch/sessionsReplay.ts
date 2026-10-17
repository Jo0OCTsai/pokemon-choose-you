/**
 * 回放路由（FR-C2 / AD §4.1 sessionReplay；从 sessions.ts 拆出——棘轮 max-lines，
 * 等量迁移；sessions.ts 为统一再出口，消费面不变）——行为基准 = src-tauri/src/
 * commands/integrations.rs 的 resume_route 回放三分支。快照压过当前配置：会话在哪台
 * 机器录的就回哪台（不读 ai_agents 当前配置）。
 */
import type { Conn } from "../storage/db";
import { notFound } from "../storage/errors";
import { PkyError } from "../storage/errors";
import { SESSION_COLS, rowToSession, type SessionSqlRow } from "./sessionsPage";

/** 回放分支：tmux attach 优先 → `--resume <会话id>` → agent 自带历史选择器兜底 */
export type ReplayBranch = "tmux" | "resume" | "picker";

/** 执行世界：本机 或 某部署（快照 target 解析出的部署别名） */
export type ReplayWorld = "local" | { deploymentAlias: string };

/** 错误语义 tag（命令装配层 2.9 映射到 PROTOCOL §2 错误码；domain 不定义错误码） */
export type ReplayErrorTag = "DEPLOYMENT_NOT_READY" | "DISPATCH_LAUNCH_FAILED" | "SSH_AUTH_REQUIRED";

/** 部署实体引用（由装配层注入 resolveDeployment 从 dsh:deployments 实体解析） */
export interface ReplayDeploymentRef {
  alias: string;
  ready: boolean;
}

/** 本机回放唤起参数（三分支由 branch 给出，命令行组装归注入实现） */
export interface LocalReplayLaunch {
  branch: ReplayBranch;
  agentId: string;
  agentCommand: string;
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
}

export type SessionReplayOutcome =
  | { kind: "not-replayable" }
  | { kind: "routed"; world: ReplayWorld; branch: ReplayBranch }
  | { kind: "error"; tag: ReplayErrorTag; message: string; hint?: string };

/** 路由三分支判定（桌面 integrations.rs resume_route 同构） */
export function replayBranchOf(row: { tmuxSession: string; sessionId: string | null }): ReplayBranch {
  if (row.tmuxSession.trim() !== "") {
    return "tmux";
  }
  if (row.sessionId !== null && row.sessionId.trim() !== "") {
    return "resume";
  }
  return "picker";
}

/** 可回放判定：session_id 或 tmux 会话名任一非空才有回放句柄（UI 按行数据渲染按钮） */
export function sessionReplayable(row: { sessionId: string | null; tmuxSession: string }): boolean {
  return row.tmuxSession.trim() !== "" || (row.sessionId ?? "").trim() !== "";
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

/** 行 → 回放句柄（sessionId/tmuxSession 空串收敛为 null） */
function replayHandles(row: { sessionId: string | null; tmuxSession: string }): {
  sessionId: string | null;
  tmuxSession: string | null;
} {
  const sessionId = (row.sessionId ?? "").trim() !== "" ? (row.sessionId as string).trim() : null;
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
 * 会话在哪台机器录的就回哪台）。无回放句柄（session_id 与 tmux 会话名皆无）返回
 * 明确不可回放值；部署已删/未就绪产出 DEPLOYMENT_NOT_READY tag（hint 给替代）。
 */
export function sessionReplay(conn: Conn, rowId: number, launcher: ReplayLauncher): SessionReplayOutcome {
  const raw = conn.prepare(`SELECT ${SESSION_COLS} FROM agent_sessions WHERE id=?`).get(rowId);
  if (raw === undefined) {
    throw notFound(`会话记录 No.${rowId} 不存在`);
  }
  const row = rowToSession(raw as SessionSqlRow);
  if (!sessionReplayable(row)) {
    return { kind: "not-replayable" };
  }
  const branch = replayBranchOf(row);
  const handles = replayHandles(row);
  if (row.remoteHost.trim() === "") {
    return launchLocalReplay(launcher, {
      branch,
      agentId: row.agentId,
      agentCommand: row.command ?? "",
      sessionId: handles.sessionId,
      tmuxSession: handles.tmuxSession,
      workdir: row.workdir,
    });
  }
  const target = row.remoteHost.trim();
  const dep = launcher.resolveDeployment(target);
  if (dep === null || !dep.ready) {
    return deploymentNotReplayable(target, dep);
  }
  return launchRemoteReplay(launcher, {
    branch,
    target,
    deploymentAlias: dep.alias,
    agentId: row.agentId,
    agentCommand: row.command ?? "",
    sessionId: handles.sessionId,
    tmuxSession: handles.tmuxSession,
    workdir: row.workdir,
    port: row.remotePort,
    keyPath: row.remoteKey,
  });
}
