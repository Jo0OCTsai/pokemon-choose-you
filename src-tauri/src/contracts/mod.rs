//! 契约 harness（FR-X3 · Rust oracle 侧，specs/dsh-plugin AD §4.4）：
//! 执行 `contracts/scenarios/<group>/<name>.json` 场景 → 生成/比对
//! `contracts/fixtures/<group>/<name>.json` 夹具。TS（dsh-plugin）回放同一份场景，
//! 逐字段比对夹具——差异即 CI 红（双实现单契约）。
//!
//! 设计口径（与 contracts/PROTOCOL.md §5 对齐）：
//! - **真实原语优先**：op 一律映射到现有 conn 层 / 命令层函数；确无现成函数的
//!   （pk suggest 的校验落在 bin 侧、插件 host 命令层尚未存在）在 harness 内写
//!   **最小组合**并逐处标注「harness 组合」，不新增应用功能。
//! - **确定性**：场景自带 `now`；op 内部经 `db::now()` / `chrono::Utc::now()` 产生的
//!   时间戳不可控，夹具序列化后统一归一（完整 RFC3339 字符串 → `<ts:N>`，按出现序）；
//!   不为注入时钟重构应用代码。自增 id 由 setup 显式指定。
//! - **别名归一（A18）**：`成员_[0-9a-f]+(\{[0-9a-f]+\})?` → `<alias:N>`（N = 场景内
//!   第 N 个不同 open_id，按夹具内出现序；无主别名按别名串本身记账）。
//! - **错误形态**：step 的 `error` 字段是机器稳定 tag（PROTOCOL §2 错误码 / 校验规则
//!   标记 / AppError kind），不锁中文文案（文案三语由 UI 层本地化）。
//! - 归一化遍历顺序 = 对象键字典序 + 数组下标序（serde_json 默认 BTreeMap），
//!   TS 侧按同序遍历即可得到相同编号。
#![allow(clippy::too_many_lines)] // 单文件契约执行器：op 分发天然集中

use crate::ai::{self, AiSuggestion};
use crate::commands::{self, radio, tasks as task_cmds, windows};
use crate::db::{self, Db};
use crate::health::HealthState;
use rusqlite::{params, Connection};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use tauri::Manager;

/// 与 db.rs CONN_PRAGMAS 同款的连接 PRAGMA（该常量为模块私有，此处按同字面量执行；
/// 双连接（concurrency 组）走临时文件库，必须 WAL + busy_timeout）
const HARNESS_PRAGMAS: &str =
    "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;";

/// 夹具 schemaVersion（PROTOCOL §5 夹具格式版本）
const FIXTURE_SCHEMA_VERSION: i64 = 2;

/// PROTOCOL §5 的 kind 全集（组目录名必须命中）
const KINDS: &[&str] = &[
    "task_sm",
    "dispatch_sm",
    "judge_protocol",
    "anonymize",
    "concurrency",
    "vocabulary",
    "config_align",
    "redact",
    "injection",
    "cold_start",
];

/// final 全量行集导出的表（行内键经 BTreeMap 字典序；行序 = rowid）
const DUMP_TABLES: &[&str] = &[
    "tasks",
    "task_logs",
    "task_notes",
    "task_tags",
    "tags",
    "tag_dimensions",
    "categories",
    "settings",
    "chat_messages",
    "chat_feedback",
    "dispatch_slots",
    "feishu_users",
    "feishu_chats",
    "chat_filter_prefs",
    "agent_sessions",
];

fn repo_contracts_dir(sub: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../contracts")
        .join(sub)
}

// ---- 场景解析与发现 ----

#[derive(Debug, serde::Deserialize)]
struct Step {
    op: String,
    #[serde(default)]
    args: Value,
}

#[derive(Debug, serde::Deserialize)]
struct Scenario {
    kind: String,
    name: String,
    #[serde(default)]
    now: String,
    #[serde(default)]
    setup: Value,
    steps: Vec<Step>,
    expect: String,
}

fn load_scenario(path: &Path) -> Scenario {
    let raw = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("读取 {path:?}: {e}"));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("解析 {path:?}: {e}"))
}

/// 遍历 scenarios 目录：(group, name, path)；group = 一级子目录（须命中 KINDS）
fn discover_scenarios() -> Vec<(String, String, PathBuf)> {
    let root = repo_contracts_dir("scenarios");
    let mut out = vec![];
    let mut groups: Vec<String> = std::fs::read_dir(&root)
        .unwrap_or_else(|e| panic!("打开 {root:?}: {e}"))
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    groups.sort();
    for g in groups {
        assert!(
            KINDS.contains(&g.as_str()),
            "场景组目录 {g} 不在 PROTOCOL §5 kind 全集内"
        );
        let mut files: Vec<_> = std::fs::read_dir(root.join(&g))
            .unwrap_or_else(|e| panic!("打开 {}/{g}: {e}", root.display()))
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .collect();
        files.sort_by_key(|e| e.file_name());
        for f in files {
            let name = f.path().file_stem().unwrap().to_string_lossy().into_owned();
            out.push((g.clone(), name, f.path()));
        }
    }
    out
}

// ---- 种子（setup → 直插 SQL）----

/// setup 键 → 表名（PROTOCOL §5 的 setup 面 + 夹具构造所需的关联表）
const SETUP_TABLES: &[(&str, &str)] = &[
    ("categories", "categories"),
    ("dimensions", "tag_dimensions"),
    ("tags", "tags"),
    ("tasks", "tasks"),
    ("task_tags", "task_tags"),
    ("task_notes", "task_notes"),
    ("task_logs", "task_logs"),
    ("chat_messages", "chat_messages"),
    ("feishu_users", "feishu_users"),
    ("chats", "feishu_chats"),
    ("filters", "chat_filter_prefs"),
    ("agent_sessions", "agent_sessions"),
    ("dispatch_slots", "dispatch_slots"),
];

fn json_to_sql(v: &Value) -> rusqlite::types::Value {
    use rusqlite::types::Value as SV;
    match v {
        Value::Null => SV::Null,
        Value::Bool(b) => SV::Integer(*b as i64),
        Value::Number(n) => n
            .as_i64()
            .map(SV::Integer)
            .or_else(|| n.as_f64().map(SV::Real))
            .unwrap_or(SV::Null),
        Value::String(s) => SV::Text(s.clone()),
        other => SV::Text(other.to_string()),
    }
}

fn insert_row(conn: &Connection, table: &str, row: &Map<String, Value>) -> Result<(), String> {
    if row.is_empty() {
        return Err(format!("setup 行为空：{table}"));
    }
    let cols: Vec<&str> = row.keys().map(|s| s.as_str()).collect();
    let holders: Vec<String> = (1..=cols.len()).map(|i| format!("?{i}")).collect();
    let sql = format!(
        "INSERT INTO {table} ({}) VALUES ({})",
        cols.join(", "),
        holders.join(", ")
    );
    let vals: Vec<rusqlite::types::Value> = row.values().map(json_to_sql).collect();
    conn.execute(&sql, rusqlite::params_from_iter(vals))
        .map(|_| ())
        .map_err(|e| format!("setup 插入 {table}: {e}"))
}

fn seed_setup(conn: &Connection, setup: &Value) {
    let obj = setup.as_object().cloned().unwrap_or_default();
    if let Some(settings) = obj.get("settings").and_then(|v| v.as_object()) {
        for (k, v) in settings {
            let sv = match v {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value=?2",
                params![k, sv],
            )
            .unwrap_or_else(|e| panic!("seed settings {k}: {e}"));
        }
    }
    for (key, table) in SETUP_TABLES {
        let Some(rows) = obj.get(*key).and_then(|v| v.as_array()) else {
            continue;
        };
        for row in rows {
            let m = row
                .as_object()
                .unwrap_or_else(|| panic!("setup.{key} 行须为对象"));
            insert_row(conn, table, m).unwrap_or_else(|e| panic!("seed {key}: {e}"));
        }
    }
}

// ---- 错误 tag（机器稳定；不锁中文文案）----

fn app_err_tag(e: &crate::error::AppError) -> String {
    match e {
        crate::error::AppError::Db(_) => "db".into(),
        crate::error::AppError::NotFound(_) => "not_found".into(),
        crate::error::AppError::Invalid(_) => "invalid".into(),
        crate::error::AppError::Network(_) => "network".into(),
        crate::error::AppError::External(_) => "external".into(),
        crate::error::AppError::Io(_) => "io".into(),
        crate::error::AppError::Tauri(_) => "tauri".into(),
    }
}

/// 裸 SQL 的 rusqlite 错误 → tag（恒 db）
fn db_tag(_: rusqlite::Error) -> String {
    "db".into()
}

fn task_exists(conn: &Connection, id: i64) -> bool {
    conn.query_row("SELECT id FROM tasks WHERE id=?1", params![id], |r| {
        r.get::<_, i64>(0)
    })
    .is_ok()
}

fn message_row_id(conn: &Connection, message_id: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT id FROM chat_messages WHERE message_id=?1",
        params![message_id],
        |r| r.get(0),
    )
    .map_err(|_| "message-not-found".to_string())
}

/// 取 args 里的时间串；"now" → 真实当前时刻（RFC3339，输出侧归一为 <ts:N>）
fn ts_arg(args: &Value, key: &str) -> Option<String> {
    let v = args.get(key)?.as_str()?;
    if v == "now" {
        return Some(chrono::Utc::now().to_rfc3339());
    }
    Some(v.to_string())
}

