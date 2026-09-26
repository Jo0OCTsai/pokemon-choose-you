use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

pub struct Db(pub Mutex<Connection>);

/// 应用标识（tauri.conf.json 的 identifier）：旧版（1.0.x）数据目录名，
/// 现仅作归一化布局迁移的来源标识，改动须与 tauri.conf.json 同步
pub const APP_IDENTIFIER: &str = "com.jotsai.pokemonchooseyou";

/// 数据库文件名（应用数据目录内）
pub const DB_FILE: &str = "pokemon-choose-you.db";

/// 归一化根目录（db / 日志 / agent workspace 共用）的环境变量覆盖键：
/// GUI 与 pk CLI 同一规则，整体重定位用（测试 / 便携部署）
pub const HOME_ENV: &str = "CHOOSE_YOU_HOME";

/// 归一化根目录名（用户主目录下）：纯容器，agent 工作区与应用数据各占子目录互不混放
pub const DEFAULT_HOME_DIR: &str = ".choose-you";

/// agent 工作区子目录（缺省 workdir）：data/、logs/ 这类通用名不落在 agent 可写
/// 范围内，agent 自建同名目录也不会踩到机器状态
pub const WORKSPACE_SUBDIR: &str = "workspace";

/// 应用数据子目录（db、backups、exports、remote-pk 密钥）
pub const DATA_SUBDIR: &str = "data";

/// 应用与 pk 共享日志的子目录
pub const LOG_SUBDIR: &str = "logs";

/// 日志文件名主干：插件 Folder 目标与 pk 轨迹（PK_LOG_FILE）落盘同一文件。
pub const LOG_FILE_STEM: &str = "pokemon-choose-you";

/// 旧 app_data_dir 布局中随库一起迁移的子目录
const MIGRATE_SUBDIRS: &[&str] = &["backups", "exports"];

/// 远程 pk 通道密钥对（丢了要重新一键配置，随库迁移）
const REMOTE_PK_KEY_FILES: &[&str] = &["remote_pk_shim_ed25519", "remote_pk_shim_ed25519.pub"];

/// 归一化根目录解析（纯函数便于测试）：CHOOSE_YOU_HOME 显式指定优先，缺省 <主目录>/.choose-you
fn app_home_from(env: Option<&std::ffi::OsStr>, home: Option<&Path>) -> Option<PathBuf> {
    if let Some(v) = env.filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(v));
    }
    home.map(|h| h.join(DEFAULT_HOME_DIR))
}

/// 应用归一化根目录：agent workspace 在 workspace/ 子目录，db 与日志在 data/、logs/。
/// GUI 与 pk CLI 共用同一解析，保证两端看到同一个库与日志
pub fn app_home() -> Option<PathBuf> {
    app_home_from(
        std::env::var_os(HOME_ENV).as_deref(),
        dirs::home_dir().as_deref(),
    )
}

/// 应用数据目录（db、backups、exports、remote-pk 密钥）：<app_home>/data
pub fn data_dir() -> Option<PathBuf> {
    app_home().map(|h| h.join(DATA_SUBDIR))
}

/// 应用与 pk 共享日志目录：<app_home>/logs
pub fn log_dir() -> Option<PathBuf> {
    app_home().map(|h| h.join(LOG_SUBDIR))
}

/// 目录内最新修改的 .log 文件（诊断页读取与旧日志迁移共用）
pub(crate) fn newest_log_file(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|f| f.path().extension().is_some_and(|e| e == "log"))
        .max_by_key(|f| f.metadata().ok().and_then(|m| m.modified().ok()))
        .map(|f| f.path())
}

/// 目标已存在（或源不是文件）则跳过的复制，返回复制文件数。
/// 幂等迁移的基元：旧目录保留不清删，重复调用不翻新已迁移内容
fn copy_if_absent(src: &Path, dest: &Path) -> usize {
    if dest.exists() || !src.is_file() {
        return 0;
    }
    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    usize::from(std::fs::copy(src, dest).is_ok())
}

