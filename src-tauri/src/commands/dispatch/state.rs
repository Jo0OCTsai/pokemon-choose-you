//! 派发状态机（§8）：迁移校验、原子 claim 与审计日志——应用命令与 pk dispatch 共用。
use crate::db::Db;
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection};
use tauri::State;

pub const DS_QUEUED: &str = "queued";

pub const DS_RUNNING: &str = "running";

pub const DS_DONE: &str = "done";

pub const DS_FAILED: &str = "failed";

/// 状态机允许的迁移（§8 stateDiagram-v2）：
/// NULL → running（手动派发）/ queued（定时排队，M3）；
/// queued → running（领取）/ 重置；running → done（信封成功 / Stop hook）/ failed（非零退出、超时）/ 重置；
/// done / failed → running（重派 --resume 续接 / 重试）
pub(crate) fn transition_allowed(from: Option<&str>, to: Option<&str>) -> bool {
    match from {
        None => matches!(to, Some(DS_RUNNING) | Some(DS_QUEUED)),
        Some(DS_QUEUED) => matches!(to, Some(DS_RUNNING) | None),
        Some(DS_RUNNING) => matches!(to, Some(DS_DONE) | Some(DS_FAILED) | None),
        Some(DS_DONE) | Some(DS_FAILED) => to == Some(DS_RUNNING),
        _ => false,
    }
}

/// 原子 claim（§7，amux 的 compare-and-swap 防抢占）：当前状态在允许集合内才置 running。
/// 返回 false = 没抢到（重复派发 / 状态不满足）。（pk dispatch start 也复用同一语义）
pub fn claim_dispatch(
    conn: &Connection,
    task_id: i64,
    allow_null: bool,
    states: &[&str],
) -> AppResult<bool> {
    let mut cond: Vec<String> = states
        .iter()
        .map(|s| format!("dispatch_state='{s}'"))
        .collect();
    if allow_null {
        cond.push("dispatch_state IS NULL".into());
    }
    let n = conn.execute(
        &format!(
            "UPDATE tasks SET dispatch_state='running' WHERE id=?1 AND ({})",
            cond.join(" OR ")
        ),
        params![task_id],
    )?;
    Ok(n > 0)
}

/// 按状态机迁移派发状态并写审计日志（应用命令与 pk dispatch 子命令共用）。
/// to=None 重置为未派发（救援卡死的 running）；不满足迁移给可操作报错
pub fn dispatch_transition_conn(
    conn: &Connection,
    task_id: i64,
    to: Option<&str>,
    note: Option<&str>,
    origin: &str,
) -> AppResult<()> {
    let from: Option<String> = conn
        .query_row(
            "SELECT dispatch_state FROM tasks WHERE id=?1",
            params![task_id],
            |r| r.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("待办 No.{task_id} 不存在"))
            }
            other => AppError::Db(other),
        })?;
    if !transition_allowed(from.as_deref(), to) {
        let from_text = from.as_deref().unwrap_or("未派发");
        let to_text = to.unwrap_or("未派发（重置）");
        return Err(AppError::Invalid(format!(
            "待办 No.{task_id} 派发状态为「{from_text}」，不能迁移到「{to_text}」；先派发领取 running，或在应用抽屉里重置"
        )));
    }
    conn.execute(
        "UPDATE tasks SET dispatch_state=?2 WHERE id=?1",
        params![task_id, to],
    )?;
    let new_value = match (to, note.map(str::trim).filter(|n| !n.is_empty())) {
        (Some(t), Some(n)) => format!("{t}：{n}"),
        (Some(t), None) => t.to_string(),
        (None, Some(n)) => format!("重置：{n}"),
        (None, None) => "重置".into(),
    };
    conn.execute(
        "INSERT INTO task_logs (task_id, action, field, old_value, new_value, origin, created_at)
         VALUES (?1,'update','dispatch_state',?2,?3,?4,?5)",
        params![
            task_id,
            from.unwrap_or_default(),
            new_value,
            origin,
            crate::db::now()
        ],
    )?;
    Ok(())
}

