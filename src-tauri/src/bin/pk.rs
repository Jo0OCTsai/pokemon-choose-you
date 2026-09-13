//! pk — 就决定是你了命令行工具。
//!
//! 供 AI agent CLI（claude code / opencode / kiro …）与终端用户直接读写待办库：
//! - 全部输出为 UTF-8 JSON（stdout），错误输出 JSON 到 stderr 并以非零码退出；
//! - 与桌面应用共用同一套数据逻辑（conn 层函数），保证状态机不变量与操作日志一致；
//! - 通过 WAL 与运行中的应用并发读写，PK_DB 环境变量可覆盖数据库路径。

/// 随包分发的 agent 技能模板（教 agent 用 pk 管待办）
const SKILL_MD: &str = include_str!("../../skills/pokemon-choose-you.md");
/// 技能引用文件（渐进披露）：主文件保持精简，参数细节与批处理协议按需再读
const SKILL_REFS: &[(&str, &str)] = &[
    (
        "references/commands.md",
        include_str!("../../skills/references/commands.md"),
    ),
    (
        "references/suggest-workflow.md",
        include_str!("../../skills/references/suggest-workflow.md"),
    ),
];
/// 当前技能版本（与 SKILL.md frontmatter 的 version 保持一致，用于安装时的版本对比）
const SKILL_VERSION: &str = "2";

use pokemon_choose_you_lib::ai::AiSuggestion;
use pokemon_choose_you_lib::commands::radio::apply_suggestion_conn;
use pokemon_choose_you_lib::commands::sessions::{
    list_agent_sessions_conn, log_session_conn, NewAgentSession,
};
use pokemon_choose_you_lib::commands::{categories, tags, tasks};
use rusqlite::{params, Connection};
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
  suggest todo|update|follow-up|none --message <消息id> [--task <待办id>] [--title <t>] [--note <n>]
                [--category <分类名>] [--priority low|normal|high|urgent] [--due <YYYY-MM-DDTHH:MM>]
                [--tags <a,b>] [--reason <一句话>] [--confidence high|medium|low] [--agent <agent-id>]
                                      提交一条 AI 判定建议（todo/update 写建议列待用户确认；follow-up 直接挂跟进）
  suggest batch [--agent <agent-id>]
                                      批量提交建议：stdin 传 {"results":[...]}（与应用文本协议同构），整批校验失败则全部不落库
  skill install <claude-code|opencode> [--dir <目录>]
                                      一键安装 pk 使用技能到 agent 的技能目录（对标 td skill install）
  skill show                         打印技能内容（Markdown 原文，可重定向给任意 agent）
  remote shim --host <本机地址> [--port <n>] [--key <私钥>] [--write <路径>]
                                      生成远程主机上的 pk 透传脚本（agent 在远程、数据在本机时，命令经 ssh 回本机执行）
  category list                      分类列表
  tag list                           标签列表
  context                            AI 处理上下文（当前时间/未完成待办/分类/标签）
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
  pk suggest todo --message om_1 --title 交周报 --due 2026-09-13T18:00 --reason 对方明确要求
  echo '{"results":[{"messageId":"om_1","action":"todo","title":"交周报"}]}' | pk suggest batch --agent claude-code
  pk skill install claude-code

输出: JSON（stdout）。错误: {"error": "..."}（stderr），退出码 1（业务）/ 2（用法）。
环境变量: PK_DB 覆盖数据库路径（默认为应用数据目录 pokemon-choose-you.db）。"#;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
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

#[derive(Debug)]
struct CliError(String, i32);

impl From<String> for CliError {
    fn from(msg: String) -> Self {
        CliError(msg, 1)
    }
}

fn fail(msg: &str, code: i32) -> ! {
    eprintln!("{}", json!({ "error": msg }));
    std::process::exit(code);
}

/// 与 tauri 的 app_data_dir 同一规则：config_dir/<identifier>/<db>
fn default_db_path() -> Result<std::path::PathBuf, String> {
    let cfg = dirs::config_dir().ok_or_else(|| "无法定位用户配置目录".to_string())?;
    Ok(cfg
        .join("com.jotsai.pokemonchooseyou")
        .join("pokemon-choose-you.db"))
}

/// 打开应用数据库：平时不做迁移（应用可能比 CLI 旧，抢跑迁移会让应用拒绝启动）；
/// 设置 busy_timeout，与运行中的应用并发读写时等待而非立刻报 BUSY。
/// tolerate_missing 供 init-db 引导独立库。
fn open_db(tolerate_missing: bool) -> Result<Connection, String> {
    let path = match std::env::var_os("PK_DB") {
        Some(p) => std::path::PathBuf::from(p),
        None => default_db_path()?,
    };
    if !path.exists() && !tolerate_missing {
        return Err(format!(
            "数据库不存在：{}。请先启动一次应用（或运行 pk init-db），也可用 PK_DB 环境变量指定路径",
            path.display()
        ));
    }
    let conn = Connection::open(&path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;")
        .map_err(|e| format!("初始化数据库失败: {e}"))?;
    Ok(conn)
}

/// 已解析的命令行：位置参数 + 旗标（--key [value]，value 缺省为空串表示布尔旗标）
struct Parsed {
    positionals: Vec<String>,
    flags: Vec<(String, String)>,
}

fn parse_args(args: &[String]) -> Parsed {
    let mut positionals = vec![];
    let mut flags = vec![];
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if let Some(key) = a.strip_prefix("--") {
            let value = match args.get(i + 1) {
                // 后随参数不以 -- 开头（含空串）就当作本旗标的值
                Some(v) if !v.starts_with("--") => {
                    i += 1;
                    v.clone()
                }
                _ => String::new(),
            };
            flags.push((key.to_string(), value));
        } else {
            positionals.push(a.clone());
        }
        i += 1;
    }
    Parsed { positionals, flags }
}

impl Parsed {
    fn flag(&self, key: &str) -> Option<&str> {
        self.flags
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }
    fn positional(&self, i: usize, what: &str) -> Result<String, CliError> {
        self.positionals
            .get(i)
            .cloned()
            .ok_or_else(|| CliError(format!("缺少{what}，用法见 pk help"), 2))
    }
}

fn usage_err(msg: &str) -> CliError {
    CliError(msg.to_string(), 2)
}

fn db_err(e: pokemon_choose_you_lib::error::AppError) -> CliError {
    CliError(e.to_string(), 1)
}

/// rusqlite 裸错误（context 里的手写 SQL）→ CliError
fn sq_err(e: rusqlite::Error) -> CliError {
    CliError(format!("数据库错误: {e}"), 1)
}

const VALID_STATUS: &[&str] = &[
    "inbox",
    "scheduled",
    "active",
    "paused",
    "done",
    "cancelled",
];
const VALID_PRIORITY: &[&str] = &["low", "normal", "high", "urgent"];

fn validate_choice(value: &str, allowed: &[&str], what: &str) -> Result<(), CliError> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(CliError(
            format!("{what}「{value}」无效，可选：{}", allowed.join("/")),
            2,
        ))
    }
}

/// 标签名 → id 列表；未知标签报错（agent 可先 `pk tag list` 查看可用标签）
fn resolve_tag_ids(conn: &Connection, spec: &str) -> Result<Vec<i64>, CliError> {
    let names: Vec<String> = spec
        .split([',', '，'])
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect();
    if names.is_empty() {
        return Ok(vec![]);
    }
    let all = tags::list_tags_conn(conn).map_err(db_err)?;
    let mut ids = vec![];
    let mut unknown = vec![];
    for name in &names {
        match all.iter().find(|t| &t.name == name) {
            Some(t) => ids.push(t.id),
            None => unknown.push(name.clone()),
        }
    }
    if !unknown.is_empty() {
        return Err(CliError(
            format!("未知标签：{}。可用标签见 pk tag list", unknown.join("、")),
            1,
        ));
    }
    Ok(ids)
}

/// 分类名 → id（只认启用中的分类；未知报错）
fn resolve_category(conn: &Connection, name: &str) -> Result<i64, CliError> {
    let hit: Option<i64> = conn
        .query_row(
            "SELECT id FROM categories WHERE name=?1 AND enabled=1",
            params![name],
            |r| r.get(0),
        )
        .ok();
    hit.ok_or_else(|| {
        CliError(
            format!("未找到启用中的分类「{name}」。可用分类见 pk category list"),
            1,
        )
    })
}

