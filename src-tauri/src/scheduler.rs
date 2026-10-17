use crate::db::Db;
use crate::events;
use rusqlite::params;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

/// 每 20 秒扫描一次到期提醒：到期先聚合（多条只发一条）、过勿扰滤网，再双通道送达
/// （系统通知 + 事件推给桌宠窗口播放"敲门"动画，两通道同受通知开关控制）
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
///（提醒循环与自动派发排队共用的混排时间判定；本地时区按宿主 Local）
pub(crate) fn parse_time(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    parse_time_in(&chrono::Local, s)
}

/// parse_time 的时区参数化形态（P1 抽取）：datetime-local 按 tz 解析；
/// RFC3339 自带偏移不受 tz 影响。桌面 tick 传 Local，契约 oracle 传场景时区。
pub(crate) fn parse_time_in<Tz: chrono::TimeZone>(
    tz: &Tz,
    s: &str,
) -> Option<chrono::DateTime<chrono::Utc>> {
    if let Ok(d) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(d.with_timezone(&chrono::Utc));
    }
    let naive = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M")
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S"))
        .ok()?;
    tz.from_local_datetime(&naive)
        .earliest()
        .map(|l| l.with_timezone(&chrono::Utc))
}

/// 提醒决策的设置快照（tick 一次读齐后传给纯决策函数；缺省值与设置面一致）
#[derive(Debug, Clone)]
pub(crate) struct ReminderSettings {
    /// 提前量（分钟）：到期判定用它把「现在」前移
    pub(crate) lead_minutes: i64,
    /// 通知开关（系统通知与桌宠事件同受它控制）
    pub(crate) notify_on: bool,
    /// 勿扰开关：时段内静默非紧急提醒（紧急仍敲门）；边界解析失败视为关闭（fail open）
    pub(crate) quiet_on: bool,
    pub(crate) quiet_start: String,
    pub(crate) quiet_end: String,
    pub(crate) lang: String,
}

impl ReminderSettings {
    /// 从 settings 表读齐提醒决策相关键（P1 抽取：tick 与契约 oracle 共用同一读取口径）
    pub(crate) fn from_conn(conn: &rusqlite::Connection) -> ReminderSettings {
        let get = |k: &str| -> Option<String> {
            conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| {
                r.get::<_, String>(0)
            })
            .ok()
        };
        ReminderSettings {
            lead_minutes: get("remind_ahead_minutes")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
            notify_on: get("notifications_enabled")
                .map(|v| v != "false")
                .unwrap_or(true),
            quiet_on: get("quiet_hours_enabled")
                .map(|v| v != "false")
                .unwrap_or(true),
            quiet_start: get("quiet_start").unwrap_or_else(|| "22:00".into()),
            quiet_end: get("quiet_end").unwrap_or_else(|| "08:00".into()),
            lang: get("language").unwrap_or_else(|| "zh-Hans".into()),
        }
    }
}

/// SQL 粗筛的到期候选行（精确判定前；datetime-local 与 RFC3339 混排都在 remind_at 里）
#[derive(Debug, Clone)]
pub(crate) struct DueRow {
    pub(crate) id: i64,
    pub(crate) title: String,
    pub(crate) priority: String,
    pub(crate) remind_at: String,
    pub(crate) pokemon: Option<String>,
}

