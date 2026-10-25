/**
 * mockHost 命令组 · 快捕与分诊：captureTodo（判重命中 → 更新建议待确认）、
 * reviewAccept/reviewApplyUpdate（CAS pending 守卫 + 建卡回填）、reviewDismiss
 * （6 原因码白名单）/reviewRestore/reviewBatch、retryJudge/forceCapture/forceDismiss。
 */
import { PkyError } from "../host/storage/errors";
import type { HostClient } from "./rpc";
import { ESCAPE_REASON_CODES, type BatchReviewOutcome, type RadioMessage } from "./rpcTypes";
import type { MockContext } from "./mockHost";
import type { Task } from "../host/domain/tasks";

/** 快捕留档消息（accepted 回执 + 建卡） */
function pushCaptureMessage(ctx: MockContext, messageId: string, text: string, task: Task): void {
  const message: RadioMessage = {
    messageId,
    content: text,
    chatName: "",
    senderName: "",
    receivedAt: "2026-10-11T09:00:00+08:00",
    aiStatus: "todo",
    reviewStatus: "accepted",
    suggestedTitle: text,
    suggestedNote: null,
    suggestedCategory: null,
    suggestedDue: null,
    suggestedPriority: null,
    suggestedTags: [],
    confidence: "high",
    reason: null,
    dismissReason: "",
    taskId: task.id,
    updateTaskId: null,
  };
  ctx.state.messages.push(message);
}

/** 快捕：判重命中待确认 update 建议时产出更新卡，否则建新卡 */
export function captureCommands(ctx: MockContext): Pick<HostClient, "captureTodo"> {
  return {
    async captureTodo(params) {
      ctx.record("captureTodo", params);
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
      const duplicate = ctx.state.messages.find(
        (m) => m.aiStatus === "update" && m.reviewStatus === "pending" && params.text.includes(m.content.slice(0, 4)),
      );
      if (duplicate !== undefined) {
        return {
          ok: true,
          data: {
            messageId: duplicate.messageId,
            outcome: "updateSuggested",
            taskId: null,
            title: duplicate.suggestedTitle,
          },
        };
      }
      const messageId = `mock-cap-${ctx.calls.length}`;
      const task: Task = {
        id: ctx.nextTaskId(),
        title: params.text,
        note: null,
        categoryId: ctx.state.categories[0]?.id ?? 1,
        status: "inbox",
        priority: "normal",
        dueAt: null,
        remindAt: null,
        reminded: false,
        source: "capture",
        externalId: null,
        createdAt: "2026-10-11T09:00:00+08:00",
        completedAt: null,
        startedAt: null,
        cancelledAt: null,
        focusSeconds: 0,
        tags: [],
        dispatchState: null,
        dispatchedSession: null,
      };
      ctx.state.tasks.push(task);
      pushCaptureMessage(ctx, messageId, params.text, task);
      return { ok: true, data: { messageId, outcome: "caught", taskId: task.id, title: task.title } };
    },
  };
}

/** 捕捉/应用更新：CAS 抢占 pending → 建卡（todo）/回执（update） */
export function acceptCommands(ctx: MockContext): Pick<HostClient, "reviewAccept" | "reviewApplyUpdate"> {
  return {
    async reviewAccept(params) {
      ctx.record("reviewAccept", params);
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
      const conflict = ctx.guardPending(params.messageId);
      if (conflict !== null) {
        return { ok: false, error: conflict.toShape() };
      }
      const message = ctx.findMessage(params.messageId);
      if (message === undefined) {
        return { ok: false, error: new PkyError("NOT_FOUND", `消息 ${params.messageId} 不存在`).toShape() };
      }
      message.reviewStatus = "accepted";
      const task = taskFromMessage(ctx, message);
      message.taskId = task.id;
      return { ok: true, data: { taskId: task.id, messageId: message.messageId } };
    },
    async reviewApplyUpdate(params) {
      ctx.record("reviewApplyUpdate", params);
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
      const conflict = ctx.guardPending(params.messageId);
      if (conflict !== null) {
        return { ok: false, error: conflict.toShape() };
      }
      const message = ctx.findMessage(params.messageId);
      if (message === undefined) {
        return { ok: false, error: new PkyError("NOT_FOUND", `消息 ${params.messageId} 不存在`).toShape() };
      }
      message.reviewStatus = "accepted";
      return { ok: true, data: { taskId: message.updateTaskId, messageId: message.messageId } };
    },
  };
}

