//! 导出/导入三件套：全量 JSON 备份（可回导）、任务 CSV（Excel 友好）、日报 Markdown（知识库对接铺路）。
//! 产物写入应用数据目录 exports/，前端经 opener 插件在文件管理器中定位。
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::events;
use chrono::{DateTime, Local};
use rusqlite::{types::Value as SqlValue, Connection};
use std::path::{Path, PathBuf};
use tauri::State;

/// 导出文件名前缀与全量 JSON 的 app 标识字段
const APP_SLUG: &str = "pokemon-choose-you";

/// 全量导出包含的表（顺序即导入顺序：被引用表在前）
const DUMP_TABLES: &[&str] = &[
    "categories",
    "tasks",
    "tags",
    "task_tags",
    "task_notes",
    "task_logs",
    "chat_messages",
    "feishu_users",
    "sync_state",
    "settings",
];

fn exports_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("exports")
}

fn write_export(data_dir: &Path, name: String, content: &str) -> AppResult<PathBuf> {
    let dir = exports_dir(data_dir);
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(name);
    std::fs::write(&path, content)?;
    log::info!("export: 已写出 {}", path.display());
    Ok(path)
}

/// 统一出口：dest=用户经保存对话框自选的完整路径（返回全路径），否则写默认 exports/ 目录（返回文件名）
fn finish_export(
    data_dir: &Path,
    name: String,
    content: &str,
    dest: Option<&str>,
) -> AppResult<String> {
    match dest.filter(|s| !s.trim().is_empty()) {
        Some(dest) => {
            let path = Path::new(dest);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(path, content)?;
            log::info!("export: 已写出 {}", path.display());
            Ok(path.to_string_lossy().into_owned())
        }
        None => write_export(data_dir, name, content).map(|p| {
            p.file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default()
        }),
    }
}

fn stamp_now() -> String {
    Local::now().format("%Y%m%d-%H%M%S").to_string()
}

// ---- 表 <-> JSON 的通用搬运（列名驱动，schema 演进无需改这里） ----

fn dump_table(
    conn: &Connection,
    table: &str,
) -> AppResult<Vec<serde_json::Map<String, serde_json::Value>>> {
    let mut stmt = conn.prepare(&format!("SELECT * FROM {table}"))?;
    let col_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt.query_map([], |row| {
        let mut obj = serde_json::Map::new();
        for (i, col) in col_names.iter().enumerate() {
            let v = match row.get_ref(i)? {
                rusqlite::types::ValueRef::Null => serde_json::Value::Null,
                rusqlite::types::ValueRef::Integer(n) => serde_json::Value::Number(n.into()),
                rusqlite::types::ValueRef::Real(f) => serde_json::Number::from_f64(f)
                    .map(serde_json::Value::Number)
                    .unwrap_or(serde_json::Value::Null),
                rusqlite::types::ValueRef::Text(t) => {
                    serde_json::Value::String(String::from_utf8_lossy(t).into_owned())
                }
                rusqlite::types::ValueRef::Blob(b) => {
                    serde_json::Value::String(format!("0x{}", hex_prefix(b)))
                }
            };
            obj.insert(col.clone(), v);
        }
        Ok(obj)
    })?;
    let mut out = vec![];
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

fn hex_prefix(b: &[u8]) -> String {
    b.iter().take(64).map(|x| format!("{x:02x}")).collect()
}

fn restore_table(
    conn: &Connection,
    table: &str,
    rows: &[serde_json::Map<String, serde_json::Value>],
) -> AppResult<()> {
    if rows.is_empty() {
        return Ok(());
    }
    // 列集合以导入数据为准（表里多出的新列取默认值）
    let cols: Vec<&String> = rows
        .iter()
        .flat_map(|r| r.keys())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    let placeholders = cols.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let col_list = cols
        .iter()
        .map(|c| format!("\"{}\"", c))
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!("INSERT INTO {table} ({col_list}) VALUES ({placeholders})");
    let mut stmt = conn.prepare(&sql)?;
    for row in rows {
        let params: Vec<SqlValue> = cols
            .iter()
            .map(|c| json_to_sql(row.get(*c).unwrap_or(&serde_json::Value::Null)))
            .collect();
        stmt.execute(rusqlite::params_from_iter(params))?;
    }
    Ok(())
}

fn json_to_sql(v: &serde_json::Value) -> SqlValue {
    match v {
        serde_json::Value::Null => SqlValue::Null,
        serde_json::Value::Bool(b) => SqlValue::Integer(*b as i64),
        serde_json::Value::Number(n) => n
            .as_i64()
            .map(SqlValue::Integer)
            .or_else(|| n.as_f64().map(SqlValue::Real))
            .unwrap_or(SqlValue::Null),
        serde_json::Value::String(s) => {
            // Blob 以 0x 前缀往返（本库目前无 Blob 列，防御性处理）
            if let Some(hex) = s.strip_prefix("0x") {
                if hex.len() % 2 == 0 {
                    let bytes: Option<Vec<u8>> = (0..hex.len())
                        .step_by(2)
                        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok())
                        .collect();
                    if let Some(b) = bytes {
                        return SqlValue::Blob(b);
                    }
                }
            }
            SqlValue::Text(s.clone())
        }
        other => SqlValue::Text(other.to_string()),
    }
}

