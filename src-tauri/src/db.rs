use rusqlite::Connection;
use std::sync::Mutex;
use tauri::Manager;

pub struct Db(pub Mutex<Connection>);

/// 应用标识（tauri.conf.json 的 identifier）：数据目录名。
/// pk CLI 定位数据库与 agent 缺省工作目录共用，改动须与 tauri.conf.json 同步
pub const APP_IDENTIFIER: &str = "com.jotsai.pokemonchooseyou";

/// 数据库文件名（应用数据目录内）
pub const DB_FILE: &str = "pokemon-choose-you.db";

/// 1.0.0 初始化基线：完整当前 schema，单条迁移。
/// 历史增量（标签/收音机、分类停用、任务状态机、飞书元数据、AI 建议与反馈、
/// agent_sessions、suggested_note、内置分类换阵）已并入本基线；应用未正式发布过，
/// 不存在需前滚的存量用户库，本地调试库手动对齐（ALTER 补列 + PRAGMA user_version=1）。
const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    note TEXT,
    category_id INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'inbox',
    priority TEXT NOT NULL DEFAULT 'normal',
    due_at TEXT,
    remind_at TEXT,
    reminded INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'local',
    external_id TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    focus_seconds INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_remind ON tasks(remind_at) WHERE remind_at IS NOT NULL AND reminded = 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_external ON tasks(external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    pokemon TEXT NOT NULL,
    sprite TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
    provider TEXT NOT NULL,
    cursor TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (provider)
);

CREATE TABLE IF NOT EXISTS tag_dimensions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    -- single（任务上至多 1 个该维度标签）/ multi
    cardinality TEXT NOT NULL DEFAULT 'multi',
    -- 该维度标签数上限（防碎片化；AI 新建标签前对照剩余名额）
    max_tags INTEGER NOT NULL DEFAULT 20,
    sort INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    -- 归属维度（tag_dimensions.id）；DEFAULT 4 = topic：存量行与未指明维度的 INSERT 归主题
    dimension_id INTEGER NOT NULL DEFAULT 4,
    -- manual / ai / nl / agent（谁建的，治理审计用）
    origin TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT '',
    UNIQUE (dimension_id, name)
);

CREATE TABLE IF NOT EXISTS task_tags (
    task_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (task_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_task_tags_task ON task_tags(task_id);
CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag_id);

CREATE TABLE IF NOT EXISTS task_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_task_notes_task ON task_notes(task_id);

CREATE TABLE IF NOT EXISTS task_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    -- create / update / start / pause / demote / delete / sync_pull / sync_push / sync_close / migrate
    action TEXT NOT NULL,
    field TEXT NOT NULL DEFAULT '',
    old_value TEXT,
    new_value TEXT,
    origin TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_logs_task ON task_logs(task_id);

CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL UNIQUE,
    chat_name TEXT NOT NULL DEFAULT '',
    sender TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    suggested_title TEXT,
    suggested_category TEXT,
    suggested_due TEXT,
    suggested_priority TEXT,
    suggested_note TEXT,
    suggested_tags TEXT NOT NULL DEFAULT '[]',
    ai_status TEXT NOT NULL DEFAULT 'pending',
    review_status TEXT NOT NULL DEFAULT 'pending',
    task_id INTEGER,
    created_at TEXT NOT NULL DEFAULT '',
    chat_id TEXT NOT NULL DEFAULT '',
    chat_type TEXT NOT NULL DEFAULT '',
    sender_id TEXT NOT NULL DEFAULT '',
    sent_at INTEGER,
    is_self INTEGER NOT NULL DEFAULT 0,
    update_task_id INTEGER,
    followup_task_id INTEGER,
    suggested_reason TEXT,
    suggested_confidence TEXT,
    ai_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id, sent_at);

CREATE TABLE IF NOT EXISTS feishu_users (
    open_id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS chat_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_message_id INTEGER NOT NULL,
    message_id TEXT NOT NULL DEFAULT '',
    ai_action TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    reason_code TEXT NOT NULL DEFAULT '',
    agent_id TEXT NOT NULL DEFAULT '',
    agent_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_chat_feedback_message ON chat_feedback(chat_message_id);

CREATE TABLE IF NOT EXISTS agent_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    agent_id TEXT NOT NULL DEFAULT '',
    agent_name TEXT NOT NULL DEFAULT '',
    session_id TEXT,
    command TEXT,
    exit_code INTEGER,
    status TEXT NOT NULL DEFAULT 'ok',
    duration_ms INTEGER,
    cost_usd REAL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    created_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_task ON agent_sessions(task_id);
"#;

/// 迁移按序号执行：MIGRATIONS[i] 负责把 `PRAGMA user_version` 从 i 升到 i+1。
/// 应用未正式发布：始终只维护这一个版本，schema/种子变更直接改 SCHEMA_V1 基线，
/// 不新增迁移项；正式发布后再有变更，改为追加新条目（且只追加，不修改已发布条目）。
const MIGRATIONS: &[&str] = &[SCHEMA_V1];

/// 当前程序期望的 schema 版本（pk doctor 用它对比库的 user_version 判断「库比程序新/旧」；
/// pk 自身不执行迁移——迁移只由应用启动时做，避免抢跑后让旧应用拒绝启动）
pub fn expected_schema_version() -> i64 {
    MIGRATIONS.len() as i64
}

#[derive(Debug, thiserror::Error)]
pub enum MigrateError {
    #[error("数据库版本 {0} 比当前程序支持的更新，请升级应用后再打开")]
    FutureVersion(i64),
    #[error(transparent)]
    Db(#[from] rusqlite::Error),
}

/// 执行未应用的迁移并推进 user_version；已最新的库是 no-op
pub fn migrate(conn: &Connection) -> Result<(), MigrateError> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if current > MIGRATIONS.len() as i64 {
        return Err(MigrateError::FutureVersion(current));
    }
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let version = i as i64 + 1;
        // 同一事务内执行迁移并写版本号：中途崩溃不会留下"改了表但没记版本"的中间态
        conn.execute_batch(&format!(
            "BEGIN;\n{sql}\nPRAGMA user_version = {version};\nCOMMIT;"
        ))?;
        log::info!("db migrated to v{version}");
    }
    Ok(())
}

