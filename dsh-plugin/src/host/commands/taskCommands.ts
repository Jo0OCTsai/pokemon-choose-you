/**
 * host 命令 · 任务域（AD §4.1.1 任务行 + 通用 dbStatus 撤销面）：taskStart / Pause /
 * Resume / Complete / Cancel / Delete / DeleteUndo / Reschedule / Update（全字段编辑）/
 * NoteAdd / NoteDelete（跟进记录）/ History（操作日志）。撤销 = 进程内快照
 * 单槽（UI 5 秒窗口期语义；跨进程撤销不支持——放生墓碑审计只留标题）。
 */
import { paramError } from "../storage/errors";
import {
  completeTask,
  deleteTask,
  escapeTask,
  pauseCurrentTask,
  rescheduleTask,
  resumeTask,
  startTask,
} from "../domain/task-lifecycle";
import {
  addTaskNote,
  deleteTaskNote,
  getCurrentTask,
  getTask,
  listTaskLogs,
  updateTask,
  type TaskPatch,
} from "../domain/tasks";
import { validEscapeReason } from "../domain/suggest-types";
import { celebrateSolemn, caughtVariantOf, dexDoneCount, openTaskCount } from "../pet/solemn";
import type { CommandFn, CommandTable, DeleteUndoSnapshot } from "./context";

const ORIGIN = "dsh";

/** 放生快照行（SQL 列原样；还原时按列序回插） */
type TaskRow = Record<string, string | number | null>;

/** 最近一次放生的恢复快照（taskDeleteUndo 消费；新放生覆盖旧槽） */
let undoSlot: { taskId: number; snapshot: DeleteUndoSnapshot } | null = null;

/** 放生 + 快照（taskDelete 命令实现） */
const taskDelete: CommandFn<{ taskId: number }> = (p, deps) => {
  const conn = deps.conn;
  const tagIds = (
    conn.prepare("SELECT tag_id FROM task_tags WHERE task_id=?").all(p.taskId) as Array<{ tag_id: number }>
  ).map((r) => Number(r.tag_id));
  const notes = conn
    .prepare("SELECT content, source, created_at FROM task_notes WHERE task_id=? ORDER BY id")
    .all(p.taskId) as Array<{ content: string; source: string; created_at: string }>;
  const row = conn
    .prepare(
      "SELECT title, note, category_id, status, priority, due_at, remind_at, reminded, source, external_id, " +
        "created_at, completed_at, started_at, cancelled_at, focus_seconds, dispatch_state, dispatched_session " +
        "FROM tasks WHERE id=?",
    )
    .get(p.taskId) as TaskRow;
  deleteTask(conn, p.taskId, ORIGIN);
  undoSlot = { taskId: p.taskId, snapshot: { task: row, tagIds, notes } };
  deps.onWrites();
  return { taskId: p.taskId };
};

/** 放生撤销：按快照原 id 还原任务与级联数据（窗口外/无最近放生 → 参数错） */
const taskDeleteUndo: CommandFn<{ taskId: number }> = (p, deps) => {
  const slot = undoSlot;
  if (slot === null || slot.taskId !== p.taskId) {
    throw paramError(`待办 No.${p.taskId} 不在放生撤销窗口内（仅最近一次放生可撤销）`);
  }
  undoSlot = null;
  const conn = deps.conn;
  const t = slot.snapshot.task;
  conn
    .prepare(
      "INSERT INTO tasks (id, title, note, category_id, status, priority, due_at, remind_at, reminded, source, " +
        "external_id, created_at, completed_at, started_at, cancelled_at, focus_seconds, dispatch_state, dispatched_session) " +
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      p.taskId,
      t["title"] as string,
      t["note"],
      t["category_id"] as number,
      t["status"] as string,
      t["priority"] as string,
      t["due_at"],
      t["remind_at"],
      t["reminded"] as number,
      t["source"] as string,
      t["external_id"],
      t["created_at"] as string,
      t["completed_at"],
      t["started_at"],
      t["cancelled_at"],
      t["focus_seconds"] as number,
      t["dispatch_state"],
      t["dispatched_session"],
    );
  const tagStmt = conn.prepare("INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)");
  for (const tagId of slot.snapshot.tagIds) {
    tagStmt.run(p.taskId, tagId);
  }
  const noteStmt = conn.prepare("INSERT INTO task_notes (task_id, content, source, created_at) VALUES (?, ?, ?, ?)");
  for (const n of slot.snapshot.notes) {
    noteStmt.run(p.taskId, n.content, n.source, n.created_at);
  }
  deps.onWrites();
  return getTask(conn, p.taskId);
};

