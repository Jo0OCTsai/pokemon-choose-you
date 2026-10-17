/**
 * 契约 op 表装配：分组实现合并 + 审计写操作集（concurrency 组审计守恒断言的期望侧，
 * 与 Rust oracle AUDIT_WRITING_OPS 逐字一致）。
 */
import type { OpFn } from "./harness";
import { taskOps } from "./opsTask";
import { judgeOps } from "./opsJudge";
import { dispatchOps } from "./opsDispatch";
import { configOps } from "./opsConfig";
import { vocabOps } from "./opsVocab";
import { reminderOps } from "./opsReminder";

/** 确定写 task_logs 的成功 op 集（auditRows >= writeOps 守恒断言的期望侧） */
export const AUDIT_WRITING_OPS = new Set([
  "task_create",
  "task_update",
  "task_start",
  "task_pause",
  "task_resume",
  "task_done",
  "task_undone",
  "task_escape",
  "task_delete",
  "task_reschedule",
  "review_accept",
  "review_apply_update",
  "dispatch_transition",
  "dispatch_reset",
  "dispatch_close",
]);

/** 全量 op 表（PROTOCOL §5 op 枚举的 TS 执行面） */
export function opTable(): Record<string, OpFn> {
  return { ...taskOps(), ...judgeOps(), ...dispatchOps(), ...configOps(), ...vocabOps(), ...reminderOps() };
}
