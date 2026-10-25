/**
 * 派发五态机（NULL/queued/running/done/failed）：transition_allowed 矩阵 + 原子
 * claim + CAS 迁移（§7.1 条目 8：UPDATE 携带期望前态，affected=0 重读仲裁——目标态
 * 已达成按幂等成功不写审计，第三态按重读值报非法迁移）+ 到期排队。
 * 行为基准 = src-tauri/src/commands/dispatch/state.rs 与 auto.rs（queue_due_tasks）。
 * 机器级并发槽表见 dispatch-slots.ts。
 */
import { nowRfc3339, type Conn } from "../storage/db";
import { notFound, paramError } from "../storage/errors";

export const DS_QUEUED = "queued";
export const DS_RUNNING = "running";
export const DS_DONE = "done";
export const DS_FAILED = "failed";

/** 状态机允许的迁移（state.rs transition_allowed 逐字对齐）：
 * NULL → running（手动派发）/ queued（定时排队）；queued → running / 重置；
 * running → done / failed / 重置；done / failed → running（重派 --resume 续接 / 重试） */
export function transitionAllowed(from: string | null, to: string | null): boolean {
  switch (from) {
    case null:
      return to === DS_RUNNING || to === DS_QUEUED;
    case DS_QUEUED:
      return to === DS_RUNNING || to === null;
    case DS_RUNNING:
      return to === DS_DONE || to === DS_FAILED || to === null;
    case DS_DONE:
    case DS_FAILED:
      return to === DS_RUNNING;
    default:
      return false;
  }
}

/** 原子 claim（state.rs claim_dispatch 同构）：当前状态在允许集合内才置 running */
export function claimDispatch(conn: Conn, taskId: number, opts: { allowNull: boolean; states: string[] }): boolean {
  const cond = opts.states.map((s) => `dispatch_state='${s}'`).slice();
  if (opts.allowNull) {
    cond.push("dispatch_state IS NULL");
  }
  const result = conn
    .prepare(`UPDATE tasks SET dispatch_state='running' WHERE id=? AND (${cond.join(" OR ")})`)
    .run(taskId);
  return Number(result.changes) > 0;
}

// ---- CAS 迁移 ----

const SQL_GET_DISPATCH_STATE = "SELECT dispatch_state FROM tasks WHERE id=?";
const SQL_CAS_DISPATCH = "UPDATE tasks SET dispatch_state=? WHERE id=? AND dispatch_state IS ?";

/**
 * CAS 迁移原语（条目 8，state.rs cas_dispatch_state 同构）：
 * 返回是否发生了迁移。affected=0 时重读仲裁——目标态已达成 → 幂等成功返回 false
 * （transition_or_already 语义泛化，未迁移不写审计）；否则按重读到的实际状态报
 * 非法迁移（重读值入文案）。
 */
export function casDispatchState(conn: Conn, taskId: number, expectedFrom: string | null, to: string | null): boolean {
  const result = conn.prepare(SQL_CAS_DISPATCH).run(to, taskId, expectedFrom);
  if (Number(result.changes) > 0) {
    return true;
  }
  const cur = conn.prepare(SQL_GET_DISPATCH_STATE).get(taskId) as { dispatch_state: string | null } | undefined;
  if (cur === undefined) {
    throw notFound(`待办 No.${taskId} 不存在`);
  }
  if (cur.dispatch_state === to) {
    return false; // 目标态已达成：幂等成功收口（未迁移、不写审计）
  }
  const fromText = cur.dispatch_state ?? "未派发";
  const toText = to ?? "未派发（重置）";
  throw paramError(
    `待办 No.${taskId} 派发状态已并发变为「${fromText}」，不能迁移到「${toText}」；` +
      "先派发领取 running，或在应用抽屉里重置",
  );
}