/// 导出全量 JSON：任务/分类/标签/跟进/日志/收音机/设置（秘钥除外，绝不落文件）
pub fn export_json_to(data_dir: &Path, conn: &Connection, dest: Option<&str>) -> AppResult<String> {
    let mut data = serde_json::Map::new();
    for table in DUMP_TABLES {
        let mut rows = dump_table(conn, table)?;
        if *table == "settings" {
            // 秘钥不出文件（在系统钥匙串）；内部标记位（迁移完成标记）也不随库走；
            // 导入端同样跳过
            rows.retain(|r| {
                r.get("key")
                    .and_then(|v| v.as_str())
                    .map(|k| {
                        !crate::secrets::is_secret_key(k) && !crate::db::is_internal_setting_key(k)
                    })
                    .unwrap_or(true)
            });
        }
        data.insert(
            table.to_string(),
            serde_json::Value::Array(rows.into_iter().map(serde_json::Value::Object).collect()),
        );
    }
    let payload = serde_json::json!({
        "app": APP_SLUG,
        "format": 1,
        "exportedAt": crate::db::now(),
        "data": data,
    });
    let pretty = serde_json::to_string_pretty(&payload)
        .map_err(|e| AppError::External(format!("序列化导出失败: {e}")))?;
    finish_export(
        data_dir,
        format!("{APP_SLUG}-full-{}.json", stamp_now()),
        &pretty,
        dest,
    )
}

/// 导入全量 JSON：整体替换（事务内清表重灌），秘钥不受影响；返回导入的行数
pub fn import_json_from(content: &str, conn: &mut Connection) -> AppResult<usize> {
    let parsed: serde_json::Value = serde_json::from_str(content)
        .map_err(|e| AppError::Invalid(format!("不是合法的 JSON 文件: {e}")))?;
    if parsed["app"] != APP_SLUG || parsed["format"] != 1 {
        return Err(AppError::Invalid(
            "不是「就决定是你了」的全量导出文件".into(),
        ));
    }
    let data = parsed["data"]
        .as_object()
        .ok_or_else(|| AppError::Invalid("导出文件缺少 data 字段".into()))?;
    for table in DUMP_TABLES {
        if !data.contains_key(*table) {
            return Err(AppError::Invalid(format!("导出文件缺少 {table} 表")));
        }
    }
    let tx = conn.transaction()?;
    let mut total = 0usize;
    // 秘钥行（回落模式存库的存量）不参与覆盖：导入前暂存、导入后放回
    let secret_rows: Vec<(String, String)> = {
        let mut stmt = tx.prepare("SELECT key, value FROM settings")?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .flatten()
            .filter(|(k, _)| crate::secrets::is_secret_key(k))
            .collect();
        rows
    };
    for table in DUMP_TABLES {
        tx.execute(&format!("DELETE FROM {table}"), [])?;
        let rows: Vec<serde_json::Map<String, serde_json::Value>> = data[*table]
            .as_array()
            .ok_or_else(|| AppError::Invalid(format!("{table} 不是数组")))?
            .iter()
            .filter_map(|v| v.as_object().cloned())
            .collect();
        let rows = if *table == "settings" {
            rows.into_iter()
                .filter(|r| {
                    r.get("key")
                        .and_then(|v| v.as_str())
                        .map(|k| {
                            !crate::secrets::is_secret_key(k)
                                && !crate::db::is_internal_setting_key(k)
                        })
                        .unwrap_or(true)
                })
                .collect()
        } else {
            rows
        };
        total += rows.len();
        restore_table(&tx, table, &rows)?;
    }
    for (k, v) in secret_rows {
        tx.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![k, v],
        )?;
    }
    // 迁移 + 默认分类补种（幂等；导入空分类表时兜底）
    crate::db::init_conn(&tx).map_err(|e| AppError::External(e.to_string()))?;
    tx.commit()?;
    log::info!("export: 导入完成，共 {total} 行");
    Ok(total)
}

