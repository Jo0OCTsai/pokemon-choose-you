/**
 * 任务状态机操作面（dsh tools / host 命令的 domain 原语）——行为基准 =
 * src-tauri/src/commands/tasks.rs 的 start_task_conn / pause_current_task_conn /
 * delete_task_conn。出发原语 = 单条 BEGIN IMMEDIATE 内「demote 全部 active/paused →
 * 本任务 active」（AD §5.4 语义等价 TS 化）；审计时序照抄 Rust——demote 快照在
 * 事务外读、COMMIT 后补写（fixtures 按实际时序锁定，AD §4.4）。全局唯一进行中由
 * demote 原语在写锁串行化下保证（并发测试：双连接同时出发，终态 active ≤ 1）。
 */
import { nowRfc3339, txImmediate, type Conn } from "../storage/db";
import { notFound, paramError } from "../storage/errors";
import { logChange } from "./task-audit";
import { getCurrentTask, getTask, updateTask, type Task } from "./tasks";

type TaskRow = Record<string, unknown>;

const SQL_DEMOTE_SNAPSHOT = "SELECT id, status FROM tasks WHERE status IN ('active','paused')";
const SQL_DEMOTE_ALL = "UPDATE tasks SET status='scheduled' WHERE status IN ('active','paused')";
const SQL_START_ONE = "UPDATE tasks SET status='active', started_at=COALESCE(started_at, ?) WHERE id=?";

/**
 * 出发（全局唯一进行中 + 顶下 demote）——对齐 start_task_conn：demote 快照在事务外
 * 读、审计在 COMMIT 后补写；本任务置 active 并记首次开始时间。目标不存在时 demote
 * 已提交（Rust 同款行为：n==0 在 commit 后报 NotFound）。
 */
export function startTask(conn: Conn, id: number, origin = "dsh", now = nowRfc3339()): Task {
  // 被顶下的任务也要记状态变更日志，先取快照（事务外读——Rust 时序）
  const demoted = conn.prepare(SQL_DEMOTE_SNAPSHOT).all() as Array<{ id: number; status: string }>;
  const started = txImmediate(conn, () => {
    conn.exec(SQL_DEMOTE_ALL);
    return Number(conn.prepare(SQL_START_ONE).run(now, id).changes);
  });
  if (started === 0) {
    throw notFound(`任务 ${id} 不存在`);
  }
  for (const d of demoted) {
    logChange(conn, Number(d.id), "demote", "status", d.status, "scheduled", origin, now);
  }
  logChange(conn, id, "start", "status", null, "active", origin, now);
  return getTask(conn, id);
}

/** 暂停当前进行中任务（对齐 pause_current_task_conn）；taskId 指定时校验其确为进行中 */
export function pauseCurrentTask(conn: Conn, origin = "dsh", now = nowRfc3339(), taskId?: number): Task | null {
  const activeRow = conn.prepare("SELECT id FROM tasks WHERE status='active'").get() as { id: number } | undefined;
  if (taskId !== undefined && activeRow?.id !== taskId) {
    throw paramError(`待办 No.${taskId} 不在进行中，无法暂停`);
  }
  conn.prepare("UPDATE tasks SET status='paused' WHERE status='active'").run();
  if (activeRow !== undefined) {
    logChange(conn, Number(activeRow.id), "pause", "status", "active", "paused", origin, now);
  }
  const row = conn
    .prepare(
      "SELECT id, title, note, category_id, status, priority, due_at, remind_at, reminded, source, " +
        "external_id, created_at, completed_at, started_at, cancelled_at, focus_seconds, " +
        "dispatch_state, dispatched_session FROM tasks WHERE status='paused' " +
        "ORDER BY focus_seconds DESC LIMIT 1",
    )
    .get();
  if (row === undefined) {
    return null;
  }
  return getTask(conn, Number((row as { id: number }).id));
}

/** 恢复（继续）= 再次出发（全局唯一进行中由 demote 原语保证） */
export function resumeTask(conn: Conn, taskId: number, origin = "dsh", now = nowRfc3339()): Task {
  return startTask(conn, taskId, origin, now);
}