/// 旧布局（tauri app_data_dir / app_log_dir 分散存放）一次性迁入归一化根：
/// db 主文件与 WAL 伴生、backups/、exports/、remote-pk 密钥对、最新一份日志。
/// 目标已存在的条目一律跳过（幂等：重复启动、迁移后旧目录残留都不翻新），
/// 旧文件保留不清删——回滚旧版本仍可用，确认无误后由用户手动清理
pub(crate) fn migrate_legacy_files(
    legacy_data: &Path,
    legacy_logs: Option<&Path>,
    new_data: &Path,
    new_logs: &Path,
) -> usize {
    let mut moved = 0usize;
    for suffix in ["", "-wal", "-shm"] {
        let name = format!("{DB_FILE}{suffix}");
        moved += copy_if_absent(&legacy_data.join(&name), &new_data.join(&name));
    }
    for sub in MIGRATE_SUBDIRS {
        let Ok(entries) = std::fs::read_dir(legacy_data.join(sub)) else {
            continue;
        };
        for e in entries.flatten() {
            let dest = new_data.join(sub).join(e.file_name());
            moved += copy_if_absent(&e.path(), &dest);
        }
    }
    for key in REMOTE_PK_KEY_FILES {
        moved += copy_if_absent(&legacy_data.join(key), &new_data.join(key));
    }
    // 日志：新目录还没有任何 .log 时搬最新一份旧日志，保住诊断页的历史轨迹；
    // 插件已开写新日志（启动行）则不覆盖
    let has_log = std::fs::read_dir(new_logs)
        .map(|rd| {
            rd.flatten()
                .any(|f| f.path().extension().is_some_and(|e| e == "log"))
        })
        .unwrap_or(false);
    if !has_log {
        if let Some(newest) = legacy_logs.and_then(newest_log_file) {
            let dest = new_logs.join(format!("{LOG_FILE_STEM}.log"));
            moved += copy_if_absent(&newest, &dest);
        }
    }
    moved
}

/// init 时调用：旧布局存在则迁入归一化根，失败只记日志不阻断启动
fn migrate_legacy_layout(app: &tauri::AppHandle, new_data: &Path, new_logs: &Path) {
    let Ok(legacy_data) = app.path().app_data_dir() else {
        return;
    };
    // 新库已在（此前启动迁过 / 全新安装）无事可做；旧库不在则无源可迁
    if new_data.join(DB_FILE).exists() || !legacy_data.join(DB_FILE).exists() {
        return;
    }
    let legacy_logs = app.path().app_log_dir().ok();
    let moved = migrate_legacy_files(&legacy_data, legacy_logs.as_deref(), new_data, new_logs);
    if moved > 0 {
        log::info!(
            "db: 旧布局 {} → {} 已迁移 {moved} 个文件（旧目录保留未删，确认无误后可手动清理）",
            legacy_data.display(),
            new_data.display()
        );
    }
}

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
    cancelled_at TEXT,
    -- 派发状态机（AGENT_DISPATCH_PROPOSAL §8）：NULL=从未派发 / queued / running / done / failed
    dispatch_state TEXT,
    -- 最近一次派发的 agent 会话 id（claude --session-id/--resume 续接用）
    dispatched_session TEXT
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
    -- 派发路由元数据（JSON，仅 project 维度标签使用）：{workdir, agentId, context}，
    -- 见 docs/proposals/AGENT_DISPATCH_PROPOSAL.md §4.1
    meta TEXT,
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
    ai_agent TEXT NOT NULL DEFAULT '',
    dismiss_reason TEXT NOT NULL DEFAULT '',
    content_anon TEXT NOT NULL DEFAULT '',
    at_me TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id, sent_at);

