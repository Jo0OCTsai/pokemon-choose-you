//! 自动派发循环（M3，§10）：到期未开始的 project 待办排队 → 按每机器并发上限
//! 领取 → 无头执行，完成发系统通知。
//! 并发上限闸门 = 库内 `dispatch_slots` 租约槽表（§5.4 / §7.1 条目 5，A6）：
//! 跨形态（app / dsh 插件 / pk）合计计数，崩溃后租约过期自动回收。
use super::headless::{run_headless_dispatch, DISPATCH_MIN_TIMEOUT_SECS};
use super::route::prepare_dispatch;
use super::state::{claim_dispatch, dispatch_transition_conn, DS_DONE, DS_FAILED, DS_QUEUED};
use crate::ai::{self, AgentConfig};
use crate::db::{now, Db};
use crate::error::AppResult;
use rusqlite::{params, Connection};
use tauri::Manager;

/// 槽租约余量（秒，A6）：租约时长 = 无头超时 + 5 分钟，执行中的正常派发不会被误回收
const SLOT_LEASE_MARGIN_SECS: i64 = 300;

/// host_key 归一（dispatch_slots.host_key 的键口径，跨形态合计计数的机器标识）：
/// 本机 'local'；远程 agent 'ssh:user@host[:port]'。公开供其他消费面复用同一归一
pub fn host_key(agent: &AgentConfig) -> String {
    agent
        .remote
        .as_ref()
        .filter(|r| !r.host.trim().is_empty())
        .map(|r| format!("ssh:{}", r.host.trim()))
        .unwrap_or_else(|| "local".into())
}

/// 槽租约时长（秒）：无头超时（600 秒下限，与 run_headless_dispatch 同口径）+ 余量（A6）
fn slot_lease_secs(agent_timeout_secs: u64) -> i64 {
    agent_timeout_secs.max(DISPATCH_MIN_TIMEOUT_SECS) as i64 + SLOT_LEASE_MARGIN_SECS
}

/// 回收过期租约（每 tick 开头）：派发进程崩溃/被杀后不会自己删槽——租约到期即
/// 扫掉，不占并发额度（A6 崩溃自愈；rfc3339 字典序与时间序一致）
fn reclaim_expired_slots(conn: &Connection) -> AppResult<usize> {
    let n = conn.execute(
        "DELETE FROM dispatch_slots WHERE lease_expires_at < ?1",
        params![now()],
    )?;
    Ok(n)
}

/// 领取并占槽（条目 5）：上限检查（COUNT）+ claim + 插租约行在同一事务内原子完成
/// ——不会出现「claim 了没占槽」或「两个形态同时过 COUNT 检查」的中间态。
/// 返回 false = 没领到（槽满 / 任务已被领取）
fn claim_with_slot(
    conn: &Connection,
    task_id: i64,
    host: &str,
    max_concurrent: usize,
    lease_secs: i64,
) -> AppResult<bool> {
    let tx = conn.unchecked_transaction()?;
    let used: i64 = tx.query_row(
        "SELECT COUNT(*) FROM dispatch_slots WHERE host_key=?1",
        params![host],
        |r| r.get(0),
    )?;
    if used >= max_concurrent as i64 {
        return Ok(false);
    }
    if !claim_dispatch(&tx, task_id, false, &[DS_QUEUED])? {
        return Ok(false);
    }
    let t = chrono::Utc::now();
    tx.execute(
        "INSERT INTO dispatch_slots (host_key, task_id, owner, acquired_at, lease_expires_at)
         VALUES (?1, ?2, 'app', ?3, ?4)",
        params![
            host,
            task_id,
            t.to_rfc3339(),
            (t + chrono::Duration::seconds(lease_secs)).to_rfc3339()
        ],
    )?;
    tx.commit()?;
    Ok(true)
}

