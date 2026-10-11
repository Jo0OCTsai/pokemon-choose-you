/**
 * 任务域核心（六态 inbox/scheduled/active/paused/done/cancelled）：行映射 / 查询 /
 * 草丛不变量 / 创建与字段级更新——行为基准 = src-tauri/src/commands/tasks.rs
 * （FR-X3：冲突以 Rust 为准）。状态机操作（出发/暂停/逃走/放生等）见
 * task-lifecycle.ts；审计见 task-audit.ts。
 */
import { nowRfc3339, type Conn } from "../storage/db";
import { notFound, paramError } from "../storage/errors";
import { logChange, logTaskDiff } from "./task-audit";

/** 任务行（camelCase，与主应用 serde rename_all = "camelCase" 对齐） */
export interface Task {
  id: number;
  title: string;
  note: string | null;
  categoryId: number;
  status: string;
  priority: string;
  dueAt: string | null;
  remindAt: string | null;
  reminded: boolean;
  source: string;
  externalId: string | null;
  createdAt: string;
  completedAt: string | null;
  startedAt: string | null;
  cancelledAt: string | null;
  focusSeconds: number;
  tags: TagRef[];
  dispatchState: string | null;
  dispatchedSession: string | null;
}

export interface TagRef {
  name: string;
  dimension: string;
}

/** 任务列集（与 Rust TASK_COLS 同序；tags 由 attachTags 单独挂） */
const TASK_COLS =
  "id, title, note, category_id, status, priority, due_at, remind_at, reminded, source, " +
  "external_id, created_at, completed_at, started_at, cancelled_at, focus_seconds, " +
  "dispatch_state, dispatched_session";

const SQL_GET_TASK = `SELECT ${TASK_COLS} FROM tasks WHERE id=?`;
const SQL_CURRENT_TASK = `SELECT ${TASK_COLS} FROM tasks WHERE status='active' LIMIT 1`;
const SQL_ATTACH_TAGS =
  "SELECT t.name, d.key FROM task_tags tt " +
  "JOIN tags t ON t.id = tt.tag_id " +
  "JOIN tag_dimensions d ON d.id = t.dimension_id " +
  "WHERE tt.task_id = ? ORDER BY d.sort, t.id";

type TaskRow = Record<string, unknown>;

function rowToTask(row: TaskRow): Task {
  return {
    id: Number(row.id),
    title: String(row.title),
    note: (row.note as string | null) ?? null,
    categoryId: Number(row.category_id),
    status: String(row.status),
    priority: String(row.priority),
    dueAt: (row.due_at as string | null) ?? null,
    remindAt: (row.remind_at as string | null) ?? null,
    reminded: Number(row.reminded) !== 0,
    source: String(row.source),
    externalId: (row.external_id as string | null) ?? null,
    createdAt: String(row.created_at),
    completedAt: (row.completed_at as string | null) ?? null,
    startedAt: (row.started_at as string | null) ?? null,
    cancelledAt: (row.cancelled_at as string | null) ?? null,
    focusSeconds: Number(row.focus_seconds),
    tags: [],
    dispatchState: (row.dispatch_state as string | null) ?? null,
    dispatchedSession: (row.dispatched_session as string | null) ?? null,
  };
}

function attachTags(conn: Conn, tasks: Task[]): void {
  const stmt = conn.prepare(SQL_ATTACH_TAGS);
  for (const task of tasks) {
    const rows = stmt.all(task.id) as Array<{ name: string; key: string }>;
    task.tags = rows.map((r) => ({ name: r.name, dimension: r.key }));
  }
}

// ---- 查询 ----

/** 取单个任务（不存在 → NOT_FOUND，对齐 query_task 的语义位） */
export function getTask(conn: Conn, id: number): Task {
  const row = conn.prepare(SQL_GET_TASK).get(id);
  if (row === undefined) {
    throw notFound(`任务 ${id} 不存在`);
  }
  const task = rowToTask(row);
  attachTags(conn, [task]);
  return task;
}

const LIST_SQL: Record<string, string> = {
  open: `SELECT ${TASK_COLS} FROM tasks WHERE status IN ('inbox','scheduled','active','paused') ORDER BY
                CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'scheduled' THEN 2 ELSE 3 END,
                CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                due_at IS NULL, due_at`,
  done: `SELECT ${TASK_COLS} FROM tasks WHERE status IN ('done','cancelled')
                ORDER BY COALESCE(completed_at, cancelled_at) DESC LIMIT 200`,
  today: `SELECT ${TASK_COLS} FROM tasks WHERE status IN ('inbox','scheduled','active','paused')
             AND (due_at IS NOT NULL AND date(due_at) <= date('now','localtime') OR status IN ('active','paused'))
             ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END`,
};

/** 列表（open/done/today/其余全量——排序与 Rust list_tasks_conn 逐字对齐） */
export function listTasks(conn: Conn, filter: string): Task[] {
  const sql = LIST_SQL[filter] ?? `SELECT ${TASK_COLS} FROM tasks ORDER BY id DESC`;
  const tasks = (conn.prepare(sql).all() as TaskRow[]).map(rowToTask);
  attachTags(conn, tasks);
  return tasks;
}

/** 当前进行中任务（无则 null） */
export function getCurrentTask(conn: Conn): Task | null {
  const row = conn.prepare(SQL_CURRENT_TASK).get();
  if (row === undefined) {
    return null;
  }
  const task = rowToTask(row);
  attachTags(conn, [task]);
  return task;
}

