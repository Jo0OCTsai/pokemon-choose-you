/**
 * host 命令 · 实体读域（Phase B 契约缺口补齐，docs/debt.md 2026-10-11 条目）：
 * panelSnapshot（面板首载一次聚合读）/ taskDetail（抽屉懒载）/ taskSearch /
 * todayTasks / categoriesList。全部只读——domain 现有查询 + 薄 SQL，不开事务、
 * 不触发 onWrites；空库/冷启动各段空数组不报错。消息/会话/健康投影单源在
 * domain/panel-read.ts（本文件只做任务分段与命令装配）。
 *
 * 任务分段语义基准 = src-tauri list_tasks_conn（open/done/today 排序逐字对齐）+
 * dex_stats（stats 全量口径不受列表 LIMIT 截断）；搜索 = search_tasks_conn
 * （标题/备注/跟进/标签名 LIKE 通配符转义、id 倒序 100）。
 */
import { nowRfc3339 } from "../storage/db";
import { paramError } from "../storage/errors";
import { getCurrentTask, getTask, listTasks, type Task } from "../domain/tasks";
import { listCategories, type Category } from "../domain/vocabulary";
import { listTagDimensions, listTags, type Tag, type TagDimension } from "../domain/vocabulary-tags";
import {
  panelRadioHealth,
  panelSessions,
  radioGroups,
  SQL_SESSION_LOGS,
  SQL_SESSION_TIMELINE,
  type PanelMessage,
  type PanelRadioHealth,
  type PanelSession,
} from "../domain/panel-read";
import type { Conn } from "../storage/db";
import type { CommandTable } from "./context";
import { sessionsPage as sessionsPageDomain } from "../dispatch/sessions";
import { streakFromDb } from "../domain/streak";
import { MILESTONES } from "../pet/solemn";
import { missedRemindersSinceLastSeen, touchLastSeenReminderAt, type MissedReminder } from "../reminder/deliver";

export type { PanelMessage, PanelRadioHealth, PanelSession } from "../domain/panel-read";

/** 面板聚合快照（panelSnapshot 载荷） */
export interface PanelSnapshot {
  now: string;
  adventure: { active: Task[]; dueToday: Task[]; overdue: Task[] };
  grass: Task[];
  /** 平铺 + dueAt 由 client 分组（routeGroups） */
  route: Task[];
  dex: { done: Task[]; cancelled: Task[]; stats: { caught: number; escaped: number } };
  radio: {
    pending: PanelMessage[];
    none: PanelMessage[];
    error: PanelMessage[];
    escaped: PanelMessage[];
    accepted: PanelMessage[];
    health: PanelRadioHealth;
  };
  /** agent_sessions 按时间倒序（id DESC）limit 500 */
  logs: PanelSession[];
  currentTask: Task | null;
  /** 分类清单（任务卡精灵/徽章渲染；与 categoriesList 同源） */
  categories: Category[];
  /** 标签维度 + 标签清单（背包标签卡/标签管理卡消费；与 categories 同快照只读） */
  dimensions: TagDimension[];
  tags: Tag[];
  /** 离开期间到期清单（补看面——AD §4.6：勿扰静默与降级送达的都「看得见」，不补送达；
   *  可选字段向后兼容，客户端呈现归组 3） */
  missedReminders?: { since: string | null; rows: MissedReminder[] };
}

/** 跟进记录行（task_notes 投影） */
export interface PanelFollowup {
  id: number;
  taskId: number;
  content: string;
  source: string;
  createdAt: string;
}

/** 任务详情（taskDetail 载荷：抽屉懒载） */
export interface TaskDetail {
  task: Task;
  followups: PanelFollowup[];
  dispatch: { state: string | null; dispatchedSession: string | null; dispatchable: boolean };
  /** 该任务的 agent 执行时间线（升序——list_agent_sessions_conn 任务口径） */
  timeline: PanelSession[];
}

// ---- 任务分段查询（薄 SQL；排序对齐 list_tasks_conn 的 open/done 口径） ----