// ---- harness 主体 ----

struct Harness {
    /// mock 应用栈：apps[i] 持有第 i 号连接（in-memory 单连接；concurrency 组为
    /// 指向同一临时文件库的两条连接、各挂一个 mock app——命令层 op 也能跨连接竞争）
    apps: Vec<tauri::App<tauri::test::MockRuntime>>,
    /// invariants 组：成功落笔的写操作计数（审计守恒断言的期望侧）
    write_ops: usize,
    db_file: Option<PathBuf>,
}

fn make_mock_app(conn: Connection) -> tauri::App<tauri::test::MockRuntime> {
    let app = tauri::test::mock_app();
    app.manage(Db(std::sync::Mutex::new(conn)));
    app.manage(HealthState::default());
    app.manage(windows::PendingMainReopen(
        std::sync::atomic::AtomicBool::new(false),
    ));
    app
}

impl Harness {
    fn new(kind: &str, name: &str, setup: &Value) -> Harness {
        let db_file = (kind == "concurrency").then(|| {
            let p = std::env::temp_dir().join(format!(
                "cy-contracts-{kind}-{name}-{}.db",
                std::process::id()
            ));
            let _ = std::fs::remove_file(&p);
            p
        });
        let mut apps = vec![];
        match &db_file {
            Some(p) => {
                for _ in 0..2 {
                    let conn = Connection::open(p).unwrap();
                    conn.execute_batch(HARNESS_PRAGMAS).unwrap();
                    db::init_conn(&conn).expect("init schema");
                    if apps.is_empty() {
                        seed_setup(&conn, setup);
                    }
                    apps.push(make_mock_app(conn));
                }
            }
            None => {
                let conn = Connection::open_in_memory().unwrap();
                db::init_conn(&conn).expect("init schema");
                seed_setup(&conn, setup);
                apps.push(make_mock_app(conn));
            }
        }
        Harness {
            apps,
            write_ops: 0,
            db_file,
        }
    }

    fn conn_idx(args: &Value) -> usize {
        args.get("conn").and_then(|v| v.as_i64()).unwrap_or(0) as usize
    }

    fn rt(&self, idx: usize) -> Result<&tauri::App<tauri::test::MockRuntime>, String> {
        self.apps
            .get(idx)
            .ok_or_else(|| "conn-index-out-of-range".to_string())
    }

    fn with_conn<R>(
        &mut self,
        idx: usize,
        f: impl FnOnce(&Connection) -> Result<R, String>,
    ) -> Result<R, String> {
        let app = self.rt(idx)?;
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        f(&conn)
    }

    fn with_conn_mut<R>(
        &mut self,
        idx: usize,
        f: impl FnOnce(&mut Connection) -> Result<R, String>,
    ) -> Result<R, String> {
        let app = self.rt(idx)?;
        let db = app.state::<Db>();
        let mut conn = db.0.lock().unwrap();
        f(&mut conn)
    }

    /// 步后快照：任务面 / 消息面 / 槽 / 计数（确定性视图，不含时间戳字段）
    fn snapshot(&mut self) -> Value {
        self.with_conn(0, |conn| {
            let mut tasks = Map::new();
            {
                let mut stmt = conn
                    .prepare("SELECT id, status, dispatch_state, focus_seconds FROM tasks ORDER BY id")
                    .unwrap();
                let rows = stmt
                    .query_map([], |r| {
                        Ok((
                            r.get::<_, i64>(0)?,
                            r.get::<_, Option<String>>(1)?,
                            r.get::<_, Option<String>>(2)?,
                            r.get::<_, i64>(3)?,
                        ))
                    })
                    .unwrap()
                    .collect::<Result<Vec<_>, _>>()
                    .unwrap();
                for (id, status, dispatch, focus) in rows {
                    tasks.insert(
                        id.to_string(),
                        json!({"status": status, "dispatch": dispatch, "focusSeconds": focus}),
                    );
                }
            }
            let mut messages = Map::new();
            {
                let mut stmt = conn
                    .prepare("SELECT message_id, ai_status, review_status FROM chat_messages ORDER BY id")
                    .unwrap();
                let rows = stmt
                    .query_map([], |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, String>(2)?,
                        ))
                    })
                    .unwrap()
                    .collect::<Result<Vec<_>, _>>()
                    .unwrap();
                for (mid, ai, review) in rows {
                    messages.insert(mid, json!({"ai": ai, "review": review}));
                }
            }
            let slots: Vec<Value> = {
                let mut stmt = conn
                    .prepare("SELECT host_key, task_id FROM dispatch_slots ORDER BY host_key, task_id")
                    .unwrap();
                stmt.query_map([], |r| Ok(json!([r.get::<_, String>(0)?, r.get::<_, i64>(1)?])))
                    .unwrap()
                    .collect::<Result<Vec<_>, _>>()
                    .unwrap()
            };
            let count =
                |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap_or(0) };
            Ok(json!({
                "tasks": Value::Object(tasks),
                "messages": Value::Object(messages),
                "slots": slots,
                "auditCount": count("SELECT COUNT(*) FROM task_logs"),
                "noteCount": count("SELECT COUNT(*) FROM task_notes"),
                "feedbackCount": count("SELECT COUNT(*) FROM chat_feedback"),
                "tagCount": count("SELECT COUNT(*) FROM tags"),
            }))
        })
        .expect("snapshot 读取失败")
    }

    /// final 全量行集：全部相关表逐行导出（行 = {列: 值}，键字典序；行序 = rowid）
    fn dump_final(&mut self) -> Value {
        self.with_conn(0, |conn| {
            let mut out = Map::new();
            for table in DUMP_TABLES {
                out.insert(
                    table.to_string(),
                    dump_table(conn, table).map_err(|e| format!("dump {table}: {e}"))?,
                );
            }
            Ok(Value::Object(out))
        })
        .expect("final dump 失败")
    }

    /// concurrency 组（expect=invariants）的不变式断言集（PROTOCOL §5 允许 final 扩展
    /// invariants 字段；断言在 oracle 侧执行，数字进夹具供 TS 侧对齐）
    fn invariants(&mut self) -> Value {
        let mut v = self
            .with_conn(0, |conn| {
                let n = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap_or(0) };
                let active = n("SELECT COUNT(*) FROM tasks WHERE status='active'");
                let audit = n("SELECT COUNT(*) FROM task_logs");
                let msgs_with_task =
                    n("SELECT COUNT(*) FROM chat_messages WHERE task_id IS NOT NULL");
                let distinct_tasks = n(
                    "SELECT COUNT(DISTINCT task_id) FROM chat_messages WHERE task_id IS NOT NULL",
                );
                let dup_followup_notes = n(
                    "SELECT COUNT(*) FROM (SELECT task_id, content FROM task_notes WHERE source='ai'
                      GROUP BY task_id, content HAVING COUNT(*) > 1)",
                );
                let mut slots = BTreeMap::new();
                {
                    let mut stmt = conn
                        .prepare("SELECT host_key, COUNT(*) FROM dispatch_slots GROUP BY host_key")
                        .unwrap();
                    let rows = stmt
                        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
                        .unwrap()
                        .collect::<Result<Vec<_>, _>>()
                        .unwrap();
                    for (h, c) in rows {
                        slots.insert(h, c);
                    }
                }
                Ok(json!({
                    "activeCount": active,
                    "auditRows": audit,
                    "dupSuggestionTasks": msgs_with_task - distinct_tasks,
                    "dupFollowupNotes": dup_followup_notes,
                    "slotsByHost": slots,
                }))
            })
            .expect("invariants 读取失败");
        let write_ops = self.write_ops;
        v["successfulWriteOps"] = json!(write_ops);
        // oracle 侧断言（PROTOCOL §5 invariants 断言集）
        assert!(
            v["activeCount"].as_i64().unwrap() <= 1,
            "不变式：active ≤ 1（全局唯一进行中）"
        );
        assert_eq!(
            v["dupSuggestionTasks"].as_i64().unwrap(),
            0,
            "不变式：无重复建议（同一消息不建两个待办）"
        );
        assert_eq!(
            v["dupFollowupNotes"].as_i64().unwrap(),
            0,
            "不变式：无重复跟进"
        );
        for (host, count) in v["slotsByHost"].as_object().unwrap() {
            assert!(
                count.as_i64().unwrap() <= 2,
                "不变式：host {host} 槽计数 ≤ 场景上限 2"
            );
        }
        assert!(
            v["auditRows"].as_i64().unwrap() >= write_ops as i64,
            "不变式：审计条数守恒（每笔成功写操作至少一条审计）"
        );
        v
    }

    fn finish(self) {
        drop(self.apps);
        if let Some(p) = &self.db_file {
            let _ = std::fs::remove_file(p);
            let _ = std::fs::remove_file(p.with_extension("db-wal"));
            let _ = std::fs::remove_file(p.with_extension("db-shm"));
        }
    }
}

