//! suggest 子命令：AI 判定写回（单条 / 批量）、校验与假名还原。
use crate::cli::{
    cli_log, db_err, parse_args, sq_err, usage_err, validate_choice, CliError, VALID_CONFIDENCE,
    VALID_PRIORITY,
};
use crate::tag::resolve_category;
use crate::task::ensure_task;
use pokemon_choose_you_lib::ai::{AiSuggestion, ProposedTag};
use pokemon_choose_you_lib::anonymize;
use pokemon_choose_you_lib::commands::radio::apply_suggestion_conn;
use pokemon_choose_you_lib::commands::tags;
use rusqlite::{params, Connection};
use serde_json::json;

/// 提交 AI 判定建议：单条命令供 agent 交互场景与人工调试，
/// batch 供无头分类流程一次提交整批（stdin JSON 与应用文本协议同构）。
/// todo/update 写建议列待用户确认，follow-up 直接挂跟进，none 只记状态；
/// 重复提交同一消息为覆盖写（幂等），已人工确认过的消息拒绝再提交。
pub(crate) fn run_suggest(
    conn: &mut Connection,
    rest: &[String],
) -> Result<serde_json::Value, CliError> {
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
    // --tags 只有名字：按 topic 维度、词表内解析（校验与落库均有按名兜底）
    let tags = match p.flag("tags") {
        Some(t) if !t.is_empty() => t
            .split([',', '，'])
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|name| ProposedTag {
                name: name.to_string(),
                dimension: "topic".into(),
                is_new: false,
            })
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
    let mut s = s;
    restore_suggestion(conn, &mut s);
    validate_suggestion(conn, &s, 1)?;
    apply_suggestion(conn, &s, agent)?;
    Ok(json!({ "applied": s.action, "message": s.message_id, "agent": agent }))
}

/// 建议回写的文本字段反向还原：模型看到与输出的是代号，落库给用户看的必须是真名。
/// 未知代号（模型幻觉/无真名行）原样保留，便于排查。
fn restore_suggestion(conn: &Connection, s: &mut AiSuggestion) {
    if let Some(t) = s.title.take() {
        s.title = Some(anonymize::restore(conn, &t));
    }
    if let Some(n) = s.note.take() {
        s.note = Some(anonymize::restore(conn, &n));
    }
    if let Some(r) = s.reason.take() {
        s.reason = Some(anonymize::restore(conn, &r));
    }
    for t in &mut s.tags {
        t.name = anonymize::restore(conn, &t.name);
    }
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

/// batch 的解析与落库（与 stdin 读取分离，便于测试）：整批先校验再单事务落库，一损俱损。
/// agent 回写的代号先反向还原成真名（发生在校验前——词表按真名匹配），用户可见文本不含代号
pub(crate) fn suggest_batch_from_str(
    conn: &mut Connection,
    body: &str,
    agent_flag: Option<&str>,
) -> Result<serde_json::Value, CliError> {
    let mut list = parse_batch(body)?;
    if list.is_empty() {
        return Err(usage_err("results 为空，无可提交的建议"));
    }
    for s in &mut list {
        restore_suggestion(conn, s);
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
    let line = format!(
        "suggest batch 提交 {} 条（todo {} / update {} / followUp {} / none {}）agent={}",
        list.len(),
        n_todo,
        n_update,
        n_follow,
        list.len() - n_todo - n_update - n_follow,
        agent
    );
    cli_log("INFO", &line);
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
        let all = tags::list_tags_conn(conn).map_err(db_err)?;
        for t in &s.tags {
            if t.is_new {
                // 新标签：维度必须存在且未满（提前报错让 agent 自纠，改选现有标签或换维度）
                let dim_id = tags::dimension_id_by_key(conn, &t.dimension).map_err(db_err)?;
                if tags::dimension_remaining(conn, dim_id).map_err(db_err)? <= 0 {
                    return Err(CliError(
                        format!(
                            "{at}:维度「{}」标签已满，不能新建「{}」",
                            t.dimension, t.name
                        ),
                        1,
                    ));
                }
            } else {
                let hit = all
                    .iter()
                    .find(|x| x.name == t.name && x.dimension == t.dimension)
                    .or_else(|| all.iter().find(|x| x.name == t.name));
                if hit.is_none() {
                    return Err(CliError(
                        format!(
                            "{at}:未知标签「{}」。词表内标签见 pk tag list；新标签须 isNew=true 并带 dimension",
                            t.name
                        ),
                        1,
                    ));
                }
            }
        }
    }
    Ok(())
}