/** taskComplete 命令实现（郑重时刻接线独立成 const——控表函数行数棘轮） */
const taskComplete: CommandFn<{ taskId?: number }> = (p, deps) => {
  // 郑重时刻（A30 · 2.7 接线）：完成动作发生在本形态 → 前后图鉴计数喂 milestone 判定；
  // 判定命中 → task-state.caught 变体直推（A1——helper CatchShow 消费）；出声由
  // celebrateSolemn 内部门控（pet_voice 默认静音 / helper 缺席不发）。
  // allDone（收工清空）随变体同行——直推先于 onWrites（后到的 plain 快照 prev 已空为 no-op）
  const before = dexDoneCount(deps.conn);
  const task = completeTask(deps.conn, p.taskId ?? getCurrentTask(deps.conn)?.id, ORIGIN);
  const solemn = celebrateSolemn(deps.conn, () => deps.petBridge?.() ?? null, {
    before,
    after: dexDoneCount(deps.conn),
  });
  const allDone = openTaskCount(deps.conn) === 0;
  if (solemn !== null || allDone) {
    deps.announceCaught?.({
      ...(solemn === null ? {} : caughtVariantOf(solemn)),
      ...(allDone ? { allDone: true } : {}),
    });
  }
  deps.onWrites();
  return task;
};

/** 最近暂停的一只（taskResume 缺省目标；无暂停任务报参数错） */
function mostRecentPaused(conn: import("../storage/db").Conn): number {
  const row = conn.prepare("SELECT id FROM tasks WHERE status='paused' ORDER BY focus_seconds DESC LIMIT 1").get() as
    { id: number } | undefined;
  if (row === undefined) {
    throw paramError("没有暂停中的待办可继续");
  }
  return Number(row.id);
}

/** 任务生命周期段（start/pause/resume/complete/cancel/delete/undo/reschedule） */
function taskLifecycleSet(): CommandTable {
  return {
    taskStart: (p, deps) => startTask(deps.conn, (p as { taskId: number }).taskId, ORIGIN),
    taskPause: (p, deps) => pauseCurrentTask(deps.conn, ORIGIN, undefined, (p as { taskId?: number }).taskId),
    taskResume: (p, deps) => {
      const id = (p as { taskId?: number }).taskId ?? mostRecentPaused(deps.conn);
      return resumeTask(deps.conn, id, ORIGIN);
    },
    taskComplete,
    taskCancel: (p, deps) => {
      const args = p as { taskId: number; reasonCode: string };
      validEscapeReason(args.reasonCode);
      return escapeTask(deps.conn, args.taskId, ORIGIN);
    },
    taskDelete,
    taskDeleteUndo,
    taskReschedule: (p, deps) => {
      const args = p as { taskId: number; due?: string };
      const task = rescheduleTask(deps.conn, args.taskId, args.due ?? "", ORIGIN);
      deps.onWrites();
      return task;
    },
  };
}

/** 任务编辑/跟进/历史段 */
function taskEditSet(): CommandTable {
  return {
    // 全字段编辑（桌面 TaskEditModal 同位：updateTask 域内含 diff 审计）
    taskUpdate: (p, deps) => {
      const task = updateTask(deps.conn, p as TaskPatch, ORIGIN);
      deps.onWrites();
      return task;
    },
    taskNoteAdd: (p, deps) => {
      const args = p as { taskId: number; content: string };
      const note = addTaskNote(deps.conn, args.taskId, args.content);
      deps.onWrites();
      return note;
    },
    taskNoteDelete: (p, deps) => {
      deleteTaskNote(deps.conn, (p as { id: number }).id);
      deps.onWrites();
      return { ok: true };
    },
    taskHistory: (p, deps) => ({ logs: listTaskLogs(deps.conn, (p as { taskId: number }).taskId) }),
  };
}

/** 任务域命令表（12 条；taskCreate 已移除——面板手动新建下线，FR-C1 回流） */
export function taskCommands(): CommandTable {
  return { ...taskLifecycleSet(), ...taskEditSet() };
}