fn dump_table(conn: &Connection, table: &str) -> Result<Value, rusqlite::Error> {
    let mut stmt = conn.prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))?;
    let cols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt
        .query_map([], |row| {
            let mut obj = Map::new();
            for (i, c) in cols.iter().enumerate() {
                let v = match row.get_ref(i)? {
                    rusqlite::types::ValueRef::Null => Value::Null,
                    rusqlite::types::ValueRef::Integer(n) => json!(n),
                    rusqlite::types::ValueRef::Real(f) => json!(f),
                    rusqlite::types::ValueRef::Text(t) => {
                        json!(String::from_utf8_lossy(t).into_owned())
                    }
                    rusqlite::types::ValueRef::Blob(b) => {
                        json!(b.iter().map(|x| format!("{x:02x}")).collect::<String>())
                    }
                };
                obj.insert(c.clone(), v);
            }
            Ok(Value::Object(obj))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Value::Array(rows))
}

// ---- op 实现：任务面（pk task 子命令同构口径，tasks.rs conn 原语）----

fn origin_arg(args: &Value) -> String {
    args.get("origin")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("cli")
        .to_string()
}

fn new_task_from_args(args: &Value) -> task_cmds::NewTask {
    let due = args.get("due").and_then(|v| v.as_str()).map(String::from);
    task_cmds::NewTask {
        title: args
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .into(),
        note: args.get("note").and_then(|v| v.as_str()).map(String::from),
        category_id: args.get("categoryId").and_then(|v| v.as_i64()),
        priority: args
            .get("priority")
            .and_then(|v| v.as_str())
            .map(String::from),
        due_at: due.clone(),
        remind_at: args
            .get("remindAt")
            .and_then(|v| v.as_str())
            .map(String::from),
        // 有截止即排期（pk task create 同构）；显式 scheduled 覆盖
        scheduled: args
            .get("scheduled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
            || due.is_some(),
        source: args
            .get("source")
            .and_then(|v| v.as_str())
            .map(String::from),
        external_id: args
            .get("externalId")
            .and_then(|v| v.as_str())
            .map(String::from),
        tag_ids: args
            .get("tagIds")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_i64()).collect::<Vec<i64>>()),
    }
}

fn patch_from_args(args: &Value) -> Result<task_cmds::TaskPatch, String> {
    let mut v = args.clone();
    if let Some(o) = v.as_object_mut() {
        if let Some(id) = args.get("taskId").and_then(|x| x.as_i64()) {
            o.insert("id".into(), json!(id));
        }
        o.remove("taskId");
    }
    serde_json::from_value(v).map_err(|e| format!("task patch 解析失败: {e}"))
}

// ---- op 实现：判定面（harness 组合，镜像 pk suggest batch 与 judge 回读链路）----

/// 代号 → 真名还原（harness 组合，与 bin/pk/suggest.rs restore_suggestion 同构）
fn restore_suggestion_mirror(conn: &Connection, s: &mut AiSuggestion) {
    if let Some(t) = s.title.take() {
        s.title = Some(crate::anonymize::restore(conn, &t));
    }
    if let Some(n) = s.note.take() {
        s.note = Some(crate::anonymize::restore(conn, &n));
    }
    if let Some(r) = s.reason.take() {
        s.reason = Some(crate::anonymize::restore(conn, &r));
    }
    for t in &mut s.tags {
        t.name = crate::anonymize::restore(conn, &t.name);
    }
}

/// 提交期校验（harness 组合，与 bin/pk/suggest.rs validate_suggestion 逐条同构；
/// 错误返回机器稳定 tag）。批内 messageId 判重并入此处（pk 在 parse 阶段判，语义等价）。
fn validate_suggestion_mirror(
    conn: &Connection,
    s: &AiSuggestion,
    seen: &mut HashSet<String>,
) -> Result<(), String> {
    if !seen.insert(s.message_id.clone()) {
        return Err("message-id-duplicated".into());
    }
    let review: Option<String> = conn
        .query_row(
            "SELECT review_status FROM chat_messages WHERE message_id=?1",
            params![s.message_id],
            |r| r.get(0),
        )
        .ok();
    let Some(review) = review else {
        return Err("message-not-found".into());
    };
    if review != "pending" {
        return Err("review-status-not-pending".into());
    }
    match s.action.as_str() {
        "todo" => {
            if s.title
                .as_deref()
                .map(str::trim)
                .filter(|t| !t.is_empty())
                .is_none()
            {
                return Err("todo-missing-title".into());
            }
        }
        "update" => {
            let Some(id) = s.update_task_id else {
                return Err("update-missing-task-id".into());
            };
            if !task_exists(conn, id) {
                return Err("update-task-not-found".into());
            }
        }
        "followUp" => {
            let Some(id) = s.follow_up_task_id else {
                return Err("followup-missing-task-id".into());
            };
            if !task_exists(conn, id) {
                return Err("followup-task-not-found".into());
            }
        }
        "none" | "" => {}
        _ => return Err("action-invalid".into()),
    }
    if let Some(p) = s.priority.as_deref().filter(|p| !p.is_empty()) {
        if !["low", "normal", "high", "urgent"].contains(&p) {
            return Err("priority-invalid".into());
        }
    }
    if let Some(c) = s.confidence.as_deref().filter(|c| !c.is_empty()) {
        if !["high", "medium", "low"].contains(&c) {
            return Err("confidence-invalid".into());
        }
    }
    if let Some(cat) = s.category.as_deref().filter(|c| !c.is_empty()) {
        let hit: Option<i64> = conn
            .query_row(
                "SELECT id FROM categories WHERE name=?1 AND enabled=1",
                params![cat],
                |r| r.get(0),
            )
            .ok();
        if hit.is_none() {
            return Err("category-not-enabled".into());
        }
    }
    if !s.tags.is_empty() {
        let all = crate::commands::tags::list_tags_conn(conn).map_err(|e| app_err_tag(&e))?;
        for t in &s.tags {
            if t.is_new {
                let dim_id = crate::commands::tags::dimension_id_by_key(conn, &t.dimension)
                    .map_err(|_| "tag-dimension-unknown".to_string())?;
                if crate::commands::tags::dimension_remaining(conn, dim_id)
                    .map_err(|e| app_err_tag(&e))?
                    <= 0
                {
                    return Err("tag-dimension-full".into());
                }
            } else {
                let hit = all
                    .iter()
                    .find(|x| x.name == t.name && x.dimension == t.dimension)
                    .or_else(|| all.iter().find(|x| x.name == t.name));
                if hit.is_none() {
                    return Err("tag-unknown".into());
                }
            }
        }
    }
    Ok(())
}

// ---- op 实现：配置对齐面（harness 组合，插件 host 命令层语义 = AD §4.1.1）----

fn settings_get(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key=?1",
        params![key],
        |r| r.get::<_, String>(0),
    )
    .ok()
}

/// 修订检测（expectedValue 基线失配 → SETTING_MODIFIED_ELSEWHERE；force 覆盖）
fn check_expected_value(
    conn: &Connection,
    key: &str,
    expected: Option<&str>,
    force: bool,
) -> Result<(), String> {
    if force {
        return Ok(());
    }
    if let Some(ev) = expected {
        if settings_get(conn, key).as_deref() != Some(ev) {
            return Err("SETTING_MODIFIED_ELSEWHERE".into());
        }
    }
    Ok(())
}

fn prompt_spec_state(conn: &Connection, key: &str) -> Value {
    let get = |k: &str| settings_get(conn, k);
    let Some(spec) = ai::editable_spec_by_key(key) else {
        return Value::Null;
    };
    let resolved = ai::resolve_override(&get, spec);
    json!({
        "source": serde_json::to_value(resolved.source).unwrap_or(Value::Null),
        "missingPlaceholders": resolved.missing,
        "overlong": resolved.overlong,
        "currentOverride": spec.storage_key.and_then(get),
    })
}

/// op=prompt_override / prompt_reset（harness 组合：键白名单 + 修订检测 + 校验 +
/// upsert/DELETE 落库，语义 = 主应用 save_ai_prompt 命令 + 插件 expectedValue 检测）
fn prompt_save_op(
    conn: &Connection,
    key: &str,
    value: &str,
    expected: Option<&str>,
    force: bool,
) -> Result<Value, String> {
    let spec = ai::editable_spec_by_key(key)
        .ok_or_else(|| "PROMPT_VALIDATION_FAILED:key-not-editable".to_string())?;
    check_expected_value(conn, key, expected, force)?;
    let before = prompt_spec_state(conn, key);
    let unknown = match ai::validate_prompt_save(spec, value).map_err(|e| {
        if matches!(e, crate::error::AppError::Invalid(_)) {
            "PROMPT_VALIDATION_FAILED".to_string()
        } else {
            app_err_tag(&e)
        }
    })? {
        ai::PromptSave::Delete => {
            conn.execute("DELETE FROM settings WHERE key=?1", params![key])
                .map_err(db_tag)?;
            vec![]
        }
        ai::PromptSave::Store {
            unknown_placeholders,
        } => {
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value=?2",
                params![key, value],
            )
            .map_err(db_tag)?;
            unknown_placeholders
        }
    };
    let after = prompt_spec_state(conn, key);
    Ok(json!({
        "before": before,
        "after": after,
        "unknownPlaceholders": unknown
    }))
}

fn agents_summary(conn: &Connection) -> Value {
    let get = |k: &str| settings_get(conn, k);
    let list: Vec<Value> = ai::load_agents(&get)
        .into_iter()
        .map(|a| json!({"id": a.id, "name": a.name, "command": a.command, "enabled": a.enabled}))
        .collect();
    json!(list)
}

