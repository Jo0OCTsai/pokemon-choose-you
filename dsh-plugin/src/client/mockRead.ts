/**
 * mockHost 命令组 · 实体读域（readCommands 的内存语义子集）：panelSnapshot（任务四段 +
 * 收音机五分组 + 会话账本的内存态投影——复用 model 纯函数保分组口径单源）、taskDetail
 * （跟进流/时间线/dispatchable）、taskSearch、todayTasks、categoriesList。
 */
import { PkyError } from "../host/storage/errors";
import type { HostClient } from "./rpc";
import type { PanelSnapshot, TaskDetail } from "./rpcTypes";
import type { MockContext } from "./mockHost";
import { adventureSnapshot, dexStats, grassTasks, routeGroups, suggestionGroups } from "./model";

/** mock 快照时刻（确定性夹具——不取真实时钟） */
const MOCK_NOW = "2026-10-11T09:00:00+08:00";

/** 本地今天 YYYY-MM-DD（与 panelData localToday 同口径） */
function mockToday(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** 任务今日口径（listTasks('today')：active/paused + 今日及以前到期） */
function dueOrActive(today: string, task: { status: string; dueAt: string | null }): boolean {
  if (task.status === "active" || task.status === "paused") {
    return true;
  }
  return task.dueAt !== null && task.dueAt.slice(0, 10) <= today;
}

/** 派发可发起判定（host readCommands dispatchableOf 同口径） */
function dispatchableOf(task: { status: string; dispatchState: string | null }): boolean {
  if (task.status === "done" || task.status === "cancelled") {
    return false;
  }
  return task.dispatchState === null || task.dispatchState === "done" || task.dispatchState === "failed";
}

/** panelSnapshot：任务四段/收音机五分组/账本的内存态投影 */
function mockPanelSnapshot(ctx: MockContext): PanelSnapshot {
  const today = mockToday();
  const tasks = ctx.state.tasks;
  const snapshot = adventureSnapshot(tasks, today);
  const groups = suggestionGroups(ctx.state.messages);
  const stats = dexStats(tasks);
  return {
    now: MOCK_NOW,
    adventure: {
      active: tasks.filter((t) => t.status === "active" || t.status === "paused"),
      dueToday: snapshot.todayTasks.filter((t) => t.status !== "active" && t.status !== "paused"),
      overdue: snapshot.overdueTasks,
    },
    grass: grassTasks(tasks),
    route: routeGroups(tasks).flatMap((group) => group.tasks),
    dex: {
      done: tasks.filter((t) => t.status === "done"),
      cancelled: tasks.filter((t) => t.status === "cancelled"),
      stats: { caught: stats.caught, escaped: stats.escaped },
    },
    radio: {
      pending: groups.pending,
      none: groups.none,
      error: groups.failed,
      escaped: groups.escaped,
      accepted: groups.caught,
      health: ctx.state.health,
    },
    logs: ctx.state.sessions,
    currentTask: tasks.find((t) => t.status === "active") ?? null,
    categories: ctx.state.categories,
    dimensions: ctx.state.dimensions,
    tags: ctx.state.tags,
  };
}

/** taskDetail：任务 + 跟进流 + 派发态/可否派发 + 该任务时间线 */
function mockTaskDetail(ctx: MockContext, task: MockContext["state"]["tasks"][number]): TaskDetail {
  return {
    task,
    followups: ctx.state.followups[task.id] ?? [],
    dispatch: {
      state: task.dispatchState,
      dispatchedSession: task.dispatchedSession,
      dispatchable: dispatchableOf(task),
    },
    timeline: ctx.state.sessions.filter((s) => s.taskId === task.id),
  };
}

/** 实体读命令组（panelSnapshot 聚合 + 按需懒载） */
export function readCommands(
  ctx: MockContext,
): Pick<HostClient, "panelSnapshot" | "taskDetail" | "taskSearch" | "todayTasks" | "categoriesList"> {
  return {
    async panelSnapshot() {
      ctx.record("panelSnapshot");
      return { ok: true, data: mockPanelSnapshot(ctx) };
    },
    async taskDetail(params) {
      ctx.record("taskDetail", params);
      const task = ctx.findTask(params.taskId);
      if (task === undefined) {
        return { ok: false, error: new PkyError("NOT_FOUND", `任务 ${params.taskId} 不存在`).toShape() };
      }
      return { ok: true, data: mockTaskDetail(ctx, task) };
    },
    async taskSearch(params) {
      ctx.record("taskSearch", params);
      return { ok: true, data: { tasks: searchMockTasks(ctx, params.query) } };
    },
    async todayTasks() {
      ctx.record("todayTasks");
      const today = mockToday();
      return { ok: true, data: { tasks: ctx.state.tasks.filter((t) => dueOrActive(today, t)) } };
    },
    async categoriesList() {
      ctx.record("categoriesList");
      return { ok: true, data: { categories: ctx.state.categories } };
    },
  };
}

/** 标题/备注/标签名/跟进内容包含匹配（host searchTasks 的内存子集） */
function searchMockTasks(ctx: MockContext, query: string): MockContext["state"]["tasks"] {
  const q = query.trim();
  if (q === "") {
    return [];
  }
  return ctx.state.tasks.filter((task) => {
    const followups = ctx.state.followups[task.id] ?? [];
    return (
      task.title.includes(q) ||
      (task.note ?? "").includes(q) ||
      task.tags.some((tag) => tag.name.includes(q)) ||
      followups.some((note) => note.content.includes(q))
    );
  });
}