CREATE TABLE IF NOT EXISTS feishu_users (
    open_id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT '',
    alias TEXT NOT NULL DEFAULT ''
);
-- 代号唯一（空串豁免）：懒分配的防碰撞锚点，见 anonymize 模块
CREATE UNIQUE INDEX IF NOT EXISTS idx_feishu_users_alias
    ON feishu_users(alias) WHERE alias != '';

-- 群聊代号（anonymize 模块）：AI prompt 的来源标签用 群_xxxx 代号，真群名只存本地，
-- pk 落库前经 anonymize::restore 还原展示；feishu_chats 是每轮整表替换的快照，存不得
CREATE TABLE IF NOT EXISTS feishu_chat_aliases (
    chat_id TEXT PRIMARY KEY,
    chat_name TEXT NOT NULL DEFAULT '',
    alias TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_feishu_chat_aliases_alias
    ON feishu_chat_aliases(alias) WHERE alias != '';

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
    -- 会话来源（'' = 早期记录 / 未标注）：classify 收音机分类 / capture 快速捕捉 /
    -- dispatch_headless 无头派发 / dispatch_interactive 交互派发 / pk agent 侧补录
    kind TEXT NOT NULL DEFAULT '',
    -- 执行时工作目录快照：本地 = 展开后的绝对路径；远程 = 远端路径串（'' = 登录目录）。
    -- 回放按此目录路由，不随 agent 配置后续变更漂移
    workdir TEXT NOT NULL DEFAULT '',
    -- 远程交互派发的 tmux 会话名（重连用）；无头 / 本地交互为空串
    tmux_session TEXT NOT NULL DEFAULT '',
    -- 执行时 agent 远端快照（remote_host 空 = 本地执行）：回放到当时的机器，不受配置变更影响
    remote_host TEXT NOT NULL DEFAULT '',
    remote_port INTEGER NOT NULL DEFAULT 0,
    remote_key TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_task ON agent_sessions(task_id);

-- 用户手动过滤偏好（飞书会话过滤）：always_filter / always_pull；「跟随」不落库（无行即跟随）
CREATE TABLE IF NOT EXISTS chat_filter_prefs (
    chat_id TEXT PRIMARY KEY,
    preference TEXT NOT NULL CHECK (preference IN ('always_filter','always_pull')),
    updated_at TEXT NOT NULL
);

-- 最近一轮拉取快照（管理界面唯一数据源，行随每轮整表替换生灭）；
-- 快照时间是轮级事实，不设行级列（唯一载体 = settings 键 feishu_snapshot_at，零会话轮无行可携带）
CREATE TABLE IF NOT EXISTS feishu_chats (
    chat_id TEXT PRIMARY KEY,
    chat_name TEXT NOT NULL DEFAULT '',
    chat_type TEXT NOT NULL DEFAULT '',
    -- muted / unmuted / unknown（unknown = 所在查询批次失败，降级不过滤）
    mute_outcome TEXT NOT NULL CHECK (mute_outcome IN ('muted','unmuted','unknown'))
);
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
    let dir = data_dir().ok_or("无法定位归一化根目录（HOME / CHOOSE_YOU_HOME）")?;
    std::fs::create_dir_all(&dir)?;
    if let Some(logs) = log_dir() {
        migrate_legacy_layout(app, &dir, &logs);
    }
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
    normalize_legacy_agent_presets(conn);
    Ok(())
}

/// 库内内部标记位（迁移完成标记等）：不参与导出/导入——导入进旧版本库会误压制
/// 尚未执行的迁移；新库初始化时自行判定并重写
pub(crate) fn is_internal_setting_key(key: &str) -> bool {
    key == "ai_agent_presets_v2"
}