/// 三态时间值：空串 → JSON null（清空），非空 → 字符串（设置）
fn time_value(v: &str) -> serde_json::Value {
    if v.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::Value::String(v.to_string())
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
        "tag" | "tags" => {
            if rest.first().map(String::as_str) != Some("list") && !rest.is_empty() {
                return Err(usage_err("tag 子命令目前只支持 list"));
            }
            Ok(json!({ "tags": tags::list_tags_conn(conn).map_err(db_err)? }))
        }
        "session" => run_session(conn, rest),
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

fn run_task(conn: &mut Connection, rest: &[String]) -> Result<serde_json::Value, CliError> {
    let sub = rest
        .first()
        .map(String::as_str)
        .ok_or_else(|| usage_err("缺少 task 子命令，用法见 pk help"))?;
    let rest = &rest[1..];
    let p = parse_args(rest);
    let id_of = |p: &Parsed| -> Result<i64, CliError> {
        p.positional(0, "任务 id")?
            .parse()
            .map_err(|_| usage_err("任务 id 必须是数字"))
    };
    match sub {
        "list" => {
            let filter = p.positionals.first().map(String::as_str).unwrap_or("open");
            let mut list = tasks::list_tasks_conn(conn, filter).map_err(db_err)?;
            // 默认截断到 50 条：防大库全量 JSON 刷爆 agent 上下文（Anthropic 工具设计建议的 token 瘦身）
            let total = list.len();
            let limit = parse_limit(&p)?;
            let truncated = limit.is_some_and(|n| total > n);
            if let Some(n) = limit {
                list.truncate(n);
            }
            Ok(json!({
                "filter": filter,
                "count": list.len(),
                "total": total,
                "truncated": truncated,
                "hint": if truncated {
                    Some("结果已截断：用 task search <关键词> 收窄，或 --limit all 看全量")
                } else {
                    None
                },
                "tasks": list,
            }))
        }
        "get" => {
            let id = id_of(&p)?;
            let task = tasks::get_task_conn(conn, id).map_err(db_err)?;
            let notes = tasks::list_task_notes_conn(conn, id).map_err(db_err)?;
            Ok(json!({ "task": task, "notes": notes }))
        }
        "search" => {
            let q = p.positional(0, "搜索关键词")?;
            let list = tasks::search_tasks_conn(conn, &q).map_err(db_err)?;
            Ok(json!({ "query": q, "count": list.len(), "tasks": list }))
        }
        "create" => {
            let title = p
                .flag("title")
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| usage_err("task create 需要 --title"))?;
            let priority = match p.flag("priority") {
                Some(v) if !v.is_empty() => {
                    validate_choice(v, VALID_PRIORITY, "优先级")?;
                    v
                }
                _ => "normal",
            };
            let due = p.flag("due").filter(|s| !s.is_empty()).map(String::from);
            if let Some(d) = &due {
                validate_due(d)?;
            }
            let category_id = match p.flag("category") {
                Some(c) if !c.is_empty() => Some(resolve_category(conn, c)?),
                _ => None,
            };
            let tag_ids = match p.flag("tags") {
                Some(t) if !t.is_empty() => Some(resolve_tag_ids(conn, t)?),
                _ => None,
            };
            // 有截止时间即视为排期（scheduled），与收音机建待办的规则一致
            let scheduled = p.flag("scheduled").is_some() || due.is_some();
            // --dry-run：参数全部照常校验（含分类/标签存在性），只回显不落库
            if p.flag("dry-run").is_some() {
                let tag_names: Vec<String> = p
                    .flag("tags")
                    .filter(|t| !t.is_empty())
                    .map(|t| {
                        t.split([',', '，'])
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .map(String::from)
                            .collect()
                    })
                    .unwrap_or_default();
                return Ok(json!({
                    "dryRun": true,
                    "wouldCreate": {
                        "title": title,
                        "note": p.flag("note").filter(|s| !s.is_empty()),
                        "category": p.flag("category").filter(|s| !s.is_empty()),
                        "priority": priority,
                        "due": due,
                        "remind": p.flag("remind").filter(|s| !s.is_empty()),
                        "tags": tag_names,
                        "scheduled": scheduled,
                        "source": "cli",
                    }
                }));
            }
            let new = tasks::NewTask {
                title: title.to_string(),
                note: p.flag("note").filter(|s| !s.is_empty()).map(String::from),
                category_id,
                priority: Some(priority.to_string()),
                due_at: due,
                remind_at: p.flag("remind").filter(|s| !s.is_empty()).map(String::from),
                scheduled,
                source: Some("cli".into()),
                external_id: None,
                tag_ids,
            };
            let t = tasks::create_task_conn(conn, &new, "cli").map_err(db_err)?;
            Ok(json!({ "created": t }))
        }
        "update" => {
            let id = id_of(&p)?;
            let status = match p.flag("status") {
                Some(s) if !s.is_empty() => {
                    validate_choice(s, VALID_STATUS, "状态")?;
                    Some(s.to_string())
                }
                _ => None,
            };
            let priority = match p.flag("priority") {
                Some(v) if !v.is_empty() => {
                    validate_choice(v, VALID_PRIORITY, "优先级")?;
                    Some(v.to_string())
                }
                _ => None,
            };
            let due = match p.flag("due") {
                // 传过 --due 即视为要改：空串清空、非空设置
                Some(v) => {
                    if !v.is_empty() {
                        validate_due(v)?;
                    }
                    Some(time_value(v))
                }
                None => None,
            };
            let remind = p.flag("remind").map(time_value);
            let category_id = match p.flag("category") {
                Some(c) if !c.is_empty() => Some(resolve_category(conn, c)?),
                _ => None,
            };
            let tag_ids = match p.flag("tags") {
                Some(t) => Some(resolve_tag_ids(conn, t)?),
                None => None,
            };
            // --dry-run：校验照常（含目标待办存在性），只回显将变更的字段
            if p.flag("dry-run").is_some() {
                if !task_exists(conn, id) {
                    return Err(CliError(
                        format!("任务 {id} 不存在（先用 pk task list 查 id）"),
                        1,
                    ));
                }
                return Ok(json!({
                    "dryRun": true,
                    "wouldUpdate": {
                        "id": id,
                        "title": p.flag("title").filter(|s| !s.is_empty()),
                        "note": p.flag("note"),
                        "category": p.flag("category").filter(|s| !s.is_empty()),
                        "priority": priority,
                        "due": due,
                        "remind": remind,
                        "status": status,
                        "tags": p.flag("tags").filter(|s| !s.is_empty()),
                    }
                }));
            }
            let patch = tasks::TaskPatch {
                id,
                title: p.flag("title").filter(|s| !s.is_empty()).map(String::from),
                note: p.flag("note").map(String::from),
                category_id,
                priority,
                due_at: due,
                remind_at: remind,
                status,
                tag_ids,
            };
            let t = tasks::update_task_conn(conn, &patch, "cli").map_err(db_err)?;
            Ok(json!({ "updated": t }))
        }
        "done" => {
            let id = id_of(&p)?;
            let patch = tasks::TaskPatch {
                id,
                title: None,
                note: None,
                category_id: None,
                priority: None,
                due_at: None,
                remind_at: None,
                status: Some("done".into()),
                tag_ids: None,
            };
            let t = tasks::update_task_conn(conn, &patch, "cli").map_err(db_err)?;
            Ok(json!({ "done": t }))
        }
        "start" => {
            let id = id_of(&p)?;
            let t = tasks::start_task_conn(conn, id, "cli").map_err(db_err)?;
            Ok(json!({ "started": t }))
        }
        "pause" => {
            let t = tasks::pause_current_task_conn(conn, "cli").map_err(db_err)?;
            Ok(json!({ "paused": t }))
        }
        "current" => {
            let t = tasks::get_current_task_conn(conn).map_err(db_err)?;
            Ok(json!({ "current": t }))
        }
        "delete" => {
            let id = id_of(&p)?;
            if p.flag("dry-run").is_some() {
                if !task_exists(conn, id) {
                    return Err(CliError(
                        format!("任务 {id} 不存在（先用 pk task list 查 id）"),
                        1,
                    ));
                }
                return Ok(json!({ "dryRun": true, "wouldDelete": id }));
            }
            tasks::delete_task_conn(conn, id, "cli").map_err(db_err)?;
            Ok(json!({ "deleted": id }))
        }
        _ => Err(usage_err(&format!(
            "未知 task 子命令「{sub}」，用法见 pk help"
        ))),
    }
}

/// 截止/提醒时间允许 YYYY-MM-DD 或 YYYY-MM-DDTHH:MM（与前端输入约定一致）
fn validate_due(v: &str) -> Result<(), CliError> {
    let ok = chrono::NaiveDate::parse_from_str(v, "%Y-%m-%d").is_ok()
        || chrono::NaiveDateTime::parse_from_str(v, "%Y-%m-%dT%H:%M").is_ok();
    if ok {
        return Ok(());
    }
    Err(usage_err(&format!(
        "时间「{v}」无效，应为 YYYY-MM-DD 或 YYYY-MM-DDTHH:MM"
    )))
}

fn run_note(conn: &Connection, rest: &[String]) -> Result<serde_json::Value, CliError> {
    let sub = rest
        .first()
        .map(String::as_str)
        .ok_or_else(|| usage_err("缺少 note 子命令（add / list）"))?;
    let rest = &rest[1..];
    let p = parse_args(rest);
    match sub {
        "add" => {
            let id: i64 = p
                .positional(0, "任务 id")?
                .parse()
                .map_err(|_| usage_err("任务 id 必须是数字"))?;
            let content = if p.positionals.len() >= 2 {
                p.positionals[1..].join(" ")
            } else {
                String::new()
            };
            let source = match p.flag("source") {
                Some("ai") => "ai",
                _ => "manual",
            };
            let note = tasks::add_task_note_conn(conn, id, &content, source).map_err(db_err)?;
            Ok(json!({ "added": note }))
        }
        "list" => {
            let id: i64 = p
                .positional(0, "任务 id")?
                .parse()
                .map_err(|_| usage_err("任务 id 必须是数字"))?;
            let notes = tasks::list_task_notes_conn(conn, id).map_err(db_err)?;
            Ok(json!({ "notes": notes }))
        }
        _ => Err(usage_err(&format!("未知 note 子命令「{sub}」"))),
    }
}

/// AI 处理上下文：当前时间 + 未完成待办 + 分类 + 标签（判重与属性建议的依据）
/// agent 技能目录：claude-code → ~/.claude/skills；opencode → ~/.config/opencode/skill；
/// 其他 agent 用 --dir 显式指定。返回技能文件所在目录。
fn skill_dir_for(agent: &str, dir_flag: Option<&str>) -> Result<std::path::PathBuf, CliError> {
    if let Some(d) = dir_flag.filter(|d| !d.is_empty()) {
        return Ok(std::path::PathBuf::from(d));
    }
    let home = dirs::home_dir().ok_or_else(|| CliError("无法定位用户主目录".into(), 1))?;
    match agent {
        "claude-code" | "claude" => Ok(home.join(".claude").join("skills").join("pokemon-choose-you")),
        "opencode" => Ok(home
            .join(".config")
            .join("opencode")
            .join("skill")
            .join("pokemon-choose-you")),
        other => Err(usage_err(&format!(
            "暂不认识 agent「{other}」的技能目录：支持 claude-code / opencode，其他 agent 用 --dir <目录> 指定，或 pk skill show 自行粘贴"
        ))),
    }
}

