/**
 * 契约 op · 任务面与分诊面（Rust oracle 同名 op 的 TS 镜像）：task_* / note_add 走
 * domain/tasks + task-lifecycle 原语（origin 缺省 "cli"——oracle origin_arg 同口径）；
 * review_* 走 domain/review（origin "radio"——主应用命令层同值）。错误 → 机器稳定
 * tag（AppError 语义位：invalid / not_found / db）。
 */
import type { Conn } from "../../src/host/storage/db";
import { PkyError } from "../../src/host/storage/errors";
import { addTaskNote, deleteTask, pauseCurrentTask, startTask } from "../../src/host/domain/task-lifecycle";
import { createTask, updateTask, type NewTask, type TaskPatch } from "../../src/host/domain/tasks";
import { acceptMessage, applyUpdateMessage, dismissMessage, restoreMessage } from "../../src/host/domain/review";
import type { OpFn, OpResult } from "./harness";

/** harness 直发机器稳定 tag 的错误（oracle 组合语义位——如 key-not-editable 后缀） */
export class TagError extends Error {
  constructor(public readonly tag: string) {
    super(tag);
  }
}

/** AppError 语义位映射（app_err_tag 同构：Invalid→invalid / NotFound→not_found / 其余 db） */
export function tagOf(error: unknown): string {
  if (error instanceof TagError) {
    return error.tag;
  }
  if (error instanceof PkyError) {
    if (error.code === "INVALID_ARGUMENT") {
      return "invalid";
    }
    if (error.code === "NOT_FOUND") {
      return "not_found";
    }
    if (error.code === "SUGGESTION_ALREADY_RESOLVED") {
      return "invalid";
    }
    return error.code;
  }
  return "db";
}

/** op 结果包装（抛错 → 错误 tag；Rust run_op 的 Result 语义） */
export function run(fn: () => unknown): OpResult {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    return { ok: false, error: tagOf(error) };
  }
}

function originArg(args: Record<string, unknown>): string {
  const v = args.origin;
  return typeof v === "string" && v !== "" ? v : "cli";
}

function num(args: Record<string, unknown>, key: string): number {
  const v = args[key];
  if (typeof v !== "number") {
    throw new PkyError("INVALID_ARGUMENT", `${key}-missing`);
  }
  return v;
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

const taskBrief = (t: { id: number; status: string; dispatchState: string | null }): unknown => ({
  id: t.id,
  status: t.status,
  dispatch: t.dispatchState,
});

/** task_create（new_task_from_args 同构：有截止即 scheduled） */
const taskCreate: OpFn = (ctx, args) =>
  run(() => {
    const due = str(args, "due");
    const input: NewTask = {
      title: str(args, "title") ?? "",
      note: str(args, "note"),
      categoryId: typeof args.categoryId === "number" ? args.categoryId : undefined,
      priority: str(args, "priority"),
      dueAt: due,
      remindAt: str(args, "remindAt"),
      scheduled: args.scheduled === true || due !== undefined,
      source: str(args, "source"),
      externalId: str(args, "externalId"),
      tagIds: Array.isArray(args.tagIds) ? (args.tagIds as number[]) : undefined,
    };
    return taskBrief(createTask(ctx.conn(0), input, originArg(args)));
  });

/** task_update（patch = args 去 taskId/conn/origin；serde TaskPatch 同构） */
const taskUpdate: OpFn = (ctx, args) =>
  run(() => {
    const patch = { id: num(args, "taskId") } as Record<string, unknown>;
    for (const [k, v] of Object.entries(args)) {
      if (k === "taskId" || k === "conn" || k === "origin") {
        continue;
      }
      patch[k] = v;
    }
    return taskBrief(updateTask(ctx.conn(0), patch as unknown as TaskPatch, originArg(args)));
  });

/** task_done / undone / escape = status 补丁（oracle 同款：conn 层不设迁移守卫） */
function statusPatch(status: string): OpFn {
  return (ctx, args) =>
    run(() => {
      const id = num(args, "taskId");
      const t = updateTask(ctx.conn(0), { id, status }, originArg(args));
      return { id: t.id, status: t.status };
    });
}

/** task_reschedule：due 缺省=不改；null/""=清空；字符串=设置 */
const taskReschedule: OpFn = (ctx, args) =>
  run(() => {
    const id = num(args, "taskId");
    const due = args.due === undefined ? undefined : args.due === null || args.due === "" ? null : String(args.due);
    const t = updateTask(ctx.conn(0), { id, dueAt: due }, originArg(args));
    return { id: t.id, status: t.status, dueAt: t.dueAt };
  });

/** 任务面 + 跟进 + 分诊面 op 表 */
export function taskOps(): Record<string, OpFn> {
  return {
    task_create: taskCreate,
    task_update: taskUpdate,
    task_start: (ctx, args) => run(() => taskBrief(startTask(ctx.conn(0), num(args, "taskId"), originArg(args)))),
    task_resume: (ctx, args) => run(() => taskBrief(startTask(ctx.conn(0), num(args, "taskId"), originArg(args)))),
    task_pause: (ctx, args) =>
      run(() => {
        const t = pauseCurrentTask(ctx.conn(0), originArg(args));
        return { paused: t === null ? null : t.id };
      }),
    task_done: statusPatch("done"),
    task_undone: statusPatch("scheduled"),
    task_escape: statusPatch("cancelled"),
    task_delete: (ctx, args) =>
      run(() => {
        const id = num(args, "taskId");
        deleteTask(ctx.conn(0), id, originArg(args));
        return { deleted: id };
      }),
    task_reschedule: taskReschedule,
    note_add: (ctx, args) =>
      run(() => {
        const note = addTaskNote(
          ctx.conn(0),
          num(args, "taskId"),
          str(args, "content") ?? "",
          str(args, "source") ?? "manual",
        );
        return { noteId: note.id, taskId: note.taskId };
      }),
    review_accept: (ctx, args) =>
      run(() => ({ taskId: acceptMessage(ctx.conn(0), str(args, "messageId") ?? "", "radio") })),
    review_dismiss: (ctx, args) =>
      run(() => {
        const mid = str(args, "messageId") ?? "";
        dismissMessage(ctx.conn(0), mid, typeof args.reasonCode === "string" ? args.reasonCode : null);
        return { dismissed: mid };
      }),
    review_apply_update: (ctx, args) =>
      run(() => ({ taskId: applyUpdateMessage(ctx.conn(0), str(args, "messageId") ?? "", "radio") })),
    review_restore: (ctx, args) =>
      run(() => {
        const mid = str(args, "messageId") ?? "";
        restoreMessage(ctx.conn(0), mid);
        return { restored: mid };
      }),
  };
}

export type { Conn };
