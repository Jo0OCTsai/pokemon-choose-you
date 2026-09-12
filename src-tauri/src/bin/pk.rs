//! pk — 宝可梦来敲门命令行工具。
//!
//! 供 AI agent CLI（claude code / opencode / kiro …）与终端用户直接读写待办库：
//! - 全部输出为 UTF-8 JSON（stdout），错误输出 JSON 到 stderr 并以非零码退出；
//! - 与桌面应用共用同一套数据逻辑（conn 层函数），保证状态机不变量与操作日志一致；
//! - 通过 WAL 与运行中的应用并发读写，PK_DB 环境变量可覆盖数据库路径。

/// 随包分发的 agent 技能模板（教 agent 用 pk 管待办）
const SKILL_MD: &str = include_str!("../../skills/pokemon-knock.md");

use pokemon_knock_lib::commands::sessions::{
    list_agent_sessions_conn, log_session_conn, NewAgentSession,
};
use pokemon_knock_lib::commands::{categories, tags, tasks};
use rusqlite::{params, Connection};
use serde_json::json;

const HELP: &str = r#"pk — 宝可梦来敲门命令行（供 AI agent 与终端使用）

用法:
  pk <命令> [参数]...

命令:
  task list [open|done|today|all]    任务列表（默认 open：未完成待办）
  task get <id>                      任务详情（含跟进记录）
  task search <关键词>                搜索标题/备注/跟进记录/标签
  task create --title <t> [--note <n>] [--category <分类名>] [--priority low|normal|high|urgent]
                [--due <YYYY-MM-DDTHH:MM>] [--scheduled] [--tags <a,b>]
  task update <id> [--title <t>] [--note <n>] [--category <分类名>] [--priority <p>]
                [--due <时间>] [--remind <时间>] [--status <状态>] [--tags <a,b>]
                （--due/--remind 传空串 "" 表示清空）
  task done <id>                     完成任务
  task start <id>                    开始任务（全局唯一进行中）
  task pause                         暂停当前进行中的任务
  task current                       查看当前进行中的任务
  task delete <id>                   删除任务
  note add <task-id> <内容...> [--source manual|ai]
  note list <task-id>
  log <task-id>                      任务操作历史
  session log [--task <id>] --agent <id> [--session <sid>] [--command <c>] [--exit-code <n>]
                [--status ok|error] [--duration-ms <n>] [--cost <美元>] [--in-tokens <n>] [--out-tokens <n>]
                                      记录一次 agent 会话（成本/时长/退出码，可关联任务）
  session list [--task <id>]         会话列表（--task 查该任务的时间线）
  skill install <claude-code|opencode> [--dir <目录>]
                                      一键安装 pk 使用技能到 agent 的技能目录（对标 td skill install）
  skill show                         打印技能内容（Markdown 原文，可重定向给任意 agent）
  category list                      分类列表
  tag list                           标签列表
  context                            AI 处理上下文（当前时间/未完成待办/分类/标签）
  init-db                            初始化 PK_DB 指定的空库（应用主库通常无需执行）
  help                               本帮助

示例:
  pk task list open
  pk task get 3
  pk task create --title "交周报" --due "2026-09-13T18:00" --tags 重要,需汇报
  pk task update 3 --priority high --due ""
  pk note add 3 对方确认周五交付 --source ai
  pk session log --task 3 --agent claude-code --session abc123 --cost 0.12 --duration-ms 61000
  pk session list --task 3
  pk skill install claude-code