/// 安装/展示 agent 技能。install 写入主文件 + references/ 引用文件；
/// show 拼接全部内容直接打印（不走 JSON，重定向给任意 agent 即完整技能）
fn run_skill(rest: &[String]) -> Result<serde_json::Value, CliError> {
    let sub = rest.first().map(String::as_str).unwrap_or("");
    let p = parse_args(&rest[1.min(rest.len())..]);
    let dir_flag = p.flag("dir").map(str::to_string);
    match sub {
        "show" => {
            print!("{SKILL_MD}");
            for (rel, content) in SKILL_REFS {
                print!("\n\n---\n\n# 附：{rel}\n\n{content}");
            }
            std::process::exit(0);
        }
        "install" => {
            let agent = p.positional(0, "agent 名（claude-code / opencode）")?;
            let dir = skill_dir_for(&agent, dir_flag.as_deref())?;
            // 已装版本检测：同版本重装幂等，跨版本才提示更新（防旧技能残留误导 agent）
            let previous = std::fs::read_to_string(dir.join("SKILL.md"))
                .ok()
                .and_then(|md| frontmatter_version(&md));
            for (rel, content) in
                std::iter::once(("SKILL.md", SKILL_MD)).chain(SKILL_REFS.iter().copied())
            {
                let path = dir.join(rel);
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|e| CliError(format!("创建技能目录失败: {e}"), 1))?;
                }
                std::fs::write(&path, content)
                    .map_err(|e| CliError(format!("写入 {rel} 失败: {e}"), 1))?;
            }
            Ok(json!({
                "installed": true,
                "version": SKILL_VERSION,
                "previousVersion": previous,
                "updated": previous.as_deref().is_some_and(|v| v != SKILL_VERSION),
                "agent": agent,
                "path": dir.join("SKILL.md").to_string_lossy(),
            }))
        }
        _ => Err(usage_err("skill 子命令支持 install / show，用法见 pk help")),
    }
}

/// 读 SKILL.md frontmatter 的 version 行（无 frontmatter 或无该行则 None）
fn frontmatter_version(md: &str) -> Option<String> {
    let mut in_fm = false;
    for line in md.lines() {
        let t = line.trim();
        if t == "---" {
            if in_fm {
                break;
            }
            in_fm = true;
            continue;
        }
        if in_fm {
            if let Some(v) = t.strip_prefix("version:") {
                return Some(v.trim().trim_matches('"').to_string());
            }
        }
    }
    None
}

fn run_session(conn: &Connection, rest: &[String]) -> Result<serde_json::Value, CliError> {
    let sub = rest.first().map(String::as_str).unwrap_or("");
    let p = parse_args(&rest[1.min(rest.len())..]);
    // parse_args 存键时已剥掉 -- 前缀，这里统一兼容两种写法
    let flag = |name: &str| p.flag(name.trim_start_matches('-')).map(str::to_string);
    let task_id = match flag("--task") {
        Some(v) if !v.is_empty() => Some(
            v.parse::<i64>()
                .map_err(|_| usage_err("--task 必须是任务 id 数字"))?,
        ),
        _ => None,
    };
    match sub {
        "log" => {
            let agent_id = flag("--agent").filter(|v| !v.is_empty());
            let Some(agent_id) = agent_id else {
                return Err(usage_err(
                    "session log 需要 --agent <agent-id>（见设置 → 集成）",
                ));
            };
            let num_flag = |name: &str| -> Result<Option<i64>, CliError> {
                match flag(name) {
                    Some(v) if !v.is_empty() => v
                        .parse::<i64>()
                        .map(Some)
                        .map_err(|_| usage_err(&format!("{name} 必须是数字"))),
                    _ => Ok(None),
                }
            };
            let cost_usd = match flag("--cost") {
                Some(v) if !v.is_empty() => Some(
                    v.parse::<f64>()
                        .map_err(|_| usage_err("--cost 必须是数字（美元）"))?,
                ),
                _ => None,
            };
            let session = log_session_conn(
                conn,
                &NewAgentSession {
                    task_id,
                    agent_id,
                    session_id: flag("--session").filter(|v| !v.is_empty()),
                    command: flag("--command").filter(|v| !v.is_empty()),
                    exit_code: num_flag("--exit-code")?,
                    status: flag("--status").unwrap_or_else(|| "ok".into()),
                    duration_ms: num_flag("--duration-ms")?,
                    cost_usd,
                    input_tokens: num_flag("--in-tokens")?,
                    output_tokens: num_flag("--out-tokens")?,
                },
            )
            .map_err(db_err)?;
            Ok(json!({ "session": session }))
        }
        "list" => {
            let list = list_agent_sessions_conn(conn, task_id).map_err(db_err)?;
            Ok(json!({ "sessions": list }))
        }
        _ => Err(usage_err("session 子命令支持 log / list，用法见 pk help")),
    }
}

const VALID_CONFIDENCE: &[&str] = &["high", "medium", "low"];

/// 提交 AI 判定建议：单条命令供 agent 交互场景与人工调试，
/// batch 供无头分类流程一次提交整批（stdin JSON 与应用文本协议同构）。
/// todo/update 写建议列待用户确认，follow-up 直接挂跟进，none 只记状态；
/// 重复提交同一消息为覆盖写（幂等），已人工确认过的消息拒绝再提交。
fn run_suggest(conn: &mut Connection, rest: &[String]) -> Result<serde_json::Value, CliError> {
    let sub = rest.first().map(String::as_str).ok_or_else(|| {
        usage_err("缺少 suggest 子命令（todo / update / follow-up / none / batch）")
    })?;
    let rest = &rest[1..];
    match sub {
        "batch" => {
            let p = parse_args(rest);
            let agent = p.flag("agent").map(str::to_string);
            run_suggest_batch(conn, agent.as_deref())
        }
        "todo" | "update" | "none" => run_suggest_single(conn, sub, rest),
        "follow-up" | "followup" => run_suggest_single(conn, "followUp", rest),
        _ => Err(usage_err(&format!(
            "未知 suggest 子命令「{sub}」，用法见 pk help"
        ))),
    }
}

fn run_suggest_single(
    conn: &Connection,
    action: &str,
    rest: &[String],
) -> Result<serde_json::Value, CliError> {
    let p = parse_args(rest);
    let message = p
        .flag("message")
        .filter(|m| !m.is_empty())
        .ok_or_else(|| usage_err("suggest 需要 --message <消息id>（待判定消息列表里的 id）"))?;
    let task_id = match p.flag("task") {
        Some(t) if !t.is_empty() => Some(
            t.parse::<i64>()
                .map_err(|_| usage_err("--task 必须是待办 id 数字"))?,
        ),
        _ => None,
    };
    let non_empty = |k: &str| p.flag(k).filter(|v| !v.is_empty()).map(String::from);
    let tags = match p.flag("tags") {
        Some(t) if !t.is_empty() => t
            .split([',', '，'])
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect(),
        _ => vec![],
    };
    let s = AiSuggestion {
        message_id: message.to_string(),
        action: action.to_string(),
        title: non_empty("title"),
        note: non_empty("note"),
        category: non_empty("category"),
        priority: non_empty("priority"),
        due: non_empty("due"),
        tags,
        follow_up_task_id: (action == "followUp").then_some(task_id).flatten(),
        update_task_id: (action == "update").then_some(task_id).flatten(),
        reason: non_empty("reason"),
        confidence: non_empty("confidence"),
    };
    let agent = p.flag("agent").filter(|a| !a.is_empty()).unwrap_or("cli");
    validate_suggestion(conn, &s, 1)?;
    apply_suggestion(conn, &s, agent)?;
    Ok(json!({ "applied": s.action, "message": s.message_id, "agent": agent }))
}

fn run_suggest_batch(
    conn: &mut Connection,
    agent_flag: Option<&str>,
) -> Result<serde_json::Value, CliError> {
    let mut body = String::new();
    std::io::Read::read_to_string(&mut std::io::stdin(), &mut body)
        .map_err(|e| CliError(format!("读取标准输入失败: {e}"), 1))?;
    if body.trim().is_empty() {
        return Err(usage_err(
            "batch 需要从标准输入传入 JSON，如：pk suggest batch < suggestions.json",
        ));
    }
    suggest_batch_from_str(conn, &body, agent_flag)
}

/// batch 的解析与落库（与 stdin 读取分离，便于测试）：整批先校验再单事务落库，一损俱损
fn suggest_batch_from_str(
    conn: &mut Connection,
    body: &str,
    agent_flag: Option<&str>,
) -> Result<serde_json::Value, CliError> {
    let list = parse_batch(body)?;
    if list.is_empty() {
        return Err(usage_err("results 为空，无可提交的建议"));
    }
    for (i, s) in list.iter().enumerate() {
        validate_suggestion(conn, s, i + 1)?;
    }
    let agent = agent_flag.filter(|a| !a.is_empty()).unwrap_or("cli");
    let n_todo = list.iter().filter(|s| s.is_todo()).count();
    let n_update = list.iter().filter(|s| s.is_update()).count();
    let n_follow = list.iter().filter(|s| s.is_follow_up()).count();
    let tx = conn.transaction().map_err(sq_err)?;
    for s in &list {
        apply_suggestion(&tx, s, agent)?;
    }
    tx.commit().map_err(sq_err)?;
    Ok(json!({
        "submitted": list.len(),
        "todo": n_todo,
        "update": n_update,
        "followUp": n_follow,
        "none": list.len() - n_todo - n_update - n_follow,
        "agent": agent,
    }))
}

