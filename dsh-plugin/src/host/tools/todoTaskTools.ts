/**
 * todo_* 工具面 · 任务域（AD §4.1 表前半）：context / list / get / search / create /
 * update / done / undone / start / pause / current / delete / escape / note_add——
 * 行为基准 = src-tauri/src/bin/pk 的 context.rs / task.rs（FR-T2 等价），handler 薄转发
 * domain 原语；写操作审计 origin 由 ToolContext 注入（默认 dsh:tools）。
 */
import { paramError } from "../storage/errors";
import {
  addTaskNote,
  completeTask,
  deleteTask,
  escapeTask,
  pauseCurrentTask,
  startTask,
  undoneTask,
} from "../domain/task-lifecycle";
import { createTask, getCurrentTask, getTask, listTasks, updateTask, type Task, type TaskPatch } from "../domain/tasks";
import { restore } from "../domain/anonymize";
import type { ToolContext, ToolDef } from "./registry";
import { buildToolContextData, categoryIdByName, tagIdsByNames } from "./contextData";

/** 当前进行中的待办上限口径（截断由 limit 控制；默认 50） */
const DEFAULT_LIST_LIMIT = 50;

function originOf(ctx: ToolContext): string {
  return ctx.origin ?? "dsh:tools";
}

const withTask = (t: Task): Record<string, unknown> => ({ task: t });

interface CreateArgs {
  title: string;
  category?: string;
  due?: string;
  priority?: string;
  tags?: string[];
  note?: string;
  dryRun?: boolean;
}

/** 建待办（pk task create 同构：有截止即 scheduled；dryRun 全参照常校验只回显不落库） */
function toolTaskCreate(args: CreateArgs, ctx: ToolContext): Record<string, unknown> {
  const title = args.title.trim();
  if (title === "") {
    throw paramError("标题不能为空");
  }
  const categoryId = args.category === undefined ? undefined : categoryIdByName(ctx.conn, args.category);
  const tagIds = args.tags === undefined ? undefined : tagIdsByNames(ctx.conn, args.tags);
  if (args.dryRun === true) {
    return { dryRun: true, wouldCreate: { ...args, title, tagNames: args.tags ?? [] } };
  }
  return {
    task: createTask(
      ctx.conn,
      {
        title,
        categoryId,
        dueAt: args.due,
        priority: args.priority,
        note: args.note,
        tagIds,
        scheduled: args.due !== undefined && args.due !== "",
      },
      originOf(ctx),
    ),
  };
}

interface UpdateArgs {
  id: number;
  title?: string;
  note?: string;
  due?: string;
  priority?: string;
  category?: string;
  tags?: string[];
}

/** 改待办（due:"" 清空；category/tags 按词表解析；未提供字段不动） */
function toolTaskUpdate(args: UpdateArgs, ctx: ToolContext): Record<string, unknown> {
  const patch: TaskPatch = { id: args.id };
  if (args.title !== undefined) {
    patch.title = args.title;
  }
  if (args.note !== undefined) {
    patch.note = args.note;
  }
  if (args.due !== undefined) {
    patch.dueAt = args.due === "" ? null : args.due;
  }
  if (args.priority !== undefined) {
    patch.priority = args.priority;
  }
  if (args.category !== undefined) {
    patch.categoryId = categoryIdByName(ctx.conn, args.category);
  }
  if (args.tags !== undefined) {
    patch.tagIds = tagIdsByNames(ctx.conn, args.tags);
  }
  return { task: updateTask(ctx.conn, patch, originOf(ctx)) };
}

/** 查询段（context / list / get / search） */
function queryToolDefs(): ToolDef[] {
  return [
    {
      name: "todo_context",
      summary: "判定上下文：当前时间、进行中待办、分类/标签/维度词表、标签负反馈（假名化口径）",
      params: [],
      handler: (_args, ctx) => buildToolContextData(ctx.conn),
    },
    {
      name: "todo_task_list",
      summary: "待办列表（scope=open|done|today|all；limit 截断）",
      params: ["scope", "limit"],
      handler: (args: { scope?: string; limit?: number }, ctx) => {
        const limit = args.limit ?? DEFAULT_LIST_LIMIT;
        const all = listTasks(ctx.conn, args.scope ?? "open");
        return { tasks: all.slice(0, limit), truncated: all.length > limit };
      },
    },
    {
      name: "todo_task_get",
      summary: "待办详情（含跟进/标签/派发状态/agent 会话时间线）",
      params: ["id"],
      handler: taskGetHandler,
    },
    {
      name: "todo_task_search",
      summary: "待办搜索（标题/备注/跟进/标签名）",
      params: ["query"],
      handler: taskSearchHandler,
    },
  ];
}

/** todo_task_get 的 handler（详情组装：任务 + 跟进 + 会话时间线摘要） */
function taskGetHandler(args: { id: number }, ctx: ToolContext): Record<string, unknown> {
  const task = getTask(ctx.conn, args.id);
  const notes = (
    ctx.conn
      .prepare("SELECT id, content, source, created_at FROM task_notes WHERE task_id=? ORDER BY id")
      .all(args.id) as Array<{
      id: number;
      content: string;
      source: string;
      created_at: string;
    }>
  ).map((n) => ({ id: n.id, content: n.content, source: n.source, createdAt: n.created_at }));
  return { ...task, notes, agentSessions: sessionTimeline(ctx, args.id) };
}