/**
 * 草丛不变量（与 Rust enforce_inbox_invariant 逐字一致）：无截止（NULL 或空串）且
 * 从未开始 → inbox。空串也兜住：历史数据 / 绕过归一化的写入曾把 '' 存进 due_at，
 * IS NULL 单判会漏。任何写路径改完 status/due_at 后调用。
 */
export function enforceInboxInvariant(conn: Conn, id: number): void {
  conn
    .prepare(
      "UPDATE tasks SET status='inbox' " +
        "WHERE id=? AND status='scheduled' AND (due_at IS NULL OR trim(due_at)='') AND started_at IS NULL",
    )
    .run(id);
}

// ---- 创建 / 更新 ----

export interface NewTask {
  title: string;
  note?: string | null;
  categoryId?: number;
  priority?: string;
  dueAt?: string | null;
  remindAt?: string | null;
  /** 直接进入排期而非收件箱 */
  scheduled?: boolean;
  source?: string;
  externalId?: string | null;
  /** 创建时直接挂的标签 id 列表 */
  tagIds?: number[];
}

/** 未指定分类时落到第一个启用分类（分类可停用，id=1 未必可用） */
export function firstEnabledCategoryId(conn: Conn): number {
  const row = conn.prepare("SELECT id FROM categories WHERE enabled=1 ORDER BY id LIMIT 1").get();
  return row === undefined ? 1 : Number(row.id);
}

/** 全量替换某任务的标签关联（与 set_task_tags 一致：先删后插，INSERT OR IGNORE 去重） */
function setTaskTags(conn: Conn, taskId: number, tagIds: number[]): void {
  conn.prepare("DELETE FROM task_tags WHERE task_id=?").run(taskId);
  const stmt = conn.prepare("INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)");
  for (const tagId of tagIds) {
    stmt.run(taskId, tagId);
  }
}

/** NewTask → INSERT 列值（缺省归一，纯函数降复杂度） */
function newTaskValues(task: NewTask, conn: Conn, now: string): Array<string | number | null> {
  return [
    task.title.trim(),
    task.note ?? null,
    task.categoryId ?? firstEnabledCategoryId(conn),
    task.scheduled === true ? "scheduled" : "inbox",
    task.priority ?? "normal",
    task.dueAt ?? null,
    task.remindAt ?? null,
    task.source ?? "local",
    task.externalId ?? null,
    now,
  ];
}

/** 创建任务（对齐 create_task_conn）：标题去空格、落分类、挂标签、保不变量、记日志 */
export function createTask(conn: Conn, task: NewTask, origin = "dsh", now = nowRfc3339()): Task {
  const title = task.title.trim();
  if (title === "") {
    throw paramError("标题不能为空");
  }
  const result = conn
    .prepare(
      "INSERT INTO tasks (title, note, category_id, status, priority, due_at, remind_at, source, external_id, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(...newTaskValues(task, conn, now));
  const id = Number(result.lastInsertRowid);
  if (task.tagIds !== undefined) {
    setTaskTags(conn, id, task.tagIds);
  }
  enforceInboxInvariant(conn, id);
  logChange(conn, id, "create", "title", null, title, origin, now);
  return getTask(conn, id);
}

export interface TaskPatch {
  id: number;
  title?: string;
  note?: string;
  categoryId?: number;
  priority?: string;
  /** 三态：缺失 = 不改，null = 清空，字符串 = 设置 */
  dueAt?: string | null;
  remindAt?: string | null;
  status?: string;
  /** 出现即全量替换标签关联（空数组 = 清空），缺失 = 不改 */
  tagIds?: number[];
}

type PatchValue = string | number | null;

/** patch → SET 子句构建（update_task_conn 的动态拼装段，纯函数降复杂度） */
function buildUpdateSets(patch: TaskPatch, now: string): { sets: string[]; values: PatchValue[] } {
  const sets: string[] = [];
  const values: PatchValue[] = [];
  const push = (column: string, value: PatchValue) => {
    sets.push(`${column}=?${values.length + 1}`);
    values.push(value);
  };
  if (patch.title !== undefined) {
    push("title", patch.title);
  }
  if (patch.note !== undefined) {
    push("note", patch.note);
  }
  if (patch.categoryId !== undefined) {
    push("category_id", patch.categoryId);
  }
  if (patch.priority !== undefined) {
    push("priority", patch.priority);
  }
  if (patch.dueAt !== undefined) {
    push("due_at", patch.dueAt);
  }
  if (patch.remindAt !== undefined) {
    push("remind_at", patch.remindAt);
    push("reminded", 0); // 提醒时间变化后重置提醒标志
  }
  if (patch.status === "done") {
    push("completed_at", now);
  } else if (patch.status === "cancelled") {
    push("cancelled_at", now);
  }
  if (patch.status !== undefined) {
    push("status", patch.status);
  }
  return { sets, values };
}

/** 字段级 patch + 不变量 + diff 日志（对齐 update_task_conn，含提醒时间变化重置提醒标志） */
export function updateTask(conn: Conn, patch: TaskPatch, origin = "dsh", now = nowRfc3339()): Task {
  const before = getTask(conn, patch.id);
  const { sets, values } = buildUpdateSets(patch, now);
  if (sets.length > 0) {
    values.push(patch.id);
    conn.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id=?${values.length}`).run(...values);
  }
  if (patch.tagIds !== undefined) {
    setTaskTags(conn, patch.id, patch.tagIds);
  }
  enforceInboxInvariant(conn, patch.id);
  const after = getTask(conn, patch.id);
  logTaskDiff(conn, before, after, origin, now);
  return after;
}