/// 收口释放槽（完成 / 失败）：删对应租约行，额度立即可复用
fn release_slot(conn: &Connection, host: &str, task_id: i64) -> AppResult<()> {
    conn.execute(
        "DELETE FROM dispatch_slots WHERE host_key=?1 AND task_id=?2",
        params![host, task_id],
    )?;
    Ok(())
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
    // 每轮开头回收过期槽租约（条目 5 / A6）：崩溃/被杀的派发留下的租约到期即扫掉
    {
        let conn = db.0.lock().unwrap();
        let n = reclaim_expired_slots(&conn)?;
        if n > 0 {
            log::info!("dispatch: 回收 {n} 条过期派发槽租约（A6 崩溃自愈）");
        }
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
        // 领取 = 上限检查 + claim + 占槽（同一事务，跨形态合计；条目 5）
        let lease_secs = slot_lease_secs(agent.timeout_secs);
        let acquired = {
            let conn = db.0.lock().unwrap();
            claim_with_slot(&conn, task_id, &hk, max_concurrent, lease_secs)?
        };
        if !acquired {
            continue;
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
                        let r = dispatch_transition_conn(
                            &conn,
                            task_id,
                            Some(DS_FAILED),
                            Some(&e.to_string()),
                            "dispatch-auto",
                        );
                        let _ = release_slot(&conn, &hk, task_id);
                        r
                    };
                    return;
                }
            };
            let title = prep.task.title.clone();
            let agent_name = prep.agent.name.clone();
            let out = run_headless_dispatch(&db, &prep, use_worktree).await;
            // 收口释放槽（完成/失败都删租约行，条目 5）
            {
                let conn = db.0.lock().unwrap();
                let _ = release_slot(&conn, &hk, task_id);
            }
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

    /// 条目 5：host_key 归一（dispatch_slots 的机器标识口径）——本机 'local'，
    /// 远程 'ssh:user@host[:port]'，空白 host 回落本机
    #[test]
    fn host_key_normalizes_local_and_ssh() {
        use crate::ai::AgentRemote;
        let local = AgentConfig::default();
        let blank_host = AgentConfig {
            remote: Some(AgentRemote {
                host: "   ".into(),
                port: 22,
                key_path: None,
                tunnel: None,
                persistent: false,
            }),
            ..Default::default()
        };
        let ssh = AgentConfig {
            remote: Some(AgentRemote {
                host: " vscode@localhost:1022 ".into(),
                port: 1022,
                key_path: None,
                tunnel: None,
                persistent: false,
            }),
            ..Default::default()
        };
        assert_eq!(host_key(&local), "local");
        assert_eq!(host_key(&blank_host), "local", "空白 host 视同本机");
        assert_eq!(
            host_key(&ssh),
            "ssh:vscode@localhost:1022",
            "去首尾空格，user@host[:port] 原样保留"
        );
    }

    /// 条目 5（A6）：槽表生命周期——上限闸门按 host 独立、领取与占槽原子、
    /// 收口释放额度复用、过期租约自动回收；租约时长 = 无头超时 + 5 分钟余量
    #[test]
    fn dispatch_slots_gate_concurrency_and_expire() {
        let conn = test_conn();
        for id in [1i64, 2] {
            conn.execute(
                "INSERT INTO tasks (id, title, status, dispatch_state, created_at)
                 VALUES (?1, 't', 'inbox', 'queued', '2026-09-13T00:00:00Z')",
                params![id],
            )
            .unwrap();
        }

        // 租约时长：无头超时 600 秒下限 + 300 秒余量（A6）
        assert_eq!(slot_lease_secs(30), 900, "短超时按下限 600 起算");
        assert_eq!(slot_lease_secs(1200), 1500, "长超时原样 + 余量");

        // 领取占槽：本机 max=1 槽满领不到（任务保持 queued），SSH 目标独立配额
        assert!(claim_with_slot(&conn, 1, "local", 1, 900).unwrap());
        assert!(
            !claim_with_slot(&conn, 2, "local", 1, 900).unwrap(),
            "本机槽满拒绝领取"
        );
        let state: String = conn
            .query_row("SELECT dispatch_state FROM tasks WHERE id=2", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(state, DS_QUEUED, "槽满时不动任务状态");
        assert!(
            claim_with_slot(&conn, 2, "ssh:u@h", 1, 900).unwrap(),
            "SSH 目标独立配额"
        );
        // running 中的任务不允许重复 claim（防重复派发，沿用 claim_dispatch 语义）
        assert!(
            !claim_with_slot(&conn, 1, "local", 2, 900).unwrap(),
            "running 不允许重复 claim"
        );
        let slots: i64 = conn
            .query_row("SELECT COUNT(*) FROM dispatch_slots", [], |r| r.get(0))
            .unwrap();
        assert_eq!(slots, 2, "两次成功领取各占一行槽");

        // 收口释放：额度立即可复用
        release_slot(&conn, "local", 1).unwrap();
        conn.execute("UPDATE tasks SET dispatch_state='queued' WHERE id=1", [])
            .unwrap();
        assert!(
            claim_with_slot(&conn, 1, "local", 1, 900).unwrap(),
            "释放后额度可复用"
        );

        // 过期回收：只扫掉到期租约，执行中的（租约未到）保留
        conn.execute(
            "UPDATE dispatch_slots SET lease_expires_at='2000-01-01T00:00:00+00:00'
             WHERE host_key='ssh:u@h'",
            [],
        )
        .unwrap();
        assert_eq!(reclaim_expired_slots(&conn).unwrap(), 1);
        let remain: i64 = conn
            .query_row("SELECT COUNT(*) FROM dispatch_slots", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remain, 1, "崩溃遗留的过期租约被回收，在途租约保留");
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
