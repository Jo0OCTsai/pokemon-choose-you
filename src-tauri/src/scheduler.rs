use crate::db::Db;
use crate::events;
use chrono::TimeZone;
use rusqlite::params;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

/// 每 20 秒扫描一次到期提醒：系统通知 + 事件推给桌宠窗口播放"敲门"动画
pub fn spawn_reminder_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            if let Err(e) = tick(&app) {
                log::warn!("reminder tick failed: {e}");
            }
            tokio::time::sleep(std::time::Duration::from_secs(20)).await;
        }
    });
}

/// 解析 RFC3339（带时区）或本地无时区格式（datetime-local）的时间字符串
fn parse_time(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    if let Ok(d) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(d.with_timezone(&chrono::Utc));
    }
    let naive = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M")
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S"))
        .ok()?;
    chrono::Local
        .from_local_datetime(&naive)
        .earliest()
        .map(|l| l.with_timezone(&chrono::Utc))
}

fn tick<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    let db = app.state::<Db>();
    // 提前量（分钟）与通知开关从设置读取
    let get = |k: &str| -> Option<String> {
        let conn = db.0.lock().unwrap();
        conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| {
            r.get::<_, String>(0)
        })
        .ok()
    };
    let lead_min: i64 = get("remind_ahead_minutes")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let notify_on = get("notifications_enabled")
        .map(|v| v != "false")
        .unwrap_or(true);
    // fresh start 设置在拿 Db 锁之前读齐（tick 后半段持有 conn 锁，再调 get 会死锁）
    let overdue_mode = get("overdue_mode").unwrap_or_else(|| "collapse".into());
    let fresh_start_last_run = get("fresh_start_last_run");
    let now = chrono::Utc::now() + chrono::Duration::minutes(lead_min);
    // SQL 预筛只是粗筛：datetime-local 存的是无时区本地时间，与 UTC RFC3339 字典序
    // 不可比（UTC+ 时区下本地字符串普遍偏大），窗口放宽一天，精确判断交给 parse_time
    let now_s = (now + chrono::Duration::days(1)).to_rfc3339();
    let conn = db.0.lock().unwrap();
    let due: Vec<(i64, String, String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT id, title, priority, remind_at FROM tasks
             WHERE reminded=0 AND remind_at IS NOT NULL AND remind_at <= ?1
               AND status IN ('inbox','scheduled','active','paused')",
        )?;
        let rows = stmt
            .query_map(params![now_s], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    for (id, title, priority, remind_at) in &due {
        // datetime-local 传入的是本地无时区时间，解析后与当前 UTC 比较
        let due_time = parse_time(remind_at);
        if due_time.is_none_or(|t| t > now) {
            continue;
        }
        conn.execute("UPDATE tasks SET reminded=1 WHERE id=?1", params![id])?;
        drop_later_notify(app, *id, title, priority, notify_on);
    }

    // ---- 逾期 fresh start：自动归草丛模式每天跑一次（反羞耻：不堆「羞耻墙」） ----
    if overdue_mode == "auto_grass" {
        let today_fs = chrono::Local::now().format("%Y-%m-%d").to_string();
        if fresh_start_last_run.as_deref() != Some(today_fs.as_str()) {
            let n = run_fresh_start(&conn, &today_fs);
            let _ = conn.execute(
                "INSERT INTO settings (key, value) VALUES ('fresh_start_last_run', ?1)
                 ON CONFLICT(key) DO UPDATE SET value=?1",
                params![today_fs],
            );
            if n > 0 {
                let _ = app.emit(crate::events::TASKS_CHANGED, ());
            }
        }
    }
    Ok(())
}

/// 逾期 fresh start（自动归草丛模式，反羞耻）：逾期未开始的路线任务清掉截止时间归回草丛，
/// 不删任务、不堆「羞耻墙」。返回归位条数。当天只跑一次由调用方的日期标记保证。
pub fn run_fresh_start(conn: &rusqlite::Connection, today: &str) -> usize {
    let ids: Vec<i64> = match conn
        .prepare(
            "SELECT id FROM tasks
             WHERE status='scheduled' AND due_at IS NOT NULL AND substr(due_at,1,10) < ?1
               AND started_at IS NULL",
        )
        .and_then(|mut stmt| {
            let rows = stmt.query_map(params![today], |r| r.get::<_, i64>(0))?;
            Ok(rows.flatten().collect::<Vec<_>>())
        }) {
        Ok(ids) => ids,
        Err(e) => {
            log::warn!("fresh-start: 读取逾期任务失败: {e}");
            return 0;
        }
    };
    let n = ids.len();
    for id in ids {
        let _ = conn.execute(
            "UPDATE tasks SET due_at=NULL, status='inbox', reminded=0 WHERE id=?1",
            params![id],
        );
        let _ = conn.execute(
            "INSERT INTO task_logs (task_id, action, field, old_value, new_value, origin, created_at)
             VALUES (?1, 'update', 'due_at', 'overdue', NULL, 'fresh-start', ?2)",
            params![id, crate::db::now()],
        );
    }
    if n > 0 {
        log::info!("fresh-start: {n} 只逾期的溜回草丛（清截止时间，不删任务）");
    }
    n
}