const DEFAULT_CATEGORIES: &[(&str, &str, &str)] = &[
    ("工作", "皮卡丘", "pikachu"),
    ("学习", "可达鸭", "psyduck"),
    ("生活", "妙蛙种子", "bulbasaur"),
    ("健康", "吉利蛋", "chansey"),
    ("兴趣", "伊布", "eevee"),
];

/// 内置标签维度（固定 id 1~4）：项目单选，其余多选；
/// topic 收纳无明确归属的标签（tags.dimension_id 的 DEFAULT 4 也指向它）
const DEFAULT_TAG_DIMENSIONS: &[(&str, &str, &str, i64)] = &[
    ("project", "项目", "single", 20),
    ("context", "场景", "multi", 10),
    ("person", "人物", "multi", 30),
    ("topic", "主题", "multi", 30),
];

pub fn init(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let conn = Connection::open(dir.join(DB_FILE))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
    init_conn(&conn)?;
    // 存量秘钥迁 OS 钥匙串（不可用则留在 settings 表，读取端回落兜底）
    let moved = crate::secrets::migrate_settings_secrets(&conn);
    if moved > 0 {
        log::info!("db: {moved} 条秘钥已迁入 OS 钥匙串");
    }
    // 已下线集成（builtin 飞书引擎 / Todoist 同步）的遗留配置与凭证清掉
    crate::secrets::purge_retired_keys(&conn);
    app.manage(Db(Mutex::new(conn)));
    Ok(())
}

