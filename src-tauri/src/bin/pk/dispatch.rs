//! dispatch 子命令：agent 回传派发状态（start/done/failed）。
use crate::cli::{db_err, parse_args, sq_err, usage_err, CliError};
use pokemon_choose_you_lib::commands::dispatch;
use rusqlite::{params, Connection};
use serde_json::json;

/// 回传待办派发状态（状态机见 AGENT_DISPATCH_PROPOSAL §8）：被应用派发处理待办的 agent
/// 完成后调 done（--note 带一句话摘要）、无法完成调 fail；start 领取开工（幂等）。
/// 任务 id：--task 优先，缺省读应用无头派发注入的 PK_DISPATCH_TASK；两者皆空时
/// 静默跳过——Stop hook 挂上后普通（非派发）会话结束不能每次都报错刷屏
pub(crate) fn run_dispatch(
    conn: &mut Connection,
    rest: &[String],
) -> Result<serde_json::Value, CliError> {
    let sub = rest
        .first()
        .map(String::as_str)
        .ok_or_else(|| usage_err("缺少 dispatch 子命令（start / done / fail），用法见 pk help"))?;
    let p = parse_args(&rest[1.min(rest.len())..]);
    let flag = |name: &str| p.flag(name.trim_start_matches('-')).map(str::to_string);
    let task_raw = flag("--task").filter(|v| !v.is_empty()).or_else(|| {
        std::env::var("PK_DISPATCH_TASK")
            .ok()
            .filter(|v| !v.is_empty())
    });
    let Some(task_raw) = task_raw else {
        return Ok(
            json!({"skipped": "未指定 --task 且无 PK_DISPATCH_TASK 派发上下文（普通会话，无需回传）"}),
        );
    };
    let task_id: i64 = task_raw
        .parse()
        .map_err(|_| usage_err("--task 必须是任务 id 数字"))?;
    let note = flag("--note").filter(|v| !v.is_empty());
    match sub {
        "start" => {
            // 领取开工：已 running 幂等成功；NULL/queued 走状态机迁移（带审计日志）
            let cur: Option<String> = conn
                .query_row(
                    "SELECT dispatch_state FROM tasks WHERE id=?1",
                    params![task_id],
                    |r| r.get(0),
                )
                .map_err(sq_err)?;
            match cur.as_deref() {
                Some(dispatch::DS_RUNNING) => Ok(json!({"task": task_id, "state": "running", "idempotent": true})),
                None | Some(dispatch::DS_QUEUED) => {
                    dispatch::dispatch_transition_conn(conn, task_id, Some("running"), None, "pk")
                        .map_err(db_err)?;
                    Ok(json!({"task": task_id, "state": "running"}))
                }
                other => Err(CliError(
                    format!(
                        "待办 No.{task_id} 派发状态为「{}」，不能开工；由应用派发领取 running 后再回传",
                        other.unwrap_or("未派发")
                    ),
                    1,
                )),
            }
        }
        "done" | "fail" => {
            let to = if sub == "done" { "done" } else { "failed" };
            dispatch::dispatch_transition_conn(conn, task_id, Some(to), note.as_deref(), "pk")
                .map_err(db_err)?;
            Ok(json!({ "task": task_id, "state": to }))
        }
        _ => Err(usage_err(&format!(
            "未知 dispatch 子命令「{sub}」（start / done / fail）"
        ))),
    }
}
