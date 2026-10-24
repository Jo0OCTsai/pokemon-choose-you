/**
 * 契约 op · 派发面（dispatch_* / slot_*）：state.rs / auto.rs 原语的 TS 镜像——
 * domain/dispatch 状态机与 domain/dispatch-slots 槽表。owner 记 "app"（oracle 的
 * claim_with_slot 硬编码同值；owner 仅供崩溃排障，不参与互斥判定）。
 */
import { claimDispatch, dispatchTransition, queueDueTasks } from "../../src/host/domain/dispatch";
import { acquireSlot, reclaimExpiredSlots, releaseSlot } from "../../src/host/domain/dispatch-slots";
import type { OpCtx, OpFn } from "./harness";
import { run } from "./opsTask";

function num(args: Record<string, unknown>, key: string): number {
  return typeof args[key] === "number" ? (args[key] as number) : 0;
}

function optStr(args: Record<string, unknown>, key: string): string | undefined {
  return typeof args[key] === "string" ? (args[key] as string) : undefined;
}

const DEFAULT_STATES = ["done", "failed", "queued"];

/** dispatch_claim（claim_dispatch 原子抢占 / claim_with_slot 占槽领取二选一） */
const dispatchClaim: OpFn = (ctx, args) =>
  run(() => {
    const conn = ctx.conn(0);
    const taskId = num(args, "taskId");
    if (args.withSlot !== false) {
      return { claimed: acquireSlot(conn, slotOpts(args, taskId)) };
    }
    const states = Array.isArray(args.states) ? (args.states as string[]) : DEFAULT_STATES;
    return { claimed: claimDispatch(conn, taskId, { allowNull: args.allowNull !== false, states }) };
  });

/** 槽参数（oracle 缺省：host=local / max=1 / lease=900 / owner=app） */
function slotOpts(
  args: Record<string, unknown>,
  taskId: number,
): { taskId: number; hostKey: string; maxConcurrent: number; leaseSecs: number; owner: string } {
  return {
    taskId,
    hostKey: optStr(args, "host") ?? "local",
    maxConcurrent: typeof args.maxConcurrent === "number" ? args.maxConcurrent : 1,
    leaseSecs: typeof args.leaseSecs === "number" ? args.leaseSecs : 900,
    owner: "app",
  };
}

/** 派发与槽 op 表 */
export function dispatchOps(): Record<string, OpFn> {
  return {
    dispatch_queue: (ctx) => run(() => ({ queued: queueDueTasks(ctx.conn(0)) })),
    dispatch_claim: dispatchClaim,
    dispatch_transition: (ctx, args) => transitionOp(ctx, args),
    dispatch_reset: (ctx, args) => transitionOp(ctx, args),
    dispatch_close: (ctx, args) =>
      run(() => {
        const conn = ctx.conn(0);
        const taskId = num(args, "taskId");
        const to = optStr(args, "result");
        if (to === undefined) {
          throw new Error("result-missing");
        }
        dispatchTransition(conn, taskId, to, optStr(args, "note") ?? null, "dsh:test");
        const host = optStr(args, "host");
        if (host !== undefined) {
          releaseSlot(conn, host, taskId);
        }
        return { taskId, result: to };
      }),
    slot_acquire: (ctx, args) =>
      run(() => {
        const opts = slotOpts(args, num(args, "taskId"));
        return { acquired: acquireSlot(ctx.conn(0), opts), host: opts.hostKey };
      }),
    slot_release: (ctx, args) =>
      run(() => {
        const taskId = num(args, "taskId");
        releaseSlot(ctx.conn(0), optStr(args, "host") ?? "local", taskId);
        return { released: taskId };
      }),
    slot_reclaim: (ctx) => run(() => ({ reclaimed: reclaimExpiredSlots(ctx.conn(0)) })),
  };
}

/** dispatch_transition / dispatch_reset（to=null / "null" / 缺省 → 重置救援） */
function transitionOp(ctx: OpCtx, args: Record<string, unknown>): ReturnType<OpFn> {
  return run(() => {
    const to = optStr(args, "to");
    const target = to === undefined || to === "null" ? null : to;
    const taskId = num(args, "taskId");
    dispatchTransition(ctx.conn(0), taskId, target, optStr(args, "note") ?? null, "dsh:test");
    return { taskId, to: target };
  });
}