/// op=agent_upsert / agent_delete（harness 组合：整读-改-整写 + 修订检测 +
/// 删除联动清 ai_agent_id，语义 = AD §4.1.1 agentUpsert/agentDelete）
fn agent_upsert_op(
    conn: &Connection,
    agent: &Value,
    expected_ids: Option<&Vec<String>>,
    force: bool,
) -> Result<Value, String> {
    let mut entry: ai::AgentConfig =
        serde_json::from_value(agent.clone()).map_err(|_| "agent-config-invalid".to_string())?;
    if entry.command.trim().is_empty() {
        return Err("AGENT_COMMAND_INVALID".into());
    }
    let get = |k: &str| settings_get(conn, k);
    let mut agents = ai::load_agents(&get);
    if let Some(expected) = expected_ids {
        if !force {
            let current: HashSet<String> = agents.iter().map(|a| a.id.clone()).collect();
            let want: HashSet<String> = expected.iter().cloned().collect();
            if current != want {
                return Err("SETTING_MODIFIED_ELSEWHERE".into());
            }
        }
    }
    entry.id = entry.id.trim().to_string();
    if let Some(slot) = agents.iter_mut().find(|a| a.id == entry.id) {
        *slot = entry;
    } else {
        agents.push(entry);
    }
    let encoded = serde_json::to_string(&agents).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('ai_agents', ?1)
         ON CONFLICT(key) DO UPDATE SET value=?1",
        params![encoded],
    )
    .map_err(db_tag)?;
    Ok(agents_summary(conn))
}

fn agent_delete_op(
    conn: &Connection,
    id: &str,
    expected_ids: Option<&Vec<String>>,
    force: bool,
) -> Result<Value, String> {
    let get = |k: &str| settings_get(conn, k);
    let mut agents = ai::load_agents(&get);
    if let Some(expected) = expected_ids {
        if !force {
            let current: HashSet<String> = agents.iter().map(|a| a.id.clone()).collect();
            let want: HashSet<String> = expected.iter().cloned().collect();
            if current != want {
                return Err("SETTING_MODIFIED_ELSEWHERE".into());
            }
        }
    }
    agents.retain(|a| a.id != id);
    let encoded = serde_json::to_string(&agents).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('ai_agents', ?1)
         ON CONFLICT(key) DO UPDATE SET value=?1",
        params![encoded],
    )
    .map_err(db_tag)?;
    // 「用于收音机分类」正指向被删 id 时一并清空（AD §4.1.1 agentDelete 联动）
    if settings_get(conn, "ai_agent_id").as_deref() == Some(id) {
        conn.execute("UPDATE settings SET value='' WHERE key='ai_agent_id'", [])
            .map_err(db_tag)?;
    }
    Ok(agents_summary(conn))
}

/// anon_build 的 myNames 快照（AnonRules 字段私有；与 AnonRules::build 同源的
/// settings/显示名读取——harness 组合，仅快照不参与判定）
fn my_names_snapshot(conn: &Connection) -> Vec<String> {
    let mut names = crate::anonymize::parse_name_list(
        &settings_get(conn, "feishu_my_names").unwrap_or_default(),
    );
    if let Some(my_name) = settings_get(conn, "feishu_my_name") {
        if my_name.chars().count() >= 2 {
            names.push(my_name);
        }
    }
    let my_open_id = settings_get(conn, "feishu_my_open_id").unwrap_or_default();
    if !my_open_id.is_empty() {
        if let Ok(name) = conn.query_row(
            "SELECT name FROM feishu_users WHERE open_id=?1",
            params![my_open_id],
            |r| r.get::<_, String>(0),
        ) {
            if name.chars().count() >= 2 {
                names.push(name);
            }
        }
    }
    names.sort_by_key(|a| std::cmp::Reverse(a.chars().count()));
    names.dedup();
    names
}

// ---- op 分发 ----

impl Harness {
    fn run_op(&mut self, op: &str, args: &Value) -> Result<Value, String> {
        // 审计写操作集（仅统计确定写 task_logs 的成功 op：审计守恒断言
        // auditRows >= write_ops 的期望侧；不写审计的 op 不计入）
        const AUDIT_WRITING_OPS: &[&str] = &[
            "task_create",
            "task_update",
            "task_start",
            "task_pause",
            "task_resume",
            "task_done",
            "task_undone",
            "task_escape",
            "task_delete",
            "task_reschedule",
            "review_accept",
            "review_apply_update",
            "dispatch_transition",
            "dispatch_reset",
            "dispatch_close",
        ];
        let result = self.dispatch_op(op, args);
        if result.is_ok() && AUDIT_WRITING_OPS.contains(&op) {
            self.write_ops += 1;
        }
        result
    }

