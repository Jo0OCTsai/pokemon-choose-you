//! tag 子命令与标签/分类解析（供 task 等子命令共用）。
use crate::cli::{db_err, parse_args, usage_err, CliError};
use pokemon_choose_you_lib::commands::tags;
use rusqlite::{params, Connection};
use serde_json::json;

/// 标签名 → id 列表（--tags a,b 按名解析；同名跨维度时报错提示归一）。
/// 未知标签报错（agent 可先 `pk tag list` 查看，或 `pk tag create` 新建）
pub(crate) fn resolve_tag_ids(conn: &Connection, spec: &str) -> Result<Vec<i64>, CliError> {
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
        let hits: Vec<&pokemon_choose_you_lib::models::Tag> =
            all.iter().filter(|t| &t.name == name).collect();
        match hits.as_slice() {
            [only] => ids.push(only.id),
            [] => unknown.push(name.clone()),
            many => {
                let dims: Vec<&str> = many.iter().map(|t| t.dimension.as_str()).collect();
                return Err(CliError(
                    format!(
                        "标签名「{name}」同时存在于维度 {}，请用 pk tag list 确认后在应用里归一",
                        dims.join("/")
                    ),
                    1,
                ));
            }
        }
    }
    if !unknown.is_empty() {
        return Err(CliError(
            format!(
                "未知标签：{}。可用标签见 pk tag list，或用 pk tag create 新建",
                unknown.join("、")
            ),
            1,
        ));
    }
    Ok(ids)
}

/// 分类名 → id（只认启用中的分类；未知报错）
pub(crate) fn resolve_category(conn: &Connection, name: &str) -> Result<i64, CliError> {
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
pub(crate) fn time_value(v: &str) -> serde_json::Value {
    if v.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::Value::String(v.to_string())
    }
}

/// tag 子命令：list（含维度）/ create（agent 自助扩词表，origin=agent）
pub(crate) fn run_tag(conn: &Connection, rest: &[String]) -> Result<serde_json::Value, CliError> {
    let sub = rest.first().map(String::as_str).unwrap_or("list");
    match sub {
        "list" => Ok(json!({
            "dimensions": tags::list_tag_dimensions_conn(conn).map_err(db_err)?,
            "tags": tags::list_tags_conn(conn).map_err(db_err)?,
        })),
        "create" => {
            let p = parse_args(&rest[1..]);
            let name = p.positional(0, "标签名")?;
            let description = p.flag("description").unwrap_or("").to_string();
            let dimension = p.flag("dimension").unwrap_or("topic").to_string();
            let t = tags::create_tag_conn(conn, &name, &description, &dimension, "agent")
                .map_err(db_err)?;
            Ok(json!({ "created": t }))
        }
        other => Err(usage_err(&format!(
            "未知 tag 子命令「{other}」，可用：list / create"
        ))),
    }
}
