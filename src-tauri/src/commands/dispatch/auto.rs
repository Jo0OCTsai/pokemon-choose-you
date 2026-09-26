//! 自动派发循环（M3，§10）：到期未开始的 project 待办排队 → 按每机器并发上限
//! 领取 → 无头执行，完成发系统通知。
use super::headless::run_headless_dispatch;
use super::route::prepare_dispatch;
use super::state::{claim_dispatch, dispatch_transition_conn, DS_DONE, DS_FAILED, DS_QUEUED};
use crate::ai::{self, AgentConfig};
use crate::db::Db;
use crate::error::AppResult;
use rusqlite::{params, Connection};
use tauri::Manager;

/// 每台机器（本机 / 每个 SSH 目标）在途无头派发数：并发上限闸门（内存态；
/// 应用重启后清零——库里的 running 状态不受影响，可手动重置救援）
fn inflight() -> &'static std::sync::Mutex<std::collections::HashMap<String, usize>> {
    static F: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, usize>>> =
        std::sync::OnceLock::new();
    F.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

fn host_key(agent: &AgentConfig) -> String {
    agent
        .remote
        .as_ref()
        .filter(|r| !r.host.trim().is_empty())
        .map(|r| format!("ssh:{}", r.host.trim()))
        .unwrap_or_else(|| "local".into())
}

/// 自动派发循环：每 60 秒排队到期任务、领取可执行者（无头执行可能数分钟，异步发车）
pub fn spawn_dispatch_loop<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        loop {
            if let Err(e) = dispatch_tick(&app).await {
                log::warn!("dispatch: 自动派发轮询失败: {e}");
            }
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        }
    });
}

async fn dispatch_tick<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<()> {
    let db = app.state::<Db>();
    let (auto_on, max_concurrent, use_worktree, lang, notify_on) = {
        let conn = db.0.lock().unwrap();
        let get = |k: &str| -> Option<String> {
            conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| {
                r.get::<_, String>(0)
            })
            .ok()
        };
        (
            get("dispatch_auto_enabled").as_deref() == Some("true"),
            get("dispatch_max_concurrent")
                .and_then(|v| v.parse::<usize>().ok())
                .filter(|n| *n > 0)
                .unwrap_or(1),
            get("dispatch_worktree").as_deref() == Some("true"),
            get("language").unwrap_or_else(|| "zh-Hans".into()),
            get("notifications_enabled")
                .map(|v| v != "false")
                .unwrap_or(true),
        )
    };
    if !auto_on {
        return Ok(());
    }
    // 排队：到期未开始 + project 标签 meta 显式指定了可用 agent（只自动派发用户明确配置过的）
    {
        let conn = db.0.lock().unwrap();
        let n = queue_due_tasks(&conn)?;
        if n > 0 {
            log::info!("dispatch: {n} 条到期待办已排队自动派发");
        }
    }
    // 领取：按到期先后，受每机器并发上限约束
    let queued: Vec<(i64, String)> = {
        let conn = db.0.lock().unwrap();
        pick_queued(&conn)?
    };
    for (task_id, agent_id) in queued {
        let agent = {
            let conn = db.0.lock().unwrap();
            let get = |k: &str| crate::secrets::secret_get(&conn, k);
            ai::agent_by_id(&get, &agent_id).filter(|a| a.enabled)
        };
        let Some(agent) = agent else {
            // meta 指定的 agent 已不可用：撤销排队，下次满足条件再排（不留在 queued 卡死）
            let _ = {
                let conn = db.0.lock().unwrap();
                dispatch_transition_conn(
                    &conn,
                    task_id,
                    None,
                    Some("排队后 agent 不可用，自动撤销"),
                    "dispatch-auto",
                )
            };
            continue;
        };
        let hk = host_key(&agent);
        let slots = {
            let m = inflight().lock().unwrap();
            max_concurrent.saturating_sub(*m.get(&hk).unwrap_or(&0))
        };
        if slots == 0 {
            continue;
        }
        {
            let conn = db.0.lock().unwrap();
            if !claim_dispatch(&conn, task_id, false, &[DS_QUEUED])? {
                continue;
            }
        }
        {
            let mut m = inflight().lock().unwrap();
            *m.entry(hk.clone()).or_insert(0) += 1;
        }
        let app = app.clone();
        let lang = lang.clone();
        tauri::async_runtime::spawn(async move {
            let db = app.state::<Db>();
            let prep = match prepare_dispatch(&db, task_id, Some(&agent_id)) {
                Ok(p) => p,
                Err(e) => {
                    log::warn!("dispatch: 自动派发准备失败（No.{task_id}）: {e}");
                    let _ = {
                        let conn = db.0.lock().unwrap();
                        dispatch_transition_conn(
                            &conn,
                            task_id,
                            Some(DS_FAILED),
                            Some(&e.to_string()),
                            "dispatch-auto",
                        )
                    };
                    dec_inflight(&hk);
                    return;
                }
            };
            let title = prep.task.title.clone();
            let agent_name = prep.agent.name.clone();
            let out = run_headless_dispatch(&db, &prep, use_worktree).await;
            dec_inflight(&hk);
            crate::events::broadcast(&app, crate::events::TASKS_CHANGED);
            if notify_on {
                use tauri_plugin_notification::NotificationExt;
                let (t, b) = dispatch_notification_text(
                    &lang,
                    out.state == DS_DONE,
                    &title,
                    &agent_name,
                    out.note.as_deref(),
                );
                let _ = app.notification().builder().title(t).body(b).show();
            }
        });
    }
    Ok(())
}

