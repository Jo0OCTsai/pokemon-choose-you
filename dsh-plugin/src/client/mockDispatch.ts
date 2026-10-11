/**
 * mockHost 命令组 · 派发六命令：双通道（互斥 DISPATCH_ALREADY_ACTIVE）/收口 done|failed
 * /重置/取消排队（仅 queued）/重派（续接）。
 */
import { PkyError } from "../host/storage/errors";
import type { HostClient } from "./rpc";
import type { DispatchView } from "./rpcTypes";
import type { MockContext } from "./mockHost";

function view(
  taskId: number,
  state: DispatchView["state"],
  startedAt: string | null,
  endedAt: string | null,
  ctx: MockContext,
): DispatchView {
  return { taskId, state, agentId: ctx.state.agents[0]?.id ?? null, startedAt, endedAt };
}

/** 互斥守卫：running/queued 在途 → DISPATCH_ALREADY_ACTIVE */
function guardActive(
  ctx: MockContext,
  taskId: number,
  writable: boolean,
): { ok: false; error: ReturnType<PkyError["toShape"]> } | null {
  if (writable) {
    const blocked = ctx.guardWritable();
    if (blocked !== null) {
      return { ok: false, error: blocked.toShape() };
    }
  }
  const task = ctx.findTask(taskId);
  if (task === undefined) {
    return { ok: false, error: new PkyError("NOT_FOUND", `任务 ${taskId} 不存在`).toShape() };
  }
  if (task.dispatchState === "running" || task.dispatchState === "queued") {
    return {
      ok: false,
      error: new PkyError("DISPATCH_ALREADY_ACTIVE", "该任务已有进行中的派发，请先收口或重置").toShape(),
    };
  }
  return null;
}

/** 双通道发起：交互 → running / 无头 → queued（互斥 + 只读守卫） */
export function dispatchCommands(ctx: MockContext): Pick<HostClient, "dispatchInteractive" | "dispatchHeadless"> {
  return {
    async dispatchInteractive(params) {
      ctx.record("dispatchInteractive", params);
      const guard = guardActive(ctx, params.taskId, true);
      if (guard !== null) {
        return guard;
      }
      const task = ctx.findTask(params.taskId)!;
      task.dispatchState = "running";
      return { ok: true, data: view(params.taskId, "running", "2026-10-11T09:00:00+08:00", null, ctx) };
    },
    async dispatchHeadless(params) {
      ctx.record("dispatchHeadless", params);
      const guard = guardActive(ctx, params.taskId, true);
      if (guard !== null) {
        return guard;
      }
      const task = ctx.findTask(params.taskId)!;
      task.dispatchState = "queued";
      return { ok: true, data: view(params.taskId, "queued", null, null, ctx) };
    },
  };
}

/** 收口/重置/取消排队/重派 */
export function dispatchControlCommands(
  ctx: MockContext,
): Pick<HostClient, "dispatchClose" | "dispatchReset" | "dispatchCancel" | "dispatchRedo"> {
  return {
    async dispatchClose(params) {
      ctx.record("dispatchClose", params);
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
      const task = ctx.findTask(params.taskId);
      if (task === undefined) {
        return { ok: false, error: new PkyError("NOT_FOUND", `任务 ${params.taskId} 不存在`).toShape() };
      }
      task.dispatchState = params.result;
      return { ok: true, data: view(params.taskId, params.result, null, "2026-10-11T09:30:00+08:00", ctx) };
    },
    async dispatchReset(params) {
      ctx.record("dispatchReset", params);
      const task = ctx.findTask(params.taskId);
      if (task === undefined) {
        return { ok: false, error: new PkyError("NOT_FOUND", `任务 ${params.taskId} 不存在`).toShape() };
      }
      task.dispatchState = null;
      return { ok: true, data: view(params.taskId, "queued", null, null, ctx) };
    },
    async dispatchCancel(params) {
      ctx.record("dispatchCancel", params);
      const task = ctx.findTask(params.taskId);
      if (task === undefined) {
        return { ok: false, error: new PkyError("NOT_FOUND", `任务 ${params.taskId} 不存在`).toShape() };
      }
      if (task.dispatchState !== "queued") {
        return { ok: false, error: new PkyError("INVALID_ARGUMENT", "只有排队中的派发可以取消").toShape() };
      }
      task.dispatchState = null;
      return { ok: true, data: view(params.taskId, "queued", null, null, ctx) };
    },
    async dispatchRedo(params) {
      ctx.record("dispatchRedo", params);
      const guard = guardActive(ctx, params.taskId, true);
      if (guard !== null) {
        return guard;
      }
      const task = ctx.findTask(params.taskId)!;
      task.dispatchState = "running";
      return { ok: true, data: view(params.taskId, "running", "2026-10-11T10:00:00+08:00", null, ctx) };
    },
  };
}
