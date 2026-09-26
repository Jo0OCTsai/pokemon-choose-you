//! pk — 就决定是你了命令行工具。
//!
//! 供 AI agent CLI（claude code / opencode / pi …）与终端用户直接读写待办库：
//! - 全部输出为 UTF-8 JSON（stdout），错误输出 JSON 到 stderr 并以非零码退出；
//! - 与桌面应用共用同一套数据逻辑（conn 层函数），保证状态机不变量与操作日志一致；
//! - 通过 WAL 与运行中的应用并发读写，PK_DB 环境变量可覆盖数据库路径。
//!
//! 子模块：cli 基础设施 / task·note / tag / skill / session / dispatch / suggest /
//! remote（ssh shim）/ doctor / context；tests 为整合测试（经 run 分发器全链路）。
mod cli;
mod context;
mod dispatch;
mod doctor;
mod remote;
mod session;
mod skill;
mod suggest;
mod tag;
mod task;
#[cfg(test)]
mod tests;

use crate::cli::{cli_log, db_err, fail, open_db, parse_args, usage_err, CliError};
use crate::context::run_context;
use crate::dispatch::run_dispatch;
use crate::doctor::doctor_report;
use crate::remote::{run_remote, ssh_entry};
use crate::session::run_session;
use crate::skill::run_skill;
use crate::suggest::run_suggest;
use crate::tag::run_tag;
use crate::task::{run_note, run_task};
use pokemon_choose_you_lib::commands::{categories, tasks};
use rusqlite::Connection;
use serde_json::json;

const HELP: &str = r#"pk — 就决定是你了命令行（供 AI agent 与终端使用）

用法:
  pk <命令> [参数]...

命令:
  task list [open|done|today|all]    任务列表（默认 open：未完成待办；--limit N|all 默认 50，超出截断并提示用 search）
  task get <id>                      任务详情（含跟进记录）
  task search <关键词>                搜索标题/备注/跟进记录/标签
  task create --title <t> [--note <n>] [--category <分类名>] [--priority low|normal|high|urgent]
                [--due <YYYY-MM-DDTHH:MM>] [--scheduled] [--tags <a,b>] [--dry-run]
                （--dry-run 只校验并回显将创建的内容，不落库）
  task update <id> [--title <t>] [--note <n>] [--category <分类名>] [--priority <p>]
                [--due <时间>] [--remind <时间>] [--status <状态>] [--tags <a,b>] [--dry-run]
                （--due/--remind 传空串 "" 表示清空；--dry-run 只校验并回显变更，不落库）
  task done <id>                     完成任务
  task start <id>                    开始任务（全局唯一进行中）
  task pause                         暂停当前进行中的任务
  task current                       查看当前进行中的任务
  task delete <id> [--dry-run]       删除任务（--dry-run 只确认存在性，不删除）
  note add <task-id> <内容...> [--source manual|ai]
  note list <task-id>
  log <task-id>                      任务操作历史
  session log [--task <id>] --agent <id> [--session <sid>] [--command <c>] [--exit-code <n>]
                [--status ok|error] [--duration-ms <n>] [--cost <美元>] [--in-tokens <n>] [--out-tokens <n>]
                                      记录一次 agent 会话（成本/时长/退出码，可关联任务）
  session list [--task <id>]         会话列表（--task 查该任务的时间线）
  dispatch start|done|fail --task <id> [--note <一句话>]
                                      回传待办派发状态（done/fail 从 running 迁移；start 领取开工、幂等）；
                                      --task 缺省读应用派发注入的 PK_DISPATCH_TASK 环境变量，
                                      两者皆空时静默跳过（普通会话的 Stop hook 不产生噪音）
  suggest todo|update|follow-up|none --message <消息id> [--task <待办id>] [--title <t>] [--note <n>]
                [--category <分类名>] [--priority low|normal|high|urgent] [--due <YYYY-MM-DDTHH:MM>]
                [--tags <a,b>] [--reason <一句话>] [--confidence high|medium|low] [--agent <agent-id>]
                                      提交一条 AI 判定建议（todo/update 写建议列待用户确认；follow-up 直接挂跟进）
  suggest batch [--agent <agent-id>]
                                      批量提交建议：stdin 传 {"results":[...]}（与应用文本协议同构），整批校验失败则全部不落库
  skill install <claude-code|opencode|pi> [--dir <目录>]
                                      一键安装 pk 使用技能到 agent 的技能目录（对标 td skill install）
  skill show                         打印技能内容（Markdown 原文，可重定向给任意 agent）
  remote shim --host <本机地址> [--port <n>] [--key <私钥>] [--write <路径>]
                                      生成远程主机上的 pk 透传脚本（agent 在远程、数据在本机时，命令经 ssh 回本机执行）
  category list                      分类列表
  tag list                           标签列表（含维度 dimensions 与标签归属维度）
  tag create <名字> [--dimension <维度key>] [--description <描述>]
                                      新建标签（缺省 topic 维度；维度 key 见 tag list）
  context                            AI 处理上下文（当前时间/未完成待办/分类/标签与维度）
  doctor [--ssh <user@host>]         环境自检：数据库/schema/完整性/技能安装（每项带修复建议）；
                                      --ssh 加测远程 pk 可达性（agent 在远程时排查 shim 部署）
  init-db                            初始化 PK_DB 指定的空库（应用主库通常无需执行）
  help [--json]                      本帮助；--json 输出机器可读的命令目录（供 agent 编程化发现）

