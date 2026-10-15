/**
 * 数据备份域（行为基准 = src-tauri/src/backup.rs）：`VACUUM INTO` 生成压缩快照（不含
 * WAL、可直接打开——与桌面产物完全一致），手动入口同样参与 backup_keep 滚动保留。
 * 导出域拆件 → export.ts（公共面在此再出口，消费面 import 不变）。恢复 / 导入 /
 * 每日自动备份调度不在本域（恢复需关库重开牵动 conn 生命周期、导入是整体替换语义、
 * 调度归桌面 Rust——dsh host 只做手动触发）。
 */
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Conn } from "../storage/db";
import { getSetting } from "./settings";
import { stampNow } from "./export";

// 导出域公共面再出口（backupCommands / 测试从本文件消费——拆件后 import 路径不变）
export { exportFullJson, exportTasksCsv, exportDailyReport, exportsDir, todayStr } from "./export";

/** 备份文件名前缀 / 后缀（与 backup.rs NAME_PREFIX/NAME_SUFFIX 一致；列表与滚动清理共用） */
const NAME_PREFIX = "pokemon-choose-you-";
const NAME_SUFFIX = ".db";

/** 备份目录：<dataDir>/backups（桌面 backup_dir 同路径——两形态共享同一份产物） */
export function backupDir(dataDir: string): string {
  return join(dataDir, "backups");
}

function isBackupName(name: string): boolean {
  return name.startsWith(NAME_PREFIX) && name.endsWith(NAME_SUFFIX);
}

/** 备份条目（与桌面 BackupInfo 同构；createdAt 取文件修改时间的本地时区 RFC3339） */
export interface BackupInfo {
  file: string;
  size: number;
  createdAt: string;
}

/** mtime → 本地时区 RFC3339（chrono DateTime<Local>::to_rfc3339 同形态） */
function rfc3339Local(ms: number): string {
  const d = new Date(ms);
  const offsetMin = -d.getTimezoneOffset();
  const p2 = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const sign = offsetMin >= 0 ? "+" : "-";
  const shifted = new Date(ms + offsetMin * 60_000);
  return `${shifted.toISOString().replace(/\.\d{3}Z$/, "")}${sign}${p2(Math.floor(offsetMin / 60))}:${p2(offsetMin % 60)}`;
}

function statSafe(path: string): { size: number; mtimeMs: number } | undefined {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

/**
 * 创建一份快照（VACUUM INTO：产物是压缩后的完整库，不含 WAL 垃圾——与桌面 create_backup
 * 同做法；相对「wal_checkpoint 后复制文件」能保证快照一致性且产物更小，且两形态产物同名
 * 同格式可互认）。同一秒内重复创建时追加序号避免覆盖。返回文件名。
 */
export function createBackup(dataDir: string, conn: Conn, now: Date = new Date()): string {
  const dir = backupDir(dataDir);
  mkdirSync(dir, { recursive: true });
  let name = `${NAME_PREFIX}${stampNow(now)}${NAME_SUFFIX}`;
  let n = 2;
  while (statSafe(join(dir, name)) !== undefined) {
    name = `${NAME_PREFIX}${stampNow(now)}-${n}${NAME_SUFFIX}`;
    n += 1;
  }
  conn.prepare("VACUUM INTO ?").run(join(dir, name));
  return name;
}

/** 备份列表（按文件名字典序倒序 = 时间倒序；目录不存在返回空列表） */
export function listBackups(dataDir: string): BackupInfo[] {
  const dir = backupDir(dataDir);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: BackupInfo[] = [];
  for (const name of names) {
    if (!isBackupName(name)) {
      continue;
    }
    const meta = statSafe(join(dir, name));
    if (meta === undefined) {
      continue;
    }
    out.push({ file: name, size: meta.size, createdAt: rfc3339Local(meta.mtimeMs) });
  }
  out.sort((a, b) => (a.file < b.file ? 1 : a.file > b.file ? -1 : 0));
  return out;
}

/** 滚动清理：只保留最新 keep 份，返回删除数（清理失败不中断——桌面同口径） */
export function pruneBackups(dataDir: string, keep: number): number {
  const list = listBackups(dataDir);
  let removed = 0;
  for (const old of list.slice(Math.max(1, keep))) {
    try {
      rmSync(join(backupDir(dataDir), old.file));
      removed += 1;
    } catch {
      // 单个文件清理失败跳过（锁竞争等瞬时原因）
    }
  }
  return removed;
}

/**
 * 立即备份（commands/backup.rs create_backup_now 同构）：读 backup_keep 共享设置
 * （缺省 7、至少 1）→ 快照 → 滚动保留。返回新文件名与保留列表。
 */
export function runBackupNow(
  dataDir: string,
  conn: Conn,
  now: Date = new Date(),
): { file: string; files: BackupInfo[] } {
  const keepRaw = Number.parseInt(getSetting(conn, "backup_keep") ?? "", 10);
  const keep = Math.max(Number.isNaN(keepRaw) ? 7 : keepRaw, 1);
  const file = createBackup(dataDir, conn, now);
  pruneBackups(dataDir, keep);
  return { file, files: listBackups(dataDir) };
}
