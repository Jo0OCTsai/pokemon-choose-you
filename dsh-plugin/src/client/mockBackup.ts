/**
 * mockHost 命令组 · 备份/导出域：backupRun（固定文件名落 mock 列表头部）、
 * backupList（状态直读）、exportRun（kind 校验 + 固定路径）+ full-parity 导入/恢复
 * （importValidate/importRun/restoreRun 按 importFiles/restoreOutcome 夹具编排）与
 * exportDirOpen。真实语义（VACUUM INTO 落盘/滚动保留/三种产物/前置备份）由
 * __tests__/backup-*.spec.ts 真库覆盖。
 */
import { PkyError } from "../host/storage/errors";
import type { HostClient } from "./rpc";
import type { BackupInfo, ImportSummary } from "./rpcTypes";
import { pendingCode } from "./mockRemote";
import type { MockContext } from "./mockHost";

/** mock 备份文件名（固定时间戳，断言确定性） */
const MOCK_BACKUP_FILE = "pokemon-choose-you-20261011-080000.db";

/** 各导出 kind 的 mock 产物路径 */
const MOCK_EXPORT_PATHS = {
  json: "/mock/.choose-you/data/exports/pokemon-choose-you-full-20261011-080000.json",
  csv: "/mock/.choose-you/data/exports/pokemon-choose-you-tasks-20261011-080000.csv",
  report: "/mock/.choose-you/data/exports/pokemon-choose-you-daily-2026-10-11.md",
} as const;

function mockBackupRun(ctx: MockContext): Awaited<ReturnType<HostClient["backupRun"]>> {
  ctx.record("backupRun");
  const entry: BackupInfo = { file: MOCK_BACKUP_FILE, size: 4096, createdAt: "2026-10-11T08:00:00+08:00" };
  // 重名幂等（同秒序号语义的简化：固定名只保留一份，置顶刷新）
  ctx.state.backups = [entry, ...ctx.state.backups.filter((b) => b.file !== entry.file)];
  return { ok: true, data: { file: entry.file, files: ctx.state.backups } };
}

function mockBackupList(ctx: MockContext): Awaited<ReturnType<HostClient["backupList"]>> {
  ctx.record("backupList");
  return { ok: true, data: { backups: ctx.state.backups } };
}

function mockExportRun(ctx: MockContext, params?: { kind?: string }): Awaited<ReturnType<HostClient["exportRun"]>> {
  ctx.record("exportRun", params);
  const kind = params?.kind;
  if (kind !== "json" && kind !== "csv" && kind !== "report") {
    return {
      ok: false,
      error: new PkyError(
        "INVALID_ARGUMENT",
        `未知导出类型 ${String(kind)}`,
        "kind 须为 json / csv / report",
      ).toShape(),
    };
  }
  return { ok: true, data: { path: MOCK_EXPORT_PATHS[kind] } };
}

function mockImportValidate(
  ctx: MockContext,
  params?: { path?: string },
): Awaited<ReturnType<HostClient["importValidate"]>> {
  ctx.record("importValidate", params);
  const fixture = ctx.state.importFiles.find((f) => f.path === params?.path);
  if (fixture === undefined) {
    return {
      ok: false,
      error: new PkyError("IMPORT_VALIDATION_FAILED", "文件不存在或不可读").toShape(),
    };
  }
  if (fixture.reasons !== undefined && fixture.reasons.length > 0) {
    return {
      ok: false,
      error: new PkyError("IMPORT_VALIDATION_FAILED", fixture.reasons.join("；")).toShape(),
    };
  }
  const summary: ImportSummary = fixture.summary ?? {
    app: "pokemon-choose-you",
    schemaVersion: 1,
    counts: { tasks: 12, categories: 2, tags: 5 },
    compatible: true,
    backupFile: ctx.state.importResult.backupId,
  };
  return { ok: true, data: { summary } };
}

function mockImportRun(
  ctx: MockContext,
  params?: { path?: string; confirmed?: boolean },
): Awaited<ReturnType<HostClient["importRun"]>> {
  ctx.record("importRun", params);
  const blocked = ctx.guardWritable();
  if (blocked !== null) {
    return { ok: false, error: blocked.toShape() };
  }
  if (params?.confirmed !== true) {
    return { ok: false, error: new PkyError("INVALID_ARGUMENT", "导入须显式确认（confirmed: true）").toShape() };
  }
  const fixture = ctx.state.importFiles.find((f) => f.path === params.path);
  if (fixture === undefined || (fixture.reasons !== undefined && fixture.reasons.length > 0)) {
    return { ok: false, error: new PkyError("IMPORT_VALIDATION_FAILED", "文件校验未通过，0 行变更").toShape() };
  }
  if (fixture.backupFail === true) {
    return {
      ok: false,
      error: new PkyError("BACKUP_FAILED", "磁盘空间不足，自动备份失败").toShape(),
    };
  }
  return { ok: true, data: { result: { ...ctx.state.importResult } } };
}

function mockRestoreRun(
  ctx: MockContext,
  params?: { confirmed?: boolean },
): Awaited<ReturnType<HostClient["restoreRun"]>> {
  ctx.record("restoreRun", params);
  const blocked = ctx.guardWritable();
  if (blocked !== null) {
    return { ok: false, error: blocked.toShape() };
  }
  if (params?.confirmed !== true) {
    return { ok: false, error: new PkyError("INVALID_ARGUMENT", "恢复须显式确认（confirmed: true）").toShape() };
  }
  const outcome = ctx.state.restoreOutcome;
  if (outcome !== null && !outcome.ok) {
    return { ok: false, error: new PkyError(outcome.code, outcome.message).toShape() };
  }
  const result =
    outcome !== null ? outcome.result : { backupId: "pokemon-choose-you-20261017-090000.db", migratedTo: 1, seeded: 2 };
  return { ok: true, data: { result } };
}

function mockExportDirOpen(ctx: MockContext): Awaited<ReturnType<HostClient["exportDirOpen"]>> {
  ctx.record("exportDirOpen");
  const dir = ctx.state.exportDir;
  if (dir.error !== undefined) {
    return {
      ok: false,
      error: new PkyError(pendingCode("HELPER_CAPABILITY_MISSING"), dir.error, dir.path).toShape(),
    };
  }
  return { ok: true, data: { ok: true, path: dir.path } };
}

export function backupCommands(
  ctx: MockContext,
): Pick<
  HostClient,
  "backupRun" | "backupList" | "exportRun" | "importValidate" | "importRun" | "restoreRun" | "exportDirOpen"
> {
  return {
    async backupRun() {
      return await mockBackupRun(ctx);
    },
    async backupList() {
      return await mockBackupList(ctx);
    },
    async exportRun(params) {
      return await mockExportRun(ctx, params);
    },
    async importValidate(params) {
      return await mockImportValidate(ctx, params);
    },
    async importRun(params) {
      return await mockImportRun(ctx, params);
    },
    async restoreRun(params) {
      return await mockRestoreRun(ctx, params);
    },
    async exportDirOpen() {
      return await mockExportDirOpen(ctx);
    },
  };
}
