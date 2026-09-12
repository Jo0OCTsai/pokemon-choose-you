use rusqlite::Connection;
use std::sync::Mutex;
use tauri::Manager;

pub struct Db(pub Mutex<Connection>);

const SCHEMA: &str = r#"
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
    focus_seconds INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_remind ON tasks(remind_at) WHERE remind_at IS NOT NULL AND reminded = 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_external ON tasks(external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    pokemon TEXT NOT NULL,
    sprite TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS im_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL UNIQUE,
    chat_name TEXT NOT NULL DEFAULT '',
    sender TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    suggested_title TEXT,
    suggested_category TEXT,
    suggested_due TEXT,
    review_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
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
"#;

const DEFAULT_CATEGORIES: &[(&str, &str, &str)] = &[
    ("工作", "皮卡丘", "pikachu"),
    ("学习", "可达鸭", "psyduck"),
    ("生活", "妙蛙种子", "bulbasaur"),
    ("健康", "吉利蛋", "chansey"),
    ("社交", "伊布", "eevee"),
    ("紧急", "卡比兽", "snorlax"),
];

pub fn init(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let conn = Connection::open(dir.join("pokemon-knock.db"))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
    init_conn(&conn)?;
    app.manage(Db(Mutex::new(conn)));
    Ok(())
}

/// 建表 + 写入默认分类（幂等），init 与单元测试共用
pub fn init_conn(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(SCHEMA)?;
    for (i, (name, pokemon, sprite)) in DEFAULT_CATEGORIES.iter().enumerate() {
        conn.execute(
            "INSERT OR IGNORE INTO categories (id, name, pokemon, sprite) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![i as i64 + 1, name, pokemon, sprite],
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

    /// 内存库 + 建表 + 默认分类（各模块测试的公共起点）
    pub(crate) fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        init_conn(&conn).expect("init schema");
        conn
    }

    #[test]
    fn init_conn_creates_schema_idempotently() {
        let conn = test_conn();
        // 重复执行不报错、不产生重复分类
        init_conn(&conn).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, DEFAULT_CATEGORIES.len() as i64);
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
        assert_eq!(rows[0], (1, "工作".into(), "皮卡丘".into(), "pikachu".into()));
        assert_eq!(rows.len(), 6);
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
            .query_row("SELECT value FROM settings WHERE key='language'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, "en");
    }
}
