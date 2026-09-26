//! Agent 会话回链与成本记录：分类调用自动落库，agent 代办经 pk session log 关联任务。
use crate::ai::{AgentConfig, AgentRemote};
use crate::db::{now, Db};
use crate::error::{AppError, AppResult};
use crate::models::AgentSession;
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

/// 一次会话记录的输入（命令与 pk CLI 共用）
pub struct NewAgentSession {
    pub task_id: Option<i64>,
    pub agent_id: String,
    /// 会话来源：classify / capture / dispatch_headless / dispatch_interactive / pk
    pub kind: String,
    pub session_id: Option<String>,
    pub command: Option<String>,
    pub exit_code: Option<i64>,
    pub status: String,
    pub duration_ms: Option<i64>,
    pub cost_usd: Option<f64>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    /// 执行时工作目录快照（回放路由用；'' = 早期记录或缺省）
    pub workdir: String,
    /// 远程交互派发的 tmux 会话名（'' = 无）
    pub tmux_session: String,
    /// 执行时远端快照（remote_host 空 = 本地执行）
    pub remote_host: String,
    pub remote_port: i64,
    pub remote_key: String,
}

impl NewAgentSession {
    /// 以执行时的 agent 配置为基底：agent_id + 来源 + 工作目录/远端快照就位，
    /// 其余字段（task/session/时长/成本…）由调用方按结果覆盖
    pub fn for_run(kind: &str, agent: &AgentConfig, workdir_snapshot: &str) -> Self {
        let (remote_host, remote_port, remote_key) = remote_snapshot(agent);
        Self {
            task_id: None,
            agent_id: agent.id.clone(),
            kind: kind.to_string(),
            session_id: None,
            command: None,
            exit_code: None,
            status: "ok".into(),
            duration_ms: None,
            cost_usd: None,
            input_tokens: None,
            output_tokens: None,
            workdir: workdir_snapshot.trim().to_string(),
            tmux_session: String::new(),
            remote_host,
            remote_port,
            remote_key,
        }
    }
}

/// agent 端点快照（执行时机器）：本地 = 空串三元组；远程 = host/port/key（key 空串 = ssh 默认）
pub fn remote_snapshot(agent: &AgentConfig) -> (String, i64, String) {
    match agent.remote.as_ref().filter(|r| !r.host.trim().is_empty()) {
        None => (String::new(), 0, String::new()),
        Some(r) => (
            r.host.trim().to_string(),
            r.port as i64,
            r.key_path
                .as_deref()
                .map(str::trim)
                .unwrap_or_default()
                .to_string(),
        ),
    }
}

/// 快照三元组还原成 AgentRemote（host 空 = None = 本地）
pub(crate) fn remote_from_snapshot(host: &str, port: i64, key: &str) -> Option<AgentRemote> {
    let host = host.trim();
    if host.is_empty() {
        return None;
    }
    Some(AgentRemote {
        host: host.to_string(),
        port: port.clamp(1, 65535) as u16,
        key_path: (!key.trim().is_empty()).then(|| key.trim().to_string()),
        ..AgentRemote::default()
    })
}

const SESSION_COLS: &str =
    "id, task_id, agent_id, agent_name, session_id, command, exit_code, status, \
                            duration_ms, cost_usd, input_tokens, output_tokens, kind, workdir, \
                            tmux_session, remote_host, remote_port, remote_key, created_at";

fn row_to_session(row: &rusqlite::Row) -> rusqlite::Result<AgentSession> {
    Ok(AgentSession {
        id: row.get(0)?,
        task_id: row.get(1)?,
        agent_id: row.get(2)?,
        agent_name: row.get(3)?,
        session_id: row.get(4)?,
        command: row.get(5)?,
        exit_code: row.get(6)?,
        status: row.get(7)?,
        duration_ms: row.get(8)?,
        cost_usd: row.get(9)?,
        input_tokens: row.get(10)?,
        output_tokens: row.get(11)?,
        kind: row.get(12)?,
        workdir: row.get(13)?,
        tmux_session: row.get(14)?,
        remote_host: row.get(15)?,
        remote_port: row.get(16)?,
        remote_key: row.get(17)?,
        created_at: row.get(18)?,
    })
}

