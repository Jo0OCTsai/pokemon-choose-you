/**
 * todo_* 工具 happy-path 用例表（tools-registry.spec 消费；从 spec 拆出以控
 * 复杂度棘轮口径——每个 builder ≤50 行）。断言 = domain 原语效果落库。
 */
import { expect } from "vitest";
import type { Conn } from "../src/host/storage/db";
import { seedMessage, seedTag } from "./helpers";

export interface ToolCase {
  tool: string;
  args: Record<string, unknown>;
  /** 前置种子（返回传给 check 的辅助 id） */
  prepare?: (conn: Conn) => number;
  /** 断言（result = ok 信封 data） */
  check: (result: unknown, ids: { seeded: number }) => void;
}

/** 直插任务行（便捷种子） */
function seedRow(
  conn: Conn,
  id: number,
  title: string,
  opts: { status?: string; dispatch?: string; started?: string; completed?: string } = {},
): number {
  conn
    .prepare(
      "INSERT INTO tasks (id, title, status, dispatch_state, started_at, completed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, '2026-01-01T00:00:00+00:00')",
    )
    .run(id, title, opts.status ?? "inbox", opts.dispatch ?? null, opts.started ?? null, opts.completed ?? null);
  return id;
}

/** 查询段（context/list/get/search） */
function queryCases(): ToolCase[] {
  return [
    {
      tool: "todo_context",
      args: {},
      check: (r) => {
        const data = r as { categories: unknown[]; dimensions: unknown[]; now: string };
        expect(data.categories.length).toBeGreaterThanOrEqual(5);
        expect(data.dimensions.length).toBe(4);
        expect(data.now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      },
    },
    {
      tool: "todo_task_list",
      args: { scope: "open" },
      check: (r) => expect((r as { tasks: unknown[] }).tasks).toHaveLength(0),
    },
    {
      tool: "todo_task_get",
      args: { id: 1 },
      prepare: (c) => seedRow(c, 1, "查这条"),
      check: (r) => {
        expect((r as { title: string }).title).toBe("查这条");
        expect((r as { notes: unknown[] }).notes).toEqual([]);
      },
    },
    {
      tool: "todo_task_search",
      args: { query: "needle" },
      prepare: (c) => seedRow(c, 2, "含 needle 的待办"),
      check: (r) => expect((r as { tasks: unknown[] }).tasks).toHaveLength(1),
    },
  ];
}

/** 建改段（create/update；origin 审计断言） */
function createUpdateCases(): ToolCase[] {
  return [
    {
      tool: "todo_task_create",
      args: { title: "新待办", category: "工作", due: "2026-06-01T09:00" },
      check: (r, ids) => {
        const task = (r as { task: { id: number; status: string } }).task;
        ids.seeded = task.id;
        expect(task.status).toBe("scheduled");
        const audit = db0.prepare("SELECT origin FROM task_logs WHERE task_id=? AND action='create'").get(task.id) as {
          origin: string;
        };
        expect(audit.origin).toBe("dsh:tools");
      },
    },
    {
      tool: "todo_task_update",
      args: { id: 3, priority: "high" },
      prepare: (c) => seedRow(c, 3, "要改的"),
      check: (r) => expect((r as { task: { priority: string } }).task.priority).toBe("high"),
    },
  ];
}

/** 状态机段（done/undone/start/pause/current） */
function lifecycleCases(): ToolCase[] {
  return [
    {
      tool: "todo_task_done",
      args: { id: 4 },
      prepare: (c) => seedRow(c, 4, "要完成的"),
      check: (r) => expect((r as { task: { status: string } }).task.status).toBe("done"),
    },
    {
      tool: "todo_task_undone",
      args: { id: 5 },
      prepare: (c) =>
        seedRow(c, 5, "要撤销的", {
          status: "done",
          started: "2026-01-02T00:00:00+00:00",
          completed: "2026-01-03T00:00:00+00:00",
        }),
      check: (r) => expect((r as { task: { status: string } }).task.status).toBe("scheduled"),
    },
    {
      tool: "todo_task_start",
      args: { id: 6 },
      prepare: (c) => seedRow(c, 6, "要出发的", { status: "scheduled" }),
      check: (r) => expect((r as { task: { status: string } }).task.status).toBe("active"),
    },
    {
      tool: "todo_task_current",
      args: {},
      prepare: (c) => seedRow(c, 7, "进行中", { status: "active" }),
      check: (r) => expect((r as { task: { id: number } | null }).task?.id).toBe(7),
    },
    {
      tool: "todo_task_pause",
      args: {},
      prepare: (c) => seedRow(c, 8, "暂停我", { status: "active" }),
      check: (r) => expect((r as { task: { id: number } | null }).task?.id).toBe(8),
    },
  ];
}

/** 放生/逃走/跟进段 */
function opsCases(): ToolCase[] {
  return [
    {
      tool: "todo_task_delete",
      args: { id: 9 },
      prepare: (c) => seedRow(c, 9, "要放生的"),
      check: (r) => {
        expect(r).toEqual({ taskId: 9 });
        expect(db0.prepare("SELECT 1 FROM tasks WHERE id=9").get()).toBeUndefined();
      },
    },
    {
      tool: "todo_task_escape",
      args: { id: 10 },
      prepare: (c) => seedRow(c, 10, "要逃走的"),
      check: (r) => expect((r as { task: { status: string } }).task.status).toBe("cancelled"),
    },
    {
      tool: "todo_note_add",
      args: { taskId: 11, content: "一条跟进" },
      prepare: (c) => seedRow(c, 11, "带跟进"),
      check: (r) => expect((r as { note: { content: string } }).note.content).toBe("一条跟进"),
    },
  ];
}

/** 判定/派发/账本/桌宠段 */
function judgeDispatchPetCases(): ToolCase[] {
  return [
    {
      tool: "todo_tag_list",
      args: {},
      prepare: (c) => seedTag(c, "已有标签"),
      check: (r) => expect((r as { tags: unknown[] }).tags.length).toBeGreaterThanOrEqual(1),
    },
    {
      tool: "todo_tag_create",
      args: { name: "新标签", dimension: "topic" },
      check: (r) => expect((r as { tag: { name: string } }).tag.name).toBe("新标签"),
    },
    {
      tool: "todo_suggest_batch",
      args: { results: [{ messageId: "om_1", action: "todo", title: "判定建议" }] },
      prepare: (c) => seedMessage(c, "om_1"),
      check: (r) => {
        expect(r).toMatchObject({ submitted: 1, todo: 1 });
        const row = db0.prepare("SELECT ai_status FROM chat_messages WHERE message_id='om_1'").get() as {
          ai_status: string;
        };
        expect(row.ai_status).toBe("todo");
      },
    },
  ];
}

/** 派发回传段 */
function dispatchCases(): ToolCase[] {
  return [
    {
      tool: "todo_dispatch_done",
      args: { taskId: 12, note: "完工" },
      prepare: (c) => seedRow(c, 12, "派发中", { status: "scheduled", dispatch: "running" }),
      check: (r) => {
        expect((r as { report: { state: string } }).report.state).toBe("done");
        const row = db0.prepare("SELECT dispatch_state FROM tasks WHERE id=12").get() as { dispatch_state: string };
        expect(row.dispatch_state).toBe("done");
      },
    },
    {
      tool: "todo_dispatch_fail",
      args: { taskId: 13, note: "失败原因" },
      prepare: (c) => seedRow(c, 13, "派发失败", { status: "scheduled", dispatch: "running" }),
      check: (r) => expect((r as { report: { state: string } }).report.state).toBe("failed"),
    },
  ];
}

/** 账本段 */
function sessionLogCases(): ToolCase[] {
  return [
    {
      tool: "todo_session_log",
      args: { agentId: "ag-1", durationMs: 1200, exitCode: 0 },
      check: (r) => {
        expect(typeof (r as { sessionId: number }).sessionId).toBe("number");
        const row = db0.prepare("SELECT agent_id, kind FROM agent_sessions ORDER BY id DESC LIMIT 1").get() as {
          agent_id: string;
          kind: string;
        };
        expect(row).toEqual({ agent_id: "ag-1", kind: "pk" });
      },
    },
  ];
}

/** 当前测试连接（builder 内的落库断言读它；由 spec 的 beforeEach 注入） */
export let db0: Conn;

/** 注入当前连接（spec beforeEach 调用） */
export function bindCaseDb(conn: Conn): void {
  db0 = conn;
}

/** 全量用例（22 工具 × ≥1 happy path） */
export function allToolCases(): ToolCase[] {
  return [
    ...queryCases(),
    ...createUpdateCases(),
    ...lifecycleCases(),
    ...opsCases(),
    ...judgeDispatchPetCases(),
    ...dispatchCases(),
    ...sessionLogCases(),
  ];
}