/// 按语言设置生成通知标题/正文（紧急与非紧急两档）
fn notification_text(lang: &str, urgent: bool, title: &str) -> (String, String) {
    match lang {
        "zh-Hant" => {
            if urgent {
                ("‼ 寶可夢來敲門".into(), format!("緊急任務提醒：{title}"))
            } else {
                ("🐾 寶可夢來敲門".into(), format!("別忘了：{title}"))
            }
        }
        "en" => {
            if urgent {
                ("‼ Pokemon Knock!".into(), format!("Urgent: {title}"))
            } else {
                ("🐾 Pokemon Knock!".into(), format!("Don't forget: {title}"))
            }
        }
        _ => {
            if urgent {
                ("‼ 宝可梦来敲门".into(), format!("紧急任务提醒：{title}"))
            } else {
                ("🐾 宝可梦来敲门".into(), format!("别忘了：{title}"))
            }
        }
    }
}

fn drop_later_notify<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    id: i64,
    title: &str,
    priority: &str,
    notify_on: bool,
) {
    let urgent = priority == "urgent" || priority == "high";
    if notify_on {
        let lang = crate::db::setting(app, "language").unwrap_or_default();
        let (title_str, body) = notification_text(&lang, urgent, title);
        let _ = app
            .notification()
            .builder()
            .title(title_str)
            .body(body)
            .show();
    }
    // 桌宠窗口收到后播放敲门/催促动画
    let _ = app.emit(
        events::TASK_REMINDER,
        serde_json::json!({ "id": id, "title": title, "urgent": urgent }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::test_conn;
    use crate::db::Db;
    use chrono::TimeZone;
    use rusqlite::Connection;
    use std::sync::Mutex;
    use tauri::Manager;

    // ---- parse_time：三种输入格式 ----

    #[test]
    fn parse_time_accepts_rfc3339_utc() {
        let t = parse_time("2026-09-12T08:30:00Z").unwrap();
        assert_eq!(
            t,
            chrono::Utc.with_ymd_and_hms(2026, 9, 12, 8, 30, 0).unwrap()
        );
    }

    #[test]
    fn parse_time_accepts_rfc3339_with_offset() {
        let t = parse_time("2026-09-12T16:30:00+08:00").unwrap();
        assert_eq!(
            t,
            chrono::Utc.with_ymd_and_hms(2026, 9, 12, 8, 30, 0).unwrap()
        );
    }

    #[test]
    fn parse_time_accepts_naive_local_formats() {
        let naive = chrono::NaiveDate::from_ymd_opt(2026, 9, 12)
            .unwrap()
            .and_hms_opt(16, 0, 0)
            .unwrap();
        let expect = chrono::Local
            .from_local_datetime(&naive)
            .earliest()
            .unwrap()
            .with_timezone(&chrono::Utc);
        assert_eq!(parse_time("2026-09-12T16:00").unwrap(), expect);
        assert_eq!(parse_time("2026-09-12T16:00:00").unwrap(), expect);
    }

    #[test]
    fn parse_time_rejects_garbage() {
        assert!(parse_time("").is_none());
        assert!(parse_time("not a time").is_none());
        assert!(parse_time("2026-13-45T99:99").is_none());
    }

    // ---- run_fresh_start：逾期自动归草丛 ----
    #[test]
    fn fresh_start_returns_overdue_unstarted_scheduled_to_grass() {
        let conn = crate::db::tests::test_conn();
        let ins = |title: &str, status: &str, due: Option<&str>, started: Option<&str>| {
            conn.execute(
                "INSERT INTO tasks (title, status, due_at, started_at, created_at)
                 VALUES (?1, ?2, ?3, ?4, '2026-09-01T00:00:00Z')",
                params![title, status, due, started],
            )
            .unwrap();
        };
        ins("逾期未动", "scheduled", Some("2026-09-10T09:00"), None); // 归位
        ins(
            "逾期但进行中",
            "scheduled",
            Some("2026-09-10T09:00"),
            Some("2026-09-09T08:00:00Z"),
        ); // 开始过：不动
        ins("逾期已开始", "active", Some("2026-09-10T09:00"), None); // active：不动（正在被照顾）
        ins("没逾期", "scheduled", Some("2026-09-20T09:00"), None); // 不动
        ins("草丛里的", "inbox", Some("2026-09-10T09:00"), None); // 已在草丛：不动

        let n = run_fresh_start(&conn, "2026-09-13");
        assert_eq!(n, 1, "只有「逾期未动」归位");
        let (status, due): (String, Option<String>) = conn
            .query_row(
                "SELECT status, due_at FROM tasks WHERE title='逾期未动'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "inbox");
        assert!(due.is_none(), "截止时间清空");
        let logs: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_logs WHERE origin='fresh-start' AND field='due_at'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(logs, 1, "归位写审计日志");
        // 再跑一次是 no-op
        assert_eq!(run_fresh_start(&conn, "2026-09-13"), 0);
    }

    // ---- notification_text：三语 × 紧急/普通 ----

    #[test]
    fn notification_text_per_language_and_urgency() {
        let (t, b) = notification_text("zh-Hans", true, "交报告");
        assert_eq!(t, "‼ 宝可梦来敲门");
        assert_eq!(b, "紧急任务提醒：交报告");
        let (t, _) = notification_text("zh-Hans", false, "交报告");
        assert_eq!(t, "🐾 宝可梦来敲门");
        let (t, b) = notification_text("zh-Hant", false, "交報告");
        assert_eq!(t, "🐾 寶可夢來敲門");
        assert_eq!(b, "別忘了：交報告");
        let (t, b) = notification_text("en", true, "report");
        assert_eq!(t, "‼ Pokemon Knock!");
        assert_eq!(b, "Urgent: report");
        // 未知语言回退简体
        let (t, _) = notification_text("fr", false, "x");
        assert_eq!(t, "🐾 宝可梦来敲门");
    }

    // ---- tick：mock 运行时 + 内存库 ----

    fn insert_task(conn: &Connection, title: &str, status: &str, remind_at: &str) -> i64 {
        conn.execute(
            "INSERT INTO tasks (title, status, remind_at, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![title, status, remind_at, "2026-09-01T00:00:00Z"],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn is_reminded(conn: &Connection, id: i64) -> bool {
        conn.query_row("SELECT reminded FROM tasks WHERE id=?1", params![id], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap()
            != 0
    }

    fn tick_app(app: &tauri::App<tauri::test::MockRuntime>) {
        tick(app.handle()).expect("tick");
    }

    #[test]
    fn tick_reminds_past_due_task() {
        let app = tauri::test::mock_app();
        let conn = test_conn();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('notifications_enabled', 'false')",
            [],
        )
        .unwrap();
        let id = insert_task(
            &conn,
            "过期提醒",
            "scheduled",
            &(chrono::Utc::now() - chrono::Duration::hours(1)).to_rfc3339(),
        );
        app.manage(Db(Mutex::new(conn)));
        tick_app(&app);
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        assert!(is_reminded(&conn, id));
    }

    #[test]
    fn tick_skips_future_and_done_tasks() {
        let app = tauri::test::mock_app();
        let conn = test_conn();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('notifications_enabled', 'false')",
            [],
        )
        .unwrap();
        let future = insert_task(
            &conn,
            "未来",
            "scheduled",
            &(chrono::Utc::now() + chrono::Duration::hours(2)).to_rfc3339(),
        );
        let done = insert_task(
            &conn,
            "已完成",
            "done",
            &(chrono::Utc::now() - chrono::Duration::hours(1)).to_rfc3339(),
        );
        app.manage(Db(Mutex::new(conn)));
        tick_app(&app);
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        assert!(!is_reminded(&conn, future));
        assert!(!is_reminded(&conn, done), "done 任务不再提醒");
    }

    /// 回归：UTC+ 时区下 datetime-local（无时区）字符串字典序大于 UTC RFC3339，
    /// SQL 预筛窗口必须放宽，否则本地晚上设置的提醒最多延迟一个时区差才触发
    #[test]
    fn tick_reminds_naive_local_past_due() {
        let app = tauri::test::mock_app();
        let conn = test_conn();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('notifications_enabled', 'false')",
            [],
        )
        .unwrap();
        let naive = (chrono::Local::now() - chrono::Duration::hours(1))
            .format("%Y-%m-%dT%H:%M")
            .to_string();
        let id = insert_task(&conn, "本地时间提醒", "scheduled", &naive);
        app.manage(Db(Mutex::new(conn)));
        tick_app(&app);
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        assert!(is_reminded(&conn, id), "无时区本地格式且已过期应触发提醒");
    }

    #[test]
    fn tick_remind_ahead_minutes_advances_due_time() {
        let app = tauri::test::mock_app();
        let conn = test_conn();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('notifications_enabled', 'false')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('remind_ahead_minutes', '30')",
            [],
        )
        .unwrap();
        // 20 分钟后到期：提前量 30 分钟应视为已到期
        let soon = (chrono::Utc::now() + chrono::Duration::minutes(20)).to_rfc3339();
        let id = insert_task(&conn, "即将到期", "scheduled", &soon);
        app.manage(Db(Mutex::new(conn)));
        tick_app(&app);
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        assert!(is_reminded(&conn, id));
    }

    #[test]
    fn tick_no_tasks_is_noop() {
        let app = tauri::test::mock_app();
        let conn = test_conn();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('notifications_enabled', 'false')",
            [],
        )
        .unwrap();
        app.manage(Db(Mutex::new(conn)));
        tick_app(&app); // 不应 panic
    }
}
