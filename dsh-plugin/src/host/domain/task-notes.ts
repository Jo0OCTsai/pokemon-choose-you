/**
 * 跟进记录与操作日志（从 tasks.ts 拆出以控文件规模——复杂度棘轮；行为基准 =
 * src-tauri/src/commands/tasks.rs 的 add_task_note_conn / delete_task_note /
 * list_task_logs_conn）。任务域核心见 tasks.ts（本文件公共面由其再出口，消费面不变）。
 */
import { nowRfc3339, type Conn } from "../storage/db";
import { paramError } from "../storage/errors";
import { getTask } from "./tasks";

/** 跟进记录行（task_notes 投影；与 PanelFollowup 同形） */
export interface TaskNote {
  id: number;
  taskId: number;
  content: string;
  source: string;
  createdAt: string;
}

/** 手动添加跟进（Rust 口径：去空格拒空文、任务须存在；source 缺省 manual，pk note add --source ai 走参数） */
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
  getTask(conn, taskId); // 不存在 → NOT_FOUND
  const r = conn
    .prepare("INSERT INTO task_notes (task_id, content, source, created_at) VALUES (?, ?, ?, ?)")
    .run(taskId, trimmed, source, now);
  return { id: Number(r.lastInsertRowid), taskId, content: trimmed, source, createdAt: now };
}

/** 删除跟进记录（按 id；幂等——不存在不报错，对齐 delete_task_note） */
export function deleteTaskNote(conn: Conn, id: number): void {
  conn.prepare("DELETE FROM task_notes WHERE id=?").run(id);
}

/** 跟进记录列表（list_task_notes_conn 同构：按 id 正序；pk note list 复用） */
export function listTaskNotes(conn: Conn, taskId: number): TaskNote[] {
  return (
    conn
      .prepare("SELECT id, task_id, content, source, created_at FROM task_notes WHERE task_id=? ORDER BY id")
      .all(taskId) as Array<Record<string, unknown>>
  ).map((n): TaskNote => ({
    id: Number(n.id),
    taskId: Number(n.task_id),
    content: String(n.content),
    source: String(n.source),
    createdAt: String(n.created_at),
  }));
}

/** 操作日志行（task_logs 投影，字段名与 Rust TaskLog serde camelCase 对齐） */
export interface TaskLog {
  id: number;
  taskId: number;
  action: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  origin: string;
  createdAt: string;
}

/** 操作日志查询（Rust 口径：倒序最新 200 条封顶） */
export function listTaskLogs(conn: Conn, taskId: number): TaskLog[] {
  return (
    conn
      .prepare(
        "SELECT id, task_id, action, field, old_value, new_value, origin, created_at " +
          "FROM task_logs WHERE task_id=? ORDER BY id DESC LIMIT 200",
      )
      .all(taskId) as Array<Record<string, unknown>>
  ).map((l): TaskLog => ({
    id: Number(l.id),
    taskId: Number(l.task_id),
    action: String(l.action),
    field: String(l.field ?? ""),
    oldValue: (l.old_value as string | null) ?? null,
    newValue: (l.new_value as string | null) ?? null,
    origin: String(l.origin),
    createdAt: String(l.created_at),
  }));
}
