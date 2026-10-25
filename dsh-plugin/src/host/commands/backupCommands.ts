/**
 * host 命令 · 备份/导出域（full-parity AD §4.1 扩展为 7 条）：backupRun（立即快照 +
 * 滚动保留）/ backupList（时间倒序）/ exportRun（全量 JSON / 任务 CSV / 今日日报）+
 * importValidate（只读预检）/ importRun（前置备份 + 整体替换）/ restoreRun（前置备份 +
 * 逐表灌回 + 补迁移补种）/ exportDirOpen（helper 文件管理器定位 exports/）。
 * 行为基准 = src-tauri/src/commands/backup.rs 与 export.rs 的默认目录路径；导入/恢复
 * domain 见 backup-import.ts / backup-restore.ts（PkyError code 已入 PROTOCOL §2 21 枚）。
 * 数据目录经 storage/paths 归一化解析（CHOOSE_YOU_HOME / ~/.choose-you，与桌面共享
 * 同一 backups/、exports/ 产物目录）。
 */
import { mkdirSync } from "node:fs";
import type { CommandTable } from "./context";
import { paramError, PkyError } from "../storage/errors";
import { dataDirFrom } from "../storage/paths";
import {
  exportDailyReport,
  exportFullJson,
  exportTasksCsv,
  exportsDir,
  listBackups,
  runBackupNow,
  todayStr,
} from "../domain/backup";
import { runImport, validateImport } from "../domain/backup-import";
import { runRestore, type RestoreSource } from "../domain/backup-restore";

/** 导出种类（exportRun kind 参数面） */
export type ExportKind = "json" | "csv" | "report";

/** 备份/导出段（手动快照 + 滚动保留 + 三种导出） */
function backupCommandSet(): CommandTable {
  return {
    // 立即备份：VACUUM INTO 快照 + backup_keep 滚动保留，返回新文件名与保留列表
    backupRun: (_p, deps) => runBackupNow(dataDir(), deps.conn),
    backupList: () => ({ backups: listBackups(dataDir()) }),
    exportRun: (p, deps) => {
      const kind = (p as { kind?: unknown }).kind;
      const dir = dataDir();
      switch (kind) {
        case "json":
          return { path: exportFullJson(dir, deps.conn) };
        case "csv":
          return { path: exportTasksCsv(dir, deps.conn) };
        case "report":
          return { path: exportDailyReport(dir, deps.conn, todayStr(new Date())) };
        default:
          throw paramError(`未知导出类型 ${String(kind)}`, "kind 须为 json / csv / report");
      }
    },
  };
}

/** 导入/恢复/导出目录段（FR-A5/A6 · D25 前置备份） */
function importRestoreCommandSet(): CommandTable {
  return {
    // 导入只读预检（结构 + 摘要；0 行变更不产生备份）
    importValidate: (p, deps) => {
      const path = requirePath(p);
      return { summary: validateImport(deps.conn, path) };
    },
    // 导入执行（confirmed 显式位；前置备份失败即中止 BACKUP_FAILED——D25）
    importRun: (p, deps) => {
      const args = p as { path?: unknown; confirmed?: unknown };
      const path = requirePath(p);
      if (args.confirmed !== true) {
        throw paramError("导入须显式确认（confirmed: true）——整体替换不可静默执行");
      }
      const result = runImport(dataDir(), deps.conn, path);
      deps.onWrites();
      return { result };
    },
    // 恢复执行（backupId / path 择一；超窗 DB_SCHEMA_TOO_NEW；恢复后补写当日备份标记）
    restoreRun: (p, deps) => {
      const args = p as { source?: RestoreSource; confirmed?: unknown };
      if (args.confirmed !== true) {
        throw paramError("恢复须显式确认（confirmed: true）——整体替换不可静默执行");
      }
      const result = runRestore(dataDir(), deps.conn, args.source ?? {});
      deps.onWrites();
      return { result };
    },
    // 打开导出目录：helper 在位经桥 open-path；缺席/能力缺位 HELPER_CAPABILITY_MISSING + hint 给路径
    exportDirOpen: (_p, deps) => {
      const dir = exportsDir(dataDir());
      mkdirSync(dir, { recursive: true }); // 不存在先建再下发（AD §4.1）
      const bridge = deps.petBridge?.() ?? null;
      if (bridge === null || bridge.hello === null) {
        throw helperMissingWithHint(dir, "helper 未运行，无法打开导出目录");
      }
      if (!bridge.sys.sendOpenPath(dir)) {
        throw helperMissingWithHint(dir, "helper 文件管理器能力不可用（能力位缺位或通道不通）");
      }
      return { ok: true, path: dir };
    },
  };
}

/** HELPER_CAPABILITY_MISSING + hint 路径（exportDirOpen 两分支共用） */
function helperMissingWithHint(dir: string, message: string): PkyError {
  return new PkyError("HELPER_CAPABILITY_MISSING", message, `导出目录路径（可手动打开）：${dir}`);
}

/** 备份/导出命令表（7 条） */
export function backupCommands(): CommandTable {
  return { ...backupCommandSet(), ...importRestoreCommandSet() };
}

/** 导入文件路径入参校验（importValidate/importRun 共用） */
function requirePath(p: unknown): string {
  const path = (p as { path?: unknown }).path;
  if (typeof path !== "string" || path.trim() === "") {
    throw paramError("缺少导入文件路径（path）");
  }
  return path;
}

/** 归一化数据目录（无法定位 = 环境缺陷，非业务错误——上抛不吞） */
function dataDir(): string {
  const dir = dataDirFrom();
  if (dir === undefined) {
    throw new Error("[dsh-plugin] 无法定位应用数据目录：CHOOSE_YOU_HOME 与 home 均不可用");
  }
  return dir;
}