/// 从设置里的 agent 列表反查名字（找不到就用 id 本身，保证记录可读）
fn agent_name_of(conn: &Connection, agent_id: &str) -> String {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key='ai_agents'",
            [],
            |r| r.get(0),
        )
        .ok();
    raw.and_then(|raw| {
        let agents: Vec<crate::ai::AgentConfig> = serde_json::from_str(&raw).ok()?;
        agents
            .iter()
            .find(|a| a.id == agent_id)
            .map(|a| a.name.clone())
    })
    .filter(|n| !n.is_empty())
    .unwrap_or_else(|| agent_id.to_string())
}

/// 写一条会话记录（命令与 pk CLI 共用）
pub fn log_session_conn(conn: &Connection, s: &NewAgentSession) -> AppResult<AgentSession> {
    if let Some(tid) = s.task_id {
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM tasks WHERE id=?1)",
                params![tid],
                |r| r.get::<_, i64>(0),
            )
            .map(|v| v != 0)
            .unwrap_or(false);
        if !exists {
            return Err(AppError::NotFound(format!(
                "待办 No.{tid} 不存在，无法关联会话"
            )));
        }
    }
    let agent_name = agent_name_of(conn, &s.agent_id);
    conn.execute(
        "INSERT INTO agent_sessions (task_id, agent_id, agent_name, session_id, command,
                                     exit_code, status, duration_ms, cost_usd, input_tokens, output_tokens,
                                     kind, workdir, tmux_session, remote_host, remote_port, remote_key, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)",
        params![
            s.task_id,
            s.agent_id,
            agent_name,
            s.session_id,
            s.command,
            s.exit_code,
            if s.status == "error" { "error" } else { "ok" },
            s.duration_ms,
            s.cost_usd,
            s.input_tokens,
            s.output_tokens,
            s.kind,
            s.workdir,
            s.tmux_session,
            s.remote_host,
            s.remote_port,
            s.remote_key,
            now(),
        ],
    )?;
    let id = conn.last_insert_rowid();
    conn.query_row(
        &format!("SELECT {SESSION_COLS} FROM agent_sessions WHERE id=?1"),
        params![id],
        row_to_session,
    )
    .map_err(AppError::from)
}

/// 记录一次 agent 会话的 IPC 入参（结构体形式，字段与 NewAgentSession 一一对应）
#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentSessionLogInput {
    pub task_id: Option<i64>,
    pub agent_id: String,
    pub session_id: Option<String>,
    pub command: Option<String>,
    pub exit_code: Option<i64>,
    pub status: Option<String>,
    pub duration_ms: Option<i64>,
    pub cost_usd: Option<f64>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    /// 会话来源 / 执行时快照（前端补录场景可带；pk 走 CLI 侧填）
    pub kind: Option<String>,
    pub workdir: Option<String>,
    pub tmux_session: Option<String>,
    pub remote_host: Option<String>,
    pub remote_port: Option<i64>,
    pub remote_key: Option<String>,
}

/// 记录一次 agent 会话（供 IPC 调用）：任务可关联、成本/时长/退出码可空
#[tauri::command]
pub fn log_agent_session(db: State<Db>, input: AgentSessionLogInput) -> AppResult<AgentSession> {
    let conn = db.0.lock().unwrap();
    log_session_conn(
        &conn,
        &NewAgentSession {
            task_id: input.task_id,
            agent_id: input.agent_id,
            kind: input.kind.unwrap_or_default(),
            session_id: input.session_id,
            command: input.command,
            exit_code: input.exit_code,
            status: input.status.unwrap_or_else(|| "ok".into()),
            duration_ms: input.duration_ms,
            cost_usd: input.cost_usd,
            input_tokens: input.input_tokens,
            output_tokens: input.output_tokens,
            workdir: input.workdir.unwrap_or_default(),
            tmux_session: input.tmux_session.unwrap_or_default(),
            remote_host: input.remote_host.unwrap_or_default(),
            remote_port: input.remote_port.unwrap_or(0),
            remote_key: input.remote_key.unwrap_or_default(),
        },
    )
}

