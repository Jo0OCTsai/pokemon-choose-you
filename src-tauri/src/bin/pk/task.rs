//! task / note 子命令：建改查、状态生命周期与跟进记录。
use crate::cli::{
    db_err, parse_args, parse_limit, usage_err, validate_choice, CliError, Parsed, VALID_PRIORITY,
    VALID_STATUS,
};
use crate::tag::{resolve_category, resolve_tag_ids, time_value};
use pokemon_choose_you_lib::commands::tasks;
use rusqlite::{params, Connection};
use serde_json::json;

pub(crate) fn run_task(
    conn: &mut Connection,
    rest: &[String],
) -> Result<serde_json::Value, CliError> {
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

pub(crate) fn run_note(conn: &Connection, rest: &[String]) -> Result<serde_json::Value, CliError> {
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

pub(crate) fn ensure_task(conn: &Connection, id: i64, at: &str) -> Result<(), CliError> {
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
