use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;
use tauri::Manager;

pub struct Db(pub Mutex<Connection>);

/// 数据库文件名（应用数据目录内）；项目改名前为 pokemon-knock.db，由 migrate_legacy 搬运
pub const DB_FILE: &str = "pokemon-choose-you.db";
/// 项目改名前的 identifier / 库文件名：一次性迁移的识别依据
const LEGACY_IDENTIFIER: &str = "com.joeca.pokemonknock";
const LEGACY_DB_FILE: &str = "pokemon-knock.db";

/// 1.0.0 初始化基线：完整当前 schema，单条迁移。
/// 历史增量（标签/收音机、分类停用、任务状态机、飞书元数据、AI 建议与反馈、
/// agent_sessions、suggested_note）已并入本基线；应用未正式发布过，不存在需前滚的
/// 存量用户库，本地调试库手动对齐（ALTER 补列 + PRAGMA user_version=1）。
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

/// v2：内置分类调整——「社交」「紧急」退出默认阵容，「兴趣」（伊布）加入。
/// 只按名字动默认分类（用户改过名的分类不碰）；其下任务迁去第一个非目标的启用分类。
/// 新库（categories 为空）不在此插入，由 init_conn 的默认种子负责。
const MIGRATION_V2: &str = r#"
UPDATE tasks SET category_id = COALESCE(
    (SELECT id FROM categories WHERE enabled=1 AND name NOT IN ('社交','紧急') ORDER BY id LIMIT 1),
    (SELECT MIN(id) FROM categories WHERE name NOT IN ('社交','紧急')),
    1)
  WHERE category_id IN (SELECT id FROM categories WHERE name IN ('社交','紧急'));
DELETE FROM categories WHERE name IN ('社交','紧急');
INSERT INTO categories (name, pokemon, sprite)
  SELECT '兴趣', '伊布', 'eevee'
  WHERE EXISTS(SELECT 1 FROM categories)
    AND NOT EXISTS(SELECT 1 FROM categories WHERE name='兴趣');
"#;

/// 迁移按序号执行：MIGRATIONS[i] 负责把 `PRAGMA user_version` 从 i 升到 i+1。
/// 发布后再有 schema/种子变更，追加新条目（且只追加，不修改已发布条目）。
const MIGRATIONS: &[&str] = &[SCHEMA_V1, MIGRATION_V2];

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

pub fn init(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    migrate_legacy_dir(&dir);
    std::fs::create_dir_all(&dir)?;
    let conn = Connection::open(dir.join(DB_FILE))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
    init_conn(&conn)?;
    // 存量秘钥迁 OS 钥匙串（不可用则留在 settings 表，读取端回落兜底）
    let moved = crate::secrets::migrate_settings_secrets(&conn);
    if moved > 0 {
        log::info!("db: {moved} 条秘钥已迁入 OS 钥匙串");
    }
    // 钥匙串服务名随项目改名：旧服务下的秘钥搬至新服务（读旧不删旧）
    crate::secrets::migrate_legacy_service();
    app.manage(Db(Mutex::new(conn)));
    Ok(())
}

