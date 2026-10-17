/**
 * agent_sessions 落账（无头/交互派发共用）——行为基准 =
 * src-tauri/src/commands/sessions.rs（log_session_conn / remote_snapshot /
 * agent_name_of）+ skills.rs kind_for_command + headless.rs session_flags。
 * kind 集合与主应用一致：dispatch_headless / dispatch_interactive。
 *
 * 拆件（棘轮 max-lines，等量迁移）：分页查询 = sessionsPage.ts、回放路由 =
 * sessionsReplay.ts；本文件为统一再出口（消费面不变）。
 */
import { nowRfc3339, type Conn } from "../storage/db";
import { paramError } from "../storage/errors";
import { randomUUID } from "node:crypto";
import type { AgentConfig } from "../domain/settings";

/** 一次会话记录的输入（与 NewAgentSession 字段一一对应） */
export interface AgentSessionRecord {
  taskId?: number | null;
  agentId: string;
  /** 会话来源：dispatch_headless / dispatch_interactive（与主应用 kind 集合一致） */
  kind: string;
  sessionId?: string | null;
  command?: string | null;
  exitCode?: number | null;
  status: "ok" | "error";
  durationMs?: number | null;
  costUsd?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  workdir?: string;
  tmuxSession?: string;
  remoteHost?: string;
  remotePort?: number;
  remoteKey?: string;
}

/** nullish 兜底单点（?? 的分支收敛到这一个函数，落账参数组装零分支噪音） */
function nn<T>(value: T | undefined | null, fallback: T): T {
  return value ?? fallback;
}

/** 从 ai_agents 反查名字（找不到用 id 本身，保证记录可读——agent_name_of 同构） */
function agentNameOf(conn: Conn, agentId: string): string {
  try {
    const raw = conn.prepare("SELECT value FROM settings WHERE key='ai_agents'").get() as { value: string } | undefined;
    if (raw === undefined) {
      return agentId;
    }
    const hit = (JSON.parse(raw.value) as Array<{ id: string; name?: string }>).find((a) => a.id === agentId);
    return hit?.name !== undefined && hit.name.trim() !== "" ? hit.name : agentId;
  } catch {
    return agentId; // 坏数据按 id 兜底
  }
}

/** 执行时远端快照（remote_snapshot 同构：host 空 = 本地执行） */
export function remoteSnapshot(
  agent: AgentConfig,
): Pick<AgentSessionRecord, "remoteHost" | "remotePort" | "remoteKey"> {
  const r = agent.remote;
  if (r === null || r === undefined || r.host.trim() === "") {
    return { remoteHost: "", remotePort: 0, remoteKey: "" };
  }
  return { remoteHost: r.host.trim(), remotePort: r.port, remoteKey: (r.keyPath ?? "").trim() };
}

/**
 * 执行世界快照（A27）：deployment 路由 = 部署 target（remote_host 快照自包含——
 * 回放路由不依赖实体在位，压过 agent 级 remote 配置）；本机路由 = agent 快照面。
 */
export function executionWorld(
  agent: AgentConfig,
  route: { deployment: { target: string } | null },
): Pick<AgentSessionRecord, "remoteHost" | "remotePort" | "remoteKey"> {
  if (route.deployment !== null) {
    return { remoteHost: route.deployment.target.trim(), remotePort: 0, remoteKey: "" };
  }
  return remoteSnapshot(agent);
}

/** 写一条会话记录（log_session_conn 同构：任务存在性校验；status 非 ok 归 error） */
export function logAgentSession(conn: Conn, rec: AgentSessionRecord, now = nowRfc3339()): number {
  if (rec.taskId != null) {
    const row = conn.prepare("SELECT COUNT(*) AS n FROM tasks WHERE id=?").get(rec.taskId) as { n: number };
    if (row.n === 0) {
      throw paramError(`待办 No.${rec.taskId} 不存在，无法关联会话`);
    }
  }
  const result = conn
    .prepare(
      "INSERT INTO agent_sessions (task_id, agent_id, agent_name, session_id, command, exit_code, status, " +
        "duration_ms, cost_usd, input_tokens, output_tokens, kind, workdir, tmux_session, remote_host, " +
        "remote_port, remote_key, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      nn(rec.taskId, null),
      rec.agentId,
      agentNameOf(conn, rec.agentId),
      nn(rec.sessionId, null),
      nn(rec.command, null),
      nn(rec.exitCode, null),
      rec.status === "error" ? "error" : "ok",
      nn(rec.durationMs, null),
      nn(rec.costUsd, null),
      nn(rec.inputTokens, null),
      nn(rec.outputTokens, null),
      rec.kind,
      nn(rec.workdir, "").trim(),
      nn(rec.tmuxSession, ""),
      nn(rec.remoteHost, ""),
      nn(rec.remotePort, 0),
      nn(rec.remoteKey, ""),
      now,
    );
  return Number(result.lastInsertRowid);
}

/** agent 技能目标判定（skills.rs kind_for_command 同构：续接旗标按 kind 选） */
export function kindForCommand(command: string): string | null {
  const base = (command.split(/[\\/]/).pop() ?? command).toLowerCase();
  if (base === "pi" || base.includes("pi-coding-agent")) {
    return "pi";
  }
  if (base === "dsh" || base.includes("deepseek")) {
    return "dsh";
  }
  if (base.includes("claude")) {
    return "claude-code";
  }
  return base.includes("opencode") ? "opencode" : null;
}

/**
 * 会话续接参数（A14 / headless.rs session_flags 同构）：claude 上一轮有会话 id →
 * `--resume`；否则预生成 `--session-id <uuid v4>`（调用方落 dispatched_session）。
 * pi 的 `--session-id` 不存在则按该 id 创建，预生成续接与 claude 同型。
 * 其他 agent 无可靠续接，每轮新会话。
 */
export function sessionFlags(
  kind: string | null,
  prevSession: string | null,
): { flags: string; preSession: string | null } {
  const prev = prevSession?.trim();
  if (kind !== "claude-code" && kind !== "pi") {
    return { flags: "", preSession: null };
  }
  if (prev !== undefined && prev !== "") {
    return { flags: `${kind === "pi" ? "--session-id" : "--resume"} ${prev}`, preSession: null };
  }
  const id = randomUUID();
  return { flags: `--session-id ${id}`, preSession: id };
}

// ---- 统一再出口（拆件前的全部导出面——消费方 import 路径不变） ----

export { sessionsPage, type SessionCounts, type SessionPageResult, type SessionRow } from "./sessionsPage";
export {
  replayBranchOf,
  sessionReplay,
  sessionReplayable,
  type LocalReplayLaunch,
  type ReplayBranch,
  type ReplayDeploymentRef,
  type ReplayErrorTag,
  type ReplayLauncher,
  type ReplayWorld,
  type RemoteReplayLaunch,
  type SessionReplayOutcome,
} from "./sessionsReplay";