示例:
  pk task list open
  pk task get 3
  pk task create --title "交周报" --due "2026-09-13T18:00" --tags 重要,需汇报
  pk task update 3 --priority high --due ""
  pk note add 3 对方确认周五交付 --source ai
  pk session log --task 3 --agent claude-code --session abc123 --cost 0.12 --duration-ms 61000
  pk session list --task 3
  pk dispatch done --task 3 --note 修复完成并补了回归用例   # 被派发处理待办后回传状态
  pk suggest todo --message om_1 --title 交周报 --due 2026-09-13T18:00 --reason 对方明确要求
  echo '{"results":[{"messageId":"om_1","action":"todo","title":"交周报"}]}' | pk suggest batch --agent claude-code
  pk skill install claude-code

输出: JSON（stdout）。错误: {"error": "..."}（stderr），退出码 1（业务）/ 2（用法）。
环境变量: PK_DB 覆盖数据库路径（默认 ~/.choose-you/data/pokemon-choose-you.db，CHOOSE_YOU_HOME 可重定位归一化根）。"#;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // 应用拉起的 agent 场景下把执行轨迹写回应用日志文件（PK_LOG_FILE 由应用注入、
    // 经 agent 的 Bash 工具继承到这里；终端手工使用时无此变量，静默跳过）
    cli_log("INFO", &format!("pk {}", args.join(" ")));
    if args.is_empty()
        || args
            .iter()
            .any(|a| a == "help" || a == "--help" || a == "-h")
    {
        // help --json：机器可读的命令目录（供 agent 编程化发现命令面）
        if args.iter().any(|a| a == "--json") {
            println!("{}", help_schema());
        } else {
            println!("{HELP}");
        }
        return;
    }
    if args
        .iter()
        .any(|a| a == "version" || a == "--version" || a == "-V")
    {
        println!("{}", env!("CARGO_PKG_VERSION"));
        return;
    }

    let init_db = args.first().map(String::as_str) == Some("init-db");
    // 本机 sshd forced command 入口（authorized_keys 的 restrict,command= 指到这里）：
    // 远程 shim 经隧道的回连统一落这里，只允许「执行本 pk 自身」，不碰库
    if args.first().map(String::as_str) == Some("__ssh_entry") {
        ssh_entry();
    }
    // remote 只生成脚本不碰库，抢在 open_db 之前处理（避免无库时顺手建出空库文件）
    if args.first().map(String::as_str) == Some("remote") {
        match run_remote(&args[1..]) {
            Ok(v) => {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&v)
                        .unwrap_or_else(|e| format!("{{\"error\": \"{e}\"}}"))
                );
                return;
            }
            Err(e) => fail(&e.0, e.1),
        }
    }
    // doctor 同样抢在 open_db 之前：库缺失/损坏正是它要诊断的内容，不能还没开诊就退出
    if args.first().map(String::as_str) == Some("doctor") {
        let p = parse_args(&args[1..]);
        let ssh = p.flag("ssh").filter(|s| !s.is_empty()).map(String::from);
        let db_override = std::env::var_os("PK_DB").map(std::path::PathBuf::from);
        let (report, code) = doctor_report(db_override.as_deref(), ssh.as_deref());
        println!(
            "{}",
            serde_json::to_string_pretty(&report)
                .unwrap_or_else(|e| format!("{{\"error\": \"{e}\"}}"))
        );
        std::process::exit(code);
    }
    let mut conn = match open_db(init_db) {
        Ok(c) => c,
        Err(e) => fail(&e, 1),
    };
    match run(&mut conn, &args) {
        Ok(v) => println!(
            "{}",
            serde_json::to_string_pretty(&v).unwrap_or_else(|e| format!("{{\"error\": \"{e}\"}}"))
        ),
        Err(e) => fail(&e.0, e.1),
    }
}

