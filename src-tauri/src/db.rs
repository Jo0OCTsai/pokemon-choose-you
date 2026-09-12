use rusqlite::Connection;
use std::sync::Mutex;
use tauri::Manager;

pub struct Db(pub Mutex<Connection>);

/// v1：初始 schema（建表 + 索引），全部幂等，兼容迁移机制引入前的老库
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

/// v2：标签 / 任务标签 / 跟进记录 / 收音机全量消息（chat_messages 取代 im_suggestions）/ AI 调用日志
const SCHEMA_V2: &str = r#"
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ''
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
    created_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);

CREATE TABLE IF NOT EXISTS ai_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scene TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    request_body TEXT NOT NULL DEFAULT '',
    response_body TEXT NOT NULL DEFAULT '',
    ok INTEGER NOT NULL DEFAULT 1,
    error TEXT,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ''
);

-- 旧 im_suggestions 数据并入 chat_messages：有建议标题的视为 AI 已判定待办
INSERT OR IGNORE INTO chat_messages
    (message_id, chat_name, sender, content, suggested_title, suggested_category, suggested_due,
     ai_status, review_status, created_at)
SELECT message_id, chat_name, sender, content, suggested_title, suggested_category, suggested_due,
       CASE WHEN suggested_title IS NULL THEN 'none' ELSE 'todo' END,
       review_status, created_at
FROM im_suggestions;
DROP TABLE IF EXISTS im_suggestions;
"#;

/// v3：分类支持停用（内置分类不可删，改为 enabled=0 隐藏出新建/编辑与 AI 选项）
const SCHEMA_V3: &str = r#"
ALTER TABLE categories ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
"#;

/// v4：任务状态机强化——started_at/cancelled_at 字段、task_logs 操作日志表、存量状态归位。
/// 归位规则：无截止时间且从未开始 → inbox；inbox 但有截止时间 → scheduled。
const SCHEMA_V4: &str = r#"
ALTER TABLE tasks ADD COLUMN started_at TEXT;
ALTER TABLE tasks ADD COLUMN cancelled_at TEXT;

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

-- active/paused 必然开始过；专注过又被顶下的任务以迁移时刻近似 started_at
UPDATE tasks SET started_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
 WHERE started_at IS NULL AND (status IN ('active','paused') OR focus_seconds > 0);

-- inbox + 有截止时间 → scheduled（先记日志再改，日志的 old/new 与更新条件一致）
INSERT INTO task_logs (task_id, action, field, old_value, new_value, origin, created_at)
SELECT id, 'migrate', 'status', 'inbox', 'scheduled', 'migration', strftime('%Y-%m-%dT%H:%M:%SZ','now')
FROM tasks WHERE status='inbox' AND due_at IS NOT NULL;
UPDATE tasks SET status='scheduled' WHERE status='inbox' AND due_at IS NOT NULL;

-- scheduled + 无截止时间 + 从未开始 → inbox
INSERT INTO task_logs (task_id, action, field, old_value, new_value, origin, created_at)
SELECT id, 'migrate', 'status', 'scheduled', 'inbox', 'migration', strftime('%Y-%m-%dT%H:%M:%SZ','now')
FROM tasks WHERE status='scheduled' AND due_at IS NULL AND started_at IS NULL;
UPDATE tasks SET status='inbox' WHERE status='scheduled' AND due_at IS NULL AND started_at IS NULL;
"#;

/// v5：飞书用户身份拉取——chat_messages 补会话/发送者元数据，新增飞书用户名缓存表。
/// chat_type 取值：p2p（单聊）/ group（群聊）/ bot（与本应用机器人的单聊）。
const SCHEMA_V5: &str = r#"
ALTER TABLE chat_messages ADD COLUMN chat_id TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_messages ADD COLUMN chat_type TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_messages ADD COLUMN sender_id TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_messages ADD COLUMN sent_at INTEGER;
ALTER TABLE chat_messages ADD COLUMN is_self INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id, sent_at);

CREATE TABLE IF NOT EXISTS feishu_users (
    open_id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
);
"#;

