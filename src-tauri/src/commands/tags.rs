use crate::db::{now, Db};
use crate::error::{AppError, AppResult};
use crate::events;
use crate::models::{Tag, TagDimension, TagMeta};
use rusqlite::{params, Connection};
use tauri::State;

/// 兜底维度 key：未指明维度的创建/解析请求归主题
pub const DEFAULT_DIMENSION: &str = "topic";

/// tags.meta 列（JSON）解析：空/坏数据按无元数据处理，不让一条脏行拖垮整个列表
pub(crate) fn parse_tag_meta(raw: Option<String>) -> Option<TagMeta> {
    let raw = raw?.trim().to_string();
    if raw.is_empty() {
        return None;
    }
    match serde_json::from_str::<TagMeta>(&raw) {
        Ok(m) => Some(m),
        Err(e) => {
            log::warn!("tags: meta 列 JSON 解析失败（按无元数据处理）: {e}");
            None
        }
    }
}

#[tauri::command]
pub fn list_tags(db: State<Db>) -> AppResult<Vec<Tag>> {
    let conn = db.0.lock().unwrap();
    list_tags_conn(&conn)
}

/// conn 版标签列表（pk CLI 复用）：带维度/来源/使用数/派发元数据，按维度序 + id 序
pub fn list_tags_conn(conn: &rusqlite::Connection) -> AppResult<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, t.description, d.key, t.origin, t.created_at,
                (SELECT COUNT(*) FROM task_tags tt WHERE tt.tag_id = t.id), t.meta
         FROM tags t JOIN tag_dimensions d ON d.id = t.dimension_id
         ORDER BY d.sort, t.id",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Tag {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                dimension: r.get(3)?,
                origin: r.get(4)?,
                created_at: r.get(5)?,
                usage: r.get(6)?,
                meta: parse_tag_meta(r.get(7)?),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

// ---- 维度 ----

#[tauri::command]
pub fn list_tag_dimensions(db: State<Db>) -> AppResult<Vec<TagDimension>> {
    let conn = db.0.lock().unwrap();
    list_tag_dimensions_conn(&conn)
}

