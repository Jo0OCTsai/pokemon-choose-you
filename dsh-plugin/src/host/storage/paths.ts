/**
 * 库定位（contracts/PROTOCOL.md §1 / 主应用 src-tauri/src/db.rs 同规则）：
 * `CHOOSE_YOU_HOME` 环境变量（非空时优先，空串视同未设）否则 `<home>/.choose-you`，
 * 库文件 `data/pokemon-choose-you.db`。
 */
import { homedir } from "node:os";
import { join } from "node:path";

/** 归一化根目录的环境变量覆盖键（GUI / pk / dsh 插件三端同一规则） */
export const HOME_ENV = "CHOOSE_YOU_HOME";

/** 归一化根目录名（用户主目录下）：纯容器，agent 工作区与应用数据各占子目录互不混放 */
export const DEFAULT_HOME_DIR = ".choose-you";

/** 应用数据子目录（db、backups、exports） */
export const DATA_SUBDIR = "data";

/** 共享日志子目录（主应用 Tauri 与 pk CLI 写 <appHome>/logs/*.log；db.rs LOG_SUBDIR 同名同规则） */
export const LOG_SUBDIR = "logs";

/** 数据库文件名（应用数据目录内） */
export const DB_FILE = "pokemon-choose-you.db";

/**
 * 归一化根目录解析（纯函数便于测试，与 db.rs app_home_from 同构）：
 * env 非空优先（空串视同未设）；否则 home/.choose-you；home 缺失返回 undefined。
 */
export function appHomeFrom(env: string | undefined, home: string | undefined): string | undefined {
  if (env !== undefined && env !== "") {
    return env;
  }
  return home === undefined ? undefined : join(home, DEFAULT_HOME_DIR);
}

/** 归一化根目录（默认取进程环境与系统 home；无法定位返回 undefined） */
export function appHome(env: string | undefined = process.env[HOME_ENV], home = homedir()): string | undefined {
  return appHomeFrom(env, home);
}

/** 应用数据目录：<appHome>/data */
export function dataDirFrom(env?: string, home?: string): string | undefined {
  const root = appHome(env, home);
  return root === undefined ? undefined : join(root, DATA_SUBDIR);
}

/** 共享库文件路径：<appHome>/data/pokemon-choose-you.db */
export function dbFileFrom(env?: string, home?: string): string | undefined {
  const dir = dataDirFrom(env, home);
  return dir === undefined ? undefined : join(dir, DB_FILE);
}

/** 共享日志目录：<appHome>/logs（主应用 list_log_entries 同数据源） */
export function logDirFrom(env?: string, home?: string): string | undefined {
  const root = appHome(env, home);
  return root === undefined ? undefined : join(root, LOG_SUBDIR);
}