/// 存量 agent 配置的一次性预设升级（幂等，完成即写标记位，用户改回旧值也不会再升级）：
/// - claude 旧默认参数补 `--output-format json`：无头调用的 stdout 变为 JSON 信封
///   （含 session_id / 成本），应用解信封后会话回链自动落库；result 内文照常解析
///
/// 只动「与旧默认值完全一致」的字段：用户改过参数的配置不碰。
fn normalize_legacy_agent_presets(conn: &Connection) {
    const MARKER_KEY: &str = "ai_agent_presets_v2";
    let marked = conn
        .query_row(
            "SELECT 1 FROM settings WHERE key=?1",
            rusqlite::params![MARKER_KEY],
            |_| Ok(()),
        )
        .is_ok();
    if marked {
        return;
    }
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key='ai_agents'",
            [],
            |r| r.get(0),
        )
        .ok();
    let Some(raw) = raw else {
        // 尚无 agent 配置也写标记位：之后新建的 agent 直接用新预设
        let _ = conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, '1')",
            rusqlite::params![MARKER_KEY],
        );
        return;
    };
    let Ok(mut agents) = serde_json::from_str::<Vec<crate::ai::AgentConfig>>(&raw) else {
        return; // 坏数据交给 load_agents 容错；不写标记位，下次启动重试
    };
    const OLD_CLAUDE_ARGS: &str = "-p {prompt} --allowedTools Bash(pk:*)";
    const NEW_CLAUDE_ARGS: &str = "-p {prompt} --allowedTools Bash(pk:*) --output-format json";
    let mut changed = false;
    for a in agents.iter_mut() {
        if a.command.contains("claude") && a.args == OLD_CLAUDE_ARGS {
            a.args = NEW_CLAUDE_ARGS.into();
            changed = true;
        }
    }
    if changed {
        if let Ok(encoded) = serde_json::to_string(&agents) {
            match conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_agents', ?1)",
                rusqlite::params![encoded],
            ) {
                Ok(_) => log::info!("db: 存量 agent 预设已升级（claude 会话信封）"),
                Err(e) => log::warn!("db: agent 预设升级写回失败（下次启动重试）: {e}"),
            }
        }
    }
    let _ = conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, '1')",
        rusqlite::params![MARKER_KEY],
    );
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

    /// 存量 agent 预设升级：旧默认参数补齐（claude 会话信封），用户改过参数的不碰，
    /// 标记位写入后不再重复升级
    #[test]
    fn legacy_agent_presets_upgraded_once_and_only_exact_defaults() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let legacy = r#"[
            {"id":"a1","name":"Claude Code","command":"claude","args":"-p {prompt} --allowedTools Bash(pk:*)","historyArgs":"--resume","timeoutSecs":120,"enabled":true},
            {"id":"a2","name":"自定义参数","command":"claude","args":"-p {prompt}","historyArgs":"--resume","timeoutSecs":120,"enabled":true}
        ]"#;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('ai_agents', ?1)",
            rusqlite::params![legacy],
        )
        .unwrap();

        init_conn(&conn).unwrap();
        let upgraded: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key='ai_agents'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            upgraded.contains("--output-format json"),
            "claude 补会话信封: {upgraded}"
        );
        assert!(
            upgraded.contains(r#""args":"-p {prompt}""#),
            "用户自定义参数不被改动: {upgraded}"
        );

        // 标记位已写：把值改回旧默认再 init 也不会再次升级
        conn.execute(
            "UPDATE settings SET value=?1 WHERE key='ai_agents'",
            rusqlite::params![legacy],
        )
        .unwrap();
        init_conn(&conn).unwrap();
        let again: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key='ai_agents'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            !again.contains("--output-format json"),
            "标记位后不再升级: {again}"
        );
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

    /// 基线自带 agent_sessions 的执行上下文列（kind/workdir/tmux/远端快照）：
    /// 回放按记录里的快照路由，不随 agent 配置漂移（正式库手动 ALTER 对齐，见迁移约定）
    #[test]
    fn baseline_creates_agent_sessions_with_context_columns() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO agent_sessions (agent_id, kind, workdir, tmux_session,
                                         remote_host, remote_port, remote_key, created_at)
             VALUES ('ag', 'classify', '/ws', '', 'vscode@localhost', 1022, '', '2026-09-26T00:00:00Z')",
            [],
        )
        .unwrap();
        let (kind, workdir, host, port): (String, String, String, i64) = conn
            .query_row(
                "SELECT kind, workdir, remote_host, remote_port FROM agent_sessions WHERE agent_id='ag'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!((kind.as_str(), workdir.as_str()), ("classify", "/ws"));
        assert_eq!((host.as_str(), port), ("vscode@localhost", 1022));
    }

    /// 基线自带会话过滤两张表（feishu-chat-filter）：偏好表 CHECK 只收
    /// always_filter/always_pull（follow=无行不落库），快照表 CHECK 只收
    /// muted/unmuted/unknown（unknown = 所在免打扰查询批次失败）
    #[test]
    fn baseline_creates_chat_filter_tables_with_checks() {
        let conn = test_conn();
        // 合法行可写入
        conn.execute(
            "INSERT INTO chat_filter_prefs (chat_id, preference, updated_at)
             VALUES ('oc_a', 'always_filter', '2026-09-23T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO feishu_chats (chat_id, chat_name, chat_type, mute_outcome)
             VALUES ('oc_a', '群', 'group', 'unknown')",
            [],
        )
        .unwrap();
        // 非法 preference（follow 是「无行」语义，不落库）被 CHECK 拒绝
        let bad_pref = conn.execute(
            "INSERT INTO chat_filter_prefs (chat_id, preference, updated_at)
             VALUES ('oc_b', 'follow', 'x')",
            [],
        );
        assert!(bad_pref.is_err(), "preference CHECK 拒绝 follow");
        // 非法 mute_outcome 被拒
        let bad_outcome = conn.execute(
            "INSERT INTO feishu_chats (chat_id, chat_name, chat_type, mute_outcome)
             VALUES ('oc_b', '群', 'group', 'maybe')",
            [],
        );
        assert!(bad_outcome.is_err(), "mute_outcome CHECK 封闭枚举");
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

    fn tmp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pk-db-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 归一化根：CHOOSE_YOU_HOME 覆盖优先，缺省 <主目录>/.choose-you，空串视同未设置
    #[test]
    fn app_home_resolves_env_override_then_default() {
        use std::ffi::OsStr;
        assert_eq!(
            app_home_from(None, Some(Path::new("/Users/demo"))),
            Some(PathBuf::from("/Users/demo/.choose-you"))
        );
        assert_eq!(
            app_home_from(Some(OsStr::new("")), Some(Path::new("/Users/demo"))),
            Some(PathBuf::from("/Users/demo/.choose-you"))
        );
        assert_eq!(
            app_home_from(Some(OsStr::new("/var/cy")), Some(Path::new("/Users/demo"))),
            Some(PathBuf::from("/var/cy"))
        );
        assert_eq!(app_home_from(None, None), None);
    }

    /// 旧布局一次性迁入归一化根：db(+WAL)/backups/exports/远程密钥/旧日志全落位，
    /// 目标已存在的一律跳过（幂等），旧文件保留不清删
    #[test]
    fn legacy_layout_migrates_idempotently() {
        let root = tmp_root("migrate");
        let legacy_data = root.join("legacy-data");
        let legacy_logs = root.join("legacy-logs");
        let new_data = root.join("new").join(DATA_SUBDIR);
        let new_logs = root.join("new").join(LOG_SUBDIR);
        for d in [
            legacy_data.join(MIGRATE_SUBDIRS[0]),
            legacy_data.join(MIGRATE_SUBDIRS[1]),
            legacy_logs.clone(),
            new_data.clone(),
            new_logs.clone(),
        ] {
            std::fs::create_dir_all(&d).unwrap();
        }
        std::fs::write(legacy_data.join(DB_FILE), "db-v1").unwrap();
        std::fs::write(legacy_data.join(format!("{DB_FILE}-wal")), "wal-v1").unwrap();
        std::fs::write(legacy_data.join(MIGRATE_SUBDIRS[0]).join("b1.db"), "bk").unwrap();
        std::fs::write(legacy_data.join(MIGRATE_SUBDIRS[1]).join("e.md"), "ex").unwrap();
        std::fs::write(legacy_data.join(REMOTE_PK_KEY_FILES[0]), "key").unwrap();
        std::fs::write(legacy_logs.join("app.log"), "old-log").unwrap();

        let moved = migrate_legacy_files(&legacy_data, Some(&legacy_logs), &new_data, &new_logs);
        assert_eq!(moved, 6, "db+wal+备份+导出+密钥+日志");
        assert_eq!(
            std::fs::read_to_string(new_data.join(DB_FILE)).unwrap(),
            "db-v1"
        );
        assert_eq!(
            std::fs::read_to_string(new_data.join(MIGRATE_SUBDIRS[0]).join("b1.db")).unwrap(),
            "bk"
        );
        assert_eq!(
            std::fs::read_to_string(new_data.join(REMOTE_PK_KEY_FILES[0])).unwrap(),
            "key"
        );
        assert_eq!(
            std::fs::read_to_string(new_logs.join(format!("{LOG_FILE_STEM}.log"))).unwrap(),
            "old-log",
            "旧日志迁入时改用规范文件名"
        );
        // 旧文件保留：回滚旧版本仍可用
        assert!(legacy_data.join(DB_FILE).exists());

        // 幂等：旧侧变化再跑，新侧已存在的不被翻新，只补缺失的
        std::fs::write(legacy_data.join(DB_FILE), "db-v2").unwrap();
        std::fs::write(legacy_data.join(MIGRATE_SUBDIRS[0]).join("b2.db"), "bk2").unwrap();
        let moved2 = migrate_legacy_files(&legacy_data, Some(&legacy_logs), &new_data, &new_logs);
        assert_eq!(moved2, 1, "只补新增的备份文件");
        assert_eq!(
            std::fs::read_to_string(new_data.join(DB_FILE)).unwrap(),
            "db-v1",
            "已迁移的库不被翻新"
        );

        // 新日志目录已有日志 → 旧日志不再搬（不覆盖轮转中的新日志）
        std::fs::write(new_logs.join("fresh.log"), "fresh").unwrap();
        std::fs::write(legacy_logs.join("app2.log"), "newer").unwrap();
        let moved3 = migrate_legacy_files(&legacy_data, Some(&legacy_logs), &new_data, &new_logs);
        assert_eq!(moved3, 0, "全量幂等：无新增可迁");
        assert_eq!(
            std::fs::read_to_string(new_logs.join(format!("{LOG_FILE_STEM}.log"))).unwrap(),
            "old-log"
        );
        assert!(!new_logs.join("app2.log").exists());
        std::fs::remove_dir_all(&root).ok();
    }

    /// 无旧日志目录 / 旧目录为空时迁移退化为纯 db 搬运，不报错
    #[test]
    fn legacy_migrate_tolerates_missing_logs_and_subdirs() {
        let root = tmp_root("migrate-partial");
        let legacy_data = root.join("legacy-data");
        std::fs::create_dir_all(&legacy_data).unwrap();
        std::fs::write(legacy_data.join(DB_FILE), "db-only").unwrap();
        let new_data = root.join("new").join(DATA_SUBDIR);
        let new_logs = root.join("new").join(LOG_SUBDIR);
        let moved = migrate_legacy_files(&legacy_data, None, &new_data, &new_logs);
        assert_eq!(moved, 1);
        assert_eq!(
            std::fs::read_to_string(new_data.join(DB_FILE)).unwrap(),
            "db-only"
        );
        std::fs::remove_dir_all(&root).ok();
    }
}