/** 逃走（原因码白名单）/恢复/批量分诊 */
export function dismissCommands(ctx: MockContext): Pick<HostClient, "reviewDismiss" | "reviewRestore" | "reviewBatch"> {
  return {
    async reviewDismiss(params) {
      ctx.record("reviewDismiss", params);
      const conflict = await dismissGuard(ctx, params.messageId, params.reasonCode);
      if (conflict !== null) {
        return conflict;
      }
      const message = ctx.findMessage(params.messageId);
      if (message === undefined) {
        return { ok: false, error: new PkyError("NOT_FOUND", `消息 ${params.messageId} 不存在`).toShape() };
      }
      message.reviewStatus = "dismissed";
      message.dismissReason = params.reasonCode as RadioMessage["dismissReason"];
      return { ok: true, data: { messageId: message.messageId } };
    },
    async reviewRestore(params) {
      ctx.record("reviewRestore", params);
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
      const message = ctx.findMessage(params.messageId);
      if (message === undefined) {
        return { ok: false, error: new PkyError("NOT_FOUND", `消息 ${params.messageId} 不存在`).toShape() };
      }
      if (message.reviewStatus !== "dismissed") {
        return { ok: false, error: new PkyError("SUGGESTION_ALREADY_RESOLVED", "该建议已在另一处处置").toShape() };
      }
      message.reviewStatus = "pending";
      message.dismissReason = "";
      return { ok: true, data: { messageId: message.messageId } };
    },
    async reviewBatch(params) {
      ctx.record("reviewBatch", params);
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
      const results = params.messageIds.map((messageId) =>
        reviewBatchOne(ctx, messageId, params.op, params.reasonCode),
      );
      return { ok: true, data: { results } };
    },
  };
}

/** 捕捉建卡（消息建议 → 草丛新任务，source=feishu） */
function taskFromMessage(ctx: MockContext, message: RadioMessage): Task {
  const task: Task = {
    id: ctx.nextTaskId(),
    title: message.suggestedTitle ?? message.content,
    note: null,
    categoryId: ctx.state.categories[0]?.id ?? 1,
    status: "inbox",
    priority: "normal",
    dueAt: null,
    remindAt: null,
    reminded: false,
    source: "feishu",
    externalId: null,
    createdAt: "2026-10-11T09:00:00+08:00",
    completedAt: null,
    startedAt: null,
    cancelledAt: null,
    focusSeconds: 0,
    tags: [],
    dispatchState: null,
    dispatchedSession: null,
  };
  ctx.state.tasks.push(task);
  return task;
}

/** 逃走守卫（只读 + CAS + 原因码白名单共用） */
async function dismissGuard(
  ctx: MockContext,
  messageId: string,
  reasonCode: string,
): Promise<{ ok: false; error: ReturnType<PkyError["toShape"]> } | null> {
  const blocked = ctx.guardWritable();
  if (blocked !== null) {
    return { ok: false, error: blocked.toShape() };
  }
  const conflict = ctx.guardPending(messageId);
  if (conflict !== null) {
    return { ok: false, error: conflict.toShape() };
  }
  if (!ESCAPE_REASON_CODES.includes(reasonCode as never)) {
    return { ok: false, error: new PkyError("INVALID_ARGUMENT", `未知逃走原因码：${reasonCode}`).toShape() };
  }
  return null;
}

/** 批量分诊单条：accept=建卡回执 / dismiss=批逃；已处置逐条汇报 */
function reviewBatchOne(
  ctx: MockContext,
  messageId: string,
  op: "accept" | "dismiss",
  reasonCode?: string,
): BatchReviewOutcome {
  const message = ctx.findMessage(messageId);
  const resolved = message === undefined || message.reviewStatus !== "pending";
  if (!resolved && message !== undefined) {
    if (op === "accept") {
      message.reviewStatus = "accepted";
    } else {
      message.reviewStatus = "dismissed";
      message.dismissReason = (reasonCode ?? "other") as RadioMessage["dismissReason"];
    }
  }
  return { messageId, ok: !resolved, error: resolved ? "SUGGESTION_ALREADY_RESOLVED" : null };
}

/** 失败组：一键重判（"all" = 整组 error）/强制捕捉/强制逃走 */
export function retryCommands(ctx: MockContext): Pick<HostClient, "retryJudge" | "forceCapture" | "forceDismiss"> {
  return {
    async retryJudge(params) {
      ctx.record("retryJudge", params);
      const targets =
        params.messageIds === "all"
          ? ctx.state.messages.filter((m) => m.aiStatus === "error")
          : ctx.state.messages.filter((m) => params.messageIds.includes(m.messageId));
      for (const message of targets) {
        message.aiStatus = "judging";
      }
      return { ok: true, data: { accepted: targets.length } };
    },
    async forceCapture(params) {
      ctx.record("forceCapture", params);
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
      const message = ctx.findMessage(params.messageId);
      if (message === undefined) {
        return { ok: false, error: new PkyError("NOT_FOUND", `消息 ${params.messageId} 不存在`).toShape() };
      }
      message.aiStatus = "todo";
      message.reviewStatus = "accepted";
      return { ok: true, data: { taskId: message.taskId, messageId: message.messageId } };
    },
    async forceDismiss(params) {
      ctx.record("forceDismiss", params);
      const blocked = ctx.guardWritable();
      if (blocked !== null) {
        return { ok: false, error: blocked.toShape() };
      }
      const message = ctx.findMessage(params.messageId);
      if (message === undefined) {
        return { ok: false, error: new PkyError("NOT_FOUND", `消息 ${params.messageId} 不存在`).toShape() };
      }
      message.aiStatus = "none";
      message.reviewStatus = "dismissed";
      message.dismissReason = params.reasonCode ?? "other";
      return { ok: true, data: { messageId: message.messageId } };
    },
  };
}