// ---- 任务 CSV ----

/// RFC 4180 转义：含逗号/引号/换行的字段加引号并双写引号
fn csv_field(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') || s.contains('\r') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

pub fn export_csv_to(data_dir: &Path, conn: &Connection, dest: Option<&str>) -> AppResult<String> {
    let mut out = String::new();
    // UTF-8 BOM：Excel 直接双击打开中文不乱码
    out.push('\u{feff}');
    out.push_str("id,title,status,priority,category,tags,due_at,remind_at,focus_seconds,source,created_at,completed_at\n");
    let mut stmt = conn.prepare(
        "SELECT t.id, t.title, t.status, t.priority, c.name,
                COALESCE((SELECT group_concat(name, ' ') FROM tags g JOIN task_tags tt ON tt.tag_id=g.id WHERE tt.task_id=t.id), ''),
                t.due_at, t.remind_at, t.focus_seconds, t.source, t.created_at, t.completed_at
         FROM tasks t LEFT JOIN categories c ON c.id = t.category_id
         ORDER BY t.id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, String>(5)?,
            r.get::<_, Option<String>>(6)?,
            r.get::<_, Option<String>>(7)?,
            r.get::<_, i64>(8)?,
            r.get::<_, String>(9)?,
            r.get::<_, String>(10)?,
            r.get::<_, Option<String>>(11)?,
        ))
    })?;
    for row in rows {
        let (
            id,
            title,
            status,
            priority,
            category,
            tags,
            due,
            remind,
            focus,
            source,
            created,
            completed,
        ) = row?;
        let fields = vec![
            id.to_string(),
            title,
            status,
            priority,
            category,
            tags,
            due.unwrap_or_default(),
            remind.unwrap_or_default(),
            focus.to_string(),
            source,
            created,
            completed.unwrap_or_default(),
        ];
        out.push_str(
            &fields
                .iter()
                .map(|f| csv_field(f))
                .collect::<Vec<_>>()
                .join(","),
        );
        out.push('\n');
    }
    finish_export(
        data_dir,
        format!("{APP_SLUG}-tasks-{}.csv", stamp_now()),
        &out,
        dest,
    )
}

// ---- 日报 Markdown ----

/// RFC3339 → 本地日期串（无法解析返回 None）
fn local_date(s: &str) -> Option<String> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.with_timezone(&Local).format("%Y-%m-%d").to_string())
}