const TASK_COLS =
  "id, title, note, category_id, status, priority, due_at, remind_at, reminded, source, " +
  "external_id, created_at, completed_at, started_at, cancelled_at, focus_seconds, " +
  "dispatch_state, dispatched_session";

const ORDER_OPEN =
  "ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, " +
  "CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, " +
  "due_at IS NULL, due_at";

const SQL_ACTIVE = `SELECT ${TASK_COLS} FROM tasks WHERE status IN ('active','paused') ${ORDER_OPEN}`;
const SQL_DUE_TODAY =
  `SELECT ${TASK_COLS} FROM tasks WHERE status IN ('inbox','scheduled') ` +
  "AND due_at IS NOT NULL AND trim(due_at) != '' AND date(due_at) = date('now','localtime') ORDER BY due_at, id";
const SQL_OVERDUE =
  `SELECT ${TASK_COLS} FROM tasks WHERE status IN ('inbox','scheduled') ` +
  "AND due_at IS NOT NULL AND trim(due_at) != '' AND date(due_at) < date('now','localtime') ORDER BY due_at, id";
const SQL_GRASS = `SELECT ${TASK_COLS} FROM tasks WHERE status='inbox' ${ORDER_OPEN}`;
const SQL_ROUTE = `SELECT ${TASK_COLS} FROM tasks WHERE status='scheduled' ORDER BY due_at IS NULL, due_at, id`;
const SQL_DONE = "SELECT id FROM tasks WHERE status='done' ORDER BY completed_at DESC LIMIT 200";
const SQL_CANCELLED = "SELECT id FROM tasks WHERE status='cancelled' ORDER BY cancelled_at DESC LIMIT 200";

/** 行集 → Task[]（复用 domain getTask 的列映射与挂标签，保形状单源） */
function tasksByIds(conn: Conn, sql: string): Task[] {
  return (conn.prepare(sql).all() as Array<{ id: number }>).map((r) => getTask(conn, Number(r.id)));
}

/** 冒险分段（进行中/暂停 + 今日到期 + 逾期折叠集） */
function adventureOf(conn: Conn): PanelSnapshot["adventure"] {
  return {
    active: tasksByIds(conn, SQL_ACTIVE),
    dueToday: tasksByIds(conn, SQL_DUE_TODAY),
    overdue: tasksByIds(conn, SQL_OVERDUE),
  };
}

/** 图鉴分段（done/cancelled 各 200 + 全量统计——dex_stats 口径不受 LIMIT 截断） */
function dexOf(conn: Conn): PanelSnapshot["dex"] {
  const stats = conn
    .prepare(
      "SELECT COALESCE(SUM(status='done'), 0) AS caught, COALESCE(SUM(status='cancelled'), 0) AS escaped FROM tasks",
    )
    .get() as { caught: number; escaped: number };
  return {
    done: tasksByIds(conn, SQL_DONE),
    cancelled: tasksByIds(conn, SQL_CANCELLED),
    stats: { caught: Number(stats.caught), escaped: Number(stats.escaped) },
  };
}

// ---- 可否派发与搜索 ----

/** 派发可发起判定：任务未收口 + 派发态不在途（NULL 可首发；done/failed 可重派） */
function dispatchableOf(task: Task): boolean {
  if (task.status === "done" || task.status === "cancelled") {
    return false;
  }
  return task.dispatchState === null || task.dispatchState === "done" || task.dispatchState === "failed";
}

const SQL_SEARCH = `SELECT ${TASK_COLS} FROM tasks
WHERE title LIKE ?1 ESCAPE '\\'
   OR note LIKE ?1 ESCAPE '\\'
   OR id IN (SELECT tt.task_id FROM task_tags tt JOIN tags t ON t.id = tt.tag_id
             WHERE t.name LIKE ?1 ESCAPE '\\')
   OR id IN (SELECT task_id FROM task_notes WHERE content LIKE ?1 ESCAPE '\\')
ORDER BY id DESC LIMIT 100`;

