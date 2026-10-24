//! 主应用侧外部变更侦听（specs/dsh-plugin §5.5 / §7.1 条目 7，A17）：
//! 前端只刷新自家命令触发的 events 广播——pk / dsh 插件等外部进程写库进不了
//! 这条链（GUI 不刷新的现行缺口）。这里以 2 秒间隔对库跑一次合取单查询
//! （变更标记：task_logs 水位 + active 聚合 + 各表计数，亚毫秒级，复用 Db Mutex），
//! 标记与上次不同 → 广播既有 events → 前端既有监听链刷新（前端零改动）。
//! 自家命令写库本就即时广播过：events::broadcast 内联刷新侦听器基线，
//! 自家写入不会被下轮轮询重复广播（防自触发风暴）。
use crate::db::Db;
use crate::error::AppResult;
use crate::events;
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::Manager;

/// 轮询间隔（秒）＝ 跨形态可见性延迟上界（远优于 FR-T5 的 10 秒阈值，A17）
const POLL_INTERVAL_SECS: u64 = 2;

/// 侦听器基线（managed state；单实例进程一份，测试各自 mock app 天然隔离）
pub struct ChangeWatchState(pub Mutex<Option<ChangeMarker>>);

/// 变更标记：六路计数的合取单查询结果，任一路变化即视为库被写过
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChangeMarker {
    task_log_max_id: i64,
    active_tasks: i64,
    chat_messages: i64,
    tags: i64,
    categories: i64,
    settings: i64,
}

/// 一次连接内读出全量变更标记（条目 7 指定口径的合取单查询）
pub(crate) fn read_marker(conn: &Connection) -> AppResult<ChangeMarker> {
    conn.query_row(
        "SELECT COALESCE((SELECT MAX(id) FROM task_logs), 0),
                (SELECT COUNT(*) FROM tasks WHERE status='active'),
                (SELECT COUNT(*) FROM chat_messages),
                (SELECT COUNT(*) FROM tags),
                (SELECT COUNT(*) FROM categories),
                (SELECT COUNT(*) FROM settings)",
        [],
        |r| {
            Ok(ChangeMarker {
                task_log_max_id: r.get(0)?,
                active_tasks: r.get(1)?,
                chat_messages: r.get(2)?,
                tags: r.get(3)?,
                categories: r.get(4)?,
                settings: r.get(5)?,
            })
        },
    )
    .map_err(crate::error::AppError::Db)
}

/// 标记差分 → 需要广播的事件（按表对应，避免无关事件刷前端）
fn marker_events(old: &ChangeMarker, new: &ChangeMarker) -> Vec<&'static str> {
    let mut evs = vec![];
    if old.task_log_max_id != new.task_log_max_id || old.active_tasks != new.active_tasks {
        evs.push(events::TASKS_CHANGED);
    }
    if old.chat_messages != new.chat_messages {
        evs.push(events::CHAT_MESSAGES_CHANGED);
    }
    if old.tags != new.tags {
        evs.push(events::TAGS_CHANGED);
    }
    if old.categories != new.categories {
        evs.push(events::CATEGORIES_CHANGED);
    }
    if old.settings != new.settings {
        evs.push(events::SETTINGS_CHANGED);
    }
    evs
}

/// 自家广播后的基线刷新（events::broadcast 调用）：把基线推到当前库状态——
/// 自家命令写库不会在下个轮询被重复广播。任一状态缺失（测试 mock 未挂）或
/// Db 锁被占（调用方持锁广播的病态路径）时静默跳过，至多多一轮重复广播
pub(crate) fn refresh_baseline<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let (Some(db), Some(state)) = (app.try_state::<Db>(), app.try_state::<ChangeWatchState>())
    else {
        return;
    };
    let Ok(conn) = db.0.try_lock() else {
        return;
    };
    let Ok(marker) = read_marker(&conn) else {
        return;
    };
    drop(conn);
    let locked = state.0.try_lock();
    if let Ok(mut st) = locked {
        *st = Some(marker);
    }
}

/// 侦听循环挂载（lib.rs setup）：与插件侧同款 ≤2 秒轮询，一侧落地即两形态互见
pub fn spawn_change_watcher<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        loop {
            watch_tick(&app);
            tokio::time::sleep(std::time::Duration::from_secs(POLL_INTERVAL_SECS)).await;
        }
    });
}