pub fn export_daily_md_to(
    data_dir: &Path,
    conn: &Connection,
    date: &str,
    dest: Option<&str>,
) -> AppResult<String> {
    let mut md = String::new();
    md.push_str(&format!("# 训练家日报 · {date}\n\n"));

    // 今日捕捉（完成）：按分类分组
    let mut stmt = conn.prepare(
        "SELECT t.title, t.priority, t.focus_seconds, c.name, c.pokemon, t.completed_at
         FROM tasks t LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.status = 'done'
         ORDER BY t.completed_at",
    )?;
    let done: Vec<(String, String, i64, String, String, String)> = stmt
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                r.get::<_, Option<String>>(4)?.unwrap_or_default(),
                r.get::<_, Option<String>>(5)?.unwrap_or_default(),
            ))
        })?
        .flatten()
        .filter(|(_, _, _, _, _, at)| local_date(at).as_deref() == Some(date))
        .collect();
    let focus_total: i64 = done.iter().map(|(_, _, f, _, _, _)| *f).sum();
    md.push_str(&format!(
        "今日捕捉 {} 只，专注 {} 分钟。\n\n",
        done.len(),
        focus_total / 60
    ));
    if !done.is_empty() {
        md.push_str("## 已捕捉\n\n");
        for (title, priority, focus, cat, pokemon, _) in &done {
            let minute = if *focus >= 60 {
                format!(" · 专注 {} 分钟", focus / 60)
            } else {
                String::new()
            };
            md.push_str(&format!(
                "- ✅ {title}（{cat}·{pokemon} · {priority}{minute}）\n"
            ));
        }
        md.push('\n');
    }

    // 进行中 / 路线上
    let mut stmt = conn.prepare(
        "SELECT t.title, t.status, t.due_at, c.name FROM tasks t
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.status IN ('active','paused','scheduled','inbox') ORDER BY t.due_at",
    )?;
    let open: Vec<(String, String, Option<String>, String)> = stmt
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get::<_, Option<String>>(3)?.unwrap_or_default(),
            ))
        })?
        .flatten()
        .collect();
    if !open.is_empty() {
        md.push_str("## 路线上\n\n");
        let (active, rest): (Vec<_>, Vec<_>) = open
            .iter()
            .partition(|(_, status, _, _)| status == "active" || status == "paused");
        for (title, _, _, cat) in &active {
            md.push_str(&format!("- 🚶 {title}（{cat}）\n"));
        }
        for (title, _, due, cat) in &rest {
            let due_str = due.as_deref().unwrap_or("").replace('T', " ");
            let due_str = due_str.split('.').next().unwrap_or("").to_string();
            let due_part = if due_str.is_empty() {
                String::new()
            } else {
                format!(" · 截止 {due_str}")
            };
            md.push_str(&format!("- [ ] {title}（{cat}{due_part}）\n"));
        }
        md.push('\n');
    }

    // 今日跟进记录
    let mut stmt = conn.prepare(
        "SELECT n.content, n.created_at, t.id, t.title, n.source
         FROM task_notes n JOIN tasks t ON t.id = n.task_id ORDER BY n.created_at",
    )?;
    let notes: Vec<(String, String, i64, String, String)> = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        })?
        .flatten()
        .filter(|(_, at, _, _, _)| local_date(at).as_deref() == Some(date))
        .collect();
    if !notes.is_empty() {
        md.push_str("## 今日跟进\n\n");
        for (content, _, tid, title, source) in &notes {
            let tag = if source == "ai" { "AI " } else { "" };
            md.push_str(&format!("- No.{tid} {title}：{tag}{content}\n"));
        }
    }
    finish_export(data_dir, format!("{APP_SLUG}-daily-{date}.md"), &md, dest)
}

// ---- Tauri 命令 ----

fn data_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<PathBuf> {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::External(format!("定位应用数据目录失败: {e}")))
}

/// 全量 JSON 导出（秘钥除外）；dest=用户自选完整路径（另存为），缺省写 exports/。返回文件名或完整路径
#[tauri::command]
pub fn export_json<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    dest: Option<String>,
) -> AppResult<String> {
    let conn = db.0.lock().unwrap();
    export_json_to(&data_dir(&app)?, &conn, dest.as_deref())
}

/// 全量 JSON 导入（前端经 <input type=file> 读内容传入；整体替换，秘钥不受影响）
#[tauri::command]
pub fn import_json<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    content: String,
) -> AppResult<usize> {
    let n = {
        let mut conn = db.0.lock().unwrap();
        import_json_from(&content, &mut conn)?
    };
    events::broadcast(&app, events::TASKS_CHANGED);
    events::broadcast(&app, events::CATEGORIES_CHANGED);
    events::broadcast(&app, events::TAGS_CHANGED);
    events::broadcast(&app, events::SETTINGS_CHANGED);
    events::broadcast(&app, events::CHAT_MESSAGES_CHANGED);
    Ok(n)
}

