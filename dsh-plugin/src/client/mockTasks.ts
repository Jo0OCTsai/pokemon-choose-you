/**
 * mockHost 命令组 · 任务域：出发/暂停/继续/完成/逃走（taskCommands）、放生与撤销与改期
 * （releaseCommands）、快捕（captureCommands）、分诊 CAS（reviewCommands）、失败组
 * （retryCommands）。派发见 mockDispatch.ts。
 */
import { PkyError } from "../host/storage/errors";
import type { HostClient } from "./rpc";
import type { MockContext } from "./mockHost";

/** 出发/暂停/继续（出发原语：demote 全部 active/paused → 本任务 active，全局唯一进行中） */
export function taskSwitchCommands(ctx: MockContext): Pick<HostClient, "taskStart" | "taskPause" | "taskResume"> {
  return {
    async taskStart(params) {
      ctx.record("taskStart", params);
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
      const task = ctx.findTask(params.taskId);
      if (task === undefined) {
        return { ok: false, error: new PkyError("NOT_FOUND", `任务 ${params.taskId} 不存在`).toShape() };
      }
      for (const other of ctx.state.tasks) {
        if (other.id !== task.id && (other.status === "active" || other.status === "paused")) {
          other.status = "scheduled";
        }
      }
      task.status = "active";
      return { ok: true, data: task };
    },
    async taskPause(params) {
      ctx.record("taskPause", params);
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
      const target =
        params?.taskId !== undefined ? ctx.findTask(params.taskId) : ctx.state.tasks.find((t) => t.status === "active");
      if (target === undefined) {
        return { ok: true, data: null };
      }
      target.status = "paused";
      return { ok: true, data: target };
    },
    async taskResume(params) {
      ctx.record("taskResume", params);
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
      const target =
        params?.taskId !== undefined ? ctx.findTask(params.taskId) : ctx.state.tasks.find((t) => t.status === "paused");
      if (target === undefined) {
        return { ok: true, data: null };
      }
      target.status = "active";
      return { ok: true, data: target };
    },
  };
}

/** 完成/逃走（原因码守卫在 taskCancel 内不涉及——由上层白名单约束） */
export function taskCloseCommands(ctx: MockContext): Pick<HostClient, "taskComplete" | "taskCancel"> {
  return {
    async taskComplete(params) {
      ctx.record("taskComplete", params);
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
      const target =
        params?.taskId !== undefined ? ctx.findTask(params.taskId) : ctx.state.tasks.find((t) => t.status !== "done");
      if (target === undefined) {
        return { ok: false, error: new PkyError("NOT_FOUND", "没有可完成的任务").toShape() };
      }
      target.status = "done";
      target.completedAt = "2026-10-11T09:00:00+08:00";
      return { ok: true, data: target };
    },
    async taskCancel(params) {
      ctx.record("taskCancel", params);
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
      const task = ctx.findTask(params.taskId);
      if (task === undefined) {
        return { ok: false, error: new PkyError("NOT_FOUND", `任务 ${params.taskId} 不存在`).toShape() };
      }
      task.status = "cancelled";
      task.cancelledAt = "2026-10-11T09:00:00+08:00";
      return { ok: true, data: task };
    },
  };
}

/** 放生（墓碑）+ 撤销 + 改期（due="" 清空回落草丛） */
export function releaseCommands(
  ctx: MockContext,
): Pick<HostClient, "taskDelete" | "taskDeleteUndo" | "taskReschedule"> {
  return {
    async taskDelete(params) {
      ctx.record("taskDelete", params);
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
      const tombstone = ctx.findTask(params.taskId);
      ctx.state.tasks = ctx.state.tasks.filter((t) => t.id !== params.taskId);
      if (tombstone !== undefined) {
        ctx.state.deleted.push(tombstone);
      }
      return { ok: true, data: { taskId: params.taskId } };
    },
    async taskDeleteUndo(params) {
      ctx.record("taskDeleteUndo", params);
      const tombstone = ctx.state.deleted.find((t) => t.id === params.taskId);
      if (tombstone === undefined) {
        return { ok: false, error: new PkyError("INVALID_ARGUMENT", "撤销窗口已过或任务未被放生").toShape() };
      }
      ctx.state.deleted = ctx.state.deleted.filter((t) => t.id !== params.taskId);
      ctx.state.tasks.push(tombstone);
      return { ok: true, data: tombstone };
    },
    async taskReschedule(params) {
      ctx.record("taskReschedule", params);
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
      const task = ctx.findTask(params.taskId);
      if (task === undefined) {
        return { ok: false, error: new PkyError("NOT_FOUND", `任务 ${params.taskId} 不存在`).toShape() };
      }
      task.dueAt = params.due === undefined ? task.dueAt : params.due === "" ? null : params.due;
      if (task.dueAt === null && task.startedAt === null) {
        task.status = "inbox";
      } else if (task.dueAt !== null && task.status === "inbox") {
        task.status = "scheduled";
      }
      return { ok: true, data: task };
    },
  };
}
