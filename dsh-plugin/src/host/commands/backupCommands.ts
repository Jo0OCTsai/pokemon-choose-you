/**
 * host 命令 · 备份/导出域：backupRun（立即快照 + 滚动保留）/ backupList（时间倒序）/
 * exportRun（全量 JSON / 任务 CSV / 今日日报）。行为基准 = src-tauri/src/commands/backup.rs
 * 与 export.rs 的默认目录路径（不含另存为 dest——dsh 客户端无系统保存对话框）。
 * 数据目录经 storage/paths 归一化解析（CHOOSE_YOU_HOME / ~/.choose-you，与桌面共享
 * 同一 backups/、exports/ 产物目录）。恢复 / 导入不在本命令面（conn 生命周期与整体替换
 * 语义牵动大，见降级项）。
 */
import type { CommandTable } from "./context";
import { paramError } from "../storage/errors";
import { dataDirFrom } from "../storage/paths";
import {
  exportDailyReport,
  exportFullJson,
  exportTasksCsv,
  listBackups,
  runBackupNow,
  todayStr,
} from "../domain/backup";

/** 导出种类（exportRun kind 参数面） */
export type ExportKind = "json" | "csv" | "report";

/** 备份/导出命令表（3 条） */
export function backupCommands(): CommandTable {
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

/** 归一化数据目录（无法定位 = 环境缺陷，非业务错误——上抛不吞） */
function dataDir(): string {
  const dir = dataDirFrom();
  if (dir === undefined) {
    throw new Error("[dsh-plugin] 无法定位应用数据目录：CHOOSE_YOU_HOME 与 home 均不可用");
  }
  return dir;
}