/// 任务 CSV 导出（带 BOM，Excel 友好）；dest 同 export_json
#[tauri::command]
pub fn export_tasks_csv<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    dest: Option<String>,
) -> AppResult<String> {
    let conn = db.0.lock().unwrap();
    export_csv_to(&data_dir(&app)?, &conn, dest.as_deref())
}

/// 日报 Markdown 导出（缺省今天，可指定日期）；dest 同 export_json
#[tauri::command]
pub fn export_daily_md<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    date: Option<String>,
    dest: Option<String>,
) -> AppResult<String> {
    let conn = db.0.lock().unwrap();
    let date = date.unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
    export_daily_md_to(&data_dir(&app)?, &conn, &date, dest.as_deref())
}

/// 在文件管理器中打开 exports 目录
#[tauri::command]
pub async fn open_exports_dir<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let dir = exports_dir(&data_dir(&app)?);
    std::fs::create_dir_all(&dir)?;
    app.opener()
        .reveal_item_in_dir(&dir)
        .map_err(|e| AppError::External(format!("打开目录失败: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::test_conn;
    use std::io::Read;

    fn tmp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pk-export-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn read_export(dir: &Path, file: &str) -> String {
        let mut s = String::new();
        std::fs::File::open(exports_dir(dir).join(file))
            .unwrap()
            .read_to_string(&mut s)
            .unwrap();
        s
    }

    fn seed(conn: &Connection) {
        conn.execute(
            "INSERT INTO tasks (title, status, priority, due_at, focus_seconds, created_at, completed_at)
             VALUES ('写周报', 'done', 'high', '2026-09-13T10:00', 1500, '2026-09-13T00:00:00Z', '2026-09-13T08:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tasks (title, status, created_at) VALUES ('交报告, 第二版 \"最终\"', 'inbox', '2026-09-13T01:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tags (name, description, created_at) VALUES ('重要', '', '2026-09-01T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO task_tags VALUES (1, 1)", [])
            .unwrap();
        conn.execute(
            "INSERT INTO task_notes (task_id, content, source, created_at) VALUES (1, '对方确认周五交付', 'manual', '2026-09-13T02:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('language', 'en'), ('feishu_poll_interval', '120')",
            [],
        )
        .unwrap();
    }

    /// 全量 JSON 往返：导出→新库导入，行数与字段一致，设置整体替换
    #[test]
    fn json_roundtrip_restores_data() {
        let dir = tmp_dir("roundtrip");
        let conn = test_conn();
        seed(&conn);

        let file = export_json_to(&dir, &conn, None).unwrap();
        let content = read_export(&dir, &file);
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed["app"], APP_SLUG);
        assert_eq!(parsed["data"]["tasks"].as_array().unwrap().len(), 2);
        assert_eq!(
            parsed["data"]["settings"].as_array().unwrap().len(),
            2,
            "设置行随导出带出"
        );

        // 新库导入：数据齐了，库里原有设置被整体替换
        let mut fresh = test_conn();
        fresh
            .execute(
                "INSERT INTO settings (key, value) VALUES ('language', 'fr')",
                [],
            )
            .unwrap();
        let n = import_json_from(&content, &mut fresh).unwrap();
        assert!(n >= 6, "导入行数含任务/标签/关联/跟进/设置: {n}");
        let count: i64 = fresh
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);
        let title: String = fresh
            .query_row("SELECT title FROM tasks WHERE id=2", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "交报告, 第二版 \"最终\"");
        let lang: String = fresh
            .query_row("SELECT value FROM settings WHERE key='language'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(lang, "en", "导入整体替换原设置");
        // 联表关系保留
        let tag: String = fresh
            .query_row(
                "SELECT g.name FROM tags g JOIN task_tags tt ON tt.tag_id=g.id WHERE tt.task_id=1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tag, "重要");
    }

    /// 导入是整体替换：库里原有的行不残留；坏文件报输入错误不动库
    #[test]
    fn import_replaces_all_and_rejects_bad_files() {
        let dir = tmp_dir("replace");
        let src = test_conn();
        seed(&src);
        let file = export_json_to(&dir, &src, None).unwrap();
        let content = read_export(&dir, &file);

        let mut conn = test_conn();
        conn.execute(
            "INSERT INTO tasks (title, status, created_at) VALUES ('旧的', 'inbox', '2026-09-01T00:00:00Z')",
            [],
        )
        .unwrap();
        import_json_from(&content, &mut conn).unwrap();
        let titles: Vec<String> = {
            let mut stmt = conn.prepare("SELECT title FROM tasks ORDER BY id").unwrap();
            stmt.query_map([], |r| r.get::<_, String>(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(
            titles,
            vec!["写周报".to_string(), "交报告, 第二版 \"最终\"".to_string()],
            "旧的被替换掉"
        );

        let err = import_json_from("not json", &mut conn).unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)));
        let err =
            import_json_from(r#"{"app":"other","format":1,"data":{}}"#, &mut conn).unwrap_err();
        assert!(err.to_string().contains("全量导出"), "{err}");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2, "失败导入不动库");
    }

    /// CSV：表头 + BOM + 逗号/引号转义 + 标签拼接
    #[test]
    fn csv_escapes_and_carries_tags() {
        let dir = tmp_dir("csv");
        let conn = test_conn();
        seed(&conn);
        let file = export_csv_to(&dir, &conn, None).unwrap();
        let csv = read_export(&dir, &file);
        assert!(csv.starts_with('\u{feff}'), "带 UTF-8 BOM");
        assert!(csv.contains("id,title,status,priority,category,tags"));
        assert!(
            csv.contains("\"交报告, 第二版 \"\"最终\"\"\""),
            "RFC4180 转义: {csv}"
        );
        assert!(csv.contains("重要"), "标签列带出");
        assert!(csv.lines().count() == 3, "表头 + 2 行任务");
    }

    /// 日报：今日完成/路线/跟进三段，勾选框语法可被知识库识别
    #[test]
    fn daily_md_sections() {
        let dir = tmp_dir("md");
        let conn = test_conn();
        seed(&conn);
        let file = export_daily_md_to(&dir, &conn, "2026-09-13", None).unwrap();
        let md = read_export(&dir, &file);
        assert!(file.starts_with("pokemon-choose-you-daily-2026-09-13"));
        assert!(md.contains("# 训练家日报 · 2026-09-13"));
        assert!(md.contains("今日捕捉 1 只，专注 25 分钟"));
        assert!(md.contains("- ✅ 写周报（工作·皮卡丘 · high · 专注 25 分钟）"));
        assert!(md.contains("- [ ] 交报告"), "未完成任务带勾选框: {md}");
        assert!(md.contains("No.1 写周报：对方确认周五交付"));
        // 其他日期不误收
        let other = export_daily_md_to(&dir, &conn, "2026-09-12", None).unwrap();
        let md2 = read_export(&dir, &other);
        assert!(md2.contains("今日捕捉 0 只"));
        assert!(!md2.contains("对方确认周五交付"));
    }

    /// 另存为：dest 指定完整路径时写到该处并返回全路径，不落 exports/；空白 dest 视为未指定
    #[test]
    fn custom_dest_writes_exactly_there() {
        let dir = tmp_dir("dest");
        let conn = test_conn();
        seed(&conn);
        let dest = dir.join("nested").join("backup.json");
        let returned = export_json_to(&dir, &conn, Some(dest.to_str().unwrap())).unwrap();
        assert_eq!(returned, dest.to_string_lossy(), "自选路径返回全路径");
        assert!(dest.exists(), "文件写在自选路径");
        assert!(
            !exports_dir(&dir).join(dest.file_name().unwrap()).exists(),
            "不再叠写 exports/ 下的同名文件"
        );
        // 空白字符串按缺省处理（返回 exports/ 下的文件名）
        let fallback = export_json_to(&dir, &conn, Some("  ")).unwrap();
        assert!(
            !fallback.contains(std::path::MAIN_SEPARATOR),
            "空白 dest 回退默认目录: {fallback}"
        );
    }
}
