/**
 * mockHost 命令组 · 备份/导出域：backupRun（固定文件名落 mock 列表头部）、
 * backupList（状态直读）、exportRun（kind 校验 + 固定路径）。真实语义
 * （VACUUM INTO 落盘/滚动保留/三种产物）由 __tests__/backup-export.spec.ts 真库覆盖。
 */
import { PkyError } from "../host/storage/errors";
import type { HostClient } from "./rpc";
import type { BackupInfo } from "./rpcTypes";
import type { MockContext } from "./mockHost";

/** mock 备份文件名（固定时间戳，断言确定性） */
const MOCK_BACKUP_FILE = "pokemon-choose-you-20261011-080000.db";

/** 各导出 kind 的 mock 产物路径 */
const MOCK_EXPORT_PATHS = {
  json: "/mock/.choose-you/data/exports/pokemon-choose-you-full-20261011-080000.json",
  csv: "/mock/.choose-you/data/exports/pokemon-choose-you-tasks-20261011-080000.csv",
  report: "/mock/.choose-you/data/exports/pokemon-choose-you-daily-2026-10-11.md",
} as const;

export function backupCommands(ctx: MockContext): Pick<HostClient, "backupRun" | "backupList" | "exportRun"> {
  return {
    async backupRun() {
      ctx.record("backupRun");
      const entry: BackupInfo = { file: MOCK_BACKUP_FILE, size: 4096, createdAt: "2026-10-11T08:00:00+08:00" };
      // 重名幂等（同秒序号语义的简化：固定名只保留一份，置顶刷新）
      ctx.state.backups = [entry, ...ctx.state.backups.filter((b) => b.file !== entry.file)];
      return { ok: true, data: { file: entry.file, files: ctx.state.backups } };
    },
    async backupList() {
      ctx.record("backupList");
      return { ok: true, data: { backups: ctx.state.backups } };
    },
    async exportRun(params) {
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
    },
  };
}