/** agent 会话时间线摘要（最近 20 条） */
function sessionTimeline(ctx: ToolContext, taskId: number): Array<Record<string, unknown>> {
  return (
    ctx.conn
      .prepare(
        "SELECT id, agent_id, session_id, kind, status, duration_ms, exit_code, created_at " +
          "FROM agent_sessions WHERE task_id=? ORDER BY id DESC LIMIT 20",
      )
      .all(taskId) as Array<Record<string, unknown>>
  ).map((s) => ({
    id: Number(s.id),
    agentId: String(s.agent_id),
    sessionId: (s.session_id as string | null) ?? null,
    kind: String(s.kind),
    status: String(s.status),
    durationMs: s.duration_ms === null ? null : Number(s.duration_ms),
    exitCode: s.exit_code === null ? null : Number(s.exit_code),
    createdAt: String(s.created_at),
  }));
}

/** todo_task_search 的 handler（标题/备注/跟进/标签名 LIKE） */
function taskSearchHandler(args: { query: string }, ctx: ToolContext): Record<string, unknown> {
  const like = `%${args.query}%`;
  const rows = ctx.conn
    .prepare(
      "SELECT DISTINCT t.id FROM tasks t " +
        "LEFT JOIN task_notes n ON n.task_id = t.id " +
        "LEFT JOIN task_tags tt ON tt.task_id = t.id " +
        "LEFT JOIN tags g ON g.id = tt.tag_id " +
        "WHERE t.title LIKE ? OR t.note LIKE ? OR n.content LIKE ? OR g.name LIKE ? ORDER BY t.id",
    )
    .all(like, like, like, like) as Array<{ id: number }>;
  return { tasks: rows.map((r) => getTask(ctx.conn, Number(r.id))) };
}

/** 建改段（create / update） */
function createUpdateToolDefs(): ToolDef[] {
  return [
    {
      name: "todo_task_create",
      summary: "建待办（有截止→scheduled，无→inbox；分类标签须来自词表）",
      params: ["title", "category", "due", "priority", "tags", "note", "dryRun"],
      handler: toolTaskCreate,
    },
    {
      name: "todo_task_update",
      summary: "改待办（due 空串清空；未提供字段不动）",
      params: ["id", "title", "note", "due", "priority", "category", "tags"],
      handler: toolTaskUpdate,
    },
  ];
}

/** 状态机与跟进段 */
function lifecycleToolDefs(): ToolDef[] {
  return [
    {
      name: "todo_task_done",
      summary: "完成待办",
      params: ["id"],
      handler: (a: { id: number }, ctx) => withTask(completeTask(ctx.conn, a.id, originOf(ctx))),
    },
    {
      name: "todo_task_undone",
      summary: "撤销完成（按分流规则落位）",
      params: ["id"],
      handler: (a: { id: number }, ctx) => withTask(undoneTask(ctx.conn, a.id, originOf(ctx))),
    },
    {
      name: "todo_task_start",
      summary: "出发待办（全局唯一进行中 + 顶下 demote）",
      params: ["id"],
      handler: (a: { id?: number }, ctx) => {
        if (a.id === undefined) {
          throw paramError("todo_task_start 需要 id");
        }
        return withTask(startTask(ctx.conn, a.id, originOf(ctx)));
      },
    },
    {
      name: "todo_task_pause",
      summary: "暂停（缺省 id = 当前进行中）",
      params: ["id"],
      handler: (a: { id?: number }, ctx) => ({ task: pauseCurrentTask(ctx.conn, originOf(ctx), undefined, a.id) }),
    },
  ];
}

/** 当前/放生/逃走/跟进段 */
function taskOpsToolDefs(): ToolDef[] {
  return [
    {
      name: "todo_task_current",
      summary: "当前进行中的待办（无则 null）",
      params: [],
      handler: (_a, ctx) => ({ task: getCurrentTask(ctx.conn) }),
    },
    {
      name: "todo_task_delete",
      summary: "放生：级联删标签关联+跟进，审计留墓碑",
      params: ["id"],
      handler: (a: { id: number }, ctx) => (deleteTask(ctx.conn, a.id, originOf(ctx)), { taskId: a.id }),
    },
    {
      name: "todo_task_escape",
      summary: "逃走（任何未完成态可逃，留档可恢复）",
      params: ["id"],
      handler: (a: { id: number }, ctx) => withTask(escapeTask(ctx.conn, a.id, originOf(ctx))),
    },
    {
      name: "todo_note_add",
      summary: "跟进记录追加（内容真名还原后落库）",
      params: ["taskId", "content", "source"],
      handler: (a: { taskId: number; content: string; source?: string }, ctx) => ({
        note: addTaskNote(ctx.conn, a.taskId, restore(ctx.conn, a.content), a.source, undefined),
      }),
    },
  ];
}

/** 任务域工具清单（AD §4.1 表逐行；响应 camelCase） */
export function taskToolDefs(): ToolDef[] {
  return [...queryToolDefs(), ...createUpdateToolDefs(), ...lifecycleToolDefs(), ...taskOpsToolDefs()];
}