/// batch 输入：{"results":[...]} 或顶层数组（与应用文本协议同构的 AiSuggestion 列表）
fn parse_batch(body: &str) -> Result<Vec<AiSuggestion>, CliError> {
    let v: serde_json::Value = serde_json::from_str(body.trim())
        .map_err(|e| CliError(format!("batch 输入不是合法 JSON: {e}"), 2))?;
    let arr = v
        .get("results")
        .and_then(|r| r.as_array())
        .cloned()
        .or_else(|| v.as_array().cloned())
        .ok_or_else(|| CliError("batch 输入应为 {\"results\":[...]} 或顶层数组".into(), 2))?;
    let list: Vec<AiSuggestion> = serde_json::from_value(serde_json::Value::Array(arr))
        .map_err(|e| CliError(format!("建议条目解析失败: {e}"), 2))?;
    // 同批重复 messageId 会在 follow-up 场景重复挂跟进，提前拒绝
    let mut seen = std::collections::HashSet::new();
    for (i, s) in list.iter().enumerate() {
        if !seen.insert(s.message_id.clone()) {
            return Err(CliError(
                format!(
                    "第 {} 条与前面的条目 messageId 重复（{}）",
                    i + 1,
                    s.message_id
                ),
                2,
            ));
        }
    }
    Ok(list)
}

/// 落库（AppError → CliError 业务错误）
fn apply_suggestion(conn: &Connection, s: &AiSuggestion, agent: &str) -> Result<(), CliError> {
    apply_suggestion_conn(conn, s, agent).map_err(|e| CliError(e.to_string(), 1))
}

/// 提交前统一校验：消息存在且未被人工确认、action/枚举合法、分类/标签存在、目标待办存在。
/// 错误信息带序号与 messageId，agent 可据此自纠重试。
fn validate_suggestion(conn: &Connection, s: &AiSuggestion, idx: usize) -> Result<(), CliError> {
    let at = format!("第 {idx} 条（messageId={}）", s.message_id);
    let review: Option<String> = conn
        .query_row(
            "SELECT review_status FROM chat_messages WHERE message_id=?1",
            params![s.message_id],
            |r| r.get(0),
        )
        .ok();
    let Some(review) = review else {
        return Err(CliError(
            format!("{at}:消息不存在（id 须来自待判定消息列表）"),
            1,
        ));
    };
    if review != "pending" {
        return Err(CliError(
            format!("{at}:消息已人工确认过（review_status={review}），不能重复提交建议"),
            1,
        ));
    }
    match s.action.as_str() {
        "todo" => {
            if s.title
                .as_deref()
                .map(str::trim)
                .filter(|t| !t.is_empty())
                .is_none()
            {
                return Err(CliError(format!("{at}:action=todo 需要 title"), 2));
            }
        }
        "update" => {
            let Some(id) = s.update_task_id else {
                return Err(CliError(format!("{at}:action=update 需要 updateTaskId"), 2));
            };
            ensure_task(conn, id, &at)?;
        }
        "followUp" => {
            let Some(id) = s.follow_up_task_id else {
                return Err(CliError(
                    format!("{at}:action=followUp 需要 followUpTaskId"),
                    2,
                ));
            };
            ensure_task(conn, id, &at)?;
        }
        "none" | "" => {}
        other => {
            return Err(CliError(
                format!("{at}:action「{other}」无效，可选 todo/update/followUp/none"),
                2,
            ))
        }
    }
    if let Some(p) = s.priority.as_deref().filter(|p| !p.is_empty()) {
        validate_choice(p, VALID_PRIORITY, "优先级")?;
    }
    if let Some(c) = s.confidence.as_deref().filter(|c| !c.is_empty()) {
        validate_choice(c, VALID_CONFIDENCE, "confidence")?;
    }
    if let Some(cat) = s.category.as_deref().filter(|c| !c.is_empty()) {
        resolve_category(conn, cat)?;
    }
    if !s.tags.is_empty() {
        resolve_tag_ids(conn, &s.tags.join(","))?;
    }
    Ok(())
}

fn ensure_task(conn: &Connection, id: i64, at: &str) -> Result<(), CliError> {
    if task_exists(conn, id) {
        Ok(())
    } else {
        Err(CliError(
            format!("{at}:待办 No.{id} 不存在（id 须来自 pk context 的 openTasks）"),
            1,
        ))
    }
}

/// 待办 id 是否存在（dry-run 与 suggest 校验共用）
fn task_exists(conn: &Connection, id: i64) -> bool {
    conn.query_row("SELECT id FROM tasks WHERE id=?1", params![id], |r| {
        r.get::<_, i64>(0)
    })
    .is_ok()
}

/// task list 的 --limit：缺省 50；`all`（或 0）不截断
fn parse_limit(p: &Parsed) -> Result<Option<usize>, CliError> {
    match p.flag("limit") {
        None => Ok(Some(50)),
        Some(v) if v.eq_ignore_ascii_case("all") || v == "0" => Ok(None),
        Some(v) => v
            .parse::<usize>()
            .map(Some)
            .map_err(|_| usage_err("--limit 须是正整数或 all")),
    }
}

/// remote 子命令：生成远程主机上的 pk 透传 shim。
/// 场景：agent CLI 跑在远程机器、待办库在本机——远程放一个同名 `pk` 包装脚本，
/// 命令经 ssh 转发回本机执行（应用侧的 SSH 远程 agent 场景）。
/// 默认把脚本打到 stdout（可重定向），--write 直接落盘并输出 JSON 确认。
fn run_remote(rest: &[String]) -> Result<serde_json::Value, CliError> {
    let sub = rest
        .first()
        .map(String::as_str)
        .ok_or_else(|| usage_err("缺少 remote 子命令（目前支持 shim）"))?;
    if sub != "shim" {
        return Err(usage_err("remote 子命令目前只支持 shim"));
    }
    let p = parse_args(&rest[1..]);
    let host = p
        .flag("host")
        .filter(|h| !h.is_empty())
        .ok_or_else(|| {
            usage_err("remote shim 需要 --host <本机地址>（远程机器可达的地址，如 user@192.168.1.10 或 Tailscale 主机名）")
        })?;
    let port = match p.flag("port") {
        Some(v) if !v.is_empty() => Some(
            v.parse::<u16>()
                .map_err(|_| usage_err("--port 必须是端口号数字"))?,
        ),
        _ => None,
    };
    let key = p.flag("key").filter(|k| !k.is_empty());
    let mut fwd = String::from("ssh -o BatchMode=yes -o ConnectTimeout=10");
    if let Some(k) = key {
        fwd.push_str(&format!(" -i {k}"));
    }
    if let Some(pn) = port {
        fwd.push_str(&format!(" -p {pn}"));
    }
    fwd.push_str(&format!(" {host} pk \"$@\""));
    let script = format!(
        "#!/bin/sh\n# pk 远程透传 shim（pokemon-choose-you）：把 pk 命令经 ssh 转发回本机执行，数据始终留在本机。\n# 部署：放到远程主机的 PATH 里并 chmod +x，如 ~/bin/pk；本机需开 sshd 并配好免密登录。\nexec {fwd}\n"
    );
    match p.flag("write").filter(|w| !w.is_empty()) {
        Some(path) => {
            std::fs::write(path, &script)
                .map_err(|e| CliError(format!("写入 shim 失败: {e}"), 1))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755));
            }
            Ok(json!({
                "written": path,
                "host": host,
                "executable": cfg!(unix),
            }))
        }
        None => {
            print!("{script}");
            std::process::exit(0);
        }
    }
}

/// doctor 单项检查的 JSON 条目：name + ok/warn/fail + detail + 可选 fix（照跑即可修复的命令/动作）
fn doctor_check(
    name: &str,
    status: &str,
    detail: String,
    fix: Option<String>,
) -> serde_json::Value {
    json!({ "name": name, "status": status, "detail": detail, "fix": fix })
}

/// 环境自检（对标 brew/gh doctor）：数据库存在性与 schema 版本、完整性、并发配置、
/// context 读链路、技能安装版本；--ssh <host> 时额外测远程 pk 可达性（排查 shim 部署）。
/// 有 fail 时退出码 1；warn 不影响退出码（可选改进项）。库缺失/损坏本身就是诊断对象，
/// 因此 doctor 不走常规 open_db（那会直接失败），而是逐项检查并汇报。
fn doctor_report(
    db_override: Option<&std::path::Path>,
    ssh_target: Option<&str>,
) -> (serde_json::Value, i32) {
    let mut checks = vec![doctor_check(
        "version",
        "ok",
        format!("pk {}", env!("CARGO_PKG_VERSION")),
        None,
    )];

    let path = match db_override {
        Some(p) => p.to_path_buf(),
        None => default_db_path().unwrap_or_default(),
    };
    if !path.exists() {
        checks.push(doctor_check(
            "database",
            "fail",
            format!("数据库不存在：{}", path.display()),
            Some("先启动一次应用（或 pk init-db / 用 PK_DB 指定路径）".into()),
        ));
    } else {
        checks.push(doctor_check(
            "database",
            "ok",
            path.display().to_string(),
            None,
        ));
        match Connection::open(&path) {
            Ok(conn) => {
                // 只设 busy_timeout 不动 journal_mode：并发检查要读库的真实持久状态
                let _ = conn.execute_batch("PRAGMA busy_timeout=5000;");
                checks.extend(schema_checks(&conn));
                checks.push(integrity_check(&conn));
                checks.push(concurrency_check(&conn));
                checks.push(context_check(&conn));
            }
            Err(e) => checks.push(doctor_check(
                "database",
                "fail",
                format!("打开失败：{e}"),
                Some("检查文件权限与所在磁盘状态".into()),
            )),
        }
    }
    checks.extend(skill_doctor_checks());
    if let Some(host) = ssh_target {
        checks.push(remote_doctor_check(host));
    }

    let count = |st: &str| checks.iter().filter(|c| c["status"] == st).count();
    let fail = count("fail");
    (
        json!({
            "checks": checks,
            "summary": {
                "ok": count("ok"),
                "warn": count("warn"),
                "fail": fail,
            }
        }),
        if fail > 0 { 1 } else { 0 },
    )
}