输出: JSON（stdout）。错误: {"error": "..."}（stderr），退出码 1（业务）/ 2（用法）。
环境变量: PK_DB 覆盖数据库路径（默认为应用数据目录 pokemon-knock.db）。"#;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty()
        || args
            .iter()
            .any(|a| a == "help" || a == "--help" || a == "-h")
    {
        println!("{HELP}");
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

/// 与 tauri 的 app_data_dir 同一规则：config_dir/<identifier>/pokemon-knock.db
fn default_db_path() -> Result<std::path::PathBuf, String> {
    let cfg = dirs::config_dir().ok_or_else(|| "无法定位用户配置目录".to_string())?;
    Ok(cfg.join("com.joeca.pokemonknock").join("pokemon-knock.db"))
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

fn db_err(e: pokemon_knock_lib::error::AppError) -> CliError {
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
        "skill" => run_skill(rest),
        "context" => run_context(conn),
        "init-db" => {
            // 显式引导（PK_DB 独立库场景）：建库 + 迁移 + 默认分类；对应用主库通常无需执行
            pokemon_knock_lib::db::init_conn(conn).map_err(|e| CliError(e.to_string(), 1))?;
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
            let list = tasks::list_tasks_conn(conn, filter).map_err(db_err)?;
            Ok(json!({ "filter": filter, "count": list.len(), "tasks": list }))
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
        "claude-code" | "claude" => Ok(home.join(".claude").join("skills").join("pokemon-knock")),
        "opencode" => Ok(home
            .join(".config")
            .join("opencode")
            .join("skill")
            .join("pokemon-knock")),
        other => Err(usage_err(&format!(
            "暂不认识 agent「{other}」的技能目录：支持 claude-code / opencode，其他 agent 用 --dir <目录> 指定，或 pk skill show 自行粘贴"
        ))),
    }
}

/// 安装/展示 agent 技能。skill show 直接打印 Markdown 原文（不走 JSON，方便重定向）
fn run_skill(rest: &[String]) -> Result<serde_json::Value, CliError> {
    let sub = rest.first().map(String::as_str).unwrap_or("");
    let p = parse_args(&rest[1.min(rest.len())..]);
    let dir_flag = p.flag("dir").map(str::to_string);
    match sub {
        "show" => {
            print!("{SKILL_MD}");
            std::process::exit(0);
        }
        "install" => {
            let agent = p.positional(0, "agent 名（claude-code / opencode）")?;
            let dir = skill_dir_for(&agent, dir_flag.as_deref())?;
            std::fs::create_dir_all(&dir)
                .map_err(|e| CliError(format!("创建技能目录失败: {e}"), 1))?;
            let path = dir.join("SKILL.md");
            let existed = path.exists();
            std::fs::write(&path, SKILL_MD)
                .map_err(|e| CliError(format!("写入技能失败: {e}"), 1))?;
            Ok(json!({
                "installed": true,
                "updated": existed,
                "agent": agent,
                "path": path.to_string_lossy(),
            }))
        }
        _ => Err(usage_err("skill 子命令支持 install / show，用法见 pk help")),
    }
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
    use pokemon_knock_lib::db;

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
            Some(6),
            "内置六分类"
        );

        let ctx = run_ok(&mut conn, &["context"]);
        assert!(ctx["now"].is_string());
        assert_eq!(
            ctx["categories"].as_array().map(Vec::len),
            Some(6),
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
        let md = std::fs::read_to_string(dir.join("SKILL.md")).unwrap();
        assert!(md.contains("pk task create"), "技能内容含命令速查");
        assert!(md.contains("name: pokemon-knock"), "带 frontmatter");

        // 重复安装标记为更新
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
        assert_eq!(out["updated"], true);

        // 未知 agent 给出 --dir 出路
        let err = run_err(&mut conn, &["skill", "install", "kiro"]);
        assert_eq!(err.1, 2);
        assert!(err.0.contains("--dir"), "{}", err.0);

        // 目录规则：claude-code / opencode 的落点结构正确（不实际写）
        let claude = skill_dir_for("claude-code", None).unwrap_or_else(|e| panic!("{}", e.0));
        assert!(
            claude.ends_with(".claude/skills/pokemon-knock")
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
    fn unknown_commands_are_usage_errors() {
        let mut conn = test_db();
        let err = run_err(&mut conn, &["nonsense"]);
        assert_eq!(err.1, 2);
        let err = run_err(&mut conn, &["task", "fly"]);
        assert_eq!(err.1, 2);
        let err = run_err(&mut conn, &["task", "get", "abc"]);
        assert_eq!(err.1, 2, "非数字 id 是用法错误");
    }
}