    fn dispatch_op(&mut self, op: &str, args: &Value) -> Result<Value, String> {
        let idx = Self::conn_idx(args);
        match op {
            // ---- 任务面 ----
            "task_create" => self.with_conn(idx, |conn| {
                let t = task_cmds::create_task_conn(
                    conn,
                    &new_task_from_args(args),
                    &origin_arg(args),
                )
                .map_err(|e| app_err_tag(&e))?;
                Ok(json!({"id": t.id, "status": t.status, "dispatch": t.dispatch_state}))
            }),
            "task_update" => self.with_conn(idx, |conn| {
                let patch = patch_from_args(args)?;
                let t = task_cmds::update_task_conn(conn, &patch, &origin_arg(args))
                    .map_err(|e| app_err_tag(&e))?;
                Ok(json!({"id": t.id, "status": t.status, "dispatch": t.dispatch_state}))
            }),
            "task_start" | "task_resume" => self.with_conn_mut(idx, |conn| {
                let id = args
                    .get("taskId")
                    .and_then(|v| v.as_i64())
                    .ok_or("task-id-missing")?;
                let t = task_cmds::start_task_conn(conn, id, &origin_arg(args))
                    .map_err(|e| app_err_tag(&e))?;
                Ok(json!({"id": t.id, "status": t.status, "dispatch": t.dispatch_state}))
            }),
            "task_pause" => self.with_conn(idx, |conn| {
                let t = task_cmds::pause_current_task_conn(conn, &origin_arg(args))
                    .map_err(|e| app_err_tag(&e))?;
                Ok(json!({"paused": t.map(|t| t.id)}))
            }),
            "task_done" | "task_undone" | "task_escape" => self.with_conn(idx, |conn| {
                let id = args
                    .get("taskId")
                    .and_then(|v| v.as_i64())
                    .ok_or("task-id-missing")?;
                let status = match op {
                    "task_done" => "done",
                    // 撤销完成回到路线（scheduled）；有截止/曾出发的停留、无截止从未
                    // 出发的由草丛不变量归 inbox——update_task_conn 内建该分流
                    "task_undone" => "scheduled",
                    _ => "cancelled",
                };
                let patch = task_cmds::TaskPatch {
                    id,
                    title: None,
                    note: None,
                    category_id: None,
                    priority: None,
                    due_at: None,
                    remind_at: None,
                    status: Some(status.into()),
                    tag_ids: None,
                };
                let t = task_cmds::update_task_conn(conn, &patch, &origin_arg(args))
                    .map_err(|e| app_err_tag(&e))?;
                Ok(json!({"id": t.id, "status": t.status}))
            }),
            "task_delete" => self.with_conn(idx, |conn| {
                let id = args
                    .get("taskId")
                    .and_then(|v| v.as_i64())
                    .ok_or("task-id-missing")?;
                task_cmds::delete_task_conn(conn, id, &origin_arg(args))
                    .map_err(|e| app_err_tag(&e))?;
                Ok(json!({"deleted": id}))
            }),
            "task_reschedule" => self.with_conn(idx, |conn| {
                let id = args
                    .get("taskId")
                    .and_then(|v| v.as_i64())
                    .ok_or("task-id-missing")?;
                // 三态：due 缺省 = 不改；null / "" = 清空；字符串 = 设置（pk update 同构）
                let due = match args.get("due") {
                    None => None,
                    Some(Value::Null) => Some(Value::Null),
                    Some(Value::String(s)) if s.is_empty() => Some(Value::Null),
                    Some(Value::String(s)) => Some(Value::String(s.clone())),
                    Some(other) => Some(other.clone()),
                };
                let patch = task_cmds::TaskPatch {
                    id,
                    title: None,
                    note: None,
                    category_id: None,
                    priority: None,
                    due_at: due,
                    remind_at: None,
                    status: None,
                    tag_ids: None,
                };
                let t = task_cmds::update_task_conn(conn, &patch, &origin_arg(args))
                    .map_err(|e| app_err_tag(&e))?;
                Ok(json!({"id": t.id, "status": t.status, "dueAt": t.due_at}))
            }),
            "note_add" => self.with_conn(idx, |conn| {
                let id = args
                    .get("taskId")
                    .and_then(|v| v.as_i64())
                    .ok_or("task-id-missing")?;
                let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
                let source = args.get("source").and_then(|v| v.as_str()).unwrap_or("manual");
                let note = task_cmds::add_task_note_conn(conn, id, content, source)
                    .map_err(|e| app_err_tag(&e))?;
                Ok(json!({"noteId": note.id, "taskId": note.task_id}))
            }),

            // ---- 判定面 ----
            "suggest_batch" => self.with_conn(idx, |conn| {
                let results = args.get("results").cloned().unwrap_or(Value::Null);
                let mut list: Vec<AiSuggestion> = serde_json::from_value(results)
                    .map_err(|_| "results-parse-failed".to_string())?;
                if list.is_empty() {
                    return Err("results-empty".into());
                }
                let agent = args
                    .get("agent")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or("dsh:test");
                // 代号还原 → 逐条校验 → 单事务落库（整批原子，pk suggest batch 同构）
                for s in &mut list {
                    restore_suggestion_mirror(conn, s);
                }
                let mut seen = HashSet::new();
                for s in &list {
                    validate_suggestion_mirror(conn, s, &mut seen)?;
                }
                let n_todo = list.iter().filter(|s| s.is_todo()).count();
                let n_update = list.iter().filter(|s| s.is_update()).count();
                let n_follow = list.iter().filter(|s| s.is_follow_up()).count();
                let tx = conn
                    .unchecked_transaction()
                    .map_err(|e| format!("tx: {e}"))?;
                for s in &list {
                    radio::apply_suggestion_conn(&tx, s, agent).map_err(|e| app_err_tag(&e))?;
                }
                tx.commit().map_err(|e| format!("commit: {e}"))?;
                Ok(json!({
                    "submitted": list.len(),
                    "todo": n_todo,
                    "update": n_update,
                    "followUp": n_follow,
                    "none": list.len() - n_todo - n_update - n_follow,
                }))
            }),
            "claim_judge" => self.with_conn(idx, |conn| {
                let ids: Vec<String> = args
                    .get("messageIds")
                    .and_then(|v| v.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|x| x.as_str().map(String::from))
                            .collect()
                    })
                    .ok_or("message-ids-missing")?;
                let ts = ts_arg(args, "now").ok_or("claim-now-missing")?;
                let claimed =
                    radio::claim_judging_conn(conn, &ids, &ts).map_err(|e| app_err_tag(&e))?;
                Ok(json!({"claimed": claimed}))
            }),
            // §5 op 枚举的 harness 扩展（报告注明）：judging 超时回收（A6）是 claim
            // 协议的组成部分，但主应用只在内层 retry_ai_judgment（async + agent 路径）
            // 里调用——契约面单列 judge_reclaim 直接驱动 reclaim_stale_judging_conn
            "judge_reclaim" => self.with_conn(idx, |conn| {
                let n = radio::reclaim_stale_judging_conn(conn).map_err(|e| app_err_tag(&e))?;
                Ok(json!({"reclaimed": n}))
            }),
            "apply_judge_result" => self.with_conn(idx, |conn| {
                // harness 组合：judge.rs run_and_collect + classify_and_apply 落地段的
                // conn 侧镜像（回读 → claim 守卫过滤 → 批内判重 → 未提及按 none 兜底）
                let ids: Vec<String> = args
                    .get("messageIds")
                    .and_then(|v| v.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|x| x.as_str().map(String::from))
                            .collect()
                    })
                    .ok_or("message-ids-missing")?;
                let agent = args
                    .get("agent")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or("dsh:test");
                let loaded =
                    radio::load_suggestions_conn(conn, &ids).map_err(|e| app_err_tag(&e))?;
                let (mut kept, dropped) = match ts_arg(args, "claimTs") {
                    Some(ts) => radio::filter_by_claim_conn(conn, loaded, &ts)
                        .map_err(|e| app_err_tag(&e))?,
                    None => (loaded, vec![]),
                };
                let demoted = ai::dedup_batch_todos(&mut kept);
                for s in kept.iter().filter(|s| demoted.contains(&s.message_id)) {
                    conn.execute(
                        "UPDATE chat_messages SET ai_status='none', suggested_title=NULL,
                                suggested_note=NULL, suggested_category=NULL, suggested_due=NULL,
                                suggested_priority=NULL, suggested_tags='[]', suggested_reason=?2
                         WHERE message_id=?1",
                        params![s.message_id, s.reason],
                    )
                    .map_err(db_tag)?;
                }
                let by_id: HashMap<String, AiSuggestion> = kept
                    .iter()
                    .map(|s| (s.message_id.clone(), s.clone()))
                    .collect();
                let mut applied = vec![];
                for id in &ids {
                    if dropped.contains(id) {
                        continue;
                    }
                    let s = by_id.get(id).cloned().unwrap_or_else(|| AiSuggestion {
                        message_id: id.clone(),
                        ..Default::default()
                    });
                    radio::apply_suggestion_conn(conn, &s, agent)
                        .map_err(|e| app_err_tag(&e))?;
                    applied.push(id.clone());
                }
                Ok(json!({
                    "kept": kept.iter().map(|s| s.message_id.clone()).collect::<Vec<_>>(),
                    "dropped": dropped,
                    "demoted": demoted,
                    "applied": applied,
                }))
            }),

            // ---- 分诊面（真实 tauri 命令，mock runtime；仅主连接）----
            "review_accept" | "review_dismiss" | "review_apply_update" | "review_restore" => {
                let mid = args
                    .get("messageId")
                    .and_then(|v| v.as_str())
                    .ok_or("message-id-missing")?;
                let reason = args.get("reasonCode").and_then(|v| v.as_str());
                let row_id = self.with_conn(0, |c| message_row_id(c, mid))?;
                let app = self.rt(idx)?;
                let db = app.state::<Db>();
                let handle = app.handle().clone();
                match op {
                    "review_accept" => commands::accept_chat_message(handle, db, row_id)
                        .map(|task_id| json!({"taskId": task_id})),
                    "review_dismiss" => {
                        commands::dismiss_chat_message(
                            handle,
                            db,
                            row_id,
                            reason.map(String::from),
                        )
                        .map(|()| json!({"dismissed": mid}))
                    }
                    "review_apply_update" => {
                        commands::apply_chat_message_update(handle, db, row_id)
                            .map(|task_id| json!({"taskId": task_id}))
                    }
                    _ => commands::undo_chat_review(handle, db, row_id)
                        .map(|()| json!({"restored": mid})),
                }
                .map_err(|e| app_err_tag(&e))
            }

            // ---- 派发面（state.rs / auto.rs 真实原语）----
            "dispatch_queue" => self.with_conn(idx, |conn| {
                let n = commands::dispatch::queue_due_tasks(conn).map_err(|e| app_err_tag(&e))?;
                Ok(json!({"queued": n}))
            }),
            "dispatch_claim" => self.with_conn(idx, |conn| {
                let id = args
                    .get("taskId")
                    .and_then(|v| v.as_i64())
                    .ok_or("task-id-missing")?;
                if args.get("withSlot").and_then(|v| v.as_bool()).unwrap_or(true) {
                    let host = args.get("host").and_then(|v| v.as_str()).unwrap_or("local");
                    let max =
                        args.get("maxConcurrent").and_then(|v| v.as_u64()).unwrap_or(1) as usize;
                    let lease = args.get("leaseSecs").and_then(|v| v.as_i64()).unwrap_or(900);
                    let got = commands::dispatch::claim_with_slot(conn, id, host, max, lease)
                        .map_err(|e| app_err_tag(&e))?;
                    Ok(json!({"claimed": got}))
                } else {
                    let allow_null = args.get("allowNull").and_then(|v| v.as_bool()).unwrap_or(true);
                    let states: Vec<String> = args
                        .get("states")
                        .and_then(|v| v.as_array())
                        .map(|a| {
                            a.iter()
                                .filter_map(|x| x.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_else(|| vec!["done".into(), "failed".into(), "queued".into()]);
                    let refs: Vec<&str> = states.iter().map(|s| s.as_str()).collect();
                    let got = commands::dispatch::claim_dispatch(conn, id, allow_null, &refs)
                        .map_err(|e| app_err_tag(&e))?;
                    Ok(json!({"claimed": got}))
                }
            }),
            "dispatch_transition" | "dispatch_reset" => self.with_conn(idx, |conn| {
                let id = args
                    .get("taskId")
                    .and_then(|v| v.as_i64())
                    .ok_or("task-id-missing")?;
                // to=null / dispatch_reset 缺省 → 重置（救援）；其余按状态机迁移
                let to = match args.get("to").and_then(|v| v.as_str()) {
                    Some(s) if s != "null" => Some(s),
                    _ => None,
                };
                let note = args.get("note").and_then(|v| v.as_str());
                let origin = args.get("origin").and_then(|v| v.as_str()).unwrap_or("dsh:test");
                commands::dispatch::dispatch_transition_conn(conn, id, to, note, origin)
                    .map_err(|e| app_err_tag(&e))?;
                Ok(json!({"taskId": id, "to": to}))
            }),
            "dispatch_close" => self.with_conn(idx, |conn| {
                // harness 组合：迁移到 done/failed + 释放槽（auto.rs 收口顺序同构）
                let id = args
                    .get("taskId")
                    .and_then(|v| v.as_i64())
                    .ok_or("task-id-missing")?;
                let to = args.get("result").and_then(|v| v.as_str()).ok_or("result-missing")?;
                let note = args.get("note").and_then(|v| v.as_str());
                commands::dispatch::dispatch_transition_conn(conn, id, Some(to), note, "dsh:test")
                    .map_err(|e| app_err_tag(&e))?;
                if let Some(host) = args.get("host").and_then(|v| v.as_str()) {
                    commands::dispatch::release_slot(conn, host, id)
                        .map_err(|e| app_err_tag(&e))?;
                }
                Ok(json!({"taskId": id, "result": to}))
            }),
            "slot_acquire" => self.with_conn(idx, |conn| {
                let id = args
                    .get("taskId")
                    .and_then(|v| v.as_i64())
                    .ok_or("task-id-missing")?;
                let host = args.get("host").and_then(|v| v.as_str()).unwrap_or("local");
                let max = args.get("maxConcurrent").and_then(|v| v.as_u64()).unwrap_or(1) as usize;
                let lease = args.get("leaseSecs").and_then(|v| v.as_i64()).unwrap_or(900);
                let got = commands::dispatch::claim_with_slot(conn, id, host, max, lease)
                    .map_err(|e| app_err_tag(&e))?;
                Ok(json!({"acquired": got, "host": host}))
            }),
            "slot_release" => self.with_conn(idx, |conn| {
                let id = args
                    .get("taskId")
                    .and_then(|v| v.as_i64())
                    .ok_or("task-id-missing")?;
                let host = args.get("host").and_then(|v| v.as_str()).unwrap_or("local");
                commands::dispatch::release_slot(conn, host, id).map_err(|e| app_err_tag(&e))?;
                Ok(json!({"released": id}))
            }),
            "slot_reclaim" => self.with_conn(idx, |conn| {
                let n = commands::dispatch::reclaim_expired_slots(conn)
                    .map_err(|e| app_err_tag(&e))?;
                Ok(json!({"reclaimed": n}))
            }),

            // ---- 假名化面（anonymize.rs 真实原语）----
            "anon_build" => self.with_conn(idx, |conn| {
                let mut rules = crate::anonymize::AnonRules::build(conn);
                // openIds：逐个走 alias_of（真实懒分配原语：未分配的按哈希生成 +
                // 碰撞探测 + 落库；radio 流程给 sender 分配代号用的同一入口）
                let mut alias_by_open_id = Map::new();
                if let Some(ids) = args.get("openIds").and_then(|v| v.as_array()) {
                    for oid in ids.iter().filter_map(|x| x.as_str()) {
                        alias_by_open_id
                            .insert(oid.to_string(), Value::String(rules.alias_of(conn, oid)));
                    }
                }
                Ok(json!({
                    "myNames": my_names_snapshot(conn),
                    "sameNameRisk": rules.same_name_risk,
                    "aliasByOpenId": Value::Object(alias_by_open_id),
                }))
            }),
            "anon_scrub" => self.with_conn(idx, |conn| {
                let text = args.get("text").and_then(|v| v.as_str()).ok_or("text-missing")?;
                let rules = crate::anonymize::AnonRules::build(conn);
                let out = if args.get("titles").and_then(|v| v.as_bool()).unwrap_or(false) {
                    rules.scrub_titles(text)
                } else {
                    rules.scrub(text)
                };
                Ok(json!({"scrubbed": out, "hintsMe": rules.hints_me(&out)}))
            }),
            "anon_restore" => self.with_conn(idx, |conn| {
                let text = args.get("text").and_then(|v| v.as_str()).ok_or("text-missing")?;
                Ok(json!({"restored": crate::anonymize::restore(conn, text)}))
            }),
            // harness 组合：把 alias_hash(withHashOf) 的首选项写到 openId 行上，
            // 构造确定性碰撞场景（DefaultHasher 同构建内确定，A18 场景依赖）
            "anon_preoccupy" => self.with_conn(idx, |conn| {
                let open_id = args
                    .get("openId")
                    .and_then(|v| v.as_str())
                    .ok_or("open-id-missing")?;
                let hash_of = args
                    .get("withHashOf")
                    .and_then(|v| v.as_str())
                    .ok_or("with-hash-of-missing")?;
                let target = crate::anonymize::alias_hash(hash_of);
                conn.execute(
                    "INSERT INTO feishu_users (open_id, name, updated_at) VALUES (?1, '', ?2)
                     ON CONFLICT(open_id) DO NOTHING",
                    params![open_id, crate::db::now()],
                )
                .map_err(db_tag)?;
                let n = conn.execute(
                    "UPDATE feishu_users SET alias=?2 WHERE open_id=?1 AND (alias='' OR alias IS NULL)",
                    params![open_id, target],
                )
                .map_err(db_tag)?;
                if n == 0 {
                    return Err("preoccupy-failed".into());
                }
                Ok(json!({"preoccupied": target}))
            }),

            // ---- 配置对齐面 ----
            "prompt_override" => self.with_conn(idx, |conn| {
                let key = args.get("key").and_then(|v| v.as_str()).ok_or("key-missing")?;
                let value = args.get("value").and_then(|v| v.as_str()).unwrap_or("");
                let expected = args.get("expectedValue").and_then(|v| v.as_str());
                let force = args.get("force").and_then(|v| v.as_bool()).unwrap_or(false);
                prompt_save_op(conn, key, value, expected, force)
            }),
            "prompt_reset" => self.with_conn(idx, |conn| {
                let key = args.get("key").and_then(|v| v.as_str()).ok_or("key-missing")?;
                let expected = args.get("expectedValue").and_then(|v| v.as_str());
                let force = args.get("force").and_then(|v| v.as_bool()).unwrap_or(false);
                prompt_save_op(conn, key, "", expected, force)
            }),
            "agent_upsert" => self.with_conn(idx, |conn| {
                let agent = args.get("agent").cloned().ok_or("agent-missing")?;
                let expected = args.get("expectedAgentIds").and_then(|v| v.as_array()).map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(String::from))
                        .collect::<Vec<String>>()
                });
                let force = args.get("force").and_then(|v| v.as_bool()).unwrap_or(false);
                agent_upsert_op(conn, &agent, expected.as_ref(), force)
            }),
            "agent_delete" => self.with_conn(idx, |conn| {
                let id = args.get("id").and_then(|v| v.as_str()).ok_or("id-missing")?;
                let expected = args.get("expectedAgentIds").and_then(|v| v.as_array()).map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(String::from))
                        .collect::<Vec<String>>()
                });
                let force = args.get("force").and_then(|v| v.as_bool()).unwrap_or(false);
                agent_delete_op(conn, id, expected.as_ref(), force)
            }),
            "config_write" => {
                let kvs = args
                    .get("keyValues")
                    .and_then(|v| v.as_object())
                    .cloned()
                    .ok_or("key-values-missing")?;
                for (k, v) in &kvs {
                    let value = v.as_str().map(String::from).unwrap_or_else(|| v.to_string());
                    let app = self.rt(idx)?;
                    let db = app.state::<Db>();
                    commands::set_setting(app.handle().clone(), db, k.clone(), value)
                        .map_err(|e| app_err_tag(&e))?;
                }
                Ok(json!({"written": kvs.len()}))
            }

            // ---- 背包词表面（真实 tauri 命令）----
            "category_upsert" => {
                let name = args.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let pokemon =
                    args.get("pokemon").and_then(|v| v.as_str()).unwrap_or("伊布").to_string();
                let sprite =
                    args.get("sprite").and_then(|v| v.as_str()).unwrap_or("eevee").to_string();
                let description =
                    args.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let enabled = args.get("enabled").and_then(|v| v.as_bool());
                match args.get("id").and_then(|v| v.as_i64()) {
                    None => {
                        let app = self.rt(idx)?;
                        let db = app.state::<Db>();
                        let cat = commands::create_category(
                            app.handle().clone(),
                            db,
                            name,
                            pokemon,
                            sprite,
                            description,
                        )
                        .map_err(|e| app_err_tag(&e))?;
                        Ok(json!({"id": cat.id, "name": cat.name, "enabled": cat.enabled}))
                    }
                    Some(id) => {
                        if let Some(on) = enabled {
                            let app = self.rt(idx)?;
                            let db = app.state::<Db>();
                            commands::set_category_enabled(app.handle().clone(), db, id, on)
                                .map_err(|e| app_err_tag(&e))?;
                        }
                        if args.get("pokemon").is_some()
                            || args.get("sprite").is_some()
                            || args.get("description").is_some()
                            || args.get("name").is_some()
                        {
                            // harness 组合：update_category 全字段覆盖，缺省字段回读现值
                            let cur = self.with_conn(0, |conn| {
                                conn.query_row(
                                    "SELECT name, pokemon, sprite, description FROM categories WHERE id=?1",
                                    params![id],
                                    |r| {
                                        Ok((
                                            r.get::<_, String>(0)?,
                                            r.get::<_, String>(1)?,
                                            r.get::<_, String>(2)?,
                                            r.get::<_, String>(3)?,
                                        ))
                                    },
                                )
                                .map_err(|_| "not-found".to_string())
                            })?;
                            let n = args
                                .get("name")
                                .and_then(|v| v.as_str())
                                .map(String::from)
                                .unwrap_or(cur.0);
                            let p = args
                                .get("pokemon")
                                .and_then(|v| v.as_str())
                                .map(String::from)
                                .unwrap_or(cur.1);
                            let s = args
                                .get("sprite")
                                .and_then(|v| v.as_str())
                                .map(String::from)
                                .unwrap_or(cur.2);
                            let d = args
                                .get("description")
                                .and_then(|v| v.as_str())
                                .map(String::from)
                                .unwrap_or(cur.3);
                            let app = self.rt(idx)?;
                            let db = app.state::<Db>();
                            commands::update_category(
                                app.handle().clone(),
                                db,
                                id,
                                n,
                                p,
                                s,
                                d,
                            )
                            .map_err(|e| app_err_tag(&e))?;
                        }
                        Ok(json!({"id": id}))
                    }
                }
            }
            "category_delete" => {
                let id = args.get("id").and_then(|v| v.as_i64()).ok_or("id-missing")?;
                let moved = self.with_conn(0, |conn| {
                    let n: i64 = conn
                        .query_row(
                            "SELECT COUNT(*) FROM tasks WHERE category_id=?1",
                            params![id],
                            |r| r.get(0),
                        )
                        .unwrap_or(0);
                    Ok(n)
                })?;
                let app = self.rt(idx)?;
                let db = app.state::<Db>();
                commands::delete_category(app.handle().clone(), db, id)
                    .map_err(|e| app_err_tag(&e))?;
                Ok(json!({"id": id, "movedTaskCount": moved}))
            }
            "tag_upsert" => {
                let name = args.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                match args.get("id").and_then(|v| v.as_i64()) {
                    None => {
                        let app = self.rt(idx)?;
                        let db = app.state::<Db>();
                        let tag = commands::create_tag(
                            app.handle().clone(),
                            db,
                            name,
                            args.get("description").and_then(|v| v.as_str().map(String::from)),
                            args.get("dimension").and_then(|v| v.as_str().map(String::from)),
                        )
                        .map_err(|e| app_err_tag(&e))?;
                        Ok(json!({
                            "id": tag.id,
                            "dimension": tag.dimension,
                            "origin": tag.origin
                        }))
                    }
                    Some(id) => {
                        let app = self.rt(idx)?;
                        let db = app.state::<Db>();
                        commands::update_tag(
                            app.handle().clone(),
                            db,
                            id,
                            name,
                            args.get("description").and_then(|v| v.as_str().map(String::from)),
                            args.get("dimension").and_then(|v| v.as_str().map(String::from)),
                        )
                        .map_err(|e| app_err_tag(&e))?;
                        Ok(json!({"id": id}))
                    }
                }
            }
            "tag_delete" => {
                let id = args.get("id").and_then(|v| v.as_i64()).ok_or("id-missing")?;
                let app = self.rt(idx)?;
                let db = app.state::<Db>();
                commands::delete_tag(app.handle().clone(), db, id)
                    .map_err(|e| app_err_tag(&e))?;
                Ok(json!({"id": id}))
            }
            "dimension_update" => {
                let id = args.get("id").and_then(|v| v.as_i64()).ok_or("id-missing")?;
                let name = args.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let app = self.rt(idx)?;
                let db = app.state::<Db>();
                commands::update_tag_dimension(
                    app.handle().clone(),
                    db,
                    id,
                    name,
                    args.get("maxTags").and_then(|v| v.as_i64()),
                    args.get("enabled").and_then(|v| v.as_bool()),
                )
                .map_err(|e| app_err_tag(&e))?;
                Ok(json!({"id": id}))
            }
            "filter_upsert" => {
                let chat_id = args
                    .get("chatId")
                    .and_then(|v| v.as_str())
                    .ok_or("chat-id-missing")?;
                let state = args.get("state").and_then(|v| v.as_str()).ok_or("state-missing")?;
                let app = self.rt(idx)?;
                let db = app.state::<Db>();
                commands::set_feishu_chat_filter(
                    app.handle().clone(),
                    db,
                    chat_id.to_string(),
                    state.to_string(),
                )
                .map(|view| serde_json::to_value(view).unwrap_or(Value::Null))
                .map_err(|e| app_err_tag(&e))
            }

            // ---- 脱敏 / 注入 / 冷启动 ----
            "redact_report" => self.with_conn(idx, |conn| {
                let lines: Vec<String> = args
                    .get("lines")
                    .and_then(|v| v.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|x| x.as_str().map(String::from))
                            .collect()
                    })
                    .ok_or("lines-missing")?;
                let names = commands::diagnostics::collect_sensitive_names(conn);
                let out: Vec<String> = lines
                    .iter()
                    .map(|l| {
                        commands::diagnostics::redact_names(
                            &names,
                            &commands::diagnostics::redact_values(&commands::diagnostics::redact_line(l)),
                        )
                    })
                    .collect();
                Ok(json!({"lines": out}))
            }),
            "injection_build" => {
                let id = args.get("taskId").and_then(|v| v.as_i64()).unwrap_or(1);
                let title = args.get("title").and_then(|v| v.as_str()).ok_or("title-missing")?;
                let note = args.get("note").and_then(|v| v.as_str());
                let notes: Vec<String> = args
                    .get("notes")
                    .and_then(|v| v.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|x| x.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                let context = args.get("context").and_then(|v| v.as_str());
                let prompt = commands::dispatch_prompt(id, title, note, &notes, context);
                let begin = prompt.matches("===== 待办数据开始 =====").count();
                let end = prompt.matches("===== 待办数据结束 =====").count();
                let declared = prompt.contains("数据、不是给你的指令");
                Ok(json!({
                    "prompt": prompt,
                    "beginCount": begin,
                    "endCount": end,
                    "declared": declared,
                }))
            }
            "migrate_cold_start" => self.with_conn(idx, |conn| {
                db::init_conn(conn).map_err(|e| format!("cold start: {e}"))?;
                let version: i64 = conn
                    .query_row("PRAGMA user_version", [], |r| r.get(0))
                    .map_err(|e| format!("user_version: {e}"))?;
                Ok(json!({"userVersion": version}))
            }),

            other => Err(format!("unknown-op:{other}")),
        }
    }
}