/// schema 版本与关键表：库比程序新（pk 需随应用升级）/ 库落后（应用未完成迁移）/ 缺表
fn schema_checks(conn: &Connection) -> Vec<serde_json::Value> {
    let mut out = vec![];
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(-1);
    let expected = pokemon_choose_you_lib::db::expected_schema_version();
    if version == expected {
        out.push(doctor_check(
            "schema",
            "ok",
            format!("schema v{version}，与当前 pk 一致"),
            None,
        ));
    } else if version > expected {
        out.push(doctor_check(
            "schema",
            "fail",
            format!("数据库 schema v{version} 比本 pk（v{expected}）新"),
            Some("pk 随应用分发：升级应用后其自带的 pk 会自动接管".into()),
        ));
    } else {
        out.push(doctor_check(
            "schema",
            "fail",
            format!("数据库 schema v{version} 落后于 pk（v{expected}），应用未完成迁移"),
            Some("启动一次应用完成迁移（pk 自身不执行迁移）".into()),
        ));
    }
    const TABLES: &[&str] = &[
        "tasks",
        "categories",
        "tags",
        "task_tags",
        "task_notes",
        "task_logs",
        "chat_messages",
        "chat_feedback",
        "agent_sessions",
        "settings",
        "sync_state",
        "feishu_users",
    ];
    let present: Vec<String> = {
        let mut stmt = match conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_%'")
        {
            Ok(s) => s,
            Err(_) => return out,
        };
        stmt.query_map([], |r| r.get::<_, String>(0))
            .map(|rows| rows.filter_map(Result::ok).collect())
            .unwrap_or_default()
    };
    let missing: Vec<&str> = TABLES
        .iter()
        .filter(|t| !present.iter().any(|p| p == *t))
        .copied()
        .collect();
    if missing.is_empty() {
        out.push(doctor_check(
            "tables",
            "ok",
            format!("{} 张表齐全", TABLES.len()),
            None,
        ));
    } else {
        out.push(doctor_check(
            "tables",
            "fail",
            format!("缺少表：{}", missing.join("、")),
            Some("schema 与 pk 版本不匹配，升级应用后重试".into()),
        ));
    }
    out
}

fn integrity_check(conn: &Connection) -> serde_json::Value {
    let rows: Vec<String> = conn
        .prepare("PRAGMA quick_check")
        .and_then(|mut stmt| {
            stmt.query_map([], |r| r.get::<_, String>(0))
                .map(|rows| rows.filter_map(Result::ok).collect())
        })
        .unwrap_or_default();
    if rows.iter().all(|r| r == "ok") {
        doctor_check("integrity", "ok", "quick_check 通过".into(), None)
    } else {
        doctor_check(
            "integrity",
            "fail",
            rows.join("; ").chars().take(200).collect(),
            Some("先关闭应用再复查；确认损坏可从设置 → 备份恢复".into()),
        )
    }
}

fn concurrency_check(conn: &Connection) -> serde_json::Value {
    let mode: String = conn
        .query_row("PRAGMA journal_mode", [], |r| r.get(0))
        .unwrap_or_default();
    if mode == "wal" {
        doctor_check(
            "concurrency",
            "ok",
            "WAL 已启用，可与运行中的应用并发读写".into(),
            None,
        )
    } else {
        doctor_check(
            "concurrency",
            "warn",
            format!("journal_mode={mode}，与应用并发读写可能报 BUSY"),
            Some("启动一次应用或运行任一 pk 读写命令即自动切为 WAL".into()),
        )
    }
}

fn context_check(conn: &Connection) -> serde_json::Value {
    match run_context(conn) {
        Ok(ctx) => doctor_check(
            "context",
            "ok",
            format!(
                "读链路正常：分类 {} · 标签 {} · 未完成待办 {}",
                ctx["categories"].as_array().map(Vec::len).unwrap_or(0),
                ctx["tags"].as_array().map(Vec::len).unwrap_or(0),
                ctx["openTasks"].as_array().map(Vec::len).unwrap_or(0)
            ),
            None,
        ),
        Err(e) => doctor_check(
            "context",
            "fail",
            format!("读取上下文失败：{}", e.0),
            Some("结合上面 schema/integrity 检查结果定位".into()),
        ),
    }
}

/// 技能安装状态：未安装提示可选安装（warn），旧版本提示更新
fn skill_doctor_checks() -> Vec<serde_json::Value> {
    let mut out = vec![];
    for agent in ["claude-code", "opencode"] {
        let entry = match skill_dir_for(agent, None) {
            Ok(dir) => dir.join("SKILL.md"),
            Err(_) => {
                out.push(doctor_check(
                    "skill",
                    "warn",
                    format!("{agent}：无法定位技能目录（home 缺失）"),
                    None,
                ));
                continue;
            }
        };
        match std::fs::read_to_string(&entry)
            .ok()
            .and_then(|md| frontmatter_version(&md))
        {
            Some(v) if v == SKILL_VERSION => out.push(doctor_check(
                "skill",
                "ok",
                format!("{agent}：v{v}（{}）", entry.display()),
                None,
            )),
            Some(v) => out.push(doctor_check(
                "skill",
                "warn",
                format!("{agent}：技能 v{v} 旧于内置 v{SKILL_VERSION}"),
                Some(format!("pk skill install {agent}")),
            )),
            None => out.push(doctor_check(
                "skill",
                "warn",
                format!("{agent}：未安装（交互/无头场景建议安装）"),
                Some(format!("pk skill install {agent}")),
            )),
        }
    }
    out
}

