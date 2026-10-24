/**
 * todo_* 工具面聚合（AD §4.1 全部 20 行 / 22 工具名——成对工具 done/undone、
 * start/pause、tag_list/create、dispatch_done/fail、pet_hide/show 各占一行表项）。
 * 会话模型与判定通道的统一消费面：`createTodoTools()` 装配完整注册表，
 * dsh 适配层后续把它投影到真实 dsh tools API（本任务不接真 dsh）。
 */
import { defineTools, type ToolRegistry } from "./registry";
import { taskToolDefs } from "./todoTaskTools";
import { miscToolDefs } from "./todoOpsTools";

/** 工具名全集（注册表完整性断言单源；与 AD §4.1 表逐行对应） */
export const TODO_TOOL_NAMES = [
  "todo_context",
  "todo_task_list",
  "todo_task_get",
  "todo_task_search",
  "todo_task_create",
  "todo_task_update",
  "todo_task_done",
  "todo_task_undone",
  "todo_task_start",
  "todo_task_pause",
  "todo_task_current",
  "todo_task_delete",
  "todo_task_escape",
  "todo_note_add",
  "todo_tag_list",
  "todo_tag_create",
  "todo_suggest_batch",
  "todo_dispatch_done",
  "todo_dispatch_fail",
  "todo_session_log",
  "todo_pet_hide",
  "todo_pet_show",
] as const;

/** 装配 todo 工具注册表（任务域 + 判定/派发/桌宠域） */
export function createTodoTools(): ToolRegistry {
  return defineTools([...taskToolDefs(), ...miscToolDefs()]);
}
