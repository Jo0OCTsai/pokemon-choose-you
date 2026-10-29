/**
 * task / note / log 子命令（对齐 bin/pk/task.rs）：建改查、状态生命周期与跟进记录。
 * 数据面全部经 host/domain 原语（契约回放锁定域语义），本层只做 argv 解析与信封组装。
 */
import type { Conn } from "../host/storage/db";
import {
  addTaskNote,
  createTask,
  getCurrentTask,
  getTask,
  listTaskLogs,
  listTasks,
  updateTask,
  type NewTask,
  type TaskPatch,
} from "../host/domain/tasks";
import { listTaskNotes } from "../host/domain/task-notes";
import { deleteTask, pauseCurrentTask, startTask } from "../host/domain/task-lifecycle";
import {
  CliError,
  dbErr,
  flag,
  parseArgs,
  parseLimit,
  positional,
  usageErr,
  validateChoice,
  VALID_PRIORITY,
  VALID_STATUS,
  type Parsed,
} from "./cli";
import { resolveCategory, resolveTagIds, timeValue } from "./tag";

function idOf(p: Parsed): number {
  const raw = positional(p, 0, "任务 id");
  const id = Number(raw);
  if (!Number.isInteger(id)) throw usageErr("任务 id 必须是数字");
  return id;
}

export function runTask(conn: Conn, rest: readonly string[]): unknown {
  const sub = rest[0];
  if (sub === undefined) throw usageErr("缺少 task 子命令，用法见 pk help");
  const p = parseArgs(rest.slice(1));
  switch (sub) {
    case "list": {
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
    case "get": {
      const id = idOf(p);
      return { task: getTask(conn, id), notes: listTaskNotes(conn, id) };
    }
    case "search": {
      const q = positional(p, 0, "搜索关键词");
      const list = searchTasks(conn, q);
      return { query: q, count: list.length, tasks: list };
    }
    case "create": {
      const title = flag(p, "title")?.trim();
      if (title === undefined || title === "") throw usageErr("task create 需要 --title");
      const priorityRaw = flag(p, "priority");
      let priority = "normal";
      if (priorityRaw !== undefined && priorityRaw !== "") {
        validateChoice(priorityRaw, VALID_PRIORITY, "优先级");
        priority = priorityRaw;
      }
      const dueRaw = flag(p, "due");
      const due = dueRaw !== undefined && dueRaw !== "" ? dueRaw : undefined;
      if (due !== undefined) validateDue(due);
      const categoryRaw = flag(p, "category");
      const categoryId =
        categoryRaw !== undefined && categoryRaw !== "" ? resolveCategory(conn, categoryRaw) : undefined;
      const tagsRaw = flag(p, "tags");
      const tagIds = tagsRaw !== undefined && tagsRaw !== "" ? resolveTagIds(conn, tagsRaw) : undefined;
      // 有截止时间即视为排期（scheduled），与收音机建待办的规则一致
      const scheduled = flag(p, "scheduled") !== undefined || due !== undefined;
      // --dry-run：参数全部照常校验（含分类/标签存在性），只回显不落库
      if (flag(p, "dry-run") !== undefined) {
        const tagNames =
          tagsRaw !== undefined && tagsRaw !== ""
            ? tagsRaw
                .split(/[,，]/)
                .map((s) => s.trim())
                .filter((s) => s !== "")
            : [];
        return {
          dryRun: true,
          wouldCreate: {
            title,
            note: nonEmpty(flag(p, "note")) ?? null,
            category: nonEmpty(flag(p, "category")) ?? null,
            priority,
            due: due ?? null,
            remind: nonEmpty(flag(p, "remind")) ?? null,
            tags: tagNames,
            scheduled,
            source: "cli",
          },
        };
      }
      const input: NewTask = {
        title,
        note: nonEmpty(flag(p, "note")) ?? null,
        categoryId,
        priority,
        dueAt: due ?? null,
        remindAt: nonEmpty(flag(p, "remind")) ?? null,
        scheduled,
        source: "cli",
        externalId: null,
        tagIds,
      };
      return { created: createTask(conn, input, "cli") };
    }
    case "update": {
      const id = idOf(p);
      const statusRaw = flag(p, "status");
      let status: string | undefined;
      if (statusRaw !== undefined && statusRaw !== "") {
        validateChoice(statusRaw, VALID_STATUS, "状态");
        status = statusRaw;
      }
      const priorityRaw = flag(p, "priority");
      let priority: string | undefined;
      if (priorityRaw !== undefined && priorityRaw !== "") {
        validateChoice(priorityRaw, VALID_PRIORITY, "优先级");
        priority = priorityRaw;
      }
      const dueRaw = flag(p, "due");
      let due: string | null | undefined;
      if (dueRaw !== undefined) {
        // 传过 --due 即视为要改：空串清空、非空设置
        if (dueRaw !== "") validateDue(dueRaw);
        due = timeValue(dueRaw);
      }
      const remindRaw = flag(p, "remind");
      const remind = remindRaw === undefined ? undefined : timeValue(remindRaw);
      const categoryRaw = flag(p, "category");
      const categoryId =
        categoryRaw !== undefined && categoryRaw !== "" ? resolveCategory(conn, categoryRaw) : undefined;
      const tagsRaw = flag(p, "tags");
      const tagIds = tagsRaw !== undefined ? resolveTagIds(conn, tagsRaw) : undefined;
      // --dry-run：校验照常（含目标待办存在性），只回显将变更的字段
      if (flag(p, "dry-run") !== undefined) {
        if (!taskExists(conn, id)) {
          throw new CliError(`任务 ${id} 不存在（先用 pk task list 查 id）`, 1);
        }
        return {
          dryRun: true,
          wouldUpdate: {
            id,
            title: nonEmpty(flag(p, "title")) ?? null,
            note: flag(p, "note") ?? null,
            category: nonEmpty(flag(p, "category")) ?? null,
            priority: priority ?? null,
            due: due ?? null,
            remind: remind ?? null,
            status: status ?? null,
            tags: nonEmpty(flag(p, "tags")) ?? null,
          },
        };
      }
      const patch: TaskPatch = {
        id,
        title: nonEmpty(flag(p, "title")) ?? undefined,
        note: flag(p, "note"),
        categoryId,
        priority,
        dueAt: due,
        remindAt: remind,
        status,
        tagIds,
      };
      return { updated: updateTask(conn, patch, "cli") };
    }
    case "done": {
      const id = idOf(p);
      return { done: updateTask(conn, { id, status: "done" }, "cli") };
    }
    case "start": {
      const id = idOf(p);
      try {
        return { started: startTask(conn, id, "cli") };
      } catch (e) {
        throw dbErr(e);
      }
    }
    case "pause": {
      try {
        return { paused: pauseCurrentTask(conn, "cli") };
      } catch (e) {
        throw dbErr(e);
      }
    }
    case "current": {
      return { current: getCurrentTask(conn) };
    }
    case "delete": {
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
    default:
      throw usageErr(`未知 task 子命令「${sub}」，用法见 pk help`);
  }
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

function taskExists(conn: Conn, id: number): boolean {
  return conn.prepare("SELECT id FROM tasks WHERE id=?").get(id) !== undefined;
}

/** 截止/提醒时间允许 YYYY-MM-DD 或 YYYY-MM-DDTHH:MM（validate_due 同构） */
function validateDue(v: string): void {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return;
  throw usageErr(`时间「${v}」无效，应为 YYYY-MM-DD 或 YYYY-MM-DDTHH:MM`);
}

function nonEmpty(v: string | undefined): string | undefined {
  return v !== undefined && v !== "" ? v : undefined;
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
