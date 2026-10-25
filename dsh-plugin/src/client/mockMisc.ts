/**
 * mockHost 命令组 · 诊断/桌宠/通用/专注：diagnosticsSnapshot（links + full-parity 增量
 * helperCaps/shortcutRegistered/sshFamily/helperVersion）、supportReport（脱敏文本）、
 * logQuery（级别/来源过滤 + 分页）、petShow/petHide/petStatus/petMove、dbStatus、pomoTryFive、
 * macAuthorizationStatus/macAuthPaneOpen（AX 授权引导数据面）。
 */
import { PkyError } from "../host/storage/errors";
import type { HostClient } from "./rpc";
import type { DiagnosticsSnapshotData, LogEntry } from "./rpcTypes";
import type { MockContext } from "./mockHost";

/** 诊断与支持报告 */
export function diagCommands(ctx: MockContext): Pick<HostClient, "diagnosticsSnapshot" | "supportReport"> {
  return {
    async diagnosticsSnapshot() {
      ctx.record("diagnosticsSnapshot");
      const data: DiagnosticsSnapshotData = {
        links: ctx.state.diagnostics,
        helperCaps: ctx.state.helperCaps,
        shortcutRegistered: ctx.state.shortcutRegistered,
        sshFamily: ctx.state.sshFamily,
        helperVersion: ctx.state.helperVersion,
      };
      return { ok: true, data };
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

function mockPollNow(ctx: MockContext): Awaited<ReturnType<HostClient["pollNow"]>> {
  ctx.record("pollNow");
  if (!ctx.state.larkAuthorized) {
    return { ok: false, error: new PkyError("LARK_UNAUTHORIZED", "飞书未授权，轮询已暂停").toShape() };
  }
  return { ok: true, data: ctx.state.health };
}

function mockPetRunning(
  ctx: MockContext,
  command: "petShow" | "petHide",
  running: boolean,
): { ok: true; data: { ok: true } } {
  ctx.record(command);
  ctx.state.petRunning = running;
  return { ok: true, data: { ok: true } };
}

function mockMacAuthorizationStatus(
  ctx: MockContext,
  params?: { kind?: string },
): Awaited<ReturnType<HostClient["macAuthorizationStatus"]>> {
  ctx.record("macAuthorizationStatus", params);
  if (params?.kind !== "accessibility") {
    return { ok: false, error: new PkyError("INVALID_ARGUMENT", `未知授权类型 ${String(params?.kind)}`).toShape() };
  }
  return { ok: true, data: { ...ctx.state.macAuth } };
}

/** 桌宠与杂项（petShow/Hide/Status/Move + dbStatus + pomoTryFive + 收音机手动拉取 + AX 授权面） */
export function miscCommands(
  ctx: MockContext,
): Pick<
  HostClient,
  | "petShow"
  | "petHide"
  | "petStatus"
  | "petMove"
  | "petResetPos"
  | "petSetupProgress"
  | "dbStatus"
  | "pomoTryFive"
  | "pollNow"
  | "macAuthorizationStatus"
  | "macAuthPaneOpen"
> {
  return {
    async pollNow() {
      return await mockPollNow(ctx);
    },
    ...petMockCommands(ctx),
    async dbStatus() {
      ctx.record("dbStatus");
      return { ok: true, data: ctx.state.dbStatus };
    },
    async pomoTryFive(params) {
      ctx.record("pomoTryFive", params);
      return { ok: true, data: { ok: true } };
    },
    async macAuthorizationStatus(params) {
      return await mockMacAuthorizationStatus(ctx, params);
    },
    async macAuthPaneOpen() {
      ctx.record("macAuthPaneOpen");
      return { ok: true, data: { ok: true } };
    },
  };
}

/** 桌宠命令 mock 组（拆小函数控棘轮 max-lines-per-function） */
function petMockCommands(
  ctx: MockContext,
): Pick<HostClient, "petShow" | "petHide" | "petStatus" | "petMove" | "petResetPos" | "petSetupProgress"> {
  return {
    async petShow() {
      return mockPetRunning(ctx, "petShow", true);
    },
    async petHide() {
      return mockPetRunning(ctx, "petHide", false);
    },
    async petStatus() {
      ctx.record("petStatus");
      return { ok: true, data: { running: ctx.state.petRunning, pomodoro: ctx.state.pomodoro } };
    },
    async petMove(params) {
      ctx.record("petMove", params);
      return { ok: true, data: { ok: true } };
    },
    async petResetPos() {
      ctx.record("petResetPos");
      return { ok: true, data: { ok: true, delivered: ctx.state.petRunning } };
    },
    async petSetupProgress() {
      ctx.record("petSetupProgress");
      return { ok: true, data: { phase: ctx.state.petRunning ? "done" : "idle", at: 0 } };
    },
  };
}