/// 远程 pk 可达性：BatchMode ssh 到目标跑 `pk --version`。
/// 远程部署的是 shim 时，这一条会端到端验证「ssh 免密 → shim 在 PATH → 回连本机 → 本机 pk」整条链。
fn remote_doctor_check(host: &str) -> serde_json::Value {
    match std::process::Command::new("ssh")
        .args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"])
        .arg(host)
        .args(["--", "pk", "--version"])
        .output()
    {
        Ok(o) if o.status.success() => {
            let v = String::from_utf8_lossy(&o.stdout).trim().to_string();
            doctor_check("remote", "ok", format!("{host} 的 pk 可用：{v}"), None)
        }
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            let hint = if stderr.contains("127") || o.status.code() == Some(127) {
                "远端 PATH 里没有 pk：确认 shim 已放进 PATH（如 ~/bin）并 chmod +x"
            } else {
                "检查免密登录（公钥）、主机可达性与 shim 部署"
            };
            doctor_check(
                "remote",
                "fail",
                format!(
                    "{host} 执行 pk 失败（退出码 {:?}）：{}",
                    o.status.code(),
                    stderr.trim().chars().take(160).collect::<String>()
                ),
                Some(hint.into()),
            )
        }
        Err(e) => doctor_check(
            "remote",
            "fail",
            format!("无法启动 ssh：{e}"),
            Some("确认本机装有 ssh 客户端".into()),
        ),
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
        "skill install <agent>",
        "安装技能（claude-code|opencode，或 --dir 指定）",
    ),
    ("skill show", "打印技能全文"),
    ("remote shim", "生成远程 pk 透传脚本（--host 必填）"),
    ("category list", "分类列表"),
    ("tag list", "标签列表"),
    (
        "context",
        "当前时间 + 未完成待办 + 分类 + 标签（判定与建任务的判重上下文）",
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

fn run_context(conn: &Connection) -> Result<serde_json::Value, CliError> {
    let open_tasks: Vec<(i64, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, title FROM tasks WHERE status IN ('inbox','scheduled','active','paused') ORDER BY id",
            )
            .map_err(sq_err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(sq_err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(sq_err)?;
        rows
    };
    let cats = categories::list_categories_conn(conn)
        .map_err(db_err)?
        .into_iter()
        .filter(|c| c.enabled)
        .map(|c| json!({ "id": c.id, "name": c.name }))
        .collect::<Vec<_>>();
    let tag_list = tags::list_tags_conn(conn)
        .map_err(db_err)?
        .into_iter()
        .map(|t| json!({ "id": t.id, "name": t.name, "description": t.description }))
        .collect::<Vec<_>>();
    let open: Vec<serde_json::Value> = open_tasks
        .into_iter()
        .map(|(id, title)| json!({ "id": id, "title": title }))
        .collect();
    Ok(json!({
        "now": chrono::Local::now().format("%Y-%m-%dT%H:%M").to_string(),
        "openTasks": open,
        "categories": cats,
        "tags": tag_list,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use pokemon_choose_you_lib::db;

    /// 每个用例独立的内存库（迁移 + 默认分类），复用应用的 init_conn 保证 schema 一致
    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        db::init_conn(&conn).unwrap();
        conn
    }

    fn run_ok(conn: &mut Connection, args: &[&str]) -> serde_json::Value {
        let owned: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        run(conn, &owned).unwrap_or_else(|e| panic!("命令 {args:?} 失败: {}", e.0))
    }

    fn run_err(conn: &mut Connection, args: &[&str]) -> CliError {
        let owned: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        run(conn, &owned).unwrap_err()
    }

    fn create(conn: &mut Connection, title: &str) -> i64 {
        let out = run_ok(conn, &["task", "create", "--title", title]);
        out["created"]["id"].as_i64().unwrap()
    }

    #[test]
    fn create_get_list_roundtrip() {
        let mut conn = test_db();
        let id = create(&mut conn, "交周报");
        let got = run_ok(&mut conn, &["task", "get", &id.to_string()]);
        assert_eq!(got["task"]["title"], "交周报");
        assert_eq!(got["task"]["status"], "inbox", "无截止时间默认草丛");
        assert_eq!(got["task"]["source"], "cli", "CLI 建的任务标记来源");
        assert_eq!(got["notes"].as_array().map(Vec::len), Some(0));

        let list = run_ok(&mut conn, &["task", "list"]);
        assert_eq!(list["count"], 1);
        assert_eq!(list["tasks"][0]["id"], json!(id));

        let today = run_ok(&mut conn, &["task", "list", "today"]);
        assert_eq!(today["count"], 0, "无截止时间不进 today");
    }

    #[test]
    fn create_with_due_goes_scheduled_and_validates_input() {
        let mut conn = test_db();
        let out = run_ok(
            &mut conn,
            &[
                "task",
                "create",
                "--title",
                "开会",
                "--due",
                "2026-09-13T10:00",
                "--priority",
                "high",
            ],
        );
        assert_eq!(out["created"]["status"], "scheduled", "有截止时间直接排期");
        assert_eq!(out["created"]["priority"], "high");

        let bad = run_err(
            &mut conn,
            &["task", "create", "--title", "x", "--priority", "urgent!!"],
        );
        assert_eq!(bad.1, 2, "非法优先级是用法错误");
        assert!(bad.0.contains("优先级"));

        let bad_due = run_err(
            &mut conn,
            &["task", "create", "--title", "x", "--due", "明天"],
        );
        assert!(bad_due.0.contains("时间"), "时间格式校验: {}", bad_due.0);
    }

    #[test]
    fn update_supports_clear_due_and_tags() {
        let mut conn = test_db();
        conn.execute(
            "INSERT INTO tags (name, description, created_at) VALUES ('重要', '', 'x')",
            [],
        )
        .unwrap();
        let id = create(&mut conn, "带时间");
        let out = run_ok(
            &mut conn,
            &[
                "task",
                "update",
                &id.to_string(),
                "--due",
                "2026-09-13T10:00",
                "--tags",
                "重要",
                "--priority",
                "urgent",
            ],
        );
        // --due 只改时间不自动升级状态（与应用 update 语义一致），进路线需显式 --status
        assert_eq!(out["updated"]["status"], "inbox");
        assert_eq!(out["updated"]["dueAt"], "2026-09-13T10:00");
        assert_eq!(out["updated"]["tags"], json!(["重要"]));

        let out = run_ok(
            &mut conn,
            &["task", "update", &id.to_string(), "--status", "scheduled"],
        );
        assert_eq!(out["updated"]["status"], "scheduled");

        // --due "" 清空截止时间：草丛不变量把它归回 inbox
        let out = run_ok(&mut conn, &["task", "update", &id.to_string(), "--due", ""]);
        assert_eq!(
            out["updated"]["dueAt"],
            serde_json::Value::Null,
            "空串清空截止"
        );
        assert_eq!(out["updated"]["status"], "inbox");
        assert_eq!(
            out["updated"]["tags"],
            json!(["重要"]),
            "未传 --tags 不动标签"
        );

        let unknown = run_err(
            &mut conn,
            &["task", "update", &id.to_string(), "--tags", "不存在的标签"],
        );
        assert!(
            unknown.0.contains("未知标签"),
            "未知标签报错: {}",
            unknown.0
        );
    }

    #[test]
    fn done_start_pause_lifecycle() {
        let mut conn = test_db();
        let a = create(&mut conn, "A");
        let b = create(&mut conn, "B");

        let started = run_ok(&mut conn, &["task", "start", &a.to_string()]);
        assert_eq!(started["started"]["status"], "active");
        let current = run_ok(&mut conn, &["task", "current"]);
        assert_eq!(current["current"]["id"], json!(a));

        // 开始 B 会把 A 顶回 scheduled
        let _ = run_ok(&mut conn, &["task", "start", &b.to_string()]);
        let current = run_ok(&mut conn, &["task", "current"]);
        assert_eq!(current["current"]["id"], json!(b));
        let list = run_ok(&mut conn, &["task", "list"]);
        let a_row = list["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["id"] == json!(a))
            .unwrap();
        assert_eq!(a_row["status"], "scheduled");

        let paused = run_ok(&mut conn, &["task", "pause"]);
        assert_eq!(paused["paused"]["id"], json!(b));

        let done = run_ok(&mut conn, &["task", "done", &a.to_string()]);
        assert_eq!(done["done"]["status"], "done");
        assert!(done["done"]["completedAt"].is_string(), "完成写入完成时间");
        let open = run_ok(&mut conn, &["task", "list"]);
        assert_eq!(open["count"], 1, "done 后不在 open 列表");
    }

    #[test]
    fn search_note_log_and_delete() {
        let mut conn = test_db();
        let id = create(&mut conn, "写季度报告");
        let _other = create(&mut conn, "无关任务");

        let hit = run_ok(&mut conn, &["task", "search", "季度"]);
        assert_eq!(hit["count"], 1);

        let note = run_ok(
            &mut conn,
            &[
                "note",
                "add",
                &id.to_string(),
                "对方确认周五交付",
                "--source",
                "ai",
            ],
        );
        assert_eq!(note["added"]["source"], "ai");
        let notes = run_ok(&mut conn, &["note", "list", &id.to_string()]);
        assert_eq!(notes["notes"].as_array().map(Vec::len), Some(1));

        let logs = run_ok(&mut conn, &["log", &id.to_string()]);
        let entries = logs["logs"].as_array().unwrap();
        assert!(
            entries.iter().any(|l| l["action"] == "create"),
            "操作日志含 create"
        );

        let del = run_ok(&mut conn, &["task", "delete", &id.to_string()]);
        assert_eq!(del["deleted"], json!(id));
        let err = run_err(&mut conn, &["task", "get", &id.to_string()]);
        assert!(err.0.contains("不存在"), "删除后查询报不存在: {}", err.0);
    }

    #[test]
    fn category_tag_list_and_context() {
        let mut conn = test_db();
        let cats = run_ok(&mut conn, &["category", "list"]);
        assert_eq!(
            cats["categories"].as_array().map(Vec::len),
            Some(5),
            "内置五分类"
        );

        let ctx = run_ok(&mut conn, &["context"]);
        assert!(ctx["now"].is_string());
        assert_eq!(
            ctx["categories"].as_array().map(Vec::len),
            Some(5),
            "context 只列启用分类"
        );
        assert_eq!(ctx["openTasks"].as_array().map(Vec::len), Some(0));

        let id = create(&mut conn, "上下文任务");
        let ctx = run_ok(&mut conn, &["context"]);
        assert_eq!(ctx["openTasks"][0]["id"], json!(id));
    }

    /// 技能分发：--dir 安装到任意目录、重复安装标记 updated、未知 agent 报用法错误并给 --dir 出路
    #[test]
    fn skill_install_show_and_unknown_agent() {
        let mut conn = test_db();
        let dir = std::env::temp_dir().join(format!("pk-skill-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        // 首次安装
        let out = run_ok(
            &mut conn,
            &[
                "skill",
                "install",
                "claude-code",
                "--dir",
                &dir.to_string_lossy(),
            ],
        );
        assert_eq!(out["installed"], true);
        assert_eq!(out["updated"], false, "首次安装");
        assert_eq!(out["version"], "2");
        let md = std::fs::read_to_string(dir.join("SKILL.md")).unwrap();
        assert!(md.contains("pk task create"), "技能内容含命令速查");
        assert!(md.contains("name: pokemon-choose-you"), "带 frontmatter");
        assert!(md.contains("pk suggest"), "含建议提交通道");
        assert!(
            dir.join("references").join("commands.md").exists(),
            "引用文件一并安装"
        );
        assert!(
            dir.join("references").join("suggest-workflow.md").exists(),
            "批处理工作流一并安装"
        );

        // 同版本重装幂等
        let out = run_ok(
            &mut conn,
            &[
                "skill",
                "install",
                "claude-code",
                "--dir",
                &dir.to_string_lossy(),
            ],
        );
        assert_eq!(out["updated"], false, "同版本重装幂等");

        // 旧版本在位 → 提示更新
        std::fs::write(
            dir.join("SKILL.md"),
            "---\nname: pokemon-choose-you\nversion: \"1\"\n---\n旧内容",
        )
        .unwrap();
        let out = run_ok(
            &mut conn,
            &[
                "skill",
                "install",
                "claude-code",
                "--dir",
                &dir.to_string_lossy(),
            ],
        );
        assert_eq!(out["updated"], true, "跨版本提示更新");
        assert_eq!(out["previousVersion"], "1");

        // 未知 agent 给出 --dir 出路
        let err = run_err(&mut conn, &["skill", "install", "kiro"]);
        assert_eq!(err.1, 2);
        assert!(err.0.contains("--dir"), "{}", err.0);

        // 目录规则：claude-code / opencode 的落点结构正确（不实际写）
        let claude = skill_dir_for("claude-code", None).unwrap_or_else(|e| panic!("{}", e.0));
        assert!(
            claude.ends_with(".claude/skills/pokemon-choose-you")
                || claude.to_string_lossy().contains(".claude"),
            "{claude:?}"
        );
        let opencode = skill_dir_for("opencode", None).unwrap_or_else(|e| panic!("{}", e.0));
        assert!(
            opencode.to_string_lossy().contains("opencode"),
            "{opencode:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 会话回链与成本记录：log 落库（关联任务 + 成本/时长）→ list 查询任务时间线
    #[test]
    fn session_log_and_list_roundtrip() {
        let mut conn = test_db();
        let id = create(&mut conn, "修登录bug");
        let out = run_ok(
            &mut conn,
            &[
                "session",
                "log",
                "--task",
                &id.to_string(),
                "--agent",
                "claude-code",
                "--session",
                "sess-1",
                "--command",
                "claude -p 修登录bug",
                "--exit-code",
                "0",
                "--duration-ms",
                "61000",
                "--cost",
                "0.12",
                "--in-tokens",
                "1000",
                "--out-tokens",
                "2000",
            ],
        );
        assert_eq!(out["session"]["taskId"], id);
        assert_eq!(out["session"]["sessionId"], "sess-1");
        assert_eq!(
            out["session"]["agentName"], "claude-code",
            "无配置时用 id 兜底"
        );
        assert_eq!(out["session"]["durationMs"], 61000);

        // 任务时间线查得到；全局列表也有
        let list = run_ok(&mut conn, &["session", "list", "--task", &id.to_string()]);
        assert_eq!(list["sessions"].as_array().unwrap().len(), 1);
        let all = run_ok(&mut conn, &["session", "list"]);
        assert_eq!(all["sessions"].as_array().unwrap().len(), 1);

        // 缺 --agent 报用法错误；关联不存在的任务报业务错误
        let err = run_err(&mut conn, &["session", "log"]);
        assert_eq!(err.1, 2, "缺参数是用法错误");
        let err = run_err(
            &mut conn,
            &["session", "log", "--agent", "a", "--task", "999"],
        );
        assert!(err.0.contains("不存在"), "{}", err.0);
    }

    #[test]
    fn remote_shim_writes_forwarding_script() {
        let args = |v: &[&str]| -> Vec<String> { v.iter().map(|s| s.to_string()).collect() };
        // 缺 --host 是用法错误
        let err = run_remote(&args(&["shim"])).unwrap_err();
        assert_eq!(err.1, 2);
        assert!(err.0.contains("--host"), "{}", err.0);

        let dir = std::env::temp_dir().join(format!("pk-shim-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let out = run_remote(&args(&[
            "shim",
            "--host",
            "dev@box",
            "--port",
            "2222",
            "--key",
            "~/.ssh/id_ed",
            "--write",
            &dir.to_string_lossy(),
        ]))
        .unwrap();
        assert_eq!(
            out["written"].as_str().unwrap(),
            dir.to_string_lossy().as_ref()
        );
        let script = std::fs::read_to_string(&dir).unwrap();
        assert!(script.contains("exec ssh"), "{script}");
        assert!(script.contains("-p 2222"), "{script}");
        assert!(script.contains("-i ~/.ssh/id_ed"), "{script}");
        assert!(
            script.contains("dev@box pk \"$@\""),
            "命令透传回本机: {script}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_commands_are_usage_errors() {
        let mut conn = test_db();
        let err = run_err(&mut conn, &["nonsense"]);
        assert_eq!(err.1, 2);
        let err = run_err(&mut conn, &["task", "fly"]);
        assert_eq!(err.1, 2);
        let err = run_err(&mut conn, &["task", "get", "abc"]);
        assert_eq!(err.1, 2, "非数字 id 是用法错误");
    }

    #[test]
    fn doctor_ok_on_fresh_db_and_fails_on_missing() {
        let dir = std::env::temp_dir().join(format!("pk-doctor-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let dbp = dir.join("d.db");
        {
            let conn = Connection::open(&dbp).unwrap();
            db::init_conn(&conn).unwrap();
        }
        let (report, code) = doctor_report(Some(&dbp), None);
        assert_eq!(code, 0, "健康库退出码 0（warn 不算失败）: {report}");
        assert_eq!(report["summary"]["fail"], 0);
        let by = |n: &str| {
            report["checks"]
                .as_array()
                .unwrap()
                .iter()
                .find(|c| c["name"] == n)
                .unwrap_or_else(|| panic!("缺检查项 {n}: {report}"))
                .clone()
        };
        assert_eq!(by("database")["status"], "ok");
        assert_eq!(by("schema")["status"], "ok");
        assert_eq!(by("tables")["status"], "ok");
        assert_eq!(by("integrity")["status"], "ok");
        assert_eq!(by("context")["status"], "ok");
        // 新库未跑过应用/pk 读写，journal_mode 可能还没切 WAL → warn 合法
        assert_ne!(by("concurrency")["status"], "fail");

        // 库不存在：database fail + 退出码 1 + 修复建议
        let (report, code) = doctor_report(Some(&dir.join("none.db")), None);
        assert_eq!(code, 1);
        assert_eq!(report["summary"]["fail"], 1);
        let db_check = report["checks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == "database")
            .unwrap();
        assert_eq!(db_check["status"], "fail");
        assert!(db_check["fix"].is_string(), "fail 项必带修复建议");

        // 库 schema 比程序新：fail + 指引升级
        {
            let conn = Connection::open(&dbp).unwrap();
            conn.execute_batch("PRAGMA user_version = 99;").unwrap();
        }
        let (report, code) = doctor_report(Some(&dbp), None);
        assert_eq!(code, 1);
        let schema = report["checks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == "schema")
            .unwrap();
        assert_eq!(schema["status"], "fail");
        assert!(schema["detail"].as_str().unwrap().contains("v99"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn dry_run_validates_without_writing() {
        let mut conn = test_db();
        conn.execute(
            "INSERT INTO tags (name, description, created_at) VALUES ('重要', '', 'x')",
            [],
        )
        .unwrap();

        // create：非法参数照常拒绝（dry-run 不是绕过校验的后门）
        let err = run_err(
            &mut conn,
            &[
                "task",
                "create",
                "--title",
                "x",
                "--priority",
                "nope",
                "--dry-run",
            ],
        );
        assert_eq!(err.1, 2);

        let out = run_ok(
            &mut conn,
            &[
                "task",
                "create",
                "--title",
                "交周报",
                "--category",
                "工作",
                "--due",
                "2026-09-14T10:00",
                "--tags",
                "重要",
                "--dry-run",
            ],
        );
        assert_eq!(out["dryRun"], true);
        assert_eq!(out["wouldCreate"]["title"], "交周报");
        assert_eq!(out["wouldCreate"]["scheduled"], true, "带 due 即排期");
        assert_eq!(out["wouldCreate"]["tags"], json!(["重要"]));
        let list = run_ok(&mut conn, &["task", "list"]);
        assert_eq!(list["total"], 0, "dry-run 不落库");

        // update：目标不存在报业务错误；存在时只回显不改
        let id = create(&mut conn, "真任务");
        let err = run_err(
            &mut conn,
            &["task", "update", "999", "--priority", "high", "--dry-run"],
        );
        assert_eq!(err.1, 1);
        assert!(err.0.contains("不存在"), "{}", err.0);
        let out = run_ok(
            &mut conn,
            &[
                "task",
                "update",
                &id.to_string(),
                "--priority",
                "high",
                "--dry-run",
            ],
        );
        assert_eq!(out["wouldUpdate"]["priority"], "high");
        let got = run_ok(&mut conn, &["task", "get", &id.to_string()]);
        assert_eq!(got["task"]["priority"], "normal", "dry-run 不改库");

        // delete：只确认存在性
        let out = run_ok(&mut conn, &["task", "delete", &id.to_string(), "--dry-run"]);
        assert_eq!(out["wouldDelete"], json!(id));
        let got = run_ok(&mut conn, &["task", "get", &id.to_string()]);
        assert_eq!(got["task"]["id"], json!(id), "dry-run 不删除");
    }

    #[test]
    fn task_list_limits_with_truncation_hint() {
        let mut conn = test_db();
        for i in 0..3 {
            create(&mut conn, &format!("任务{i}"));
        }
        // 默认 50：小库不截断
        let out = run_ok(&mut conn, &["task", "list"]);
        assert_eq!(out["count"], 3);
        assert_eq!(out["total"], 3);
        assert_eq!(out["truncated"], false);
        assert!(out["hint"].is_null(), "未截断不给提示");

        // --limit 2：截断 + 提示收窄手段
        let out = run_ok(&mut conn, &["task", "list", "--limit", "2"]);
        assert_eq!(out["count"], 2);
        assert_eq!(out["total"], 3);
        assert_eq!(out["truncated"], true);
        assert!(out["hint"].as_str().unwrap().contains("search"));

        // --limit all / 0：不截断
        let out = run_ok(&mut conn, &["task", "list", "--limit", "all"]);
        assert_eq!(out["count"], 3);
        assert_eq!(out["truncated"], false);
        let out = run_ok(&mut conn, &["task", "list", "--limit", "0"]);
        assert_eq!(out["count"], 3);

        let err = run_err(&mut conn, &["task", "list", "--limit", "很多"]);
        assert_eq!(err.1, 2, "非法 limit 是用法错误");
    }

    /// help --json 的机器可读目录：合法 JSON、含契约信息与全部命令
    #[test]
    fn help_schema_lists_commands_and_contract() {
        let v: serde_json::Value = serde_json::from_str(&help_schema()).unwrap();
        assert_eq!(v["name"], "pk");
        assert_eq!(v["version"], env!("CARGO_PKG_VERSION"));
        assert!(v["exitCodes"]["2"].is_string(), "退出码契约");
        assert!(v["env"]["PK_DB"].is_string());
        let cmds = v["commands"].as_array().unwrap();
        assert!(cmds.len() >= COMMAND_INDEX.len());
        for must in [
            "task create",
            "suggest batch",
            "doctor",
            "remote shim",
            "context",
        ] {
            assert!(cmds.iter().any(|c| c["command"] == must), "缺命令 {must}");
        }
    }

    /// 直插一条待判定消息（模拟飞书拉取落库后的状态：ai_status/review_status 均 pending）
    fn insert_msg(conn: &Connection, message_id: &str, content: &str) {
        conn.execute(
            "INSERT INTO chat_messages (message_id, content, sent_at, created_at)
             VALUES (?1, ?2, 0, 'x')",
            params![message_id, content],
        )
        .unwrap();
    }

    fn msg_col(conn: &Connection, message_id: &str, col: &str) -> String {
        conn.query_row(
            &format!("SELECT {col} FROM chat_messages WHERE message_id=?1"),
            params![message_id],
            |r| r.get::<_, String>(0),
        )
        .unwrap_or_default()
    }

    #[test]
    fn suggest_todo_update_none_roundtrip() {
        let mut conn = test_db();
        insert_msg(&conn, "om_1", "明天上午交周报");

        // none：只记状态与理由
        let out = run_ok(
            &mut conn,
            &["suggest", "none", "--message", "om_1", "--reason", "闲聊"],
        );
        assert_eq!(out["applied"], "none");
        assert_eq!(msg_col(&conn, "om_1", "ai_status"), "none");
        assert_eq!(msg_col(&conn, "om_1", "suggested_reason"), "闲聊");

        // todo：建议列落库 + 幂等覆盖
        let out = run_ok(
            &mut conn,
            &[
                "suggest",
                "todo",
                "--message",
                "om_1",
                "--title",
                "交周报",
                "--category",
                "工作",
                "--priority",
                "high",
                "--due",
                "2026-09-14T10:00",
                "--reason",
                "对方明确要求",
                "--agent",
                "claude-code",
            ],
        );
        assert_eq!(out["applied"], "todo");
        assert_eq!(msg_col(&conn, "om_1", "ai_status"), "todo");
        assert_eq!(msg_col(&conn, "om_1", "suggested_title"), "交周报");
        assert_eq!(msg_col(&conn, "om_1", "ai_agent"), "claude-code");
        let out = run_ok(
            &mut conn,
            &[
                "suggest",
                "todo",
                "--message",
                "om_1",
                "--title",
                "交周报v2",
            ],
        );
        assert_eq!(out["applied"], "todo");
        assert_eq!(
            msg_col(&conn, "om_1", "suggested_title"),
            "交周报v2",
            "重提覆盖旧建议"
        );
        assert_eq!(
            msg_col(&conn, "om_1", "ai_agent"),
            "cli",
            "不带 --agent 兜底 cli"
        );

        // update：指向现有待办，落「更新建议」待确认
        let task = create(&mut conn, "已有待办");
        let out = run_ok(
            &mut conn,
            &[
                "suggest",
                "update",
                "--message",
                "om_1",
                "--task",
                &task.to_string(),
                "--due",
                "2026-09-15T09:00",
            ],
        );
        assert_eq!(out["applied"], "update");
        assert_eq!(msg_col(&conn, "om_1", "ai_status"), "update");
        let update_task: i64 = conn
            .query_row(
                "SELECT update_task_id FROM chat_messages WHERE message_id='om_1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(update_task, task);
    }

    #[test]
    fn suggest_follow_up_attaches_note() {
        let mut conn = test_db();
        insert_msg(&conn, "om_2", "周五交付确认了");
        let task = create(&mut conn, "交付任务");
        let out = run_ok(
            &mut conn,
            &[
                "suggest",
                "follow-up",
                "--message",
                "om_2",
                "--task",
                &task.to_string(),
                "--reason",
                "进展确认",
            ],
        );
        assert_eq!(out["applied"], "followUp");
        assert_eq!(msg_col(&conn, "om_2", "ai_status"), "followup");
        assert_eq!(
            msg_col(&conn, "om_2", "review_status"),
            "accepted",
            "跟进自动应用"
        );
        assert_eq!(msg_col(&conn, "om_2", "suggested_reason"), "进展确认");
        let note: String = conn
            .query_row(
                "SELECT content FROM task_notes WHERE task_id=?1",
                params![task],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(note, "周五交付确认了", "跟进正文是消息原文");
        // 已确认的消息不能再提交
        let err = run_err(&mut conn, &["suggest", "none", "--message", "om_2"]);
        assert_eq!(err.1, 1);
        assert!(err.0.contains("人工确认"), "{}", err.0);
    }

    #[test]
    fn suggest_validates_input() {
        let mut conn = test_db();
        insert_msg(&conn, "om_3", "内容");

        let err = run_err(
            &mut conn,
            &["suggest", "todo", "--message", "om_none", "--title", "x"],
        );
        assert_eq!(err.1, 1);
        assert!(err.0.contains("消息不存在"), "{}", err.0);

        let err = run_err(&mut conn, &["suggest", "todo", "--message", "om_3"]);
        assert_eq!(err.1, 2, "缺 title 是用法错误");
        assert!(err.0.contains("title"), "{}", err.0);

        let err = run_err(
            &mut conn,
            &[
                "suggest",
                "todo",
                "--message",
                "om_3",
                "--title",
                "x",
                "--priority",
                "urgent!!",
            ],
        );
        assert_eq!(err.1, 2);

        let err = run_err(
            &mut conn,
            &[
                "suggest",
                "todo",
                "--message",
                "om_3",
                "--title",
                "x",
                "--category",
                "不存在的分类",
            ],
        );
        assert_eq!(err.1, 1);
        assert!(err.0.contains("分类"), "{}", err.0);

        let err = run_err(
            &mut conn,
            &[
                "suggest",
                "todo",
                "--message",
                "om_3",
                "--title",
                "x",
                "--tags",
                "没有的标签",
            ],
        );
        assert!(err.0.contains("未知标签"), "{}", err.0);

        let err = run_err(
            &mut conn,
            &[
                "suggest",
                "todo",
                "--message",
                "om_3",
                "--title",
                "x",
                "--confidence",
                "maybe",
            ],
        );
        assert!(err.0.contains("confidence"), "{}", err.0);

        // update 的目标待办必须存在、缺 --task 报用法错误
        let err = run_err(
            &mut conn,
            &[
                "suggest",
                "update",
                "--message",
                "om_3",
                "--task",
                "999",
                "--title",
                "x",
            ],
        );
        assert!(err.0.contains("不存在"), "{}", err.0);
        let err = run_err(&mut conn, &["suggest", "update", "--message", "om_3"]);
        assert!(err.0.contains("updateTaskId"), "{}", err.0);
    }

    #[test]
    fn suggest_batch_atomic_and_counts() {
        let mut conn = test_db();
        insert_msg(&conn, "om_a", "新任务消息");
        insert_msg(&conn, "om_b", "闲聊");
        insert_msg(&conn, "om_c", "进展消息");
        let task = create(&mut conn, "目标待办");

        let body = r#"{"results":[
            {"messageId":"om_a","action":"todo","title":"新任务","priority":"high"},
            {"messageId":"om_b","action":"none","reason":"闲聊"},
            {"messageId":"om_c","action":"followUp","followUpTaskId":TASK,"reason":"进展"}
        ]}"#
        .replace("TASK", &task.to_string());
        let out = suggest_batch_from_str(&mut conn, &body, Some("claude-code")).unwrap();
        assert_eq!(out["submitted"], 3);
        assert_eq!(out["todo"], 1);
        assert_eq!(out["update"], 0);
        assert_eq!(out["followUp"], 1);
        assert_eq!(out["none"], 1);
        assert_eq!(msg_col(&conn, "om_a", "ai_status"), "todo");
        assert_eq!(msg_col(&conn, "om_a", "ai_agent"), "claude-code");
        assert_eq!(msg_col(&conn, "om_c", "ai_status"), "followup");

        // 顶层数组也接受；空 action 按 none；幂等重提覆盖
        let out = suggest_batch_from_str(
            &mut conn,
            r#"[{"messageId":"om_b","reason":"再次确认"}]"#,
            None,
        )
        .unwrap();
        assert_eq!(out["none"], 1);
        assert_eq!(msg_col(&conn, "om_b", "suggested_reason"), "再次确认");

        // 整批校验一损俱损：第 2 条消息不存在 → 全部不落库
        insert_msg(&conn, "om_d", "待覆盖");
        let bad = r#"{"results":[
            {"messageId":"om_d","action":"todo","title":"x"},
            {"messageId":"om_missing","action":"none"}
        ]}"#;
        let err = suggest_batch_from_str(&mut conn, bad, None).unwrap_err();
        assert_eq!(err.1, 1);
        assert!(err.0.contains("om_missing"), "{}", err.0);
        assert!(
            err.0.contains("第 2 条"),
            "错误带序号供 agent 自纠: {}",
            err.0
        );
        assert_eq!(
            msg_col(&conn, "om_d", "ai_status"),
            "pending",
            "失败批次不落库"
        );

        // 同批重复 messageId 拒绝（防 follow-up 重复挂跟进）
        let dup = r#"{"results":[
            {"messageId":"om_d","action":"none"},
            {"messageId":"om_d","action":"none"}
        ]}"#;
        let err = suggest_batch_from_str(&mut conn, dup, None).unwrap_err();
        assert_eq!(err.1, 2);
        assert!(err.0.contains("重复"), "{}", err.0);
    }
}
