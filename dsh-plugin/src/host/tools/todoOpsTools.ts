/**
 * todo_* 工具面 · 判定/派发/桌宠域（AD §4.1 表后半）：tag_list / tag_create /
 * suggest_batch（判定唯一出口）/ dispatch_done / dispatch_fail / session_log /
 * pet_hide / pet_show——薄转发 domain/judge/dispatch/pet 原语。
 */
import { paramError } from "../storage/errors";
import { suggestBatch, type AiSuggestion } from "../domain/suggest";
import { tagUpsert, listTags } from "../domain/vocabulary-tags";
import { dispatchReport } from "../dispatch/interactive";
import { logAgentSession } from "../dispatch/sessions";
import type { ToolContext, ToolDef } from "./registry";

/** 桌宠面（petShow/petHide 共用：未装配时报参数错——helper 生命周期归装配层注入） */
function petFace(ctx: ToolContext): { show(): Promise<unknown>; hide(): void } {
  if (ctx.pet === undefined) {
    throw paramError("桌宠 helper 未装配，pet 工具不可用", "确认插件已完成桌宠装配或联系宿主");
  }
  return ctx.pet;
}

/** 标签与判定段（AD §4.1 表逐行） */
function tagJudgeToolDefs(): ToolDef[] {
  return [
    {
      name: "todo_tag_list",
      summary: "标签词表（含维度与用量）",
      params: [],
      handler: (_a, ctx) => ({ tags: listTags(ctx.conn) }),
    },
    {
      name: "todo_tag_create",
      summary: "新建标签（维度停用/配额满/重名拒绝）",
      params: ["name", "dimension"],
      handler: (a: { name: string; dimension: string }, ctx) => ({
        tag: tagUpsert(ctx.conn, { name: a.name, dimension: a.dimension }),
      }),
    },
    {
      name: "todo_suggest_batch",
      summary: "判定唯一出口：整批强校验 + 单事务落库（任一违规整批拒绝）",
      params: ["results"],
      handler: (a: { results: AiSuggestion[] }, ctx) => suggestBatch(ctx.conn, a.results, ctx.origin ?? "dsh:tools"),
    },
  ];
}

/** 派发回传/账本段 */
function dispatchToolDefs(): ToolDef[] {
  return [
    {
      name: "todo_dispatch_done",
      summary: "派发回传：成功收口（已收口径按成功反馈幂等）+ agent_sessions 落账",
      params: ["taskId", "note"],
      handler: (a: { taskId: number; note?: string }, ctx) => ({
        report: dispatchReport(ctx.conn, a.taskId, "done", a.note, ctx.origin ?? "dsh:tools"),
      }),
    },
    {
      name: "todo_dispatch_fail",
      summary: "派发回传：失败收口（原因入审计）+ agent_sessions 落账",
      params: ["taskId", "note"],
      handler: (a: { taskId: number; note?: string }, ctx) => ({
        report: dispatchReport(ctx.conn, a.taskId, "failed", a.note, ctx.origin ?? "dsh:tools"),
      }),
    },
    {
      name: "todo_session_log",
      summary: "消耗账本补录（agent 会话的成本/时长/退出码）",
      params: ["taskId", "agentId", "sessionId", "costUsd", "durationMs", "exitCode"],
      handler: sessionLogHandler,
    },
  ];
}

/** todo_session_log 的 handler（账本行落库；exitCode>0 记 error） */
function sessionLogHandler(
  a: {
    taskId?: number;
    agentId: string;
    sessionId?: string;
    costUsd?: number;
    durationMs?: number;
    exitCode?: number;
  },
  ctx: ToolContext,
): Record<string, unknown> {
  const id = logAgentSession(ctx.conn, {
    taskId: a.taskId ?? null,
    agentId: a.agentId,
    kind: "pk",
    sessionId: a.sessionId ?? null,
    costUsd: a.costUsd ?? null,
    durationMs: a.durationMs ?? null,
    exitCode: a.exitCode ?? null,
    status: a.exitCode !== undefined && a.exitCode > 0 ? "error" : "ok",
  });
  return { sessionId: id };
}

/** 桌宠段（helper 生命周期） */
function petToolDefs(): ToolDef[] {
  return [
    {
      name: "todo_pet_hide",
      summary: "隐藏桌宠（停 helper 进程，其余功能不受影响）",
      params: [],
      handler: async (_a, ctx) => (petFace(ctx).hide(), { ok: true }),
    },
    {
      name: "todo_pet_show",
      summary: "显示桌宠（拉起 helper 并恢复状态与位置）",
      params: [],
      handler: async (_a, ctx) => (await petFace(ctx).show(), { ok: true }),
    },
  ];
}

/** 判定/派发/桌宠工具清单（AD §4.1 表逐行） */
export function miscToolDefs(): ToolDef[] {
  return [...tagJudgeToolDefs(), ...dispatchToolDefs(), ...petToolDefs()];
}