/// v6：AI 动作扩展——chat_messages 记录 update 建议指向的目标待办
const SCHEMA_V6: &str = r#"
ALTER TABLE chat_messages ADD COLUMN update_task_id INTEGER;
"#;

/// 迁移按序号执行：MIGRATIONS[i] 负责把 `PRAGMA user_version` 从 i 升到 i+1。
/// 新的 schema 变更一律追加新条目（且只追加，不修改已发布条目），老库逐级前滚。
const MIGRATIONS: &[&str] = &[
    SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6,
];

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

/// 迁移 + 写入默认分类（幂等），init 与单元测试共用
pub fn init_conn(conn: &Connection) -> Result<(), MigrateError> {
    migrate(conn)?;
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
        assert_eq!(rows.len(), 6);
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

    /// 回归：v1 老库（含 im_suggestions 数据）升级 v2 后，消息并入 chat_messages 且标签表可用
    #[test]
    fn migrates_v1_db_moving_im_suggestions_into_chat_messages() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA_V1).unwrap();
        conn.execute("PRAGMA user_version = 1", []).unwrap();
        conn.execute(
            "INSERT INTO im_suggestions (message_id, chat_name, sender, content, suggested_title, suggested_category, suggested_due, review_status, created_at)
             VALUES ('om_1', '群', '张三', '明天开周会', '参加周会', '工作', '2026-09-13T10:00', 'pending', '2026-09-01T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO im_suggestions (message_id, chat_name, sender, content, suggested_title, review_status, created_at)
             VALUES ('om_2', '群', '李四', '哈哈', NULL, 'dismissed', '2026-09-01T00:00:00Z')",
            [],
        )
        .unwrap();

        init_conn(&conn).unwrap();
        assert_eq!(user_version(&conn), MIGRATIONS.len() as i64);
        let todo: (String, String) = conn
            .query_row(
                "SELECT suggested_title, ai_status FROM chat_messages WHERE message_id='om_1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(todo, ("参加周会".into(), "todo".into()));
        let none: (i64, String) = conn
            .query_row(
                "SELECT COALESCE(task_id, 0), ai_status FROM chat_messages WHERE message_id='om_2'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(none, (0, "none".into()), "无建议标题的消息标记为 none");
        // 旧表已删除，标签/跟进/AI 日志表可用
        let tables: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='im_suggestions'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tables, 0, "im_suggestions 已被 chat_messages 取代");
        conn.execute(
            "INSERT INTO tags (name, description, created_at) VALUES ('重要', '核心目标', '2026-09-01T00:00:00Z')",
            [],
        )
        .unwrap();
    }

    /// 回归：v2 库升级 v3 后分类带上 enabled 标志且默认启用
    #[test]
    fn migrates_v2_db_adding_category_enabled_flag() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA_V1).unwrap();
        conn.execute_batch(SCHEMA_V2).unwrap();
        conn.execute("PRAGMA user_version = 2", []).unwrap();
        // 手工造一个 v2 时代的存量分类（改名过的 id=1）
        conn.execute(
            "INSERT INTO categories (id, name, pokemon, sprite) VALUES (1, '改名分类', '皮卡丘', 'pikachu')",
            [],
        )
        .unwrap();

        init_conn(&conn).unwrap();
        assert_eq!(user_version(&conn), MIGRATIONS.len() as i64);
        let (name, enabled): (String, i64) = conn
            .query_row("SELECT name, enabled FROM categories WHERE id=1", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(name, "改名分类", "升级不动既有数据");
        assert_eq!(enabled, 1, "存量分类默认启用");
    }

    /// 回归：v3 库升级 v4 后状态归位——inbox+due → scheduled、scheduled 无 due 未开始 → inbox、
    /// active/paused 补 started_at，且归位动作写入 task_logs
    #[test]
    fn migrates_v3_db_repositioning_task_statuses() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA_V1).unwrap();
        conn.execute_batch(SCHEMA_V2).unwrap();
        conn.execute_batch(SCHEMA_V3).unwrap();
        conn.execute("PRAGMA user_version = 3", []).unwrap();
        for (title, status, due) in [
            ("带时间的草丛", "inbox", Some("2026-09-10T09:00")),
            ("没时间的路线", "scheduled", None),
            ("正常路线", "scheduled", Some("2026-09-10T09:00")),
        ] {
            conn.execute(
                "INSERT INTO tasks (title, status, due_at, created_at) VALUES (?1, ?2, ?3, '2026-09-01T00:00:00Z')",
                rusqlite::params![title, status, due],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO tasks (title, status, created_at) VALUES ('进行中', 'active', '2026-09-01T00:00:00Z')",
            [],
        )
        .unwrap();

        init_conn(&conn).unwrap();
        assert_eq!(user_version(&conn), MIGRATIONS.len() as i64);
        let status_of = |title: &str| {
            conn.query_row("SELECT status FROM tasks WHERE title=?1", [title], |r| {
                r.get::<_, String>(0)
            })
            .unwrap()
        };
        assert_eq!(status_of("带时间的草丛"), "scheduled");
        assert_eq!(status_of("没时间的路线"), "inbox");
        assert_eq!(status_of("正常路线"), "scheduled", "有时间的路线不动");
        assert_eq!(status_of("进行中"), "active", "进行中不被归位");
        let active_started: Option<String> = conn
            .query_row(
                "SELECT started_at FROM tasks WHERE title='进行中'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(active_started.is_some(), "active 任务补 started_at");
        let migrated: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_logs WHERE action='migrate' AND origin='migration'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(migrated, 2, "两处归位写入日志");
    }

    /// 回归：v4 库升级 v5 后 chat_messages 带上会话元数据列（存量行取默认值），
    /// feishu_users 缓存表可用
    #[test]
    fn migrates_v4_db_adding_chat_metadata_columns() {
        let conn = Connection::open_in_memory().unwrap();
        for sql in [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4] {
            conn.execute_batch(sql).unwrap();
        }
        conn.execute("PRAGMA user_version = 4", []).unwrap();
        conn.execute(
            "INSERT INTO chat_messages (message_id, chat_name, sender, content, ai_status, review_status, created_at)
             VALUES ('om_old', '项目群', '张三', '老消息', 'todo', 'pending', '2026-09-01T00:00:00Z')",
            [],
        )
        .unwrap();

        init_conn(&conn).unwrap();
        assert_eq!(user_version(&conn), MIGRATIONS.len() as i64);
        let (chat_id, chat_type, sender_id, sent_at, is_self): (String, String, String, Option<i64>, i64) = conn
            .query_row(
                "SELECT chat_id, chat_type, sender_id, sent_at, is_self FROM chat_messages WHERE message_id='om_old'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .unwrap();
        assert_eq!(
            (chat_id.as_str(), chat_type.as_str(), sender_id.as_str()),
            ("", "", "")
        );
        assert!(sent_at.is_none());
        assert_eq!(is_self, 0, "存量行不带元数据但不丢消息");
        conn.execute(
            "INSERT INTO feishu_users (open_id, name, updated_at) VALUES ('ou_a', '张三', '2026-09-12T00:00:00Z')",
            [],
        )
        .unwrap();
    }

    /// 回归：v5 库升级 v6 后 chat_messages 支持 update 建议的目标待办列
    #[test]
    fn migrates_v5_db_adding_update_task_id() {
        let conn = Connection::open_in_memory().unwrap();
        for sql in [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5] {
            conn.execute_batch(sql).unwrap();
        }
        conn.execute("PRAGMA user_version = 5", []).unwrap();

        init_conn(&conn).unwrap();
        assert_eq!(user_version(&conn), MIGRATIONS.len() as i64);
        conn.execute(
            "INSERT INTO chat_messages (message_id, content, update_task_id) VALUES ('om_u', '改到周四', 5)",
            [],
        )
        .unwrap();
        let target: Option<i64> = conn
            .query_row(
                "SELECT update_task_id FROM chat_messages WHERE message_id='om_u'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(target, Some(5));
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
