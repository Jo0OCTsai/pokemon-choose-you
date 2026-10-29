/**
 * pk 入口（对齐 bin/pk/main.rs 的分发序）：help/version 抢跑 → __ssh_entry/remote/doctor
 * 抢在 open_db 之前（不碰库或库缺失正是诊断对象）→ open_db → run 分发。
 * 输出信封：stdout 恒 pretty JSON（2 空格缩进），错误 {"error":...} 到 stderr，
 * 退出码 0/1/2（信封契约 contracts/cli_envelope 锁定与 Rust 实现一致）。
 */
import type { Conn } from "../host/storage/db";
import { initConn } from "../host/storage/init";
import { registerEmbeddedSchemas } from "../host/storage/migrate";
import embeddedSchemas from "../host/storage/schema-raw";
import { cliLog, fail, openDb, usageErr, CliError, flag, parseArgs, dbErr } from "./cli";
import { HELP, helpSchema, pkVersion } from "./help";
import { runTask, runNote } from "./task";
import { runCategory, runTag } from "./tag";
import { runSession } from "./session";
import { runDispatch } from "./dispatch";
import { runSuggest } from "./suggest";
import { runSkill } from "./skill";
import { runContext } from "./context";
import { runRemote, sshEntry } from "./remote";
import { doctorReport } from "./doctor";
import { listTaskLogs } from "../host/domain/tasks";

// 契约 SQL 编译期内嵌注册（bundle 形态磁盘路径不可达；与 hostEntry 同款装配）
registerEmbeddedSchemas(embeddedSchemas);

export function main(): void {
  const args = process.argv.slice(2);
  // 应用拉起的 agent 场景下把执行轨迹写回应用日志文件（终端手工使用时静默跳过）
  cliLog("INFO", `pk ${args.join(" ")}`);
  if (args.length === 0 || args.some((a) => a === "help" || a === "--help" || a === "-h")) {
    if (args.some((a) => a === "--json")) {
      process.stdout.write(`${JSON.stringify(helpSchema(), null, 2)}\n`);
    } else {
      process.stdout.write(`${HELP}\n`);
    }
    return;
  }
  if (args.some((a) => a === "version" || a === "--version" || a === "-V")) {
    process.stdout.write(`${pkVersion()}\n`);
    return;
  }

  const initDb = args[0] === "init-db";
  // 本机 sshd forced command 入口（authorized_keys 的 restrict,command= 指到这里）：
  // 远程 shim 经隧道的回连统一落这里，只允许「执行本 pk 自身」，不碰库
  if (args[0] === "__ssh_entry") {
    sshEntry();
  }
  // remote 只生成脚本/编排 ssh 不碰库，抢在 open_db 之前处理（避免无库时顺手建出空库文件）
  if (args[0] === "remote") {
    emitThrown(() => runRemote(args.slice(1)));
  }
  // doctor 同样抢在 open_db 之前：库缺失/损坏正是它要诊断的内容
  if (args[0] === "doctor") {
    const p = parseArgs(args.slice(1));
    const ssh = flag(p, "ssh");
    const { report, code } = doctorReport(process.env.PK_DB, ssh !== undefined && ssh !== "" ? ssh : undefined);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(code);
  }
  let conn: Conn;
  try {
    conn = openDb(initDb);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e), 1);
  }
  emitThrown(() => run(conn!, args));
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

/** 入口分发：返回将打印到 stdout 的 JSON（对齐 bin/pk/main.rs 的 run） */
function run(conn: Conn, args: readonly string[]): unknown {
  const cmd = args[0];
  const rest = args.slice(1);
  switch (cmd) {
    case "task":
      return guard(() => runTask(conn, rest));
    case "note":
      return guard(() => runNote(conn, rest));
    case "log": {
      return guard(() => {
        const p = parseArgs(rest);
        const raw = p.positionals[0];
        if (raw === undefined) throw usageErr("缺少任务 id，用法见 pk help");
        const id = Number(raw);
        if (!Number.isInteger(id)) throw usageErr("任务 id 必须是数字");
        return { logs: listTaskLogs(conn, id) };
      });
    }
    case "category":
    case "categories":
      return guard(() => runCategory(conn, rest));
    case "tag":
    case "tags":
      return guard(() => runTag(conn, rest));
    case "session":
      return guard(() => runSession(conn, rest));
    case "dispatch":
      return guard(() => runDispatch(conn, rest));
    case "suggest":
      return guard(() => runSuggest(conn, rest));
    case "skill":
      return guard(() => runSkill(rest));
    case "context":
      return guard(() => runContext(conn));
    case "init-db":
      // 显式引导（PK_DB 独立库场景）：建库 + 迁移 + 默认分类；对应用主库通常无需执行
      initConn(conn);
      return { initialized: true };
    default:
      throw usageErr(`未知命令「${cmd}」，用法见 pk help`);
  }
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
