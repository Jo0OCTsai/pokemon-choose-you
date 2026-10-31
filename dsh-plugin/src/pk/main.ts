/**
 * pk 入口（对齐 bin/pk/main.rs 的分发序）：help/version 抢跑 → __ssh_entry/remote/doctor
 * 抢在 open_db 之前（不碰库或库缺失正是诊断对象）→ open_db → 命令表分发。
 * 输出信封：stdout 恒 pretty JSON（2 空格缩进），错误 {"error":...} 到 stderr，
 * 退出码 0/1/2（信封契约 contracts/cli_envelope 锁定与 Rust 实现一致）。
 */
import type { Conn } from "../host/storage/db";
import { initConn } from "../host/storage/init";
import { registerEmbeddedSchemas } from "../host/storage/migrate";
import embeddedSchemas from "../host/storage/schema-raw";
import { cliLog, fail, openDb, usageErr, CliError, flag, parseArgs, dbErr } from "./cli";
import { HELP, helpSchema, pkVersion } from "./help";
import { runLog, runNote, runTask } from "./task";
import { runCategory, runTag } from "./tag";
import { runSession } from "./session";
import { runDispatch } from "./dispatch";
import { runSuggest } from "./suggest";
import { runSkill } from "./skill";
import { runContext } from "./context";
import { runRemote, sshEntry } from "./remote";
import { doctorReport } from "./doctor";

// 契约 SQL 编译期内嵌注册（bundle 形态磁盘路径不可达；与 hostEntry 同款装配）
registerEmbeddedSchemas(embeddedSchemas);

export function main(): void {
  const args = process.argv.slice(2);
  // 应用拉起的 agent 场景下把执行轨迹写回应用日志文件（终端手工使用时静默跳过）
  cliLog("INFO", `pk ${args.join(" ")}`);
  if (helpRequested(args)) {
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(helpSchema(), null, 2) : HELP}\n`);
    return;
  }
  if (args.includes("version") || args.includes("--version") || args.includes("-V")) {
    process.stdout.write(`${pkVersion()}\n`);
    return;
  }
  if (preDbCommand(args)) {
    return;
  }
  let conn: Conn;
  try {
    conn = openDb(args[0] === "init-db");
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e), 1);
  }
  emitThrown(() => run(conn!, args));
}

function helpRequested(args: readonly string[]): boolean {
  return args.length === 0 || args.some((a) => a === "help" || a === "--help" || a === "-h");
}

/** 抢在 open_db 之前的命令（不碰库或库缺失正是诊断对象）；true = 已处理完毕 */
function preDbCommand(args: readonly string[]): boolean {
  // 本机 sshd forced command 入口（authorized_keys 的 restrict,command= 指到这里）：
  // 远程 shim 经隧道的回连统一落这里，只允许「执行本 pk 自身」，不碰库
  if (args[0] === "__ssh_entry") {
    sshEntry();
  }
  // remote 只生成脚本/编排 ssh 不碰库（避免无库时顺手建出空库文件）
  if (args[0] === "remote") {
    emitThrown(() => runRemote(args.slice(1)));
  }
  // doctor：库缺失/损坏正是它要诊断的内容
  if (args[0] === "doctor") {
    const p = parseArgs(args.slice(1));
    const ssh = flag(p, "ssh");
    const { report, code } = doctorReport(process.env.PK_DB, ssh !== undefined && ssh !== "" ? ssh : undefined);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(code);
  }
  return false;
}

/** 命令执行统一出口：正常值 pretty JSON + exit 0；CliError/域错误按信封转 stderr + 退出码 */
function emitThrown(fn: () => unknown): never {
  try {
    const result = fn();
    process.stdout.write(`${JSON.stringify(result ?? null, null, 2)}\n`);
    process.exit(0);
  } catch (e) {
    if (e instanceof CliError) fail(e.message, e.code);
    fail(dbErr(e).message, dbErr(e).code);
  }
}

/** 数据面命令表（对齐 bin/pk/main.rs run 的分发面；域错误 → CLI 错误统一出口） */
const COMMANDS: Record<string, (conn: Conn, rest: readonly string[]) => unknown> = {
  task: (c, r) => guard(() => runTask(c, r)),
  note: (c, r) => guard(() => runNote(c, r)),
  log: (c, r) => guard(() => runLog(c, r)),
  category: (c, r) => guard(() => runCategory(c, r)),
  categories: (c, r) => guard(() => runCategory(c, r)),
  tag: (c, r) => guard(() => runTag(c, r)),
  tags: (c, r) => guard(() => runTag(c, r)),
  session: (c, r) => guard(() => runSession(c, r)),
  dispatch: (c, r) => guard(() => runDispatch(c, r)),
  suggest: (c, r) => guard(() => runSuggest(c, r)),
  skill: (_c, r) => guard(() => runSkill(r)),
  context: (c) => guard(() => runContext(c)),
  "init-db": (c) => {
    // 显式引导（PK_DB 独立库场景）：建库 + 迁移 + 默认分类；对应用主库通常无需执行
    initConn(c);
    return { initialized: true };
  },
};

function run(conn: Conn, args: readonly string[]): unknown {
  const handler = COMMANDS[args[0]];
  if (handler === undefined) {
    throw usageErr(`未知命令「${args[0]}」，用法见 pk help`);
  }
  return handler(conn, args.slice(1));
}

/** 域错误 → CLI 错误（db_err 同构统一出口；CliError 透传） */
function guard(fn: () => unknown): unknown {
  try {
    return fn();
  } catch (e) {
    if (e instanceof CliError) throw e;
    throw dbErr(e);
  }
}

main();
