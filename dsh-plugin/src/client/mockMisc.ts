/**
 * mockHost 命令组 · 诊断/桌宠/通用/专注：diagnosticsSnapshot、supportReport（脱敏文本）、
 * logQuery（级别/来源过滤 + 分页）、petShow/petHide/petStatus/petMove、dbStatus、pomoTryFive。
 */
import { PkyError } from "../host/storage/errors";
import type { HostClient } from "./rpc";
import type { LogEntry } from "./rpcTypes";
import type { MockContext } from "./mockHost";

/** 诊断与支持报告 */
export function diagCommands(ctx: MockContext): Pick<HostClient, "diagnosticsSnapshot" | "supportReport"> {
  return {
    async diagnosticsSnapshot() {
      ctx.record("diagnosticsSnapshot");
      return { ok: true, data: { links: ctx.state.diagnostics } };
    },
    async supportReport() {
      ctx.record("supportReport");
      return { ok: true, data: { text: "pokemon-choose-you dsh plugin support report (redacted)" } };
    },
  };
}

/** 运行日志查询（host 侧过滤口径：minLevel 阈值 + target 精确 + offset/limit 分页） */
export function logCommands(ctx: MockContext): Pick<HostClient, "logQuery"> {
  const ORDER: Record<LogEntry["level"], number> = { debug: 0, info: 1, warn: 2, error: 3 };
  return {
    async logQuery(params) {
      ctx.record("logQuery", params);
      let entries = [...ctx.state.logEntries];
      if (params?.minLevel !== undefined) {
        entries = entries.filter((e) => ORDER[e.level] >= ORDER[params.minLevel as LogEntry["level"]]);
      }
      if (params?.target !== undefined && params.target !== "") {
        entries = entries.filter((e) => e.target === params.target);
      }
      const total = entries.length;
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? 500;
      return { ok: true, data: { entries: entries.slice(offset, offset + limit), total } };
    },
  };
}

/** 桌宠与杂项（petShow/Hide/Status/Move + dbStatus + pomoTryFive + 收音机手动拉取） */
export function miscCommands(
  ctx: MockContext,
): Pick<HostClient, "petShow" | "petHide" | "petStatus" | "petMove" | "dbStatus" | "pomoTryFive" | "pollNow"> {
  return {
    async pollNow() {
      ctx.record("pollNow");
      if (!ctx.state.larkAuthorized) {
        return { ok: false, error: new PkyError("LARK_UNAUTHORIZED", "飞书未授权，轮询已暂停").toShape() };
      }
      return { ok: true, data: ctx.state.health };
    },

    async petShow() {
      ctx.record("petShow");
      ctx.state.petRunning = true;
      return { ok: true, data: { ok: true } };
    },
    async petHide() {
      ctx.record("petHide");
      ctx.state.petRunning = false;
      return { ok: true, data: { ok: true } };
    },
    async petStatus() {
      ctx.record("petStatus");
      return { ok: true, data: { running: ctx.state.petRunning } };
    },
    async petMove(params) {
      ctx.record("petMove", params);
      return { ok: true, data: { ok: true } };
    },
    async dbStatus() {
      ctx.record("dbStatus");
      return { ok: true, data: ctx.state.dbStatus };
    },
    async pomoTryFive(params) {
      ctx.record("pomoTryFive", params);
      return { ok: true, data: { ok: true } };
    },
  };
}