/// 按 id 取单条会话记录（回放路由用）：不存在报 NotFound
pub fn get_session_conn(conn: &Connection, id: i64) -> AppResult<AgentSession> {
    conn.query_row(
        &format!("SELECT {SESSION_COLS} FROM agent_sessions WHERE id=?1"),
        params![id],
        row_to_session,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("会话记录 No.{id} 不存在"))
        }
        other => AppError::from(other),
    })
}

/// 会话列表查询（命令与 pk CLI 共用）：给 task_id 查该任务的时间线，否则全局最近 100 条
pub fn list_agent_sessions_conn(
    conn: &Connection,
    task_id: Option<i64>,
) -> AppResult<Vec<AgentSession>> {
    if let Some(tid) = task_id {
        let mut stmt = conn.prepare(&format!(
            "SELECT {SESSION_COLS} FROM agent_sessions WHERE task_id=?1 ORDER BY id"
        ))?;
        let rows = stmt
            .query_map(params![tid], row_to_session)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    } else {
        let mut stmt = conn.prepare(&format!(
            "SELECT {SESSION_COLS} FROM agent_sessions ORDER BY id DESC LIMIT 100"
        ))?;
        let rows = stmt
            .query_map([], row_to_session)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

/// 会话列表：给 task_id 查该任务的时间线，否则全局最近 100 条（含分类调用）
#[tauri::command]
pub fn list_agent_sessions(db: State<Db>, task_id: Option<i64>) -> AppResult<Vec<AgentSession>> {
    let conn = db.0.lock().unwrap();
    list_agent_sessions_conn(&conn, task_id)
}

/// 会话历史的来源分组过滤条件（与前端筛选 chip 对齐；kind 空/NULL 归「其他」，
/// 与前端 `kind ?? ""` 不入 radio/dispatch 集合的既有语义一致）
fn session_group_sql(group: &str) -> &'static str {
    match group {
        "radio" => " WHERE kind IN ('classify','capture')",
        "dispatch" => " WHERE kind IN ('dispatch_headless','dispatch_interactive')",
        "other" => {
            " WHERE (kind IS NULL OR kind NOT IN ('classify','capture','dispatch_headless','dispatch_interactive'))"
        }
        _ => "",
    }
}

/// 四个筛选档的全量计数（chip 徽标；不随当前分组/翻页变化）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCounts {
    pub all: i64,
    pub radio: i64,
    pub dispatch: i64,
    pub other: i64,
}

/// 分页结果：当前页行 + 该分组总数（翻页用）+ 四档计数（筛选 chip）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPage {
    pub items: Vec<AgentSession>,
    pub total: i64,
    pub counts: SessionCounts,
}

/// 会话历史分页查询：按来源分组过滤 + id 倒序 LIMIT/OFFSET（全局视图；
/// 任务时间线走 list_agent_sessions_conn，不分页）
pub fn list_agent_sessions_page_conn(
    conn: &Connection,
    group: &str,
    limit: i64,
    offset: i64,
) -> AppResult<SessionPage> {
    let where_sql = session_group_sql(group);
    let total: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM agent_sessions{where_sql}"),
        [],
        |r| r.get(0),
    )?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {SESSION_COLS} FROM agent_sessions{where_sql} ORDER BY id DESC LIMIT ?1 OFFSET ?2"
    ))?;
    let items = stmt
        .query_map(params![limit.clamp(1, 100), offset.max(0)], row_to_session)?
        .collect::<Result<Vec<_>, _>>()?;
    let (radio, dispatch): (i64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(kind IN ('classify','capture')), 0), \
                COALESCE(SUM(kind IN ('dispatch_headless','dispatch_interactive')), 0) \
         FROM agent_sessions",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let all: i64 = conn.query_row("SELECT COUNT(*) FROM agent_sessions", [], |r| r.get(0))?;
    let counts = SessionCounts {
        all,
        radio,
        dispatch,
        other: all - radio - dispatch,
    };
    Ok(SessionPage {
        items,
        total,
        counts,
    })
}