/// conn 版维度列表（pk CLI 复用）
pub fn list_tag_dimensions_conn(conn: &rusqlite::Connection) -> AppResult<Vec<TagDimension>> {
    let mut stmt = conn.prepare(
        "SELECT d.id, d.key, d.name, d.cardinality, d.max_tags, d.sort, d.enabled
         FROM tag_dimensions d ORDER BY d.sort, d.id",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(TagDimension {
                id: r.get(0)?,
                key: r.get(1)?,
                name: r.get(2)?,
                cardinality: r.get(3)?,
                max_tags: r.get(4)?,
                sort: r.get(5)?,
                enabled: r.get::<_, i64>(6)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// 维度 key → id（不存在或空 key 回落 topic；topic 也缺时错——库未初始化）
pub fn dimension_id_by_key(conn: &Connection, key: &str) -> AppResult<i64> {
    let key = if key.trim().is_empty() {
        DEFAULT_DIMENSION
    } else {
        key.trim()
    };
    conn.query_row(
        "SELECT id FROM tag_dimensions WHERE key=?1",
        params![key],
        |r| r.get(0),
    )
    .map_err(|_| AppError::Invalid(format!("未知标签维度「{key}」")))
}

/// 维度剩余可新建名额（无上限约束的值不影响：负数只会出现在超配额的库）
pub fn dimension_remaining(conn: &Connection, dim_id: i64) -> AppResult<i64> {
    let (max, used): (i64, i64) = conn.query_row(
        "SELECT (SELECT max_tags FROM tag_dimensions WHERE id=?1),
                (SELECT COUNT(*) FROM tags WHERE dimension_id=?1)",
        params![dim_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(max - used)
}

/// 近 N 天用户从待办上移除的标签聚合（task_logs 的 tags diff：old 有而 new 无的名字）。
/// 出现 >= min_count 次的名字作为分类 prompt 的负反馈——「无明确依据不要再建议」，
/// 防错误反馈固化：只统计窗口期内、只取高频（>= 2 次）、条数封顶
pub fn removal_feedback(
    conn: &Connection,
    days: i64,
    min_count: i64,
    cap: usize,
) -> AppResult<Vec<(String, i64)>> {
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(days)).to_rfc3339();
    let mut stmt = conn.prepare(
        "SELECT old_value, new_value FROM task_logs
         WHERE action='update' AND field='tags' AND created_at >= ?1
         ORDER BY id DESC LIMIT 500",
    )?;
    let rows: Vec<(Option<String>, Option<String>)> = stmt
        .query_map(params![cutoff], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut counts: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for (old, new) in rows {
        let Some(old) = old.filter(|s| !s.is_empty()) else {
            continue;
        };
        let new = new.unwrap_or_default();
        let kept: std::collections::HashSet<&str> = new
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect();
        for name in old.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            if !kept.contains(name) {
                *counts.entry(name.to_string()).or_default() += 1;
            }
        }
    }
    let mut list: Vec<(String, i64)> = counts
        .into_iter()
        .filter(|(_, n)| *n >= min_count)
        .collect();
    list.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    list.truncate(cap);
    Ok(list)
}

#[tauri::command]
pub fn create_tag_dimension<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    key: String,
    name: String,
    cardinality: Option<String>,
    max_tags: Option<i64>,
) -> AppResult<TagDimension> {
    let key = key.trim().to_lowercase();
    let name = name.trim().to_string();
    if key.is_empty() || name.is_empty() {
        return Err(AppError::Invalid("维度 key 与名称不能为空".into()));
    }
    if !key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::Invalid(
            "维度 key 只能包含小写字母、数字、-、_（AI 协议里的稳定标识）".into(),
        ));
    }
    let cardinality = match cardinality.as_deref() {
        Some("single") | None => "single",
        Some(_) => "multi",
    }
    .to_string();
    let max_tags = max_tags.unwrap_or(20).clamp(1, 200);
    let conn = db.0.lock().unwrap();
    let sort: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort), 0) + 1 FROM tag_dimensions",
        [],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO tag_dimensions (key, name, cardinality, max_tags, sort) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![key, name, cardinality, max_tags, sort],
    )?;
    let id = conn.last_insert_rowid();
    drop(conn);
    events::broadcast(&app, events::TAGS_CHANGED);
    Ok(TagDimension {
        id,
        key,
        name,
        cardinality,
        max_tags,
        sort,
        enabled: true,
    })
}

/// 维度改名/调上限/停用：key 与 cardinality 建后不可改（前者是协议标识，后者牵涉存量数据语义）
#[tauri::command]
pub fn update_tag_dimension<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    id: i64,
    name: String,
    max_tags: Option<i64>,
    enabled: Option<bool>,
) -> AppResult<()> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Invalid("维度名称不能为空".into()));
    }
    let conn = db.0.lock().unwrap();
    let n = conn.execute(
        "UPDATE tag_dimensions SET name=?2,
                max_tags=COALESCE(?3, max_tags),
                enabled=COALESCE(?4, enabled)
         WHERE id=?1",
        params![
            id,
            name,
            max_tags.map(|m| m.clamp(1, 200)),
            enabled.map(|b| b as i64),
        ],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("维度 {id} 不存在")));
    }
    drop(conn);
    events::broadcast(&app, events::TAGS_CHANGED);
    Ok(())
}

// ---- 标签 ----

#[tauri::command]
pub fn create_tag<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    name: String,
    description: Option<String>,
    dimension: Option<String>,
) -> AppResult<Tag> {
    let tag = {
        let conn = db.0.lock().unwrap();
        create_tag_conn(
            &conn,
            &name,
            description.as_deref().unwrap_or_default(),
            dimension.as_deref().unwrap_or(DEFAULT_DIMENSION),
            "manual",
        )?
    };
    events::broadcast(&app, events::TAGS_CHANGED);
    Ok(tag)
}