/// 一次性迁移：改名前的数据目录整目录搬至新 identifier 目录，库文件随之换新名。
/// 新目录已存在（含全新安装）或旧目录不存在时为 no-op；任何失败只告警不阻塞启动
/// （旧数据原样留在旧目录，可手动改名）。返回是否实际搬运。
fn migrate_legacy_dir(new_dir: &Path) -> bool {
    let Some(parent) = new_dir.parent() else {
        return false;
    };
    let old_dir = parent.join(LEGACY_IDENTIFIER);
    if new_dir.exists() || !old_dir.is_dir() {
        return false;
    }
    match std::fs::rename(&old_dir, new_dir) {
        Ok(()) => {
            let old_db = new_dir.join(LEGACY_DB_FILE);
            let new_db = new_dir.join(DB_FILE);
            if old_db.exists() && !new_db.exists() {
                if let Err(e) = std::fs::rename(&old_db, &new_db) {
                    log::warn!(
                        "db: 库文件改名失败（{e}）：{} 手动改名为 {} 即可",
                        old_db.display(),
                        new_db.display()
                    );
                }
            }
            log::info!(
                "db: 已迁移旧数据目录 {} → {}",
                old_dir.display(),
                new_dir.display()
            );
            true
        }
        Err(e) => {
            log::warn!(
                "db: 旧数据目录迁移失败（{e}）：旧数据保留在 {}，可手动改名为 {}",
                old_dir.display(),
                new_dir.display()
            );
            false
        }
    }
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

    /// v1 → v2：内置分类换阵——社交/紧急 的任务迁去第一个启用分类后被删，兴趣补位；
    /// 用户改过名的旧分类不受影响
    #[test]
    fn v2_migration_swaps_default_categories() {
        // 手工搭一个 v1 老库：六只默认分类（含社交/紧急）+ 用户改过名的「娱乐」+ 挂在社交下的任务
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA_V1).unwrap();
        conn.execute_batch("PRAGMA user_version = 1;").unwrap();
        let old: &[&str] = &["工作", "学习", "生活", "健康", "社交", "紧急"];
        for (i, name) in old.iter().enumerate() {
            conn.execute(
                "INSERT INTO categories (id, name, pokemon, sprite) VALUES (?1, ?2, 'x', 'x')",
                rusqlite::params![i as i64 + 1, name],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO categories (name, pokemon, sprite) VALUES ('娱乐', 'x', 'x')",
            [],
        )
        .unwrap(); // id 7：用户自建
        conn.execute(
            "INSERT INTO tasks (title, category_id, status, created_at) VALUES ('社交任务', 5, 'inbox', '2026-09-01T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tasks (title, category_id, status, created_at) VALUES ('紧急任务', 6, 'inbox', '2026-09-01T00:00:00Z')",
            [],
        )
        .unwrap();

        init_conn(&conn).unwrap(); // migrate v2 + 默认种子

        let names: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT name FROM categories ORDER BY id")
                .unwrap();
            stmt.query_map([], |r| r.get::<_, String>(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(names, vec!["工作", "学习", "生活", "健康", "娱乐", "兴趣"]);
        let (pokemon, sprite): (String, String) = conn
            .query_row(
                "SELECT pokemon, sprite FROM categories WHERE name='兴趣'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((pokemon.as_str(), sprite.as_str()), ("伊布", "eevee"));
        let task_cats: Vec<i64> = {
            let mut stmt = conn
                .prepare("SELECT category_id FROM tasks ORDER BY id")
                .unwrap();
            stmt.query_map([], |r| r.get::<_, i64>(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(
            task_cats,
            vec![1, 1],
            "社交/紧急 下的任务迁去第一个启用分类（工作）"
        );
        // 种子不会重复插兴趣（名字已存在）也不会动改过名的行
        let dup: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM categories WHERE name='兴趣'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(dup, 1);
    }

    /// v2 迁移幂等：已迁过的库重复执行不重复插兴趣、不动数据
    #[test]
    fn v2_migration_is_idempotent() {
        let conn = test_conn();
        let before: i64 = conn
            .query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0))
            .unwrap();
        migrate(&conn).unwrap(); // 已是最新版本，no-op
        init_conn(&conn).unwrap();
        let after: i64 = conn
            .query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0))
            .unwrap();
        assert_eq!(before, after);
    }

    /// 临时目录里预置旧 identifier 目录与旧库文件，验证整目录 + 库文件一次性搬运
    #[test]
    fn migrate_legacy_dir_moves_old_dir_and_db_file() {
        let parent = std::env::temp_dir().join(format!("pk-migrate-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&parent);
        std::fs::create_dir_all(parent.join(LEGACY_IDENTIFIER).join("backups")).unwrap();
        std::fs::write(parent.join(LEGACY_IDENTIFIER).join(LEGACY_DB_FILE), "db").unwrap();
        std::fs::write(
            parent
                .join(LEGACY_IDENTIFIER)
                .join("backups")
                .join("pokemon-knock-20260913.db"),
            "backup",
        )
        .unwrap();

        let new_dir = parent.join("pokemonchooseyou");
        assert!(migrate_legacy_dir(&new_dir));
        assert!(!parent.join(LEGACY_IDENTIFIER).exists(), "旧目录整体搬走");
        assert!(new_dir.join(DB_FILE).exists(), "库文件换成新名");
        assert!(
            new_dir.join("backups").exists(),
            "其余内容（备份等）随目录保留"
        );

        // 新目录已存在或旧目录不存在时为 no-op，且不误删任何东西
        std::fs::create_dir_all(parent.join(LEGACY_IDENTIFIER)).unwrap();
        std::fs::write(parent.join(LEGACY_IDENTIFIER).join(LEGACY_DB_FILE), "again").unwrap();
        assert!(!migrate_legacy_dir(&new_dir));
        assert!(
            parent.join(LEGACY_IDENTIFIER).exists(),
            "新目录在场时不碰旧目录"
        );
        assert!(new_dir.join(DB_FILE).exists());
        let _ = std::fs::remove_dir_all(&parent);
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