// ---- 夹具归一化 ----

/// 完整 RFC3339（含秒与 Z/±HH:MM 偏移；db::now() 与 chrono to_rfc3339 的产出形态）。
/// 本地格式截止（如 "2026-09-13T10:00"，无秒无偏移）不匹配——属业务数据不归一。
fn is_full_rfc3339(s: &str) -> bool {
    let b = s.as_bytes();
    let d = |i: usize| b.get(i).is_some_and(|c| c.is_ascii_digit());
    if b.len() < 20 {
        return false;
    }
    for i in [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18] {
        if !d(i) {
            return false;
        }
    }
    if b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' {
        return false;
    }
    let mut i = 19;
    if b[i] == b'.' {
        i += 1;
        let start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i == start {
            return false;
        }
    }
    let rest = &b[i..];
    if rest == b"Z" {
        return true;
    }
    rest.len() == 6
        && (rest[0] == b'+' || rest[0] == b'-')
        && rest[1..3].iter().all(|c| c.is_ascii_digit())
        && rest[3] == b':'
        && rest[4..6].iter().all(|c| c.is_ascii_digit())
}

/// 第一遍：完整 RFC3339 时间戳 → `<ts:N>`（字典序遍历的出现序；同值同占位符）
fn normalize_timestamps(v: &mut Value, next: &mut usize, seen: &mut BTreeMap<String, String>) {
    match v {
        Value::String(s) => {
            if is_full_rfc3339(s) {
                let ph = match seen.get(s.as_str()) {
                    Some(p) => p.clone(),
                    None => {
                        let p = format!("<ts:{}>", *next);
                        *next += 1;
                        seen.insert(s.clone(), p.clone());
                        p
                    }
                };
                *s = ph;
            }
        }
        Value::Array(a) => {
            for x in a {
                normalize_timestamps(x, next, seen);
            }
        }
        Value::Object(o) => {
            for (_, x) in o {
                normalize_timestamps(x, next, seen);
            }
        }
        _ => {}
    }
}