/// 单轮：读标记 → 与基线差分 → 有差先更新基线（锁内）再广播（锁外——broadcast
/// 会内联回调 refresh_baseline 拿状态锁，先释放避免互锁）
fn watch_tick<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let db = app.state::<Db>();
    let marker = {
        let conn = db.0.lock().unwrap();
        match read_marker(&conn) {
            Ok(m) => m,
            Err(e) => {
                log::warn!("watcher: 变更标记读取失败: {e}");
                return;
            }
        }
    };
    let state = app.state::<ChangeWatchState>();
    let evs = {
        let mut st = state.0.lock().unwrap();
        match *st {
            // 首轮只建基线（启动前的历史写入不触发广播）
            None => {
                *st = Some(marker);
                vec![]
            }
            Some(prev) if prev != marker => {
                let evs = marker_events(&prev, &marker);
                *st = Some(marker);
                evs
            }
            _ => vec![],
        }
    };
    for ev in evs {
        log::info!("watcher: 检测到外部进程写入（dsh / pk），广播刷新: {ev}");
        events::broadcast(app, ev);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::windows::PendingMainReopen;
    use crate::db::tests::test_conn;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tauri::Listener;

    fn setup() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(Db(Mutex::new(test_conn())));
        app.manage(ChangeWatchState(Mutex::new(None)));
        app.manage(PendingMainReopen(std::sync::atomic::AtomicBool::new(false)));
        app
    }

    /// 标记差分 → 事件映射：各表对应、任务双信号（水位/active）合并、无差不广播
    #[test]
    fn marker_events_map_table_changes_to_events() {
        let base = ChangeMarker {
            task_log_max_id: 1,
            active_tasks: 0,
            chat_messages: 0,
            tags: 0,
            categories: 0,
            settings: 0,
        };
        assert!(marker_events(&base, &base).is_empty(), "无差不广播");
        let bump = |m: &ChangeMarker, f: fn(&mut ChangeMarker)| {
            let mut n = *m;
            f(&mut n);
            n
        };
        assert_eq!(
            marker_events(&base, &bump(&base, |m| m.task_log_max_id += 1)),
            vec![events::TASKS_CHANGED]
        );
        assert_eq!(
            marker_events(&base, &bump(&base, |m| m.active_tasks += 1)),
            vec![events::TASKS_CHANGED]
        );
        assert_eq!(
            marker_events(&base, &bump(&base, |m| m.chat_messages += 1)),
            vec![events::CHAT_MESSAGES_CHANGED]
        );
        assert_eq!(
            marker_events(&base, &bump(&base, |m| m.tags += 1)),
            vec![events::TAGS_CHANGED]
        );
        assert_eq!(
            marker_events(&base, &bump(&base, |m| m.categories += 1)),
            vec![events::CATEGORIES_CHANGED]
        );
        assert_eq!(
            marker_events(&base, &bump(&base, |m| m.settings += 1)),
            vec![events::SETTINGS_CHANGED]
        );
    }

    /// 行为闭环（条目 7 能力新增）：首轮建基线不广播；外部进程写入（模拟 dsh/pk 直写
    /// 库）→ 下一轮广播对应事件；无后续写入不再重复；自家 events::broadcast 后基线
    /// 已刷新——紧随其后的自家写入不会被重复广播（防自触发风暴）
    #[test]
    fn watch_tick_broadcasts_external_writes_and_absorbs_self_broadcasts() {
        let app = setup();
        let hits = Arc::new(AtomicUsize::new(0));
        {
            let hits = hits.clone();
            app.listen(events::TASKS_CHANGED, move |_e| {
                hits.fetch_add(1, Ordering::SeqCst);
            });
        }
        // 首轮：建基线，无广播
        watch_tick(app.handle());
        assert_eq!(hits.load(Ordering::SeqCst), 0);

        // 模拟外部进程写入（dsh / pk：不经自家命令，只动库）
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO tasks (title, status, created_at) VALUES ('外部写的', 'inbox', '2026-10-11T00:00:00Z')",
                [],
            )
            .unwrap();
            crate::commands::tasks::log_change(
                &conn,
                conn.last_insert_rowid(),
                "create",
                "title",
                None,
                Some("外部写的"),
                "dsh",
            )
            .unwrap();
        }
        watch_tick(app.handle());
        assert_eq!(hits.load(Ordering::SeqCst), 1, "外部写入触发一次广播");
        watch_tick(app.handle());
        assert_eq!(
            hits.load(Ordering::SeqCst),
            1,
            "基线已更新，无新写入不再广播"
        );

        // 自家路径：broadcast 内联刷新基线 → 同一写入不被下轮重复广播
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO tasks (title, status, created_at) VALUES ('自家写的', 'inbox', '2026-10-11T00:01:00Z')",
                [],
            )
            .unwrap();
        }
        events::broadcast(app.handle(), events::TASKS_CHANGED);
        assert_eq!(
            hits.load(Ordering::SeqCst),
            2,
            "自家 broadcast 本身照常送达"
        );
        watch_tick(app.handle());
        assert_eq!(
            hits.load(Ordering::SeqCst),
            2,
            "自家写入已被基线刷新吸收，不重复广播"
        );
    }
}
