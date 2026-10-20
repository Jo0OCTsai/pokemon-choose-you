/**
 * host 命令 · 收音机域（AD §4.1.1 快捕/分诊/失败组/收音机行）：captureTodo /
 * reviewAccept / reviewApplyUpdate / reviewDismiss / reviewRestore / reviewBatch /
 * retryJudge / forceCapture / forceDismiss / pollNow。分诊 CAS 幂等反馈 =
 * SUGGESTION_ALREADY_RESOLVED（domain/review 原语承载）。
 */
import { paramError } from "../storage/errors";
import { captureTodo } from "../judge/capture";
import { retryJudge } from "../judge/orchestrator";
import { radioHealth } from "../health/snapshot";
import { acceptMessage, applyUpdateMessage, batchReview, dismissMessage, restoreMessage } from "../domain/review";
import { validEscapeReason } from "../domain/suggest-types";
import type { CommandTable } from "./context";

const ORIGIN = "dsh";

/** 判定执行方（未配置 AI agent 时的可操作报错——快捕/重判共用） */
function executorOf(deps: Parameters<CommandTable["pollNow"]>[1]) {
  const executor = deps.newExecutor();
  if (executor === null) {
    throw paramError("未配置可用的 AI agent（设置 → Agent）", "先在背包的 Agent 分区配置并启用一个 agent");
  }
  return executor;
}

/** 快捕结果映射（judge/capture 的 outcome → 客户端视图 caught/updateSuggested） */
function captureOutcome(out: { messageId: string; outcome: "task" | "suggestion"; taskId: number | null }): {
  messageId: string;
  outcome: "caught" | "updateSuggested";
  taskId: number | null;
} {
  return {
    messageId: out.messageId,
    outcome: out.outcome === "task" ? "caught" : "updateSuggested",
    taskId: out.taskId,
  };
}

/** 失败组重判目标（"all" = 全部 error 且未分诊） */
function retryIds(conn: Parameters<CommandTable["pollNow"]>[1]["conn"], arg: string[] | "all"): string[] {
  if (arg !== "all") {
    return arg;
  }
  return (
    conn
      .prepare("SELECT message_id FROM chat_messages WHERE ai_status='error' AND review_status='pending' ORDER BY id")
      .all() as Array<{ message_id: string }>
  ).map((r) => r.message_id);
}

/** 单条分诊段（accept/applyUpdate/dismiss/restore + 快捕，5 条） */
function reviewCommandSet(): CommandTable {
  return {
    captureTodo: async (p, deps) => {
      const executor = executorOf(deps);
      const out = await captureTodo({ conn: deps.conn, executor, health: deps.health }, (p as { text: string }).text);
      deps.onWrites();
      return captureOutcome(out);
    },
    reviewAccept: (p, deps) => {
      const id = (p as { messageId: string }).messageId;
      const taskId = acceptMessage(deps.conn, id, ORIGIN);
      deps.onWrites();
      return { taskId, messageId: id };
    },
    reviewApplyUpdate: (p, deps) => {
      const id = (p as { messageId: string }).messageId;
      const taskId = applyUpdateMessage(deps.conn, id, ORIGIN);
      deps.onWrites();
      return { taskId, messageId: id };
    },
    reviewDismiss: (p, deps) => {
      const args = p as { messageId: string; reasonCode: string };
      dismissMessage(deps.conn, args.messageId, args.reasonCode);
      deps.onWrites();
      return { messageId: args.messageId };
    },
    reviewRestore: (p, deps) => {
      const id = (p as { messageId: string }).messageId;
      restoreMessage(deps.conn, id);
      deps.onWrites();
      return { messageId: id };
    },
  };
}

/** 批量与失败组段（reviewBatch/retryJudge/force×2，4 条） */
function failureCommandSet(): CommandTable {
  return {
    reviewBatch: (p, deps) => {
      const args = p as { messageIds: string[]; op: "accept" | "dismiss"; reasonCode?: string };
      const result = batchReview(deps.conn, args.messageIds, args.op, args.reasonCode ?? null, ORIGIN);
      const failed = new Map(result.failed.map((f) => [f.messageId, f.error]));
      deps.onWrites();
      return {
        results: args.messageIds.map((id) => ({
          messageId: id,
          ok: !failed.has(id),
          error: failed.get(id) ?? null,
        })),
      };
    },
    retryJudge: async (p, deps) => {
      const executor = executorOf(deps);
      const ids = retryIds(deps.conn, (p as { messageIds: string[] | "all" }).messageIds);
      const result = await retryJudge(
        { conn: deps.conn, executor, health: deps.health, onWrites: () => deps.onWrites() },
        ids,
      );
      deps.onWrites();
      return { accepted: result.claimed };
    },
    forceCapture: (p, deps) => {
      const id = (p as { messageId: string }).messageId;
      const taskId = acceptMessage(deps.conn, id, "dsh:force");
      deps.onWrites();
      return { taskId, messageId: id };
    },
    forceDismiss: (p, deps) => {
      const args = p as { messageId: string; reasonCode?: string };
      const reason = args.reasonCode === undefined ? null : validEscapeReason(args.reasonCode);
      dismissMessage(deps.conn, args.messageId, reason);
      deps.onWrites();
      return { messageId: args.messageId };
    },
  };
}

/** 收音机域命令表（10 条 = 单条分诊 5 + 批量/失败组 4 + pollNow） */
export function radioCommands(): CommandTable {
  return {
    ...reviewCommandSet(),
    ...failureCommandSet(),
    pollNow: async (_p, deps) => {
      const round = await deps.poll.runRound();
      if (!round.unauthorized && !round.ok) {
        deps.log("warn", "radio: pollNow 失败", round.error ?? "unknown");
      }
      if (!round.unauthorized) {
        deps.poll.resume();
      }
      return radioHealth(deps.conn, deps.health);
    },
  };
}