/// 第二遍：`成员_[0-9a-f]+(\{[0-9a-f]+\})?` → `<alias:N>`（A18；N = 第 N 个不同
/// open_id——有主别名按 open_id 记账，无主（幻觉/无行）按别名串本身记账）
struct AliasNormalizer {
    known: Vec<(String, String)>, // alias → open_id（长别名优先，防前缀截胡）
    ids: BTreeMap<String, String>, // identity → placeholder
    next: usize,
}

impl AliasNormalizer {
    fn from_conn(conn: &Connection) -> Self {
        let mut known: Vec<(String, String)> = vec![];
        if let Ok(mut stmt) =
            conn.prepare("SELECT alias, open_id FROM feishu_users WHERE alias != ''")
        {
            if let Ok(rows) =
                stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            {
                for (alias, open_id) in rows.flatten() {
                    known.push((alias, open_id));
                }
            }
        }
        known.sort_by_key(|(a, _)| std::cmp::Reverse(a.chars().count()));
        AliasNormalizer {
            known,
            ids: BTreeMap::new(),
            next: 0,
        }
    }

    fn placeholder_for(&mut self, alias: &str) -> String {
        let identity = self
            .known
            .iter()
            .find(|(a, _)| a == alias)
            .map(|(_, oid)| oid.clone())
            .unwrap_or_else(|| alias.to_string());
        if let Some(ph) = self.ids.get(&identity) {
            return ph.clone();
        }
        let ph = format!("<alias:{}>", self.next);
        self.next += 1;
        self.ids.insert(identity, ph.clone());
        ph
    }

