/**
 * mockHost 命令组 · 跟进记录与操作历史（从 mockTasks.ts 拆出——棘轮 max-lines，
 * 等量迁移；taskEditCommands 经展开消费，公共面不变）。
 */
import { PkyError } from "../host/storage/errors";
import type { HostClient } from "./rpc";
import type { MockContext } from "./mockHost";

/** 跟进记录增删（写 ctx.state.followups）+ 操作历史（读 ctx.state.taskLogs） */
export function taskNoteCommands(ctx: MockContext): Pick<HostClient, "taskNoteAdd" | "taskNoteDelete" | "taskHistory"> {
  return {
    async taskNoteAdd(params) {
      ctx.record("taskNoteAdd", params);
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
      const task = ctx.findTask(params.taskId);
      if (task === undefined) {
        return { ok: false, error: new PkyError("NOT_FOUND", `任务 ${params.taskId} 不存在`).toShape() };
      }
      const content = params.content.trim();
      if (content === "") {
        return { ok: false, error: new PkyError("INVALID_ARGUMENT", "跟进内容不能为空").toShape() };
      }
      const list = (ctx.state.followups[params.taskId] ??= []);
      const note = {
        id: list.reduce((max, n) => Math.max(max, n.id), 0) + 1,
        taskId: params.taskId,
        content,
        source: "manual",
        createdAt: "2026-10-14T08:00:00+00:00",
      };
      list.push(note);
      return ctx.ok(note);
    },
    async taskNoteDelete(params) {
      ctx.record("taskNoteDelete", params);
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
      for (const key of Object.keys(ctx.state.followups)) {
        const id = Number(key);
        ctx.state.followups[id] = ctx.state.followups[id].filter((n) => n.id !== params.id);
      }
      return ctx.ok({ ok: true });
    },
    async taskHistory(params) {
      ctx.record("taskHistory", params);
      return ctx.ok({ logs: ctx.state.taskLogs[params.taskId] ?? [] });
    },
  };
}
