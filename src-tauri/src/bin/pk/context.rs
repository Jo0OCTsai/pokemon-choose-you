//! context 子命令：给 agent 的判重上下文（当前时间、待办、分类、标签、反馈，标题假名化）。
use crate::cli::{db_err, sq_err, CliError};
use pokemon_choose_you_lib::commands::{categories, tags};
use rusqlite::Connection;
use serde_json::json;

pub(crate) fn run_context(conn: &Connection) -> Result<serde_json::Value, CliError> {
    // 输出整体脱敏：待办标题/标签词表里的真名替换成代号（我的称呼 → 「我」），
    // 与消息 prompt 同一套映射，agent 侧「同代号=同人」始终成立
    let rules = pokemon_choose_you_lib::anonymize::AnonRules::build(conn);
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
        .map(|t| {
            json!({ "id": t.id, "name": rules.scrub_titles(&t.name), "description": t.description, "dimension": t.dimension })
        })
        .collect::<Vec<_>>();
    // 维度元信息（AI 提议新标签前对照剩余名额；remaining<=0 禁止新建）
    let dimensions = tags::list_tag_dimensions_conn(conn)
        .map_err(db_err)?
        .into_iter()
        .map(|d| {
            let remaining = tags::dimension_remaining(conn, d.id).unwrap_or(0);
            json!({
                "key": d.key, "name": d.name, "cardinality": d.cardinality,
                "maxTags": d.max_tags, "remaining": remaining,
            })
        })
        .collect::<Vec<_>>();
    // 负反馈：用户多次移除的标签，agent 无明确依据不应再建议
    let tag_feedback = tags::removal_feedback(conn, 30, 2, 3)
        .map_err(db_err)?
        .into_iter()
        .map(|(name, removed)| json!({ "name": rules.scrub_titles(&name), "removed": removed }))
        .collect::<Vec<_>>();
    let open: Vec<serde_json::Value> = open_tasks
        .into_iter()
        .map(|(id, title)| json!({ "id": id, "title": rules.scrub_titles(&title) }))
        .collect();
    Ok(json!({
        "now": chrono::Local::now().format("%Y-%m-%dT%H:%M").to_string(),
        "openTasks": open,
        "categories": cats,
        "tags": tag_list,
        "dimensions": dimensions,
        "tagFeedback": tag_feedback,
    }))
}
