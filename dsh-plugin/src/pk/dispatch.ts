/**
 * dispatch 子命令（对齐 bin/pk/dispatch.rs）：agent 回传派发状态（start/done/fail）。
 * --task 缺省读应用派发注入的 PK_DISPATCH_TASK；两者皆空时静默跳过（Stop hook 场景不产噪）。
 */
import type { Conn } from "../host/storage/db";
import { dispatchTransition } from "../host/domain/dispatch";
import { notFound } from "../host/storage/errors";
import { dbErr, flag, parseArgs, usageErr, CliError } from "./cli";

export function runDispatch(conn: Conn, rest: readonly string[]): unknown {
  const sub = rest[0];
  if (sub === undefined) {
    throw usageErr("缺少 dispatch 子命令（start / done / fail），用法见 pk help");
  }
  const p = parseArgs(rest.slice(1));
  const task = dispatchTaskOf(p);
  if (task === undefined) {
    return { skipped: "未指定 --task 且无 PK_DISPATCH_TASK 派发上下文（普通会话，无需回传）" };
  }
  if (sub === "start") {
    return dispatchStart(conn, task);
  }
  if (sub === "done" || sub === "fail") {
    return dispatchFinish(conn, sub, p, task);
  }
  throw usageErr(`未知 dispatch 子命令「${sub}」（start / done / fail）`);
}

/** --task 缺省读 PK_DISPATCH_TASK；非法值报用法错（taskRaw 解析同构） */
function dispatchTaskOf(p: Parameters<typeof flag>[0]): number | undefined {
  const fl = (name: string): string | undefined => flag(p, name.replace(/^-+/, ""));
  const taskFlag = fl("--task");
  const envTask = process.env.PK_DISPATCH_TASK;
  const taskRaw =
    taskFlag !== undefined && taskFlag !== ""
      ? taskFlag
      : envTask !== undefined && envTask !== ""
        ? envTask
        : undefined;
  if (taskRaw === undefined) {
    return undefined;
  }
  const taskId = Number(taskRaw);
  if (!Number.isInteger(taskId)) throw usageErr("--task 必须是任务 id 数字");
  return taskId;
}

/** 领取开工：已 running 幂等成功；NULL/queued 走状态机迁移（带审计日志） */
function dispatchStart(conn: Conn, taskId: number): unknown {
  const row = conn.prepare("SELECT dispatch_state FROM tasks WHERE id=?").get(taskId) as
    { dispatch_state: string | null } | undefined;
  if (row === undefined) {
    throw dbErr(notFound(`待办 No.${taskId} 不存在`));
  }
  const cur = row.dispatch_state;
  if (cur === "running") return { task: taskId, state: "running", idempotent: true };
  if (cur === null || cur === "queued") {
    return dispatchTo(conn, taskId, "running", null);
  }
  throw new CliError(`待办 No.${taskId} 派发状态为「${cur}」，不能开工；由应用派发领取 running 后再回传`, 1);
}

/** done/fail：从 running 迁移并带一句话摘要 */
function dispatchFinish(conn: Conn, sub: string, p: Parameters<typeof flag>[0], taskId: number): unknown {
  const noteRaw = flag(p, "note");
  const note = noteRaw !== undefined && noteRaw !== "" ? noteRaw : null;
  return dispatchTo(conn, taskId, sub === "done" ? "done" : "failed", note);
}

/** 状态机迁移 + 域错误转 CLI 错误 */
function dispatchTo(conn: Conn, taskId: number, to: string, note: string | null): unknown {
  try {
    dispatchTransition(conn, taskId, to, note, "pk");
  } catch (e) {
    throw dbErr(e);
  }
  return { task: taskId, state: to };
}