/// 迁移 + 写入默认分类（幂等），init 与单元测试共用。
/// 种子按「id 或名字已存在都跳过」判定：改过名的默认分类保留不改，
/// 迁移已补过的分类（id 不在默认位）也不会重复插入。
pub fn init_conn(conn: &Connection) -> Result<(), MigrateError> {
    migrate(conn)?;
    for (i, (name, pokemon, sprite)) in DEFAULT_CATEGORIES.iter().enumerate() {
        conn.execute(
            "INSERT INTO categories (id, name, pokemon, sprite)
             SELECT ?1, ?2, ?3, ?4
             WHERE NOT EXISTS (SELECT 1 FROM categories WHERE id=?1 OR name=?2)",
            rusqlite::params![i as i64 + 1, name, pokemon, sprite],
        )?;
    }
    // 维度种子同策略：id 或 key 已存在都跳过，改名不影响
    for (i, (key, name, cardinality, max_tags)) in DEFAULT_TAG_DIMENSIONS.iter().enumerate() {
        conn.execute(
            "INSERT INTO tag_dimensions (id, key, name, cardinality, max_tags, sort)
             SELECT ?1, ?2, ?3, ?4, ?5, ?1
             WHERE NOT EXISTS (SELECT 1 FROM tag_dimensions WHERE id=?1 OR key=?2)",
            rusqlite::params![i as i64 + 1, key, name, cardinality, max_tags],
        )?;
    }
    Ok(())
}

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// 读取一条设置（找不到 key 时返回 None）
pub fn setting<R: tauri::Runtime>(app: &tauri::AppHandle<R>, key: &str) -> Option<String> {
    let db = app.try_state::<Db>()?;
    let conn = db.0.lock().ok()?;
    conn.query_row("SELECT value FROM settings WHERE key=?1", [key], |r| {
        r.get::<_, String>(0)
    })
    .ok()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// 内存库 + 迁移 + 默认分类（各模块测试的公共起点）
    pub(crate) fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        init_conn(&conn).expect("init schema");
        conn
    }

    fn user_version(conn: &Connection) -> i64 {
        conn.query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn fresh_db_migrates_to_latest_and_seeds_idempotently() {
        let conn = test_conn();
        assert_eq!(
            user_version(&conn),
            MIGRATIONS.len() as i64,
            "新库直接迁到最新"
        );
        // 重复执行不报错、不产生重复分类
        init_conn(&conn).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, DEFAULT_CATEGORIES.len() as i64);
    }

    /// v1 基线即当前阵容：新库默认分类不含社交/紧急、含兴趣（伊布）
    #[test]
    fn baseline_seeds_current_category_lineup() {
        let conn = test_conn();
        let names: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT name FROM categories ORDER BY id")
                .unwrap();
            stmt.query_map([], |r| r.get::<_, String>(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(names, vec!["工作", "学习", "生活", "健康", "兴趣"]);
    }

    /// 维度种子：固定 id 1~4、项目单选；重复 init 不重复插入；
    /// tags.dimension_id 的 DEFAULT 4 指向 topic
    #[test]
    fn baseline_seeds_tag_dimensions_with_fixed_ids() {
        let conn = test_conn();
        let rows: Vec<(i64, String, String, String)> = {
            let mut stmt = conn
                .prepare("SELECT id, key, name, cardinality FROM tag_dimensions ORDER BY id")
                .unwrap();
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(
            rows,
            vec![
                (1, "project".into(), "项目".into(), "single".into()),
                (2, "context".into(), "场景".into(), "multi".into()),
                (3, "person".into(), "人物".into(), "multi".into()),
                (4, "topic".into(), "主题".into(), "multi".into()),
            ]
        );
        // 幂等
        init_conn(&conn).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM tag_dimensions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 4);
        // 未指明维度的标签 INSERT 归 topic（存量/测试路径兜底）
        conn.execute(
            "INSERT INTO tags (name, description, created_at) VALUES ('老标签', '', 'x')",
            [],
        )
        .unwrap();
        let dim: String = conn
            .query_row(
                "SELECT d.key FROM tags t JOIN tag_dimensions d ON d.id = t.dimension_id WHERE t.name='老标签'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(dim, "topic");
    }

    /// 维度内名唯一：同名可存在于不同维度，同维度重名被拒
    #[test]
    fn tag_names_unique_within_dimension_only() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO tags (name, dimension_id, created_at) VALUES ('张三', 3, 'x')",
            [],
        )
        .unwrap();
        // 人物维度重名 → 唯一约束拒绝
        let dup = conn.execute(
            "INSERT INTO tags (name, dimension_id, created_at) VALUES ('张三', 3, 'x')",
            [],
        );
        assert!(dup.is_err(), "维度内唯一");
        // 项目维度同名 → 允许
        conn.execute(
            "INSERT INTO tags (name, dimension_id, created_at) VALUES ('张三', 1, 'x')",
            [],
        )
        .unwrap();
    }

    #[test]
    fn default_categories_seeded_with_fixed_ids() {
        let conn = test_conn();
        let mut stmt = conn
            .prepare("SELECT id, name, pokemon, sprite FROM categories ORDER BY id")
            .unwrap();
        let rows: Vec<(i64, String, String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        // 新任务 category_id 默认 1，第一个分类必须固定在 id=1
        assert_eq!(
            rows[0],
            (1, "工作".into(), "皮卡丘".into(), "pikachu".into())
        );
        assert_eq!(rows.len(), 5);
        assert_eq!(rows[4].1, "兴趣");
    }

    /// 回归：迁移机制引入前的老库（表已存在但 user_version=0）升级不丢数据
    #[test]
    fn migrates_legacy_unversioned_db_preserving_data() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA_V1).unwrap(); // 老路径建表，未写 user_version
        conn.execute(
            "INSERT INTO tasks (title, status, created_at) VALUES ('老任务', 'inbox', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('language', 'en')",
            [],
        )
        .unwrap();
        assert_eq!(user_version(&conn), 0);

        init_conn(&conn).unwrap();
        assert_eq!(user_version(&conn), MIGRATIONS.len() as i64);
        let (title, lang): (String, String) = conn
            .query_row(
                "SELECT (SELECT title FROM tasks LIMIT 1), (SELECT value FROM settings WHERE key='language')",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(title, "老任务");
        assert_eq!(lang, "en");
    }

    /// 基线自带 suggested_note 列（曾因只进建表语句漏迁移，导致老库收音机查询报缺列）
    #[test]
    fn baseline_creates_chat_messages_with_suggested_note() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO chat_messages (message_id, content, suggested_note, created_at)
             VALUES ('om_n', '提醒我买虾', '家里还有半只', '2026-09-13T00:00:00Z')",
            [],
        )
        .unwrap();
        let note: Option<String> = conn
            .query_row(
                "SELECT suggested_note FROM chat_messages WHERE message_id='om_n'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(note.as_deref(), Some("家里还有半只"));
    }

    #[test]
    fn rejects_db_from_newer_app_version() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(&format!("PRAGMA user_version = {};", MIGRATIONS.len() + 1))
            .unwrap();
        let err = init_conn(&conn).unwrap_err();
        assert!(
            err.to_string().contains("升级应用"),
            "提示升级而不是破坏数据: {err}"
        );
    }

    #[test]
    fn settings_roundtrip() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('language', 'en')",
            [],
        )
        .unwrap();
        let v: String = conn
            .query_row("SELECT value FROM settings WHERE key='language'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(v, "en");
    }
}
