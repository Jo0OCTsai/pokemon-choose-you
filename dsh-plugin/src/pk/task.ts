/**
 * task / note / log 子命令（对齐 bin/pk/task.rs）：查列表/详情/搜索与状态生命周期、
 * 跟进记录。建/改在 task-write.ts（拆件控复杂度）。数据面全部经 host/domain 原语
 * （契约回放锁定域语义），本层只做 argv 解析与信封组装。
 */
import type { Conn } from "../host/storage/db";
import { addTaskNote, getCurrentTask, getTask, listTaskLogs, listTasks } from "../host/domain/tasks";
import { listTaskNotes } from "../host/domain/task-notes";
import { deleteTask, pauseCurrentTask, startTask } from "../host/domain/task-lifecycle";
import { updateTask } from "../host/domain/tasks";
import { CliError, dbErr, flag, parseArgs, parseLimit, positional, usageErr, type Parsed } from "./cli";
import { runTaskCreate, runTaskUpdate, taskExists } from "./task-write";

function idOf(p: Parsed): number {
  const raw = positional(p, 0, "任务 id");
  const id = Number(raw);
  if (!Number.isInteger(id)) throw usageErr("任务 id 必须是数字");
  return id;
}

const TASK_SUBCOMMANDS: Record<string, (conn: Conn, p: Parsed) => unknown> = {
  list: runTaskList,
  get: (c, p) => ({ task: getTask(c, idOf(p)), notes: listTaskNotes(c, idOf(p)) }),
  search: (c, p) => {
    const q = positional(p, 0, "搜索关键词");
    const list = searchTasks(c, q);
    return { query: q, count: list.length, tasks: list };
  },
  create: runTaskCreate,
  update: (c, p) => runTaskUpdate(c, p, idOf(p)),
  done: (c, p) => ({ done: updateTask(c, { id: idOf(p), status: "done" }, "cli") }),
  start: (c, p) => runTaskLifecycle(c, "start", p),
  pause: (c) => runTaskLifecycle(c, "pause"),
  current: (c) => ({ current: getCurrentTask(c) }),
  delete: runTaskDelete,
};

export function runTask(conn: Conn, rest: readonly string[]): unknown {
  const sub = rest[0];
  if (sub === undefined) throw usageErr("缺少 task 子命令，用法见 pk help");
  const handler = TASK_SUBCOMMANDS[sub];
  if (handler === undefined) {
    throw usageErr(`未知 task 子命令「${sub}」，用法见 pk help`);
  }
  return handler(conn, parseArgs(rest.slice(1)));
}

function runTaskList(conn: Conn, p: Parsed): unknown {
  const filter = p.positionals[0] ?? "open";
  const all = listTasks(conn, filter);
  // 默认截断到 50 条：防大库全量 JSON 刷爆 agent 上下文
  const total = all.length;
  const limit = parseLimit(p);
  const truncated = limit !== undefined && total > limit;
  const list = truncated ? all.slice(0, limit) : all;
  return {
    filter,
    count: list.length,
    total,
    truncated,
    hint: truncated ? "结果已截断：用 task search <关键词> 收窄，或 --limit all 看全量" : null,
    tasks: list,
  };
}

function runTaskLifecycle(conn: Conn, sub: string, p?: Parsed): unknown {
  try {
    if (sub === "start") {
      return { started: startTask(conn, idOf(p!), "cli") };
    }
    return { paused: pauseCurrentTask(conn, "cli") };
  } catch (e) {
    throw dbErr(e);
  }
}

function runTaskDelete(conn: Conn, p: Parsed): unknown {
  const id = idOf(p);
  if (flag(p, "dry-run") !== undefined) {
    if (!taskExists(conn, id)) {
      throw new CliError(`任务 ${id} 不存在（先用 pk task list 查 id）`, 1);
    }
    return { dryRun: true, wouldDelete: id };
  }
  try {
    deleteTask(conn, id, "cli");
  } catch (e) {
    throw dbErr(e);
  }
  return { deleted: id };
}

export function runNote(conn: Conn, rest: readonly string[]): unknown {
  const sub = rest[0];
  if (sub === undefined) throw usageErr("缺少 note 子命令（add / list）");
  const p = parseArgs(rest.slice(1));
  if (sub === "add") {
    const id = idOf(p);
    const content = p.positionals.slice(1).join(" ");
    const source = flag(p, "source") === "ai" ? "ai" : "manual";
    try {
      return { added: addTaskNote(conn, id, content, source) };
    } catch (e) {
      throw dbErr(e);
    }
  }
  if (sub === "list") {
    const id = idOf(p);
    return { notes: listTaskNotes(conn, id) };
  }
  throw usageErr(`未知 note 子命令「${sub}」`);
}

export function runLog(conn: Conn, rest: readonly string[]): unknown {
  const p = parseArgs(rest);
  const id = idOf(p);
  return { logs: listTaskLogs(conn, id) };
}

/** suggest 校验共用：待办存在性（ensure_task 同构） */
export function ensureTask(conn: Conn, id: number, at: string): void {
  if (!taskExists(conn, id)) {
    throw new CliError(`${at}:待办 No.${id} 不存在（id 须来自 pk context 的 openTasks）`, 1);
  }
}

/** 任务搜索（search_tasks_conn 同构：标题/备注/跟进/标签，LIKE 转义 + 倒序 100 封顶） */
function searchTasks(conn: Conn, q: string): unknown[] {
  const query = q.trim();
  if (query === "") return [];
  const like = `%${query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  return (
    conn
      .prepare(
        "SELECT id FROM tasks " +
          "WHERE title LIKE ?1 ESCAPE '\\' OR note LIKE ?1 ESCAPE '\\' " +
          "OR id IN (SELECT tt.task_id FROM task_tags tt JOIN tags t ON t.id = tt.tag_id WHERE t.name LIKE ?1 ESCAPE '\\') " +
          "OR id IN (SELECT task_id FROM task_notes WHERE content LIKE ?1 ESCAPE '\\') " +
          "ORDER BY id DESC LIMIT 100",
      )
      .all(like) as Array<{ id: number }>
  ).map((row) => getTask(conn, Number(row.id)));
}