    fn scrub_string(&mut self, s: &str) -> String {
        const HEAD: &str = "成员_";
        let mut out = String::with_capacity(s.len());
        let mut rest = s;
        while let Some(pos) = rest.find(HEAD) {
            out.push_str(&rest[..pos]);
            let after = &rest[pos + HEAD.len()..];
            let bytes = after.as_bytes();
            let mut end = 0;
            while end < bytes.len() && matches!(bytes[end], b'0'..=b'9' | b'a'..=b'f') {
                end += 1;
            }
            let hex_end = end;
            // 可选 probe 后缀 {hex+}
            if bytes.get(hex_end) == Some(&b'{') {
                let mut j = hex_end + 1;
                while j < bytes.len() && matches!(bytes[j], b'0'..=b'9' | b'a'..=b'f') {
                    j += 1;
                }
                if bytes.get(j) == Some(&b'}') && j > hex_end + 1 {
                    end = j + 1;
                }
            }
            if hex_end == 0 {
                // 「成员_」后无 hex：不是别名形态，原样保留并跳过该前缀
                out.push_str(HEAD);
                rest = after;
                continue;
            }
            let alias = &after[..end];
            let ph = self.placeholder_for(alias);
            out.push_str(&ph);
            rest = &after[end..];
        }
        out.push_str(rest);
        out
    }

    fn walk(&mut self, v: &mut Value) {
        match v {
            Value::String(s) => {
                if s.contains("成员_") {
                    *s = self.scrub_string(s);
                }
            }
            Value::Array(a) => {
                for x in a {
                    self.walk(x);
                }
            }
            Value::Object(o) => {
                for (_, x) in o {
                    self.walk(x);
                }
            }
            _ => {}
        }
    }
}

// ---- 场景执行 → 夹具 ----

fn execute_scenario(sc: &Scenario) -> Value {
    let mut h = Harness::new(&sc.kind, &sc.name, &sc.setup);
    let mut steps = vec![];
    for step in &sc.steps {
        let res = h.run_op(&step.op, &step.args);
        let snapshot = if sc.expect == "invariants" {
            Value::Null
        } else {
            h.snapshot()
        };
        let entry = match res {
            Ok(v) => json!({"ok": true, "error": null, "value": v, "snapshot": snapshot}),
            Err(tag) => json!({"ok": false, "error": tag, "value": null, "snapshot": snapshot}),
        };
        steps.push(entry);
    }
    // 别名归属表须在连接存活时取（归一化在 finish 后做，凭快照记账）
    let alias_seed = h
        .with_conn(0, |c| Ok(AliasNormalizer::from_conn(c)))
        .expect("别名归属表读取失败");
    let final_state = if sc.expect == "invariants" {
        json!({"invariants": h.invariants()})
    } else {
        h.dump_final()
    };
    h.finish();

    let mut fixture = json!({
        "scenario": sc.name,
        "generatedBy": {"impl": "rust", "schemaVersion": FIXTURE_SCHEMA_VERSION},
        "steps": steps,
        "final": final_state,
    });

    // 归一化（先时间戳后别名；遍历序 = 对象键字典序 + 数组序）
    let mut ts_next = 0usize;
    let mut ts_seen = BTreeMap::new();
    normalize_timestamps(&mut fixture, &mut ts_next, &mut ts_seen);
    let mut alias_norm = alias_seed;
    alias_norm.walk(&mut fixture);
    fixture
}

// ---- 测试入口 ----

fn update_fixtures_mode() -> bool {
    std::env::var("UPDATE_FIXTURES").ok().as_deref() == Some("1")
}

/// FR-X3 主测试：执行全部场景 → 生成（UPDATE_FIXTURES=1）或逐字节比对夹具。
/// 含 M3a 完备性（正向）：按目录动态发现，执行集 == 目录文件集——新增场景文件
/// 未被执行即红（本 harness 以发现驱动执行，清单与文件集不可能静默漂移）。
#[test]
fn contracts_scenarios_execute_and_match_fixtures() {
    let scenarios = discover_scenarios();
    assert!(
        !scenarios.is_empty(),
        "contracts/scenarios 目录为空：契约套件必须有场景"
    );
    let update = update_fixtures_mode();
    let mut executed = HashSet::new();
    let mut mismatches = vec![];
    for (group, name, path) in &scenarios {
        let sc = load_scenario(path);
        assert_eq!(sc.kind, *group, "{path:?}: kind 须与组目录一致");
        assert_eq!(sc.name, *name, "{path:?}: name 须与文件名一致");
        assert!(
            sc.expect == "exact" || sc.expect == "invariants",
            "{path:?}: expect 只支持 exact / invariants"
        );
        // PROTOCOL §5：now 为必填的确定性时钟基点（协议字段；op 内不可控时间戳
        // 由输出侧归一兜底，不注入应用代码）
        assert!(
            !sc.now.trim().is_empty(),
            "{path:?}: 场景缺 now（确定性时钟基点）"
        );
        let fixture = execute_scenario(&sc);
        executed.insert(format!("{group}/{name}"));

        let fixture_path = repo_contracts_dir("fixtures")
            .join(group)
            .join(format!("{name}.json"));
        let pretty = {
            let mut s = serde_json::to_string_pretty(&fixture).unwrap();
            s.push('\n');
            s
        };
        if update {
            if let Some(dir) = fixture_path.parent() {
                std::fs::create_dir_all(dir).expect("创建 fixtures 目录");
            }
            std::fs::write(&fixture_path, &pretty)
                .unwrap_or_else(|e| panic!("写 {fixture_path:?}: {e}"));
        } else {
            let Ok(current) = std::fs::read_to_string(&fixture_path) else {
                mismatches.push(format!(
                    "{group}/{name}: 夹具缺失（先 UPDATE_FIXTURES=1 生成）"
                ));
                continue;
            };
            if current != pretty {
                mismatches.push(format!(
                    "{group}/{name}: 夹具漂移（行为变更须显式 UPDATE_FIXTURES=1 重生成）"
                ));
            }
        }
    }
    assert!(
        mismatches.is_empty(),
        "契约夹具不一致（{} 处）：\n{}",
        mismatches.len(),
        mismatches.join("\n")
    );
    let discovered: HashSet<String> = scenarios
        .iter()
        .map(|(g, n, _)| format!("{g}/{n}"))
        .collect();
    assert_eq!(executed, discovered, "执行场景集必须与目录文件集一致");
}

/// M3a 完备性（反向）：fixtures 目录不得有场景之外的孤儿文件（防静默删场景留脏夹具）
#[test]
fn contracts_fixtures_have_no_orphans() {
    let scenarios = discover_scenarios();
    let fixtures_root = repo_contracts_dir("fixtures");
    if !fixtures_root.exists() {
        return; // 尚未生成（首次运行由主测试报告缺失）
    }
    let mut expected = HashSet::new();
    for (g, n, _) in &scenarios {
        expected.insert(fixtures_root.join(g).join(format!("{n}.json")));
    }
    let mut orphans = vec![];
    for group in std::fs::read_dir(&fixtures_root).unwrap().flatten() {
        let gd = group.path();
        if !gd.is_dir() {
            continue;
        }
        for f in std::fs::read_dir(&gd).unwrap().flatten() {
            let p = f.path();
            if p.extension().is_some_and(|x| x == "json") && !expected.contains(&p) {
                orphans.push(p.display().to_string());
            }
        }
    }
    assert!(
        orphans.is_empty(),
        "fixtures 存在无场景对应的孤儿文件：{:?}",
        orphans
    );
}

/// schema 同源断言（AD §4.4）：include_str! 的两个 SQL 与磁盘字节相等（防复制路径
/// 漂移），裸执行两 SQL + PRAGMA user_version=2 后 sqlite_master 含 dispatch_slots、
/// chat_messages 含 judge_claimed_at；与 db.rs 迁移产物同版本。
#[test]
fn contracts_schema_single_source() {
    const V1: &str = include_str!("../../../contracts/schema/001_v1.sql");
    const V2: &str = include_str!("../../../contracts/schema/002_dispatch_coord.sql");
    for (included, file) in [(V1, "001_v1.sql"), (V2, "002_dispatch_coord.sql")] {
        let disk = std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../contracts/schema")
                .join(file),
        )
        .unwrap_or_else(|e| panic!("读 {file}: {e}"));
        assert_eq!(
            included, disk,
            "contracts/schema/{file} 与编译进二进制的副本字节不一致"
        );
    }
    // 裸执行 → 关键表/列在场
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(V1).unwrap();
    conn.execute_batch(V2).unwrap();
    conn.execute_batch("PRAGMA user_version=2;").unwrap();
    let tables: HashSet<String> = {
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .unwrap();
        stmt.query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    };
    assert!(tables.contains("dispatch_slots"), "002 须建 dispatch_slots");
    let cols: HashSet<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(chat_messages)").unwrap();
        stmt.query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    };
    assert!(
        cols.contains("judge_claimed_at"),
        "chat_messages 须含 judge_claimed_at"
    );
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, 2);
    // 与 db.rs 迁移同源：init_conn 产物同版本号
    let migrated = Connection::open_in_memory().unwrap();
    db::init_conn(&migrated).unwrap();
    let mv: i64 = migrated
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(mv, db::expected_schema_version());
    assert_eq!(mv, 2);
}