/// conn 版创建（radio 接受建议 / pk CLI / 自然语言捕捉复用）：
/// 归一空白、按维度查重（同名已存在直接复用——AI 建议 idempotent）、维度配额闸门
pub fn create_tag_conn(
    conn: &Connection,
    name: &str,
    description: &str,
    dimension: &str,
    origin: &str,
) -> AppResult<Tag> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Invalid("标签名不能为空".into()));
    }
    let dim_id = dimension_id_by_key(conn, dimension)?;
    // 幂等：同名同维度已存在直接返回（不覆盖描述，保留用户手写的说明）
    if let Ok(id) = conn.query_row(
        "SELECT id FROM tags WHERE name=?1 AND dimension_id=?2",
        params![name, dim_id],
        |r| r.get::<_, i64>(0),
    ) {
        return tag_by_id(conn, id);
    }
    if dimension_remaining(conn, dim_id)? <= 0 {
        let dim_name: String = conn.query_row(
            "SELECT name FROM tag_dimensions WHERE id=?1",
            params![dim_id],
            |r| r.get(0),
        )?;
        return Err(AppError::Invalid(format!(
            "「{dim_name}」维度标签已满（上限），先在设置里合并或清理后再新建"
        )));
    }
    conn.execute(
        "INSERT INTO tags (name, description, dimension_id, origin, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![name, description, dim_id, origin, now()],
    )?;
    tag_by_id(conn, conn.last_insert_rowid())
}

fn tag_by_id(conn: &Connection, id: i64) -> AppResult<Tag> {
    conn.query_row(
        "SELECT t.id, t.name, t.description, d.key, t.origin, t.created_at,
                (SELECT COUNT(*) FROM task_tags tt WHERE tt.tag_id = t.id), t.meta
         FROM tags t JOIN tag_dimensions d ON d.id = t.dimension_id WHERE t.id=?1",
        params![id],
        |r| {
            Ok(Tag {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                dimension: r.get(3)?,
                origin: r.get(4)?,
                created_at: r.get(5)?,
                usage: r.get(6)?,
                meta: parse_tag_meta(r.get(7)?),
            })
        },
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("标签 {id} 不存在")),
        other => AppError::Db(other),
    })
}

#[tauri::command]
pub fn update_tag<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    id: i64,
    name: String,
    description: Option<String>,
    dimension: Option<String>,
) -> AppResult<()> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Invalid("标签名不能为空".into()));
    }
    let dim_id = match dimension.as_deref() {
        Some(d) => Some(dimension_id_by_key(&db.0.lock().unwrap(), d)?),
        None => None,
    };
    let n = db.0.lock().unwrap().execute(
        "UPDATE tags SET name=?2, description=?3,
                dimension_id=COALESCE(?4, dimension_id)
         WHERE id=?1",
        params![id, name, description.unwrap_or_default(), dim_id],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("标签 {id} 不存在")));
    }
    events::broadcast(&app, events::TAGS_CHANGED);
    Ok(())
}