/** 审计 new_value 组装（state.rs 同款：态：备注 / 重置：备注） */
function auditNewValue(to: string | null, note: string | null): string {
  const trimmed = note?.trim();
  const hasNote = trimmed !== undefined && trimmed !== "";
  if (to !== null) {
    return hasNote ? `${to}：${trimmed}` : to;
  }
  return hasNote ? `重置：${trimmed}` : "重置";
}

/**
 * 按状态机迁移派发状态并写审计（dispatch_transition_conn 同构）。
 * to=null 重置为未派发（救援卡死的 running）；CAS 失配按幂等/第三态仲裁。
 */
export function dispatchTransition(
  conn: Conn,
  taskId: number,
  to: string | null,
  note: string | null,
  origin = "dsh",
  now = nowRfc3339(),
): void {
  const row = conn.prepare(SQL_GET_DISPATCH_STATE).get(taskId);
  if (row === undefined) {
    throw notFound(`待办 No.${taskId} 不存在`);
  }
  const from = (row as { dispatch_state: string | null }).dispatch_state;
  if (!transitionAllowed(from, to)) {
    const fromText = from ?? "未派发";
    const toText = to ?? "未派发（重置）";
    throw paramError(
      `待办 No.${taskId} 派发状态为「${fromText}」，不能迁移到「${toText}」；` +
        "先派发领取 running，或在应用抽屉里重置",
    );
  }
  if (casDispatchState(conn, taskId, from, to)) {
    conn
      .prepare(
        "INSERT INTO task_logs (task_id, action, field, old_value, new_value, origin, created_at) " +
          "VALUES (?,'update','dispatch_state',?,?,?,?)",
      )
      .run(taskId, from ?? "", auditNewValue(to, note), origin, now);
  }
}

/** 迁移到 to，目标态已达成时按成功处理（transition_or_already 同构：回传信号优先幂等收口） */
export function transitionOrAlready(conn: Conn, taskId: number, to: string, origin = "dsh", now = nowRfc3339()): void {
  const row = conn.prepare(SQL_GET_DISPATCH_STATE).get(taskId) as { dispatch_state: string | null } | undefined;
  if (row?.dispatch_state === to) {
    return;
  }
  dispatchTransition(conn, taskId, to, null, origin, now);
}

/**
 * 手动标记重置（state.rs mark_dispatch "idle" 同构）：从任意状态（含卡死 running）
 * 重置为未派发——不走状态机校验（救援语义），审计记 running→NULL（Rust 硬编码同款）。
 */
export function markDispatchIdle(conn: Conn, taskId: number, origin = "dsh", now = nowRfc3339()): void {
  const result = conn.prepare("UPDATE tasks SET dispatch_state=NULL WHERE id=?").run(taskId);
  if (Number(result.changes) === 0) {
    throw notFound(`待办 No.${taskId} 不存在`);
  }
  conn
    .prepare(
      "INSERT INTO task_logs (task_id, action, field, old_value, new_value, origin, created_at) " +
        "VALUES (?,'update','dispatch_state','running',NULL,?,?)",
    )
    .run(taskId, origin, now);
}

// ---- 到期排队（auto.rs queue_due_tasks 同构） ----

/**
 * 解析 RFC3339（带时区）或本地无时区格式（datetime-local）的时间字符串
 * （scheduler.rs parse_time 同语义；JS Date 两种形态都按规范解析，本地串按本机时区）。
 */
export function parseTime(s: string): Date | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 标签 meta（JSON）解析：空/坏数据按无元数据处理（tags.rs parse_tag_meta 同款） */
export function parseTagMeta(
  raw: string | null | undefined,
): { agentId?: string; workdir?: string; context?: string } | null {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed === "") {
    return null;
  }
  try {
    return JSON.parse(trimmed) as { agentId?: string; workdir?: string; context?: string };
  } catch {
    return null;
  }
}

/** agent 可用性判定入参（从 ai_agents 设置解析：存在且启用——auto.rs agent_ok 同语义） */
export type AgentAvailability = (agentId: string) => { enabled: boolean } | undefined;

