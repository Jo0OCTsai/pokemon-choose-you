/**
 * 会话历史分页查询（FR-C2 / AD §4.1 sessionsPage；从 sessions.ts 拆出——棘轮
 * max-lines，等量迁移；sessions.ts 为统一再出口，消费面不变）——行为基准 =
 * src-tauri/src/commands/sessions.rs list_agent_sessions_page_conn。
 */
import type { Conn } from "../storage/db";

/** 会话行（camelCase，与主应用 AgentSession serde 投影对齐；含执行世界快照三元组） */
export interface SessionRow {
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

/** 四档分组计数（筛选胶囊徽标；不随分组/翻页变化） */
export interface SessionCounts {
  all: number;
  radio: number;
  dispatch: number;
  other: number;
}

export interface SessionPageResult {
  rows: SessionRow[];
  counts: SessionCounts;
  /** 当前分组总数（翻页用；与 counts.<group> 同值） */
  total: number;
}

export const SESSION_COLS =
  "id, task_id, agent_id, agent_name, session_id, command, exit_code, status, " +
  "duration_ms, cost_usd, input_tokens, output_tokens, kind, workdir, tmux_session, " +
  "remote_host, remote_port, remote_key, created_at";

/**
 * 归组 WHERE（UIUX §3.1 M9）：radio = classify/capture、dispatch = dispatch_*、
 * other = pk；未知/新增来源（含早期空 kind）仅入「全部」不进三组——与桌面
 * other = NOT IN 四集合的语义有意分歧，以 M9 为准（共享库中桌面写的未知 kind 行
 * 在插件面板不进任何分组胶囊）。
 */
const GROUP_WHERE: Record<string, string> = {
  radio: " WHERE kind IN ('classify','capture')",
  dispatch: " WHERE kind IN ('dispatch_headless','dispatch_interactive')",
  other: " WHERE kind='pk'",
};

export type SessionSqlRow = Record<string, unknown>;

export function rowToSession(row: SessionSqlRow): SessionRow {
  return {
    id: Number(row.id),
    taskId: row.task_id === null ? null : Number(row.task_id),
    agentId: String(row.agent_id),
    agentName: String(row.agent_name),
    sessionId: (row.session_id as string | null) ?? null,
    command: (row.command as string | null) ?? null,
    exitCode: row.exit_code === null ? null : Number(row.exit_code),
    status: String(row.status),
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
    inputTokens: row.input_tokens === null ? null : Number(row.input_tokens),
    outputTokens: row.output_tokens === null ? null : Number(row.output_tokens),
    kind: String(row.kind),
    workdir: String(row.workdir),
    tmuxSession: String(row.tmux_session),
    remoteHost: String(row.remote_host),
    remotePort: Number(row.remote_port),
    remoteKey: String(row.remote_key),
    createdAt: String(row.created_at),
  };
}

/** 数值钳制（NaN/Infinity 按缺省；截断小数）——limit/offset 参数防御单点 */
function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * 会话历史分页查询：分组过滤 + id 倒序 LIMIT/OFFSET；limit 钳 1–100 默认 20、
 * offset 负值按 0、未知分组值按 all（桌面 list_agent_sessions_page_conn 口径）；
 * counts 四档汇总一次全量 count，不随分组/翻页变化。
 */
export function sessionsPage(
  conn: Conn,
  query: { group?: string; limit?: number; offset?: number } = {},
): SessionPageResult {
  const where = GROUP_WHERE[query.group ?? "all"] ?? "";
  const limit = clampInt(query.limit, 20, 1, 100);
  const offset = clampInt(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const total = Number((conn.prepare(`SELECT COUNT(*) AS n FROM agent_sessions${where}`).get() as { n: number }).n);
  const rows = (
    conn
      .prepare(`SELECT ${SESSION_COLS} FROM agent_sessions${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(limit, offset) as SessionSqlRow[]
  ).map(rowToSession);
  const c = conn
    .prepare(
      "SELECT COUNT(*) AS all_count, " +
        "COALESCE(SUM(kind IN ('classify','capture')), 0) AS radio, " +
        "COALESCE(SUM(kind IN ('dispatch_headless','dispatch_interactive')), 0) AS dispatch, " +
        "COALESCE(SUM(kind='pk'), 0) AS other_count FROM agent_sessions",
    )
    .get() as { all_count: number; radio: number; dispatch: number; other_count: number };
  return {
    rows,
    counts: {
      all: Number(c.all_count),
      radio: Number(c.radio),
      dispatch: Number(c.dispatch),
      other: Number(c.other_count),
    },
    total,
  };
}
