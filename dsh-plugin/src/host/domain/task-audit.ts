/**
 * 任务审计（task_logs）——与 src-tauri/src/commands/tasks.rs 的 log_change /
 * log_task_diff 同构：所有状态与属性变更的字段级 diff 审计（origin 区分形态，
 * dsh 侧默认 origin='dsh'，可带会话后缀 `dsh:<sessionId>`）。
 */
import { nowRfc3339, type Conn } from "../storage/db";
import type { Task, TagRef } from "./tasks";

/**
 * 写一条审计日志；field 无关的动作（create/delete 等）传空串。now 缺省时本条
 * 独立取时（Rust log_change 每行 db::now()，FR-X3 按夹具对齐——多行审计各占一个
 * 时间戳位）；显式传入时用传入值（测试确定性注入）。
 */
export function logChange(
  conn: Conn,
  taskId: number,
  action: string,
  field: string,
  oldValue: string | null,
  newValue: string | null,
  origin: string,
  now: string = nowRfc3339(),
): void {
  conn
    .prepare(
      "INSERT INTO task_logs (task_id, action, field, old_value, new_value, origin, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(taskId, action, field, oldValue, newValue, origin, now);
}

function tagRefsEqual(a: TagRef[], b: TagRef[]): boolean {
  return a.length === b.length && a.every((t, i) => t.name === b[i].name && t.dimension === b[i].dimension);
}

/**
 * 任务前后快照的字段级 diff（无变化不记）——字段名与 Rust log_task_diff 逐字一致。
 * now 缺省时每行独立取时（Rust 每行 log_change 独立 db::now()——多字段变更的审计
 * 各占一个时间戳位，FR-X3 按夹具对齐）。
 */
export function logTaskDiff(conn: Conn, before: Task, after: Task, origin: string, now?: string): void {
  const stamp = (): string => now ?? nowRfc3339();
  const pairs: Array<[string, string, string]> = [
    ["title", before.title, after.title],
    ["note", before.note ?? "", after.note ?? ""],
    ["category_id", String(before.categoryId), String(after.categoryId)],
    ["priority", before.priority, after.priority],
    ["due_at", before.dueAt ?? "", after.dueAt ?? ""],
    ["remind_at", before.remindAt ?? "", after.remindAt ?? ""],
    ["status", before.status, after.status],
  ];
  for (const [field, oldV, newV] of pairs) {
    if (oldV !== newV) {
      logChange(conn, after.id, "update", field, oldV, newV, origin, stamp());
    }
  }
  if (!tagRefsEqual(before.tags, after.tags)) {
    const names = (tags: TagRef[]) => tags.map((t) => t.name).join(",");
    logChange(conn, after.id, "update", "tags", names(before.tags), names(after.tags), origin, stamp());
  }
}