/** 从 ai_agents 设置解析可用性（存在 + command 非空 + 启用；坏数据按不可用） */
export function settingsAgentAvailable(conn: Conn): AgentAvailability {
  return (agentId: string) => {
    try {
      const raw = conn.prepare("SELECT value FROM settings WHERE key='ai_agents'").get() as
        { value: string } | undefined;
      if (raw === undefined) {
        return undefined;
      }
      const list = JSON.parse(raw.value) as Array<{ id: string; command?: string; enabled?: boolean }>;
      const hit = list.find((a) => a.id === agentId && (a.command ?? "").trim() !== "");
      return hit === undefined ? undefined : { enabled: hit.enabled !== false };
    } catch {
      return undefined;
    }
  };
}

interface QueueRow {
  id: number;
  due_at: string;
  meta: string | null;
}

/** 排队行过滤（SQL 粗筛后的精判：到期 / meta 显式 agent / agent 可用），返回可排队 id */
function filterQueueable(rows: QueueRow[], now: Date, agentAvailable: AgentAvailability): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const due = parseTime(row.due_at);
    if (due === null || due.getTime() > now.getTime()) {
      continue;
    }
    const agentId = parseTagMeta(row.meta)?.agentId?.trim();
    if (agentId === undefined || agentId === "" || agentAvailable(agentId)?.enabled !== true) {
      continue; // 未显式指定 agent / agent 不可用：不自动派发
    }
    out.push(Number(row.id));
  }
  return out;
}

/**
 * 排队到期任务（queue_due_tasks 同构）：到期未开始 + project 标签 meta 显式指定了
 * 可用 agent；只动 dispatch_state IS NULL 的行（done/failed 不自动重派，避免失败
 * 循环）。返回排队条数。agentAvailable 缺省从 ai_agents 设置解析。
 */
export function queueDueTasks(conn: Conn, opts: { now?: Date; agentAvailable?: AgentAvailability } = {}): number {
  const now = opts.now ?? new Date();
  const agentAvailable = opts.agentAvailable ?? settingsAgentAvailable(conn);
  const window = nowRfc3339(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const rows = conn
    .prepare(
      "SELECT t.id, t.due_at, g.meta FROM tasks t " +
        "JOIN task_tags tt ON tt.task_id = t.id " +
        "JOIN tags g ON g.id = tt.tag_id " +
        "JOIN tag_dimensions d ON d.id = g.dimension_id AND d.key='project' " +
        "WHERE t.status IN ('inbox','scheduled') AND t.dispatch_state IS NULL " +
        "AND t.due_at IS NOT NULL AND trim(t.due_at) != '' AND t.due_at <= ?",
    )
    .all(window) as unknown as QueueRow[];
  let queued = 0;
  for (const id of filterQueueable(rows, now, agentAvailable)) {
    queued += Number(
      conn.prepare("UPDATE tasks SET dispatch_state='queued' WHERE id=? AND dispatch_state IS NULL").run(id).changes,
    );
  }
  return queued;
}

/** 待领取的排队任务（到期先后）：(task_id, meta.agentId)——pick_queued 同构 */
export function pickQueued(conn: Conn): Array<{ taskId: number; agentId: string }> {
  const rows = conn
    .prepare(
      "SELECT t.id, g.meta FROM tasks t " +
        "JOIN task_tags tt ON tt.task_id = t.id " +
        "JOIN tags g ON g.id = tt.tag_id " +
        "JOIN tag_dimensions d ON d.id = g.dimension_id AND d.key='project' " +
        "WHERE t.dispatch_state='queued' " +
        "ORDER BY t.due_at IS NULL, t.due_at, t.id LIMIT 10",
    )
    .all() as Array<{ id: number; meta: string | null }>;
  const out: Array<{ taskId: number; agentId: string }> = [];
  for (const row of rows) {
    const agentId = parseTagMeta(row.meta)?.agentId;
    if (agentId !== undefined) {
      out.push({ taskId: Number(row.id), agentId });
    }
  }
  return out;
}