/// 删除标签：任务上的关联随外键级联清理（task_tags 手动删，无外键约束）
#[tauri::command]
pub fn delete_tag<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    id: i64,
) -> AppResult<()> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM task_tags WHERE tag_id=?1", params![id])?;
    conn.execute("DELETE FROM tags WHERE id=?1", params![id])?;
    drop(conn);
    events::broadcast(&app, events::TAGS_CHANGED);
    events::broadcast(&app, events::TASKS_CHANGED);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::windows::PendingMainReopen;
    use crate::db::tests::test_conn;
    use crate::db::Db;
    use std::sync::Mutex;
    use tauri::Manager;

    fn setup() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(Db(Mutex::new(test_conn())));
        app.manage(PendingMainReopen(std::sync::atomic::AtomicBool::new(false)));
        app
    }

    fn tags(app: &tauri::App<tauri::test::MockRuntime>) -> Vec<Tag> {
        let db = app.state::<Db>();
        list_tags(db).unwrap()
    }

    #[test]
    fn tag_crud_roundtrip() {
        let app = setup();
        let tag = {
            let db = app.state::<Db>();
            create_tag(
                app.handle().clone(),
                db,
                "PokemonApp".into(),
                Some("应用开发".into()),
                Some("project".into()),
            )
            .unwrap()
        };
        assert!(tag.id > 0);
        assert_eq!(tag.dimension, "project");
        assert_eq!(tag.origin, "manual");
        {
            let db = app.state::<Db>();
            update_tag(
                app.handle().clone(),
                db,
                tag.id,
                "PokemonApp v2".into(),
                Some("改了".into()),
                Some("topic".into()),
            )
            .unwrap();
        }
        let got = tags(&app);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "PokemonApp v2");
        assert_eq!(got[0].description, "改了");
        assert_eq!(got[0].dimension, "topic", "维度可迁移");
        {
            let db = app.state::<Db>();
            delete_tag(app.handle().clone(), db, tag.id).unwrap();
        }
        assert!(tags(&app).is_empty());
    }

    #[test]
    fn create_tag_rejects_blank_and_dimension_duplicates() {
        let app = setup();
        let err = {
            let db = app.state::<Db>();
            create_tag(app.handle().clone(), db, "  ".into(), None, None).unwrap_err()
        };
        assert!(matches!(err, AppError::Invalid(_)));
        let first = {
            let db = app.state::<Db>();
            create_tag(app.handle().clone(), db, "重要".into(), None, None).unwrap()
        };
        // 同维度重名：幂等复用（AI 建议重放 / 设置页双击都不会炸）
        let again = {
            let db = app.state::<Db>();
            create_tag(app.handle().clone(), db, "重要".into(), None, None).unwrap()
        };
        assert_eq!(first.id, again.id, "同名同维度复用既有标签");
        // 不同维度同名允许
        {
            let db = app.state::<Db>();
            create_tag(
                app.handle().clone(),
                db,
                "重要".into(),
                None,
                Some("project".into()),
            )
            .unwrap();
        }
        // 未知维度报输入错误
        let err = {
            let db = app.state::<Db>();
            create_tag(
                app.handle().clone(),
                db,
                "x".into(),
                None,
                Some("nope".into()),
            )
            .unwrap_err()
        };
        assert!(matches!(err, AppError::Invalid(_)));
    }

    /// conn 版创建幂等：同名同维度复用既有标签（AI 建议重放不报错）
    #[test]
    fn create_tag_conn_is_idempotent_within_dimension() {
        let conn = test_conn();
        let a = create_tag_conn(&conn, "新项目", "", "project", "ai").unwrap();
        let b = create_tag_conn(&conn, "新项目", "忽略描述", "project", "ai").unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(b.description, "", "复用不覆盖既有描述");
        let c = create_tag_conn(&conn, "新项目", "", "person", "ai").unwrap();
        assert_ne!(a.id, c.id, "跨维度同名是不同标签");
    }

    /// 配额闸门：维度满后拒绝新建（场景维度种子上限 10）
    #[test]
    fn create_tag_conn_enforces_dimension_quota() {
        let conn = test_conn();
        for i in 0..10 {
            create_tag_conn(&conn, &format!("场景{i}"), "", "context", "manual").unwrap();
        }
        let err = create_tag_conn(&conn, "挤不进", "", "context", "ai").unwrap_err();
        assert!(err.to_string().contains("已满"), "{err}");
        // 其他维度不受影响
        create_tag_conn(&conn, "没问题", "", "topic", "ai").unwrap();
    }

    #[test]
    fn update_missing_tag_is_not_found() {
        let app = setup();
        let err = {
            let db = app.state::<Db>();
            update_tag(app.handle().clone(), db, 999, "x".into(), None, None).unwrap_err()
        };
        assert!(matches!(err, AppError::NotFound(_)));
    }

    /// 删除标签时任务上的关联一并清理
    #[test]
    fn delete_tag_clears_task_links() {
        let app = setup();
        let tag_id = {
            let db = app.state::<Db>();
            create_tag(app.handle().clone(), db, "需汇报".into(), None, None)
                .unwrap()
                .id
        };
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO tasks (title, status, created_at) VALUES ('任务A', 'inbox', '2026-09-01T00:00:00Z')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO task_tags (task_id, tag_id) VALUES (1, ?1)",
                params![tag_id],
            )
            .unwrap();
        }
        {
            let db = app.state::<Db>();
            delete_tag(app.handle().clone(), db, tag_id).unwrap();
        }
        let links: i64 = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.query_row("SELECT COUNT(*) FROM task_tags", [], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(links, 0);
    }

    /// 维度 CRUD：key 校验、排序自增、改名/上限/停用
    #[test]
    fn tag_dimension_crud() {
        let app = setup();
        let err = {
            let db = app.state::<Db>();
            create_tag_dimension(
                app.handle().clone(),
                db,
                "非法 key!".into(),
                "x".into(),
                None,
                None,
            )
            .unwrap_err()
        };
        assert!(matches!(err, AppError::Invalid(_)));
        let d = {
            let db = app.state::<Db>();
            create_tag_dimension(
                app.handle().clone(),
                db,
                "energy".into(),
                "精力".into(),
                Some("multi".into()),
                Some(5),
            )
            .unwrap()
        };
        assert!(d.id > 4, "内置维度固定 1~4，新维度排后");
        assert_eq!(d.sort, 5);
        {
            let db = app.state::<Db>();
            update_tag_dimension(
                app.handle().clone(),
                db,
                d.id,
                "精力（改）".into(),
                Some(8),
                Some(false),
            )
            .unwrap();
        }
        let dims = {
            let db = app.state::<Db>();
            list_tag_dimensions(db).unwrap()
        };
        let got = dims.iter().find(|x| x.id == d.id).unwrap();
        assert_eq!(got.name, "精力（改）");
        assert_eq!(got.max_tags, 8);
        assert!(!got.enabled);
        let err = {
            let db = app.state::<Db>();
            update_tag_dimension(app.handle().clone(), db, 999, "x".into(), None, None).unwrap_err()
        };
        assert!(matches!(err, AppError::NotFound(_)));
    }

    /// 维度 key 唯一：重复 key 建维度报库错误（UNIQUE 约束）
    #[test]
    fn create_tag_dimension_rejects_duplicate_key() {
        let app = setup();
        let err = {
            let db = app.state::<Db>();
            create_tag_dimension(
                app.handle().clone(),
                db,
                "project".into(),
                "又一个项目".into(),
                None,
                None,
            )
            .unwrap_err()
        };
        assert!(matches!(err, AppError::Db(_)), "key 唯一: {err}");
    }

    /// 移除反馈：old 有而 new 无的名字按次聚合；阈值过滤、条数封顶、窗口期外不计
    #[test]
    fn removal_feedback_counts_dropped_names() {
        let conn = test_conn();
        let log = |old: &str, new: &str, days_ago: i64| {
            conn.execute(
                "INSERT INTO task_logs (task_id, action, field, old_value, new_value, origin, created_at)
                 VALUES (1, 'update', 'tags', ?1, ?2, 'main', ?3)",
                params![
                    old,
                    new,
                    (chrono::Utc::now() - chrono::Duration::days(days_ago)).to_rfc3339()
                ],
            )
            .unwrap();
        };
        log("重要,需汇报", "需汇报", 1); // 重要 -1
        log("重要", "", 2); // 重要 -1（清空）
        log("重要,杂", "重要,杂", 3); // 无移除
        log("杂", "", 40); // 窗口期外
        log("低频", "", 5); // 只有 1 次，低于阈值
        let fb = removal_feedback(&conn, 30, 2, 3).unwrap();
        assert_eq!(fb, vec![("重要".to_string(), 2)], "只留窗口内 >=2 次的名字");
        // 封顶：三个名字各移除 2 次以上，cap=2 只取频次最高的
        log("甲", "", 1);
        log("甲", "", 1);
        log("乙", "", 1);
        log("乙", "", 1);
        let capped = removal_feedback(&conn, 30, 2, 2).unwrap();
        assert_eq!(capped.len(), 2);
        assert_eq!(capped[0].0, "乙", "同频次按名字稳定排序（乙 < 甲 < 重要）");
        assert_eq!(capped[1].0, "甲");
    }
}
