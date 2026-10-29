/**
 * session 子命令（对齐 bin/pk/session.rs + commands/sessions.rs 的 conn 语义）：
 * agent 会话记录的落库与分页查询。dsh 侧无独立 sessions 域模块（补录走 lateReport），
 * 这里按 Rust log_session_conn / list_agent_sessions_conn 同构直写（storage 唯一握连接纪律）。
 */

import type { Conn } from "../host/storage/db";
import { nowRfc3339 } from "../host/storage/db";
import { flag, parseArgs, usageErr, CliError } from "./cli";

/** 会话行（AgentSession serde camelCase 同构） */
interface AgentSessionRow {
  id: number;
  taskId: number | null;
  agentId: string;
  agentName: string;
  sessionId: string | null;
  command: string | null;
  exitCode: number | null;
  status: string;
  durationMs: number | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  kind: string;
  workdir: string;
  tmuxSession: string;
  remoteHost: string;
  remotePort: number;
  remoteKey: string;
  createdAt: string;
}

const SESSION_COLS =
  "id, task_id, agent_id, agent_name, session_id, command, exit_code, status, " +
  "duration_ms, cost_usd, input_tokens, output_tokens, kind, workdir, " +
  "tmux_session, remote_host, remote_port, remote_key, created_at";

function rowToSession(r: Record<string, unknown>): AgentSessionRow {
  return {
    id: Number(r.id),
    taskId: r.task_id === null ? null : Number(r.task_id),
    agentId: String(r.agent_id),
    agentName: String(r.agent_name),
    sessionId: (r.session_id as string | null) ?? null,
    command: (r.command as string | null) ?? null,
    exitCode: r.exit_code === null ? null : Number(r.exit_code),
    status: String(r.status),
    durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
    costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
    inputTokens: r.input_tokens === null ? null : Number(r.input_tokens),
    outputTokens: r.output_tokens === null ? null : Number(r.output_tokens),
    kind: String(r.kind),
    workdir: String(r.workdir),
    tmuxSession: String(r.tmux_session),
    remoteHost: String(r.remote_host),
    remotePort: Number(r.remote_port),
    remoteKey: String(r.remote_key),
    createdAt: String(r.created_at),
  };
}

/** 从设置里的 agent 列表反查名字（找不到就用 id 本身，保证记录可读） */
function agentNameOf(conn: Conn, agentId: string): string {
  const raw = conn.prepare("SELECT value FROM settings WHERE key='ai_agents'").get() as { value: string } | undefined;
  if (raw) {
    try {
      const agents = JSON.parse(raw.value) as Array<{ id: string; name: string }>;
      const hit = agents.find((a) => a.id === agentId);
      if (hit && hit.name !== "") return hit.name;
    } catch {
      // 设置解析失败按未配置处理
    }
  }
  return agentId;
}

export function runSession(conn: Conn, rest: readonly string[]): unknown {
  const sub = rest[0] ?? "";
  const p = parseArgs(rest.slice(1));
  // parse_args 存键时已剥掉 -- 前缀，这里统一兼容两种写法
  const fl = (name: string): string | undefined => flag(p, name.replace(/^-+/, ""));
  let taskId: number | undefined;
  const taskRaw = fl("--task");
  if (taskRaw !== undefined && taskRaw !== "") {
    const n = Number(taskRaw);
    if (!Number.isInteger(n)) throw usageErr("--task 必须是任务 id 数字");
    taskId = n;
  }
  if (sub === "log") {
    const agentId = fl("--agent");
    if (agentId === undefined || agentId === "") {
      throw usageErr("session log 需要 --agent <agent-id>（见设置 → 集成）");
    }
    const numFlag = (name: string): number | undefined => {
      const v = fl(name);
      if (v === undefined || v === "") return undefined;
      const n = Number(v);
      if (!Number.isInteger(n)) throw usageErr(`${name} 必须是数字`);
      return n;
    };
    const costRaw = fl("--cost");
    let costUsd: number | undefined;
    if (costRaw !== undefined && costRaw !== "") {
      const c = Number(costRaw);
      if (!Number.isFinite(c)) throw usageErr("--cost 必须是数字（美元）");
      costUsd = c;
    }
    return {
      session: logSession(conn, {
        taskId,
        agentId,
        sessionId: fl("--session"),
        command: fl("--command"),
        exitCode: numFlag("--exit-code"),
        status: fl("--status") ?? "ok",
        durationMs: numFlag("--duration-ms"),
        costUsd,
        inputTokens: numFlag("--in-tokens"),
        outputTokens: numFlag("--out-tokens"),
      }),
    };
  }
  if (sub === "list") {
    const rows = (
      taskId === undefined
        ? conn.prepare(`SELECT ${SESSION_COLS} FROM agent_sessions ORDER BY id DESC LIMIT 200`).all()
        : conn
            .prepare(`SELECT ${SESSION_COLS} FROM agent_sessions WHERE task_id=? ORDER BY id DESC LIMIT 200`)
            .all(taskId)
    ) as Array<Record<string, unknown>>;
    return { sessions: rows.map(rowToSession) };
  }
  throw usageErr("session 子命令支持 log / list，用法见 pk help");
}

interface NewSession {
  taskId?: number;
  agentId: string;
  sessionId?: string;
  command?: string;
  exitCode?: number;
  status: string;
  durationMs?: number;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

/** 写一条会话记录（log_session_conn 同构：关联任务须存在、agentName 反查、kind=pk） */
function logSession(conn: Conn, s: NewSession): AgentSessionRow {
  if (s.taskId !== undefined) {
    const exists = conn.prepare("SELECT 1 FROM tasks WHERE id=?").get(s.taskId) !== undefined;
    if (!exists) {
      throw new CliError(`待办 No.${s.taskId} 不存在，无法关联会话`, 1);
    }
  }
  const agentName = agentNameOf(conn, s.agentId);
  const r = conn
    .prepare(
      "INSERT INTO agent_sessions (task_id, agent_id, agent_name, session_id, command, " +
        "exit_code, status, duration_ms, cost_usd, input_tokens, output_tokens, " +
        "kind, workdir, tmux_session, remote_host, remote_port, remote_key, created_at) " +
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      s.taskId ?? null,
      s.agentId,
      agentName,
      s.sessionId && s.sessionId !== "" ? s.sessionId : null,
      s.command && s.command !== "" ? s.command : null,
      s.exitCode ?? null,
      s.status === "error" ? "error" : "ok",
      s.durationMs ?? null,
      s.costUsd ?? null,
      s.inputTokens ?? null,
      s.outputTokens ?? null,
      "pk",
      // agent 侧补录：pk 在哪跑，会话就在哪个目录（agent 的 cwd）
      process.cwd(),
      "",
      "",
      0,
      "",
      nowRfc3339(),
    );
  const row = conn
    .prepare(`SELECT ${SESSION_COLS} FROM agent_sessions WHERE id=?`)
    .get(Number(r.lastInsertRowid)) as Record<string, unknown>;
  return rowToSession(row);
}