/** search_tasks_conn 同构（trim、空查询空集、LIKE 转义、id 倒序 100） */
export function searchTasks(conn: Conn, query: string): Task[] {
  const q = query.trim();
  if (q === "") {
    return [];
  }
  const like = `%${q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
  return (conn.prepare(SQL_SEARCH).all(like) as Array<{ id: number }>).map((row) => getTask(conn, Number(row.id)));
}

/** 任务详情组装（taskDetail 命令体：全量 + 跟进 + 派发 + 时间线 join） */
function taskDetailOf(conn: Conn, taskId: number): TaskDetail {
  const task = getTask(conn, taskId);
  const followups = (
    conn
      .prepare("SELECT id, task_id, content, source, created_at FROM task_notes WHERE task_id=? ORDER BY id")
      .all(taskId) as Array<Record<string, unknown>>
  ).map((n): PanelFollowup => ({
    id: Number(n.id),
    taskId: Number(n.task_id),
    content: String(n.content),
    source: String(n.source),
    createdAt: String(n.created_at),
  }));
  return {
    task,
    followups,
    dispatch: {
      state: task.dispatchState,
      dispatchedSession: task.dispatchedSession,
      dispatchable: dispatchableOf(task),
    },
    timeline: panelSessions(conn, SQL_SESSION_TIMELINE, taskId),
  };
}

// ---- 命令表 ----

/** 实体读命令表（5 条，全部只读） */
/** panelSnapshot 聚合体（独立函数——控表函数行数棘轮；含补看面锚点更新） */
function panelSnapshotOf(deps: Parameters<CommandTable["dbStatus"]>[1]): PanelSnapshot {
  const conn = deps.conn;
  // 补看面（AD §4.6 静默消费闭环）：先取「离开期间到期」清单（上一锚点 → 现在），
  // 再把锚点推到本次面板打开时刻（dsh: 内部键单语句写——非业务数据面）
  const nowMs = Date.now();
  const missed = missedRemindersSinceLastSeen(conn, {
    nowMs,
    offsetMinutes: -new Date(nowMs).getTimezoneOffset(),
  });
  touchLastSeenReminderAt(conn, new Date(nowMs).toISOString().replace("Z", "+00:00"));
  return {
    now: nowRfc3339(),
    adventure: adventureOf(conn),
    grass: tasksByIds(conn, SQL_GRASS),
    route: tasksByIds(conn, SQL_ROUTE),
    dex: dexOf(conn),
    radio: { ...radioGroups(conn), health: panelRadioHealth(conn, deps.health, deps.feishuConfigured) },
    logs: panelSessions(conn, SQL_SESSION_LOGS),
    currentTask: getCurrentTask(conn),
    categories: listCategories(conn),
    dimensions: listTagDimensions(conn),
    tags: listTags(conn),
    missedReminders: missed,
  };
}

export function readCommands(): CommandTable {
  return {
    panelSnapshot: (_p, deps) => panelSnapshotOf(deps),
    taskDetail: (p, deps) => {
      const taskId = (p as { taskId: number }).taskId;
      if (!Number.isInteger(taskId) || taskId <= 0) {
        throw paramError(`非法任务 id：${String(taskId)}`);
      }
      return taskDetailOf(deps.conn, taskId);
    },
    taskSearch: (p, deps) => ({ tasks: searchTasks(deps.conn, (p as { query: string }).query ?? "") }),
    todayTasks: (_p, deps) => ({ tasks: listTasks(deps.conn, "today") }),
    categoriesList: (_p, deps) => ({ categories: listCategories(deps.conn) }),
    // 会话分页（FR-C2）：分组过滤 + id 倒序 + limit 钳制全在 domain（sessionsPage）
    sessionsPage: (p, deps) => {
      const args = p as { group?: string; limit?: number; offset?: number };
      return sessionsPageDomain(deps.conn, {
        ...(args.group === undefined ? {} : { group: args.group }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
        ...(args.offset === undefined ? {} : { offset: args.offset }),
      });
    },
    // 图鉴连胜直读（FR-B3 数据面；nextMilestone = 下一连胜里程碑阈值）
    streakInfo: (_p, deps) => {
      const streak = streakFromDb(deps.conn);
      const next = MILESTONES.find((m) => m > streak.days);
      return next === undefined ? streak : { ...streak, nextMilestone: next };
    },
  };
}