/** 完成（status=done 写 completed_at；缺省目标 = 当前进行中，对齐 host 命令 taskComplete） */
export function completeTask(conn: Conn, taskId?: number, origin = "dsh", now = nowRfc3339()): Task {
  const id = taskId ?? getCurrentTask(conn)?.id;
  if (id === undefined) {
    throw paramError("当前没有进行中的待办");
  }
  return updateTask(conn, { id, status: "done" }, origin, now);
}

/**
 * 撤销完成（撤销分流）：status 回 scheduled，草丛不变量把「无截止且从未出发」的
 * 打回 inbox（有截止或曾出发 → scheduled）。与主应用前端 undone 同构
 * （TaskTab.vue：updateTask({id, status:"scheduled"})；completed_at 不清——Rust 行为）。
 */
export function undoneTask(conn: Conn, id: number, origin = "dsh", now = nowRfc3339()): Task {
  return updateTask(conn, { id, status: "scheduled" }, origin, now);
}

/** 逃走（任意未完成态可逃，cancelled + cancelled_at 留档可恢复） */
export function escapeTask(conn: Conn, id: number, origin = "dsh", now = nowRfc3339()): Task {
  return updateTask(conn, { id, status: "cancelled" }, origin, now);
}

/**
 * 改期（对齐主应用前端 reschedule：dueAt 与 status="scheduled" 同补丁提交）：
 * due 空串/纯空白归 NULL（清空截止），草丛不变量联动 scheduled↔inbox。
 */
export function rescheduleTask(conn: Conn, id: number, due: string, origin = "dsh", now = nowRfc3339()): Task {
  const dueAt = due.trim() === "" ? null : due;
  return updateTask(conn, { id, dueAt, status: "scheduled" }, origin, now);
}

/** 放生（级联删除 + 墓碑审计，对齐 delete_task_conn：task_logs 保留并记录删除时标题） */
export function deleteTask(conn: Conn, id: number, origin = "dsh", now = nowRfc3339()): void {
  const row = conn.prepare("SELECT title FROM tasks WHERE id=?").get(id) as { title: string } | undefined;
  logChange(conn, id, "delete", "title", row?.title ?? null, null, origin, now);
  conn.prepare("DELETE FROM tasks WHERE id=?").run(id);
  conn.prepare("DELETE FROM task_tags WHERE task_id=?").run(id);
  conn.prepare("DELETE FROM task_notes WHERE task_id=?").run(id);
}

// ---- 跟进记录 ----

export interface TaskNote {
  id: number;
  taskId: number;
  content: string;
  source: string;
  createdAt: string;
}

/** 跟进追加（对齐 add_task_note_conn：内容去空格非空、source 归一 manual/ai） */
export function addTaskNote(
  conn: Conn,
  taskId: number,
  content: string,
  source = "manual",
  now = nowRfc3339(),
): TaskNote {
  const trimmed = content.trim();
  if (trimmed === "") {
    throw paramError("跟进内容不能为空");
  }
  if (conn.prepare("SELECT 1 FROM tasks WHERE id=?").get(taskId) === undefined) {
    throw notFound(`任务 ${taskId} 不存在`);
  }
  const result = conn
    .prepare("INSERT INTO task_notes (task_id, content, source, created_at) VALUES (?, ?, ?, ?)")
    .run(taskId, trimmed, source === "ai" ? "ai" : "manual", now);
  const row = conn
    .prepare("SELECT id, task_id, content, source, created_at FROM task_notes WHERE id=?")
    .get(result.lastInsertRowid) as TaskRow;
  return {
    id: Number(row.id),
    taskId: Number(row.task_id),
    content: String(row.content),
    source: String(row.source),
    createdAt: String(row.created_at),
  };
}

/** 单任务跟进列表（按 id 正序） */
export function listTaskNotes(conn: Conn, taskId: number): TaskNote[] {
  return (
    conn
      .prepare("SELECT id, task_id, content, source, created_at FROM task_notes WHERE task_id=? ORDER BY id")
      .all(taskId) as TaskRow[]
  ).map((row) => ({
    id: Number(row.id),
    taskId: Number(row.task_id),
    content: String(row.content),
    source: String(row.source),
    createdAt: String(row.created_at),
  }));
}
