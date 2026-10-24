/**
 * 派发任务 prompt 组装（取数层）：任务 + 最新跟进 + 路由上下文 → 假名化 →
 * domain/injection 定界组装（调不重写——injection.ts 与 Rust prompt.rs 字节级
 * 同构，契约 fixtures injection 组锁定）。
 *
 * 行为基准 = src-tauri/src/commands/dispatch/route.rs prepare_dispatch：
 * project 校验、notes 取最新 3 条、AnonRules.scrub_titles 假名化（真名不随
 * 派发 prompt 出机）、prev_session 续接线索。
 */
import type { Conn } from "../storage/db";
import { AnonRules } from "../domain/anonymize";
import { dispatchPrompt } from "../domain/injection";
import type { AgentConfig } from "../domain/settings";
import { getTask, type Task } from "../domain/tasks";
import { resolveDispatchRoute, type ResolvedDispatchRoute } from "./routes";

/** 两条通道（无头/交互）共用的派发取数 */
export interface DispatchPromptPrep {
  task: Task;
  /** 最新跟进（时间正序，最多 3 条——route.rs 同款查询后 reverse） */
  notes: string[];
  agent: AgentConfig;
  route: ResolvedDispatchRoute;
  /** tasks.dispatched_session（A14 会话续接用；空归 null） */
  prevSession: string | null;
  /** 组装完成的派发 prompt（定界块 + 要求段） */
  prompt: string;
}

/**
 * 派发统一取数（prepare_dispatch 同构）：无 project 标签 / 无可用 agent 抛参数错
 * （文案对齐主应用）；标题/详情/跟进/项目上下文先过假名化再进定界块。
 * routeOverride 临时改选 agent（不回写路由表）。
 */
export function prepareDispatchPrompt(conn: Conn, taskId: number, routeOverride?: string): DispatchPromptPrep {
  const route = resolveDispatchRoute(conn, taskId, routeOverride);
  const task = getTask(conn, taskId);
  const notes = (
    conn.prepare("SELECT content FROM task_notes WHERE task_id=? ORDER BY id DESC LIMIT 3").all(taskId) as Array<{
      content: string;
    }>
  )
    .map((r) => r.content)
    .reverse();
  const rules = AnonRules.build(conn);
  const scrubbedTask: Task = {
    ...task,
    title: rules.scrubTitles(task.title),
    note: task.note === null ? null : rules.scrubTitles(task.note),
  };
  const scrubbedNotes = notes.map((n) => rules.scrubTitles(n));
  const context = route.context === null ? null : rules.scrubTitles(route.context);
  const prevSession = task.dispatchedSession?.trim() ?? "";
  return {
    task: scrubbedTask,
    notes: scrubbedNotes,
    agent: route.agent,
    route,
    prevSession: prevSession === "" ? null : prevSession,
    prompt: dispatchPrompt(taskId, scrubbedTask.title, scrubbedTask.note, scrubbedNotes, context),
  };
}