/// 会话历史分页（全局视图）：group = all/radio/dispatch/other，limit 默认 20（1-100 钳制）
#[tauri::command]
pub fn list_agent_sessions_paged(
    db: State<Db>,
    group: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> AppResult<SessionPage> {
    let conn = db.0.lock().unwrap();
    list_agent_sessions_page_conn(
        &conn,
        group.as_deref().unwrap_or("all"),
        limit.unwrap_or(20),
        offset.unwrap_or(0),
    )
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

    fn seed_task(conn: &Connection) -> i64 {
        conn.execute(
            "INSERT INTO tasks (title, status, created_at) VALUES ('写周报', 'inbox', '2026-09-13T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    /// 落库→查询往返：字段齐全、agent 名从设置反查（无配置时用 id 兜底）
    #[test]
    fn log_and_list_sessions() {
        let app = setup();
        let (task_id, agent_name_fallback) = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            (seed_task(&conn), agent_name_of(&conn, "claude-code"))
        };
        assert_eq!(agent_name_fallback, "claude-code", "无配置时用 id 兜底");

        let session = {
            let db = app.state::<Db>();
            log_agent_session(
                db,
                AgentSessionLogInput {
                    task_id: Some(task_id),
                    agent_id: "claude-code".into(),
                    session_id: Some("sess-1".into()),
                    command: Some("claude -p 修登录bug".into()),
                    exit_code: Some(0),
                    status: None,
                    duration_ms: Some(61_000),
                    cost_usd: Some(0.12),
                    input_tokens: Some(1000),
                    output_tokens: Some(2000),
                    ..Default::default()
                },
            )
            .unwrap()
        };
        assert_eq!(session.task_id, Some(task_id));
        assert_eq!(session.agent_name, "claude-code");
        assert_eq!(session.session_id.as_deref(), Some("sess-1"));
        assert_eq!(session.status, "ok");
        assert!((session.cost_usd.unwrap() - 0.12).abs() < 1e-9);

        // 全局一条 + 任务一条
        let all = {
            let db = app.state::<Db>();
            list_agent_sessions(db, None).unwrap()
        };
        assert_eq!(all.len(), 1);
        let of_task = {
            let db = app.state::<Db>();
            list_agent_sessions(db, Some(task_id)).unwrap()
        };
        assert_eq!(of_task.len(), 1);
        let empty = {
            let db = app.state::<Db>();
            list_agent_sessions(db, Some(999)).unwrap()
        };
        assert!(empty.is_empty());
    }

    /// 关联不存在的任务被拒绝；status 只落 ok/error
    #[test]
    fn log_validates_task_and_status() {
        let app = setup();
        let err = {
            let db = app.state::<Db>();
            log_agent_session(
                db,
                AgentSessionLogInput {
                    task_id: Some(999),
                    agent_id: "a".into(),
                    ..Default::default()
                },
            )
            .unwrap_err()
        };
        assert!(matches!(err, AppError::NotFound(_)), "{err}");

        let s = {
            let db = app.state::<Db>();
            log_agent_session(
                db,
                AgentSessionLogInput {
                    agent_id: "a".into(),
                    status: Some("whatever".into()),
                    ..Default::default()
                },
            )
            .unwrap()
        };
        assert_eq!(s.status, "ok", "未知 status 归一为 ok");
        assert!(s.task_id.is_none(), "分类调用不关联任务");
    }

    /// for_run 快照基底 + 回环：kind/workdir/tmux/远端三元组原样落库取出；
    /// get_session_conn 命中与 NotFound
    #[test]
    fn for_run_snapshots_context_and_roundtrips() {
        let app = setup();
        let agent = crate::ai::AgentConfig {
            id: "ag-1".into(),
            command: "claude".into(),
            workdir: "/remote/ws".into(),
            remote: Some(crate::ai::AgentRemote {
                host: "vscode@localhost".into(),
                port: 1022,
                key_path: Some("/keys/pk".into()),
                ..Default::default()
            }),
            ..Default::default()
        };
        let mut rec = NewAgentSession::for_run("classify", &agent, "/remote/ws");
        rec.task_id = None;
        rec.session_id = Some("0b0ae984".into());
        rec.status = "error".into();
        rec.duration_ms = Some(4_591);
        let s = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            log_session_conn(&conn, &rec).unwrap()
        };
        assert_eq!(s.kind, "classify");
        assert_eq!(s.workdir, "/remote/ws");
        assert_eq!(s.remote_host, "vscode@localhost");
        assert_eq!(s.remote_port, 1022);
        assert_eq!(s.remote_key, "/keys/pk");
        assert_eq!(s.status, "error");
        assert_eq!(s.tmux_session, "");

        // 本地 agent 快照为空三元组
        let local = crate::ai::AgentConfig {
            id: "ag-2".into(),
            command: "claude".into(),
            ..Default::default()
        };
        let rec = NewAgentSession::for_run("capture", &local, "/Users/x/ws");
        assert_eq!(
            (
                rec.remote_host.as_str(),
                rec.remote_port,
                rec.remote_key.as_str()
            ),
            ("", 0, "")
        );

        // 按 id 取行：命中 + 不存在报 NotFound
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            assert_eq!(
                get_session_conn(&conn, s.id).unwrap().session_id.as_deref(),
                Some("0b0ae984")
            );
            let err = get_session_conn(&conn, 999).unwrap_err();
            assert!(matches!(err, AppError::NotFound(_)), "{err}");
        }
    }

    /// 分页 + 分组过滤：id 倒序 LIMIT/OFFSET 翻页；radio/dispatch/other 分组
    /// 与四档计数（kind 空 = 早期记录归「其他」）
    #[test]
    fn paged_sessions_group_and_pagination() {
        let conn = crate::db::tests::test_conn();
        let local = crate::ai::AgentConfig {
            id: "ag".into(),
            command: "claude".into(),
            ..Default::default()
        };
        for (i, kind) in [
            "classify",
            "capture",
            "classify",
            "dispatch_headless",
            "dispatch_headless",
            "pk",
            "",
        ]
        .into_iter()
        .enumerate()
        {
            let mut rec = NewAgentSession::for_run(kind, &local, "/ws");
            rec.command = Some(format!("run-{i}"));
            log_session_conn(&conn, &rec).unwrap();
        } // id 1..=7

        let ids = |p: &SessionPage| p.items.iter().map(|s| s.id).collect::<Vec<_>>();

        // 全量分页：每页 3，倒序翻页
        let p1 = list_agent_sessions_page_conn(&conn, "all", 3, 0).unwrap();
        assert_eq!(ids(&p1), vec![7, 6, 5]);
        assert_eq!(p1.total, 7);
        let p2 = list_agent_sessions_page_conn(&conn, "all", 3, 3).unwrap();
        assert_eq!(ids(&p2), vec![4, 3, 2]);
        let p3 = list_agent_sessions_page_conn(&conn, "all", 3, 6).unwrap();
        assert_eq!(ids(&p3), vec![1]);

        // 分组：radio = classify/capture，dispatch = dispatch_*，other = pk + 早期记录
        let radio = list_agent_sessions_page_conn(&conn, "radio", 20, 0).unwrap();
        assert_eq!(ids(&radio), vec![3, 2, 1]);
        assert_eq!(radio.total, 3);
        let dispatch = list_agent_sessions_page_conn(&conn, "dispatch", 20, 0).unwrap();
        assert_eq!(ids(&dispatch), vec![5, 4]);
        assert_eq!(dispatch.total, 2);
        let other = list_agent_sessions_page_conn(&conn, "other", 20, 0).unwrap();
        assert_eq!(ids(&other), vec![7, 6]);

        // 四档计数不随分组/翻页变化；未知分组名按 all 处理
        assert_eq!(
            (
                p1.counts.all,
                p1.counts.radio,
                p1.counts.dispatch,
                p1.counts.other
            ),
            (7, 3, 2, 2)
        );
        assert_eq!(radio.counts.all, 7);
        let unknown = list_agent_sessions_page_conn(&conn, "whatever", 20, 0).unwrap();
        assert_eq!(unknown.total, 7);

        // 边界钳制：limit ≤ 0 / offset < 0 不炸（clamp 到合法域）
        assert_eq!(
            list_agent_sessions_page_conn(&conn, "all", 0, -5)
                .unwrap()
                .items
                .len(),
            1
        );
    }
}