/// 到期粗筛（SQL，P1 抽取）：datetime-local 存的是无时区本地时间，与 UTC RFC3339
/// 字典序不可比（UTC+ 时区下本地字符串普遍偏大），窗口放宽一天，精确判断交给 due_precise
pub(crate) fn query_due_rows(
    conn: &rusqlite::Connection,
    now_s: &str,
) -> Result<Vec<DueRow>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.title, t.priority, t.remind_at, c.pokemon FROM tasks t
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.reminded=0 AND t.remind_at IS NOT NULL AND t.remind_at <= ?1
           AND t.status IN ('inbox','scheduled','active','paused')",
    )?;
    let rows = stmt
        .query_map(params![now_s], |r| {
            Ok(DueRow {
                id: r.get(0)?,
                title: r.get(1)?,
                priority: r.get(2)?,
                remind_at: r.get(3)?,
                pokemon: r.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// 到期精判（纯函数，P1 抽取）：混排时间解析（RFC3339 直接转 UTC；datetime-local
/// 按 tz 解析），解析失败或未到期的行跳过（原 tick 内联逻辑原样抽出，行为零变化）
pub(crate) fn due_precise<Tz: chrono::TimeZone>(
    tz: &Tz,
    rows: &[DueRow],
    now: chrono::DateTime<chrono::Utc>,
) -> Vec<Reminder> {
    rows.iter()
        .filter(|r| parse_time_in(tz, &r.remind_at).is_some_and(|t| t <= now))
        .map(|r| Reminder {
            id: r.id,
            title: r.title.clone(),
            priority: r.priority.clone(),
            pokemon: r.pokemon.clone(),
        })
        .collect()
}

/// 抢占送达权（P2 · D28 双形态仲裁）：BEGIN IMMEDIATE 内逐条
/// `UPDATE tasks SET reminded=1 WHERE id=? AND reminded=0`——
/// affected=1 → 抢到（本形态送达）；affected=0 → 后到让位（另一形态已送达）。
/// 返回抢到的子集（保持入参顺序）。单形态下守卫恒真，行为与无守卫版一致。
pub(crate) fn claim_reminded(
    conn: &rusqlite::Connection,
    due: &[Reminder],
) -> Result<Vec<Reminder>, rusqlite::Error> {
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let mark = || -> Result<Vec<Reminder>, rusqlite::Error> {
        let mut fired = Vec::new();
        for r in due {
            let n = conn.execute(
                "UPDATE tasks SET reminded=1 WHERE id=?1 AND reminded=0",
                params![r.id],
            )?;
            if n == 1 {
                fired.push(r.clone());
            }
        }
        Ok(fired)
    };
    match mark() {
        Ok(fired) => {
            conn.execute_batch("COMMIT")?;
            Ok(fired)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

/// 桌宠事件载荷（决策的一部分；tick 侧负责 emit 给桌宠窗口播敲门/催促动画）
#[derive(Debug, Clone)]
pub(crate) struct PetReminderEvent {
    pub(crate) id: i64,
    pub(crate) title: String,
    pub(crate) urgent: bool,
    pub(crate) pokemon: Option<String>,
}

/// 送达决策（纯函数输出，P1 抽取）
#[derive(Debug)]
pub(crate) struct DeliveryDecision {
    /// 当前时刻是否在勿扰时段内
    pub(crate) quiet: bool,
    /// 勿扰静默掉的非紧急条数（已抢到标记但不送达、不补发）
    pub(crate) silenced: usize,
    /// 送达集（勿扰滤网后）
    pub(crate) deliver: Vec<Reminder>,
    /// 系统通知文案（通知开且送达集非空才有）
    pub(crate) notification: Option<(String, String)>,
    /// 桌宠事件载荷（与系统通知同门控）
    pub(crate) pet: Option<PetReminderEvent>,
}

/// 送达决策（纯函数，无 IO；入参 = 设置快照 + 抢到送达权的到期集 + 当前本地时刻）：
/// 单条原样；多条聚合（点名前 3 + 等 N 项，任一紧急整体 ‼ 前缀）；勿扰时段内非紧急
/// 静默（紧急例外仍敲门）；通知关闭时系统通知与桌宠事件都不发。
pub(crate) fn decide_delivery(
    settings: &ReminderSettings,
    claimed: &[Reminder],
    now_local: chrono::NaiveTime,
) -> DeliveryDecision {
    // 勿扰判定：解析失败视为关闭（fail open，宁可多提醒也不静默丢事）
    let quiet = settings.quiet_on
        && parse_hm(&settings.quiet_start)
            .zip(parse_hm(&settings.quiet_end))
            .is_some_and(|(s, e)| in_quiet_hours(now_local, s, e));
    let mut deliver = claimed.to_vec();
    if quiet {
        deliver.retain(|r| r.urgent());
    }
    let silenced = claimed.len() - deliver.len();
    // 注意力友好：一次只强调一件事——单条原样、多条聚合成一条；桌宠只敲一次门
    //（代表选紧急优先）。通知关闭时两通道都不发。
    let (notification, pet) = if deliver.is_empty() || !settings.notify_on {
        (None, None)
    } else if deliver.len() == 1 {
        let r = &deliver[0];
        let (title, body) =
            notification_text(&settings.lang, r.urgent(), &r.title, r.pokemon.as_deref());
        (Some((title, body)), Some(pet_event_of(r)))
    } else {
        let any_urgent = deliver.iter().any(|r| r.urgent());
        let titles: Vec<&str> = deliver.iter().map(|r| r.title.as_str()).collect();
        let (title, body) = aggregated_notification_text(&settings.lang, &titles, any_urgent);
        let repr = deliver.iter().find(|r| r.urgent()).unwrap_or(&deliver[0]);
        (Some((title, body)), Some(pet_event_of(repr)))
    };
    DeliveryDecision {
        quiet,
        silenced,
        deliver,
        notification,
        pet,
    }
}

fn pet_event_of(r: &Reminder) -> PetReminderEvent {
    PetReminderEvent {
        id: r.id,
        title: r.title.clone(),
        urgent: r.urgent(),
        pokemon: r.pokemon.clone(),
    }
}

fn tick<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap();
    // 设置一次读齐（同一连接上直查，不再逐键加锁）；后半段 fresh start / 复盘键同窗读取
    let get = |k: &str| -> Option<String> {
        conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| {
            r.get::<_, String>(0)
        })
        .ok()
    };
    let settings = ReminderSettings::from_conn(&conn);
    let overdue_mode = get("overdue_mode").unwrap_or_else(|| "collapse".into());
    let fresh_start_last_run = get("fresh_start_last_run");
    let review_enabled = get("review_enabled").map(|v| v != "false").unwrap_or(true);
    let review_dow: u32 = get("review_dow").and_then(|v| v.parse().ok()).unwrap_or(1);
    let review_last_notified = get("review_last_notified");
    let now = chrono::Utc::now() + chrono::Duration::minutes(settings.lead_minutes);
    let now_s = (now + chrono::Duration::days(1)).to_rfc3339();
    let due_rows = query_due_rows(&conn, &now_s)?;
    let due = due_precise(&chrono::Local, &due_rows, now);
    let fired = claim_reminded(&conn, &due)?;
    let decision = decide_delivery(&settings, &fired, chrono::Local::now().time());
    if decision.silenced > 0 {
        log::info!(
            "quiet hours {}-{}: {} 条非紧急提醒静默",
            settings.quiet_start,
            settings.quiet_end,
            decision.silenced
        );
    }
    deliver_reminders(app, &decision);

    // ---- 逾期 fresh start：自动归草丛模式每天跑一次（反羞耻：不堆「羞耻墙」） ----
    if overdue_mode == "auto_grass" {
        let today_fs = chrono::Local::now().format("%Y-%m-%d").to_string();
        // 当日去重（P2 CAS）：旧值快查 + 当日键抢占——双形态同窗只跑一次
        if fresh_start_last_run.as_deref() != Some(today_fs.as_str())
            && crate::db::claim_daily_key(&conn, "fresh_start_last_run", &today_fs)
        {
            let n = run_fresh_start(&conn, &today_fs);
            if n > 0 {
                let _ = app.emit(crate::events::TASKS_CHANGED, ());
                // 温和告知（反羞耻：溜回去不是失败，想好了再去看）；勿扰时段内不打扰
                if settings.notify_on && !decision.quiet {
                    let (fs_title, fs_body) = fresh_start_notification_text(&settings.lang, n);
                    let _ = app
                        .notification()
                        .builder()
                        .title(fs_title)
                        .body(fs_body)
                        .show();
                }
            }
        }
    }

    // ---- 每周复盘提醒：到设定星期当天提醒一次（主流任务应用没有的 OmniFocus 式空位） ----
    let today_local = chrono::Local::now();
    let today = today_local.format("%Y-%m-%d").to_string();
    let due_today = review_due(
        review_enabled,
        review_dow,
        today_local
            .format("%u")
            .to_string()
            .parse::<u32>()
            .unwrap_or(1), // %u：周一=1…周日=7
        review_last_notified.as_deref(),
        &today,
    );
    // 当日去重（P2 CAS）：抢到 review_last_notified 当日键才有送达权
    if due_today && crate::db::claim_daily_key(&conn, "review_last_notified", &today) {
        let (caught, focus_min) = week_stats(&conn);
        let (title, body) = review_notification_text(&settings.lang, caught, focus_min);
        log::info!("review: 每周复盘提醒已发送");
        if settings.notify_on && !decision.quiet {
            let _ = app.notification().builder().title(title).body(body).show();
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

/// 每周复盘提醒决策（独立出来便于测试）：
/// 开启 + 今天是设定星期（1=周一…7=周日）+ 今天还没提醒过
fn review_due(
    enabled: bool,
    review_dow: u32,
    today_dow: u32,
    last_notified: Option<&str>,
    today: &str,
) -> bool {
    enabled && today_dow == review_dow && last_notified != Some(today)
}

/// 本周捕捉数与专注分钟（近 7 天完成口径，与训练家复盘向导一致）
fn week_stats(conn: &rusqlite::Connection) -> (usize, i64) {
    match conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(focus_seconds), 0) / 60 FROM tasks
         WHERE status='done' AND datetime(completed_at) >= datetime('now', '-7 days')",
        [],
        |r| Ok((r.get::<_, i64>(0)? as usize, r.get::<_, i64>(1)?)),
    ) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("review: 统计本周捕捉失败（通知降级为不带数字）: {e}");
            (0, 0)
        }
    }
}

/// 复盘提醒文案（三语，带本周战绩）
fn review_notification_text(lang: &str, caught: usize, focus_min: i64) -> (String, String) {
    match lang {
        "zh-Hant" => (
            "🧢 訓練家複盤".into(),
            format!("本週捕捉 {caught} 隻、專注 {focus_min} 分鐘——到圖鑑頁點「複盤」逐站整理路線與草叢"),
        ),
        "en" => (
            "🧢 Trainer review".into(),
            format!("{caught} caught, {focus_min} focus min this week — open the Dex tab and run the review"),
        ),
        _ => (
            "🧢 训练家复盘".into(),
            format!("本周捕捉 {caught} 只、专注 {focus_min} 分钟——到图鉴页点「复盘」逐站整理路线与草丛"),
        ),
    }
}

/// 逾期归草丛的温和告知（三语；反羞耻语气：溜回去不是失败）
fn fresh_start_notification_text(lang: &str, n: usize) -> (String, String) {
    match lang {
        "zh-Hant" => (
            "🐾 有寶可夢溜回草叢".into(),
            format!("{n} 隻逾期的小傢伙回了草叢——想好了再去看，不急"),
        ),
        "en" => (
            "🐾 Some Pokemon slipped back".into(),
            format!("{n} overdue friends returned to the grass — visit when you're ready"),
        ),
        _ => (
            "🐾 有宝可梦溜回草丛".into(),
            format!("{n} 只逾期的小家伙回了草丛——想好了再去看，不急"),
        ),
    }
}

/// 按语言设置生成通知标题/正文（紧急与非紧急两档）；body 附分类宝可梦名（有则拼尾）
fn notification_text(
    lang: &str,
    urgent: bool,
    title: &str,
    pokemon: Option<&str>,
) -> (String, String) {
    // 主体带宝可梦后缀：交报告（皮卡丘）
    let subject = match pokemon {
        Some(p) if lang == "en" => format!("{title} ({p})"),
        Some(p) => format!("{title}（{p}）"),
        None => title.to_string(),
    };
    match lang {
        "zh-Hant" => {
            if urgent {
                (
                    "‼ 訓練家，快看快看！".into(),
                    format!("緊急任務提醒：{subject}"),
                )
            } else {
                ("🐾 訓練家，別忘了".into(), subject.to_string())
            }
        }
        "en" => {
            if urgent {
                (
                    "‼ Trainer, quick look!".into(),
                    format!("Urgent: {subject}"),
                )
            } else {
                ("🐾 Trainer, don't forget".into(), subject.to_string())
            }
        }
        _ => {
            if urgent {
                (
                    "‼ 训练家，快看快看！".into(),
                    format!("紧急任务提醒：{subject}"),
                )
            } else {
                ("🐾 训练家，别忘了".into(), subject.to_string())
            }
        }
    }
}

/// 一条到期提醒（送达用：标题 + 优先级 + 分类宝可梦）
#[derive(Debug, Clone)]
pub(crate) struct Reminder {
    pub(crate) id: i64,
    pub(crate) title: String,
    pub(crate) priority: String,
    pub(crate) pokemon: Option<String>,
}

impl Reminder {
    /// 紧急档（urgent/high）：更强的提醒文案，且不受勿扰时段约束
    pub(crate) fn urgent(&self) -> bool {
        self.priority == "urgent" || self.priority == "high"
    }
}

/// 到期提醒的送达（IO 侧，消费纯决策结果）：
/// 注意力友好：一次只强调一件事——单条原样送达；多条聚合为一条系统通知、
/// 桌宠只敲一次门（代表选紧急优先，气泡带就近「完成/推迟」，其余几条去冒险页看）。
/// 通知与桌宠事件的门控都在 decide_delivery 里算好，这里只负责发。
fn deliver_reminders<R: tauri::Runtime>(app: &tauri::AppHandle<R>, decision: &DeliveryDecision) {
    if let Some((title, body)) = &decision.notification {
        log::info!(
            "reminder: {} 条到期聚合成一条通知送达",
            decision.deliver.len()
        );
        let _ = app.notification().builder().title(title).body(body).show();
    }
    // 桌宠窗口收到后播放敲门/催促动画（pokemon 附带分类宝可梦名，供气泡文案个性化）
    if let Some(pet) = &decision.pet {
        let _ = app.emit(
            events::TASK_REMINDER,
            serde_json::json!({
                "id": pet.id, "title": pet.title, "urgent": pet.urgent, "pokemon": pet.pokemon
            }),
        );
    }
}

/// 聚合通知文案（三语）：N 只宝可梦同时敲门，点名前几条，其余到冒险页看
fn aggregated_notification_text(lang: &str, titles: &[&str], any_urgent: bool) -> (String, String) {
    let n = titles.len();
    let sep = if lang == "en" { ", " } else { "、" };
    let shown = titles.iter().take(3).copied().collect::<Vec<_>>().join(sep);
    let badge = if any_urgent { "‼" } else { "🐾" };
    match lang {
        "zh-Hant" => {
            let detail = if n > 3 {
                format!("{shown} 等 {n} 項")
            } else {
                shown
            };
            (
                format!("{badge} {n} 隻寶可夢同時敲門！"),
                format!("點名：{detail}——到冒險頁逐隻看看"),
            )
        }
        "en" => {
            let detail = if n > 3 {
                format!("{shown} and more")
            } else {
                shown
            };
            (
                format!("{badge} {n} Pokemon knocking at once!"),
                format!("{detail} are due — check the Adventure list"),
            )
        }
        _ => {
            let detail = if n > 3 {
                format!("{shown} 等 {n} 项")
            } else {
                shown
            };
            (
                format!("{badge} {n} 只宝可梦同时敲门！"),
                format!("点名：{detail}——到冒险页逐只看看"),
            )
        }
    }
}

/// "HH:MM" → NaiveTime（设置里的勿扰边界）
fn parse_hm(s: &str) -> Option<chrono::NaiveTime> {
    chrono::NaiveTime::parse_from_str(s, "%H:%M").ok()
}

/// 勿扰时段判定：start==end 视为关闭；支持跨零点区间（如 22:00–08:00）
fn in_quiet_hours(
    now: chrono::NaiveTime,
    start: chrono::NaiveTime,
    end: chrono::NaiveTime,
) -> bool {
    if start == end {
        return false;
    }
    if start < end {
        now >= start && now < end
    } else {
        now >= start || now < end
    }
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

    // ---- review_due：每周复盘提醒决策 ----
    #[test]
    fn review_due_fires_once_on_configured_weekday() {
        // 周三(3)、设定周三：开启且未提醒过 → 触发
        assert!(review_due(true, 3, 3, None, "2026-09-13"));
        // 已提醒过 → 当天不再触发
        assert!(!review_due(true, 3, 3, Some("2026-09-13"), "2026-09-13"));
        // 其他天 / 关闭开关 → 不触发
        assert!(!review_due(true, 3, 4, None, "2026-09-13"));
        assert!(!review_due(false, 3, 3, None, "2026-09-13"));
        // 周日 = 7（ISO %u 约定）
        assert!(review_due(true, 7, 7, None, "2026-09-13"));
    }

    #[test]
    fn review_notification_text_covers_three_languages() {
        let (t, b) = review_notification_text("zh-Hans", 3, 95);
        assert!(t.contains("复盘") && b.contains("草丛"));
        assert!(
            b.contains("3 只") && b.contains("95 分钟"),
            "带本周战绩: {b}"
        );
        let (t, b) = review_notification_text("zh-Hant", 1, 0);
        assert!(t.contains("複盤") && b.contains("1 隻"));
        let (t, b) = review_notification_text("en", 2, 30);
        assert!(t.contains("review") && b.contains("2 caught") && b.len() > 10);
    }

    #[test]
    fn fresh_start_notification_text_is_gentle() {
        let (t, b) = fresh_start_notification_text("zh-Hans", 2);
        assert!(t.contains("草丛") && b.contains("2 只") && !b.contains("失败"));
        let (t, b) = fresh_start_notification_text("zh-Hant", 1);
        assert!(t.contains("草叢") && b.contains("1 隻"));
        let (_, b) = fresh_start_notification_text("en", 3);
        assert!(b.contains("3 overdue"));
    }

    #[test]
    fn week_stats_counts_done_within_seven_days() {
        let conn = crate::db::tests::test_conn();
        let now = chrono::Utc::now();
        for (i, days_ago) in [0, 3, 6, 8].iter().enumerate() {
            conn.execute(
                "INSERT INTO tasks (title, status, created_at, completed_at, focus_seconds)
                 VALUES (?1, 'done', ?2, ?2, ?3)",
                rusqlite::params![
                    format!("t{i}"),
                    (now - chrono::Duration::days(*days_ago)).to_rfc3339(),
                    (i as i64) * 600
                ],
            )
            .unwrap();
        }
        // 进行中的专注时长不计入
        conn.execute(
            "INSERT INTO tasks (title, status, created_at, focus_seconds)
             VALUES ('open', 'active', ?1, 99999)",
            rusqlite::params![now.to_rfc3339()],
        )
        .unwrap();
        let (caught, focus_min) = week_stats(&conn);
        assert_eq!(caught, 3, "只数近 7 天完成的");
        assert_eq!(focus_min, 30, "专注分钟 = (0+1+2)*600s / 60");
    }

    // ---- notification_text：三语 × 紧急/普通 ----

    #[test]
    fn notification_text_per_language_and_urgency() {
        let (t, b) = notification_text("zh-Hans", true, "交报告", None);
        assert_eq!(t, "‼ 训练家，快看快看！");
        assert_eq!(b, "紧急任务提醒：交报告");
        let (t, b) = notification_text("zh-Hans", false, "交报告", Some("皮卡丘"));
        assert_eq!(t, "🐾 训练家，别忘了");
        assert_eq!(b, "交报告（皮卡丘）", "body 附分类宝可梦名");
        let (t, b) = notification_text("zh-Hant", false, "交報告", None);
        assert_eq!(t, "🐾 訓練家，別忘了");
        assert_eq!(b, "交報告");
        let (t, b) = notification_text("en", true, "report", Some("Pikachu"));
        assert_eq!(t, "‼ Trainer, quick look!");
        assert_eq!(b, "Urgent: report (Pikachu)");
        // 未知语言回退简体
        let (t, _) = notification_text("fr", false, "x", None);
        assert_eq!(t, "🐾 训练家，别忘了");
    }

    // ---- in_quiet_hours / parse_hm：勿扰时段判定 ----

    fn hm(s: &str) -> chrono::NaiveTime {
        parse_hm(s).unwrap()
    }

    #[test]
    fn quiet_hours_covers_normal_and_wrap_ranges() {
        let start = hm("22:00");
        let end = hm("08:00");
        // 跨零点区间：深夜与清晨都在勿扰内，白天不在
        assert!(in_quiet_hours(hm("23:30"), start, end));
        assert!(in_quiet_hours(hm("05:59"), start, end));
        assert!(!in_quiet_hours(hm("12:00"), start, end));
        // 边界：起点含、终点不含
        assert!(in_quiet_hours(hm("22:00"), start, end));
        assert!(!in_quiet_hours(hm("08:00"), start, end));
        // 不跨零点的区间
        assert!(in_quiet_hours(hm("13:00"), hm("12:00"), hm("14:00")));
        assert!(!in_quiet_hours(hm("15:00"), hm("12:00"), hm("14:00")));
        // start == end 视为关闭
        assert!(!in_quiet_hours(hm("12:00"), hm("22:00"), hm("22:00")));
    }

    #[test]
    fn parse_hm_rejects_garbage() {
        assert!(parse_hm("22:00").is_some());
        assert!(parse_hm("25:00").is_none());
        assert!(parse_hm("22:99").is_none());
        assert!(parse_hm("").is_none());
    }

    // ---- aggregated_notification_text：聚合通知文案 ----

    #[test]
    fn aggregated_notification_text_three_languages() {
        let (t, b) = aggregated_notification_text("zh-Hans", &["交周报", "取快递"], false);
        assert!(t.contains("2 只") && t.contains("🐾"), "{t}");
        assert!(b.contains("交周报、取快递"), "{b}");
        let (t, _) = aggregated_notification_text("zh-Hans", &["a"], true);
        assert!(t.contains("‼"), "含紧急任务时用紧急前缀");
        let (t, b) = aggregated_notification_text("zh-Hant", &["a", "b"], false);
        assert!(t.contains("2 隻") && b.contains("冒險頁"));
        let (t, b) = aggregated_notification_text("en", &["a", "b"], false);
        assert!(t.contains("2 Pokemon") && b.contains("Adventure"));
        // 未知语言回退简体
        let (t, _) = aggregated_notification_text("fr", &["a"], false);
        assert!(t.contains("1 只"));
    }

    #[test]
    fn aggregated_notification_text_lists_at_most_three_titles() {
        let titles = ["一", "二", "三", "四", "五"];
        let (_, b) = aggregated_notification_text("zh-Hans", &titles, false);
        assert!(b.contains("一、二、三"), "只点名前 3 条: {b}");
        assert!(b.contains("等 5 项"), "尾部汇总总数: {b}");
        assert!(!b.contains("四"), "第 4 条不点名: {b}");
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

    // ---- P1 抽取的纯函数面（设置快照 / 到期精判 / 送达决策） ----

    fn fixed_tz() -> chrono::FixedOffset {
        chrono::FixedOffset::east_opt(8 * 3600).unwrap()
    }

    fn reminder(id: i64, title: &str, priority: &str, pokemon: Option<&str>) -> Reminder {
        Reminder {
            id,
            title: title.into(),
            priority: priority.into(),
            pokemon: pokemon.map(String::from),
        }
    }

    #[test]
    fn reminder_settings_defaults_and_overrides() {
        let conn = test_conn();
        let s = ReminderSettings::from_conn(&conn);
        assert_eq!(
            (
                s.lead_minutes,
                s.notify_on,
                s.quiet_on,
                s.quiet_start.as_str(),
                s.quiet_end.as_str(),
                s.lang.as_str()
            ),
            (0, true, true, "22:00", "08:00", "zh-Hans"),
            "全部键缺省与设置面默认一致"
        );
        for (k, v) in [
            ("remind_ahead_minutes", "30"),
            ("notifications_enabled", "false"),
            ("quiet_hours_enabled", "false"),
            ("quiet_start", "23:30"),
            ("quiet_end", "07:00"),
            ("language", "en"),
        ] {
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)",
                params![k, v],
            )
            .unwrap();
        }
        let s = ReminderSettings::from_conn(&conn);
        assert_eq!(
            (s.lead_minutes, s.notify_on, s.quiet_on, s.lang.as_str()),
            (30, false, false, "en")
        );
        assert_eq!(
            (s.quiet_start.as_str(), s.quiet_end.as_str()),
            ("23:30", "07:00")
        );
    }

    #[test]
    fn due_precise_mixes_formats_and_boundary() {
        let tz = fixed_tz();
        let now = chrono::DateTime::parse_from_rfc3339("2026-09-12T15:30:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let rows = vec![
            DueRow {
                id: 1,
                title: "带偏移".into(),
                priority: "normal".into(),
                remind_at: "2026-09-12T22:00:00+08:00".into(), // = 14:00Z
                pokemon: None,
            },
            DueRow {
                id: 2,
                title: "utc".into(),
                priority: "normal".into(),
                remind_at: "2026-09-12T14:30:00Z".into(),
                pokemon: None,
            },
            DueRow {
                id: 3,
                title: "本地无秒".into(),
                priority: "normal".into(),
                remind_at: "2026-09-12T23:00".into(), // datetime-local（+08）= 15:00Z
                pokemon: None,
            },
            DueRow {
                id: 4,
                title: "恰好到期".into(),
                priority: "normal".into(),
                remind_at: "2026-09-12T15:30:00Z".into(), // == now → 边界含
                pokemon: None,
            },
            DueRow {
                id: 5,
                title: "未来".into(),
                priority: "normal".into(),
                remind_at: "2026-09-12T15:30:01Z".into(),
                pokemon: None,
            },
            DueRow {
                id: 6,
                title: "解析失败".into(),
                priority: "normal".into(),
                remind_at: "2026-09-12".into(), // 过 SQL 粗筛但解析失败 → 跳过
                pokemon: None,
            },
        ];
        let due = due_precise(&tz, &rows, now);
        assert_eq!(
            due.iter().map(|r| r.id).collect::<Vec<_>>(),
            vec![1, 2, 3, 4]
        );
    }

    fn settings_of(
        notify_on: bool,
        quiet_on: bool,
        qs: &str,
        qe: &str,
        lang: &str,
    ) -> ReminderSettings {
        ReminderSettings {
            lead_minutes: 0,
            notify_on,
            quiet_on,
            quiet_start: qs.into(),
            quiet_end: qe.into(),
            lang: lang.into(),
        }
    }

    #[test]
    fn decide_delivery_single_multi_quiet_and_notify_off() {
        let noon = chrono::NaiveTime::from_hms_opt(12, 0, 0).unwrap();
        let late = chrono::NaiveTime::from_hms_opt(23, 30, 0).unwrap();

        // 单条原样（附分类宝可梦名）
        let s = settings_of(true, true, "22:00", "08:00", "zh-Hans");
        let d = decide_delivery(&s, &[reminder(1, "交周报", "normal", Some("皮卡丘"))], noon);
        assert_eq!(
            d.notification.as_ref().unwrap(),
            &(
                "🐾 训练家，别忘了".to_string(),
                "交周报（皮卡丘）".to_string()
            )
        );
        assert_eq!(d.pet.as_ref().unwrap().id, 1);
        assert!(!d.pet.as_ref().unwrap().urgent);
        assert_eq!(d.silenced, 0);

        // 多条聚合：任一紧急整体 ‼ 前缀，桌宠代表选第一条紧急
        let s = settings_of(true, false, "22:00", "08:00", "zh-Hans");
        let d = decide_delivery(
            &s,
            &[
                reminder(1, "一", "normal", None),
                reminder(2, "二", "urgent", None),
            ],
            noon,
        );
        let (t, b) = d.notification.as_ref().unwrap();
        assert!(t.starts_with("‼") && t.contains("2 只"), "{t}");
        assert_eq!(b, "点名：一、二——到冒险页逐只看看");
        assert_eq!(d.pet.as_ref().unwrap().id, 2, "代表选第一条紧急");
        assert!(d.pet.as_ref().unwrap().urgent);

        // 勿扰内：非紧急静默（抢到标记但不送达），紧急例外仍敲门
        let s = settings_of(true, true, "22:00", "08:00", "zh-Hans");
        let d = decide_delivery(
            &s,
            &[
                reminder(1, "普通", "normal", None),
                reminder(2, "紧急", "high", None),
            ],
            late,
        );
        assert!(d.quiet);
        assert_eq!(d.silenced, 1);
        assert_eq!(d.deliver.len(), 1);
        assert!(
            d.notification.as_ref().unwrap().0.starts_with("‼"),
            "剩下的紧急仍送达"
        );
        assert_eq!(d.pet.as_ref().unwrap().id, 2);

        // 通知关：系统通知与桌宠事件都不发（送达集保留，由调用方看决策）
        let s = settings_of(false, false, "22:00", "08:00", "zh-Hans");
        let d = decide_delivery(&s, &[reminder(1, "x", "normal", None)], noon);
        assert!(d.notification.is_none() && d.pet.is_none());
        assert_eq!(d.deliver.len(), 1);
    }

    #[test]
    fn decide_delivery_quiet_fail_open_and_start_eq_end() {
        let late = chrono::NaiveTime::from_hms_opt(23, 30, 0).unwrap();
        // 边界解析失败 → fail open（不静默）
        let s = settings_of(true, true, "bad!", "08:00", "zh-Hans");
        let d = decide_delivery(&s, &[reminder(1, "普通", "normal", None)], late);
        assert!(!d.quiet && d.silenced == 0 && d.notification.is_some());
        // start == end 视为关闭
        let s = settings_of(true, true, "23:30", "23:30", "zh-Hans");
        let d = decide_delivery(&s, &[reminder(1, "普通", "normal", None)], late);
        assert!(!d.quiet && d.notification.is_some());
        // 勿扰开关整体关
        let s = settings_of(true, false, "22:00", "08:00", "zh-Hans");
        let d = decide_delivery(&s, &[reminder(1, "普通", "normal", None)], late);
        assert!(!d.quiet && d.notification.is_some());
    }

    // ---- P2 提醒落库 CAS（D28 双形态仲裁 · 回归 TDD） ----

    /// 双开窗口回归：两个形态（两条连接）同 20s 窗口各自粗筛到同一到期任务、
    /// 先后抢占送达权——全系统只允许一个 affected=1（后到让位，不双发）。
    /// 模拟的是真实竞态窗口：两形态都已在标记前看到 reminded=0 的同一任务。
    #[test]
    fn dual_form_claim_grants_single_delivery_right() {
        let file = std::env::temp_dir().join(format!("pk-reminder-cas-{}", std::process::id()));
        let _ = std::fs::remove_file(&file);
        let open = || {
            let conn = Connection::open(&file).unwrap();
            conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;")
                .unwrap();
            conn
        };
        let conn1 = open();
        crate::db::init_conn(&conn1).unwrap();
        let conn2 = open();
        let past = (chrono::Utc::now() - chrono::Duration::hours(1)).to_rfc3339();
        conn1
            .execute(
                "INSERT INTO tasks (title, status, remind_at, created_at)
                 VALUES ('双发竞态', 'scheduled', ?1, ?1)",
                params![past],
            )
            .unwrap();
        let id = conn1.last_insert_rowid();
        // 两形态同窗：各自完成粗筛 + 精判（此刻都看到 reminded=0）
        let now = chrono::Utc::now();
        let now_s = (now + chrono::Duration::days(1)).to_rfc3339();
        let due1 = due_precise(
            &chrono::Local,
            &query_due_rows(&conn1, &now_s).unwrap(),
            now,
        );
        let due2 = due_precise(
            &chrono::Local,
            &query_due_rows(&conn2, &now_s).unwrap(),
            now,
        );
        assert_eq!((due1.len(), due2.len()), (1, 1));
        let won1 = claim_reminded(&conn1, &due1).unwrap();
        let won2 = claim_reminded(&conn2, &due2).unwrap();
        assert_eq!(
            won1.len() + won2.len(),
            1,
            "全系统只有一个「送达权」（先到送达、后到让位）"
        );
        assert!(is_reminded(&conn2, id));
        drop(conn1);
        drop(conn2);
        let _ = std::fs::remove_file(&file);
        let _ = std::fs::remove_file(file.with_extension("db-wal"));
        let _ = std::fs::remove_file(file.with_extension("db-shm"));
    }
}