/// 迁移到 to，但目标态已达成时按成功处理（agent 中途 `pk dispatch done` 回传后，
/// 应用按退出码再迁移会撞已迁移的状态——回传信号优先，幂等收口）
pub(crate) fn transition_or_already(
    db: &Db,
    task_id: i64,
    to: &str,
    origin: &str,
) -> AppResult<()> {
    let conn = db.0.lock().unwrap();
    let cur: Option<String> = conn
        .query_row(
            "SELECT dispatch_state FROM tasks WHERE id=?1",
            params![task_id],
            |r| r.get(0),
        )
        .unwrap_or(None);
    if cur.as_deref() == Some(to) {
        return Ok(());
    }
    dispatch_transition_conn(&conn, task_id, Some(to), None, origin)
}

/// 手动标记派发状态（交互会话 agent 未回传时的救援入口）：done/failed 走状态机校验；
/// idle 从任意状态重置为未派发（卡死的 running 也救得回）
#[tauri::command]
pub fn mark_dispatch<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    task_id: i64,
    state: String,
) -> AppResult<()> {
    {
        let conn = db.0.lock().unwrap();
        match state.as_str() {
            "done" | "failed" => {
                dispatch_transition_conn(&conn, task_id, Some(&state), None, "manual")?;
            }
            "idle" => {
                let n = conn.execute(
                    "UPDATE tasks SET dispatch_state=NULL WHERE id=?1",
                    params![task_id],
                )?;
                if n == 0 {
                    return Err(AppError::NotFound(format!("待办 No.{task_id} 不存在")));
                }
                conn.execute(
                    "INSERT INTO task_logs (task_id, action, field, old_value, new_value, origin, created_at)
                     VALUES (?1,'update','dispatch_state','running',NULL,'manual',?2)",
                    params![task_id, crate::db::now()],
                )?;
            }
            _ => {
                return Err(AppError::Invalid(
                    "state 只支持 done / failed / idle（重置）".into(),
                ))
            }
        }
    }
    crate::events::broadcast(&app, crate::events::TASKS_CHANGED);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::dispatch::testsupport::*;
    use crate::db::tests::test_conn;
    use tauri::Manager;

    /// §8 状态机允许的迁移矩阵（非法迁移在 claim 与回传路径上都会被拦）
    #[test]
    fn transition_matrix_follows_state_diagram() {
        use super::{DS_DONE, DS_FAILED, DS_QUEUED, DS_RUNNING};
        // NULL → running / queued
        assert!(transition_allowed(None, Some(DS_RUNNING)));
        assert!(transition_allowed(None, Some(DS_QUEUED)));
        assert!(!transition_allowed(None, Some(DS_DONE)));
        // queued → running / 重置
        assert!(transition_allowed(Some(DS_QUEUED), Some(DS_RUNNING)));
        assert!(transition_allowed(Some(DS_QUEUED), None));
        assert!(!transition_allowed(Some(DS_QUEUED), Some(DS_DONE)));
        // running → done / failed / 重置
        assert!(transition_allowed(Some(DS_RUNNING), Some(DS_DONE)));
        assert!(transition_allowed(Some(DS_RUNNING), Some(DS_FAILED)));
        assert!(transition_allowed(Some(DS_RUNNING), None));
        assert!(!transition_allowed(Some(DS_RUNNING), Some(DS_QUEUED)));
        // done/failed → running（重派/重试）
        assert!(transition_allowed(Some(DS_DONE), Some(DS_RUNNING)));
        assert!(transition_allowed(Some(DS_FAILED), Some(DS_RUNNING)));
        assert!(!transition_allowed(Some(DS_DONE), Some(DS_DONE)));
        // 未知状态拒绝一切
        assert!(!transition_allowed(Some("weird"), Some(DS_RUNNING)));
    }

    #[test]
    fn claim_dispatch_is_atomic_per_state() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO tasks (title, status, created_at) VALUES ('t', 'inbox', '2026-09-13T00:00:00Z')",
            [],
        )
        .unwrap();
        // NULL（手动派发口径）→ 抢到；running 重复抢 → 失败
        assert!(claim_dispatch(&conn, 1, true, &[DS_DONE, DS_FAILED, DS_QUEUED]).unwrap());
        assert!(
            !claim_dispatch(&conn, 1, true, &[DS_DONE, DS_FAILED, DS_QUEUED]).unwrap(),
            "running 中不允许重复 claim（防重复派发）"
        );
        // 不允许 NULL 的口径（自动派发领取 queued）抢不到 NULL 行
        conn.execute("UPDATE tasks SET dispatch_state=NULL", [])
            .unwrap();
        assert!(!claim_dispatch(&conn, 1, false, &[DS_QUEUED]).unwrap());
        // queued → 抢到
        conn.execute("UPDATE tasks SET dispatch_state='queued'", [])
            .unwrap();
        assert!(claim_dispatch(&conn, 1, false, &[DS_QUEUED]).unwrap());
    }

    #[test]
    fn transitions_write_audit_log_and_reject_illegal() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO tasks (title, status, created_at) VALUES ('t', 'inbox', '2026-09-13T00:00:00Z')",
            [],
        )
        .unwrap();
        // NULL → done 非法
        let err = dispatch_transition_conn(&conn, 1, Some(DS_DONE), None, "t").unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)), "{err}");
        // running → done 带备注；日志落 dispatch_state 字段并带备注
        conn.execute("UPDATE tasks SET dispatch_state='running'", [])
            .unwrap();
        dispatch_transition_conn(&conn, 1, Some(DS_DONE), Some("修复完成，含回归"), "pk").unwrap();
        let (state, log_new): (Option<String>, String) = conn
            .query_row(
                "SELECT dispatch_state, (SELECT new_value FROM task_logs WHERE task_id=1 AND field='dispatch_state' ORDER BY id DESC LIMIT 1) FROM tasks WHERE id=1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(state.as_deref(), Some(DS_DONE));
        assert!(
            log_new.contains("done：修复完成"),
            "备注并入日志: {log_new}"
        );
        // 不存在的任务
        let err = dispatch_transition_conn(&conn, 99, Some(DS_DONE), None, "t").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "{err}");
    }

    /// 手动标记：done/failed 走状态机；idle 从任意态（含卡死 running）重置
    #[test]
    fn mark_dispatch_manual_rescue_paths() {
        let app = setup();
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO tasks (title, status, created_at) VALUES ('t', 'inbox', '2026-09-13T00:00:00Z')",
                [],
            )
            .unwrap();
        }
        let err =
            mark_dispatch(app.handle().clone(), app.state::<Db>(), 1, "done".into()).unwrap_err();
        assert!(
            matches!(err, AppError::Invalid(_)),
            "NULL → done 被状态机拒绝"
        );
        {
            let db = app.state::<Db>();
            db.0.lock()
                .unwrap()
                .execute("UPDATE tasks SET dispatch_state='running'", [])
                .unwrap();
        }
        mark_dispatch(app.handle().clone(), app.state::<Db>(), 1, "done".into()).unwrap();
        // done 状态也能直接重置（救援语义）
        mark_dispatch(app.handle().clone(), app.state::<Db>(), 1, "idle".into()).unwrap();
        let state: Option<String> = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.query_row("SELECT dispatch_state FROM tasks WHERE id=1", [], |r| {
                r.get(0)
            })
            .unwrap()
        };
        assert!(state.is_none(), "idle 重置为未派发");
        let err =
            mark_dispatch(app.handle().clone(), app.state::<Db>(), 1, "weird".into()).unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)));
    }
}