fn dec_inflight(host: &str) {
    let mut m = inflight().lock().unwrap();
    if let Some(n) = m.get_mut(host) {
        *n = n.saturating_sub(1);
    }
}

/// 排队到期任务（SQL 粗筛 + parse_time 精判，窗口放宽一天——与提醒循环同一套时间字符串
/// 混排问题）；只动 dispatch_state IS NULL 的行（done/failed 不自动重派，避免失败循环）
fn queue_due_tasks(conn: &Connection) -> AppResult<usize> {
    let window = (chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339();
    let rows: Vec<(i64, String, Option<String>)> = {
        let mut stmt = conn.prepare(
            "SELECT t.id, t.due_at, g.meta FROM tasks t
             JOIN task_tags tt ON tt.task_id = t.id
             JOIN tags g ON g.id = tt.tag_id
             JOIN tag_dimensions d ON d.id = g.dimension_id AND d.key='project'
             WHERE t.status IN ('inbox','scheduled') AND t.dispatch_state IS NULL
               AND t.due_at IS NOT NULL AND trim(t.due_at) != '' AND t.due_at <= ?1",
        )?;
        let rows = stmt
            .query_map(params![window], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    let now = chrono::Utc::now();
    let mut queued = 0;
    for (id, due_at, meta_raw) in rows {
        let Some(due) = crate::scheduler::parse_time(&due_at) else {
            continue;
        };
        if due > now {
            continue;
        }
        let Some(agent_id) = crate::commands::tags::parse_tag_meta(meta_raw)
            .and_then(|m| m.agent_id)
            .filter(|a| !a.trim().is_empty())
        else {
            continue; // 未显式指定 agent 的标签不自动派发
        };
        let get = |k: &str| crate::secrets::secret_get(conn, k);
        let agent_ok = ai::agent_by_id(&get, &agent_id).is_some_and(|a| a.enabled);
        if !agent_ok {
            continue;
        }
        let n = conn.execute(
            "UPDATE tasks SET dispatch_state='queued' WHERE id=?1 AND dispatch_state IS NULL",
            params![id],
        )?;
        queued += n;
    }
    Ok(queued)
}

/// 待领取的排队任务（到期先后）：(task_id, meta.agentId)
fn pick_queued(conn: &Connection) -> AppResult<Vec<(i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, g.meta FROM tasks t
         JOIN task_tags tt ON tt.task_id = t.id
         JOIN tags g ON g.id = tt.tag_id
         JOIN tag_dimensions d ON d.id = g.dimension_id AND d.key='project'
         WHERE t.dispatch_state='queued'
         ORDER BY t.due_at IS NULL, t.due_at, t.id
         LIMIT 10",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows
        .into_iter()
        .filter_map(|(id, meta)| {
            crate::commands::tags::parse_tag_meta(meta).and_then(|m| m.agent_id.map(|a| (id, a)))
        })
        .collect())
}

/// 自动派发结果通知（三语；失败带原因摘要）
fn dispatch_notification_text(
    lang: &str,
    ok: bool,
    title: &str,
    agent: &str,
    reason: Option<&str>,
) -> (String, String) {
    let reason: String = reason
        .map(|r| r.chars().take(80).collect::<String>())
        .unwrap_or_default();
    match lang {
        "zh-Hant" => {
            if ok {
                (
                    "⚡ 派發完成".into(),
                    format!("「{title}」已由 {agent} 處理完——摘要見任務抽屜"),
                )
            } else {
                (
                    "⚡ 派發失敗".into(),
                    format!("「{title}」處理失敗：{reason}（詳情見任務抽屜）"),
                )
            }
        }
        "en" => {
            if ok {
                (
                    "⚡ Dispatch done".into(),
                    format!("\"{title}\" finished by {agent} — see the task drawer"),
                )
            } else {
                (
                    "⚡ Dispatch failed".into(),
                    format!("\"{title}\" failed: {reason} (details in the task drawer)"),
                )
            }
        }
        _ => {
            if ok {
                (
                    "⚡ 派发完成".into(),
                    format!("「{title}」已由 {agent} 处理完——摘要见任务抽屉"),
                )
            } else {
                (
                    "⚡ 派发失败".into(),
                    format!("「{title}」处理失败：{reason}（详情见任务抽屉）"),
                )
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::dispatch::testsupport::*;
    use crate::commands::tags::create_tag_conn;
    use crate::db::tests::test_conn;

    /// 到期未开始 + 标签 meta 指定可用 agent 才排队；done/failed/queued/无 agent 的不动
    #[test]
    fn queue_due_tasks_filters_and_claims_once() {
        let conn = test_conn();
        seed_agents(&conn, &[agent_json("ag-1", "Claude", "claude", true, "")]);
        create_tag_conn(&conn, "PokemonApp", "", "project", "manual").unwrap();
        let past = (chrono::Utc::now() - chrono::Duration::hours(2)).to_rfc3339();
        let meta = r#"{"agentId":"ag-1","workdir":"~/app"}"#;

        // 到期 + 配了 agent → 排队；重复轮次不重复排
        due_task(&conn, "到期该排", &past, Some(meta));
        assert_eq!(queue_due_tasks(&conn).unwrap(), 1);
        let state: String = conn
            .query_row(
                "SELECT dispatch_state FROM tasks WHERE title='到期该排'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(state, DS_QUEUED);
        assert_eq!(
            queue_due_tasks(&conn).unwrap(),
            0,
            "queued 非 NULL 不重复排"
        );
        let queued = pick_queued(&conn).unwrap();
        assert_eq!(
            queued,
            vec![(1, "ag-1".to_string())],
            "领取列表返回 meta 的 agentId"
        );
        conn.execute(
            "UPDATE tasks SET dispatch_state='done' WHERE title='到期该排'",
            [],
        )
        .unwrap();

        // meta 无 agentId（未显式指定 agent 的标签不自动派发）
        due_task(&conn, "无 agent 配置", &past, Some(r#"{"workdir":"~/x"}"#));
        assert_eq!(queue_due_tasks(&conn).unwrap(), 0);
        conn.execute(
            "UPDATE tasks SET dispatch_state='done' WHERE title='无 agent 配置'",
            [],
        )
        .unwrap();

        // meta 指向不存在/停用的 agent
        due_task(&conn, "agent 不可用", &past, Some(r#"{"agentId":"ag-9"}"#));
        assert_eq!(queue_due_tasks(&conn).unwrap(), 0);
        conn.execute(
            "UPDATE tasks SET dispatch_state='done' WHERE title='agent 不可用'",
            [],
        )
        .unwrap();

        // 未到期不排
        due_task(
            &conn,
            "未到期",
            &(chrono::Utc::now() + chrono::Duration::days(2)).to_rfc3339(),
            Some(meta),
        );
        assert_eq!(queue_due_tasks(&conn).unwrap(), 0);
        // done 状态不自动重派（失败循环防线）
        conn.execute(
            "UPDATE tags SET meta=?1 WHERE name='PokemonApp'",
            params![meta],
        )
        .unwrap();
        assert_eq!(queue_due_tasks(&conn).unwrap(), 0, "done 不自动重派");
    }

    #[test]
    fn dispatch_notification_text_covers_languages_and_outcomes() {
        let (t, b) = dispatch_notification_text("zh-Hans", true, "修登录", "Claude", None);
        assert!(t.contains("派发完成") && b.contains("修登录") && b.contains("Claude"));
        let (t, b) = dispatch_notification_text(
            "zh-Hans",
            false,
            "修登录",
            "Claude",
            Some("退出码 1：boom"),
        );
        assert!(t.contains("派发失败") && b.contains("boom"));
        let (t, _) = dispatch_notification_text("zh-Hant", true, "t", "a", None);
        assert!(t.contains("派發完成"));
        let (t, b) = dispatch_notification_text("en", false, "t", "a", Some("timeout"));
        assert!(t.contains("failed") && b.contains("timeout"));
    }
}
