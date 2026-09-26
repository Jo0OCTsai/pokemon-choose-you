//! CLI 基础设施：错误类型与退出码、日志行、数据库连接、参数解析与通用取值校验。
use rusqlite::Connection;
use serde_json::json;

#[derive(Debug)]
pub(crate) struct CliError(pub(crate) String, pub(crate) i32);

impl From<String> for CliError {
    fn from(msg: String) -> Self {
        CliError(msg, 1)
    }
}

pub(crate) fn fail(msg: &str, code: i32) -> ! {
    cli_log("ERROR", &format!("失败退出（码 {code}）: {msg}"));
    eprintln!("{}", json!({ "error": msg }));
    std::process::exit(code);
}

/// 往应用日志文件追加一行轨迹。格式与 tauri-plugin-log 一致
/// （`[日期][时间][target][级别] 消息`，时间为 UTC），诊断页日志视图按此解析；
/// 单行一次 O_APPEND 写入，与应用进程的写入交错安全；任何失败静默放弃（日志不碍主流程）。
pub(crate) fn cli_log(level: &str, msg: &str) {
    let Some(path) = std::env::var_os("PK_LOG_FILE") else {
        return;
    };
    let line = format_log_line(chrono::Utc::now(), level, msg);
    use std::io::Write as _;
    let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    else {
        return;
    };
    let _ = writeln!(f, "{line}");
}

pub(crate) fn format_log_line(
    now: chrono::DateTime<chrono::Utc>,
    level: &str,
    msg: &str,
) -> String {
    format!(
        "[{}][{}][pk][{}] {}",
        now.format("%Y-%m-%d"),
        now.format("%H:%M:%S"),
        level,
        msg.replace('\n', " ")
    )
}

/// 与应用同一解析（db::app_home）：CHOOSE_YOU_HOME 优先，缺省 ~/.choose-you/data/<db>。
/// 旧版默认在系统应用数据目录（data_dir/<identifier>/），由应用启动时一次性迁入新布局
pub(crate) fn default_db_path() -> Result<std::path::PathBuf, String> {
    let home =
        pokemon_choose_you_lib::db::app_home().ok_or_else(|| "无法定位用户主目录".to_string())?;
    Ok(home
        .join(pokemon_choose_you_lib::db::DATA_SUBDIR)
        .join(pokemon_choose_you_lib::db::DB_FILE))
}

/// 打开应用数据库：平时不做迁移（应用可能比 CLI 旧，抢跑迁移会让应用拒绝启动）；
/// 设置 busy_timeout，与运行中的应用并发读写时等待而非立刻报 BUSY。
/// tolerate_missing 供 init-db 引导独立库（连父目录一并创建；归一化布局下
/// data/ 未必已由应用建好，裸机引导不能挂在这一步）
pub(crate) fn open_db(tolerate_missing: bool) -> Result<Connection, String> {
    let path = match std::env::var_os("PK_DB") {
        Some(p) => std::path::PathBuf::from(p),
        None => default_db_path()?,
    };
    if !path.exists() {
        if !tolerate_missing {
            return Err(format!(
                "数据库不存在：{}。请先启动一次应用（或运行 pk init-db），也可用 PK_DB 环境变量指定路径",
                path.display()
            ));
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建数据库目录失败: {e}"))?;
        }
    }
    let conn = Connection::open(&path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;")
        .map_err(|e| format!("初始化数据库失败: {e}"))?;
    Ok(conn)
}

/// 已解析的命令行：位置参数 + 旗标（--key [value]，value 缺省为空串表示布尔旗标）
pub(crate) struct Parsed {
    pub(crate) positionals: Vec<String>,
    pub(crate) flags: Vec<(String, String)>,
}

pub(crate) fn parse_args(args: &[String]) -> Parsed {
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
    pub(crate) fn flag(&self, key: &str) -> Option<&str> {
        self.flags
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }
    pub(crate) fn positional(&self, i: usize, what: &str) -> Result<String, CliError> {
        self.positionals
            .get(i)
            .cloned()
            .ok_or_else(|| CliError(format!("缺少{what}，用法见 pk help"), 2))
    }
}

pub(crate) fn usage_err(msg: &str) -> CliError {
    CliError(msg.to_string(), 2)
}

pub(crate) fn db_err(e: pokemon_choose_you_lib::error::AppError) -> CliError {
    CliError(e.to_string(), 1)
}

/// rusqlite 裸错误（context 里的手写 SQL）→ CliError
pub(crate) fn sq_err(e: rusqlite::Error) -> CliError {
    CliError(format!("数据库错误: {e}"), 1)
}

pub(crate) const VALID_STATUS: &[&str] = &[
    "inbox",
    "scheduled",
    "active",
    "paused",
    "done",
    "cancelled",
];

pub(crate) const VALID_PRIORITY: &[&str] = &["low", "normal", "high", "urgent"];

pub(crate) fn validate_choice(value: &str, allowed: &[&str], what: &str) -> Result<(), CliError> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(CliError(
            format!("{what}「{value}」无效，可选：{}", allowed.join("/")),
            2,
        ))
    }
}

pub(crate) const VALID_CONFIDENCE: &[&str] = &["high", "medium", "low"];

/// task list 的 --limit：缺省 50；`all`（或 0）不截断
pub(crate) fn parse_limit(p: &Parsed) -> Result<Option<usize>, CliError> {
    match p.flag("limit") {
        None => Ok(Some(50)),
        Some(v) if v.eq_ignore_ascii_case("all") || v == "0" => Ok(None),
        Some(v) => v
            .parse::<usize>()
            .map(Some)
            .map_err(|_| usage_err("--limit 须是正整数或 all")),
    }
}