/// 入口分发：返回将打印到 stdout 的 JSON（&mut 供 start 的事务使用）
fn run(conn: &mut Connection, args: &[String]) -> Result<serde_json::Value, CliError> {
    let cmd = args[0].as_str();
    let rest = &args[1..];
    match cmd {
        "task" => run_task(conn, rest),
        "note" => run_note(conn, rest),
        "log" => {
            let p = parse_args(rest);
            let id: i64 = p
                .positional(0, "任务 id")?
                .parse()
                .map_err(|_| usage_err("任务 id 必须是数字"))?;
            let logs = tasks::list_task_logs_conn(conn, id).map_err(db_err)?;
            Ok(json!({ "logs": logs }))
        }
        "category" | "categories" => {
            if rest.first().map(String::as_str) != Some("list") && !rest.is_empty() {
                return Err(usage_err("category 子命令目前只支持 list"));
            }
            Ok(json!({ "categories": categories::list_categories_conn(conn).map_err(db_err)? }))
        }
        "tag" | "tags" => run_tag(conn, rest),
        "session" => run_session(conn, rest),
        "dispatch" => run_dispatch(conn, rest),
        "suggest" => run_suggest(conn, rest),
        "skill" => run_skill(rest),
        "context" => run_context(conn),
        "init-db" => {
            // 显式引导（PK_DB 独立库场景）：建库 + 迁移 + 默认分类；对应用主库通常无需执行
            pokemon_choose_you_lib::db::init_conn(conn).map_err(|e| CliError(e.to_string(), 1))?;
            Ok(json!({ "initialized": true }))
        }
        _ => Err(usage_err(&format!("未知命令「{cmd}」，用法见 pk help"))),
    }
}

/// help --json 的数据源：命令目录（与 HELP 文本各司其职——前者给 agent 编程化发现，后者给人读）
const COMMAND_INDEX: &[(&str, &str)] = &[
    (
        "task list",
        "任务列表（open|done|today|all；--limit N|all 默认 50，超出截断并提示用 search）",
    ),
    ("task get <id>", "任务详情（含跟进记录）"),
    ("task search <关键词>", "搜标题/备注/跟进/标签"),
    (
        "task create",
        "建任务（--title 必填；--dry-run 只校验回显不落库）",
    ),
    (
        "task update <id>",
        "更新字段（--due \"\" 清空；--dry-run 只校验回显）",
    ),
    ("task done <id>", "完成任务"),
    ("task start <id>", "开始任务（全局唯一进行中）"),
    ("task pause", "暂停当前进行中任务"),
    ("task current", "当前进行中任务"),
    ("task delete <id>", "删除任务（--dry-run 只确认存在性）"),
    (
        "note add <task-id> <内容...>",
        "记跟进（--source manual|ai）",
    ),
    ("note list <task-id>", "跟进列表"),
    ("log <task-id>", "任务操作历史"),
    (
        "suggest todo|update|follow-up|none",
        "提交单条 AI 判定建议（--message 必填；写建议列待用户确认）",
    ),
    (
        "suggest batch",
        "批量提交建议（stdin 传 {\"results\":[...]}，整批校验一损俱损）",
    ),
    (
        "session log",
        "记录 agent 会话（--agent 必填；成本/时长/退出码）",
    ),
    ("session list", "会话列表（--task 查任务时间线）"),
    (
        "dispatch done",
        "回传派发状态（done/fail 从 running 迁移，--note 带摘要；start 领取开工；--task 缺省读 PK_DISPATCH_TASK）",
    ),
    (
        "skill install <agent>",
        "安装技能（claude-code|opencode|pi，或 --dir 指定）",
    ),
    ("skill show", "打印技能全文"),
    ("remote shim", "生成远程 pk 透传脚本（--host 必填）"),
    ("category list", "分类列表"),
    ("tag list", "标签列表（含维度）"),
    ("tag create", "新建标签（--dimension 指定维度，缺省 topic）"),
    (
        "context",
        "当前时间 + 未完成待办 + 分类 + 标签与维度（判定与建任务的判重上下文）",
    ),
    (
        "doctor",
        "环境自检（数据库/schema/技能安装，每项带修复建议；--ssh <host> 加测远程 pk）",
    ),
    ("init-db", "初始化 PK_DB 指定的空库"),
    ("help --json", "机器可读命令目录（本命令）"),
];

fn help_schema() -> String {
    let v = json!({
        "name": "pk",
        "version": env!("CARGO_PKG_VERSION"),
        "description": "就决定是你了待办库命令行（供 AI agent 与终端使用）",
        "output": "stdout 恒为 JSON；错误输出 {\"error\":...} 到 stderr",
        "exitCodes": { "0": "成功", "1": "业务错误", "2": "用法错误" },
        "env": { "PK_DB": "覆盖数据库路径（默认为应用数据目录 pokemon-choose-you.db）" },
        "commands": COMMAND_INDEX
            .iter()
            .map(|(c, s)| json!({ "command": c, "summary": s }))
            .collect::<Vec<_>>(),
    });
    serde_json::to_string_pretty(&v).unwrap_or_else(|_| "{}".into())
}
