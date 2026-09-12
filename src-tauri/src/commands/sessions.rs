//! Agent 会话回链与成本记录：分类调用自动落库，agent 代办经 pk session log 关联任务。
use crate::db::{now, Db};
use crate::error::{AppError, AppResult};
use crate::models::AgentSession;
use rusqlite::{params, Connection};
use tauri::State;

/// 一次会话记录的输入（命令与 pk CLI 共用）
pub struct NewAgentSession {
    pub task_id: Option<i64>,
    pub agent_id: String,
    pub session_id: Option<String>,
    pub command: Option<String>,
    pub exit_code: Option<i64>,
    pub status: String,
    pub duration_ms: Option<i64>,
    pub cost_usd: Option<f64>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
}

const SESSION_COLS: &str =
    "id, task_id, agent_id, agent_name, session_id, command, exit_code, status, \
                            duration_ms, cost_usd, input_tokens, output_tokens, created_at";

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
        created_at: row.get(12)?,
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
                                     exit_code, status, duration_ms, cost_usd, input_tokens, output_tokens, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
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
            session_id: input.session_id,
            command: input.command,
            exit_code: input.exit_code,
            status: input.status.unwrap_or_else(|| "ok".into()),
            duration_ms: input.duration_ms,
            cost_usd: input.cost_usd,
            input_tokens: input.input_tokens,
            output_tokens: input.output_tokens,
        },
    )
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
}
