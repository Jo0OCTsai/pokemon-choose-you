//! session 子命令：agent 会话记录的落库与分页查询。
use crate::cli::{db_err, parse_args, usage_err, CliError};
use pokemon_choose_you_lib::commands::sessions::{
    list_agent_sessions_conn, log_session_conn, NewAgentSession,
};
use rusqlite::Connection;
use serde_json::json;

pub(crate) fn run_session(
    conn: &Connection,
    rest: &[String],
) -> Result<serde_json::Value, CliError> {
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
                    // agent 侧补录：pk 在哪跑，会话就在哪个目录（agent 的 cwd）
                    kind: "pk".into(),
                    session_id: flag("--session").filter(|v| !v.is_empty()),
                    command: flag("--command").filter(|v| !v.is_empty()),
                    exit_code: num_flag("--exit-code")?,
                    status: flag("--status").unwrap_or_else(|| "ok".into()),
                    duration_ms: num_flag("--duration-ms")?,
                    cost_usd,
                    input_tokens: num_flag("--in-tokens")?,
                    output_tokens: num_flag("--out-tokens")?,
                    workdir: std::env::current_dir()
                        .map(|p| p.to_string_lossy().into_owned())
                        .unwrap_or_default(),
                    tmux_session: String::new(),
                    remote_host: String::new(),
                    remote_port: 0,
                    remote_key: String::new(),
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
