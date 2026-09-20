//! 桌宠体验升级命令（PET_EXPERIENCE_PROPOSAL）：输入响应开关（F1）、AI 对话（F2）、
//! 连胜统计（F7）、语音播报（F5）。纯前端能力（F3 时刻台词 / F4 栖息 / F6 陪跑）在 PetApp 内实现。

use crate::ai;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection};
use tauri::State;

// ---- F1 输入响应：后端监听线程的开关与权限 ----

/// macOS 辅助功能授权状态（输入响应的前提；其他平台恒 true）
#[tauri::command]
pub fn pet_input_permission() -> bool {
    crate::input::ax_trusted()
}

/// 同步输入响应开关到后端监听线程。
/// 返回 "ok" 或 "permission"（macOS 未授权：前端保留设置但提示授权路径，授权后重试即生效）。
#[tauri::command]
pub fn pet_input_set_enabled<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> AppResult<&'static str> {
    if !enabled {
        crate::input::set_enabled(&app, false);
        return Ok("ok");
    }
    if !crate::input::ax_trusted() {
        return Ok("permission");
    }
    crate::input::set_enabled(&app, true);
    Ok("ok")
}

// ---- F5 语音 ----

/// 系统语音播报一句（调用方自行按 pet_voice 设置把关；失败静默）
#[tauri::command]
pub fn pet_speak(text: String) -> AppResult<()> {
    crate::voice::speak_detached(&text);
    Ok(())
}

// ---- F7 连胜：连续有捕捉的日历日（一个宽容日），周口径的判定基础 ----

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreakInfo {
    pub days: i64,
    pub today_count: i64,
}

#[tauri::command]
pub fn task_streak(db: State<Db>) -> AppResult<StreakInfo> {
    let conn = db.0.lock().unwrap();
    streak_conn(&conn)
}

/// 纯逻辑（pk CLI 与测试复用）：done 任务的 completed_at（本地日）去重成集合，
/// 从今天往回走——有捕捉计一天；整天空着可用掉唯一一个宽容日；再空即断。
/// 今天还没捕捉不清零（连胜活到今天结束，给用户留着续上的机会）。
pub fn streak_conn(conn: &Connection) -> AppResult<StreakInfo> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT date(completed_at, 'localtime') FROM tasks
         WHERE status='done' AND completed_at IS NOT NULL ORDER BY 1 DESC LIMIT 400",
    )?;
    let days_set: std::collections::HashSet<chrono::NaiveDate> = stmt
        .query_map([], |r| {
            r.get::<_, String>(0)
                .map(|s| chrono::NaiveDate::parse_from_str(&s, "%Y-%m-%d").ok())
        })?
        .filter_map(|r| r.ok().flatten())
        .collect();
    let today = chrono::Local::now().date_naive();
    let mut days: i64 = 0;
    let mut grace = 1;
    let mut cur = today;
    for _ in 0..400 {
        if days_set.contains(&cur) {
            days += 1;
        } else if grace > 0 {
            grace -= 1;
        } else {
            break;
        }
        cur -= chrono::Duration::days(1);
    }
    let today_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tasks
         WHERE status='done' AND date(completed_at, 'localtime') = date('now', 'localtime')",
        [],
        |r| r.get(0),
    )?;
    Ok(StreakInfo { days, today_count })
}

// ---- F2 AI 对话：接主 agent + 任务上下文的单轮问答（≤2 句，只答不执行） ----

#[tauri::command]
pub async fn pet_chat(db: State<'_, Db>, message: String) -> AppResult<String> {
    let q = message.trim();
    if q.is_empty() {
        return Err(AppError::Invalid("想问什么要说出来呀".into()));
    }
    if q.chars().count() > 200 {
        return Err(AppError::Invalid("问题太长了，精灵记不住～".into()));
    }
    let (agent, ctx) = {
        let conn = db.0.lock().unwrap();
        let get = |k: &str| -> Option<String> {
            conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| {
                r.get::<_, String>(0)
            })
            .ok()
        };
        let agent = ai::primary_agent(&get)
            .ok_or_else(|| AppError::Invalid("还没有配置 AI agent（设置 → AI 集成）".into()))?;
        (agent, build_context(&conn)?)
    };
    let prompt = format!(
        "你是一只桌面宝可梦桌宠，训练家正在问你任务的情况。规则：\
         1. 用与提问相同的语言回答，最多两句话，不用 Markdown 列表和标题；\
         2. 语气是陪伴、鼓励，永远不指责、不催促、不说教；\
         3. 只聊任务/图鉴/专注这些应用内的话题，别的话题温柔拉回；\
         4. 你不能执行任何操作，涉及操作就建议训练家去主面板确认；\
         5. 词汇表：完成任务=捕捉，取消=逃走，待办收件箱=草丛，日程=路线，已完成列表=图鉴，用户=训练家。\n\
         当前上下文：\n{ctx}\n训练家问：{q}"
    );
    let out = ai::run_agent(&agent, &prompt).await?;
    Ok(trim_sentences(&out, 2))
}

/// 拼装任务快照（轻量查询，不挂标签）：进行中 + 今天的路线 + 图鉴累计 + 连胜
fn build_context(conn: &Connection) -> AppResult<String> {
    let current: Option<String> = conn
        .query_row(
            "SELECT title FROM tasks WHERE status='active' ORDER BY started_at DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .ok();
    let mut stmt = conn.prepare(
        "SELECT title, COALESCE(due_at, '') FROM tasks
         WHERE status IN ('inbox','scheduled','active','paused')
         ORDER BY CASE WHEN due_at IS NULL OR due_at='' THEN 1 ELSE 0 END, due_at LIMIT 10",
    )?;
    let open: Vec<String> = stmt
        .query_map([], |r| {
            Ok(format!(
                "{}{}",
                r.get::<_, String>(0)?,
                if r.get::<_, String>(1)?.is_empty() {
                    String::new()
                } else {
                    format!("（截止 {}）", r.get::<_, String>(1)?)
                }
            ))
        })?
        .collect::<Result<_, _>>()?;
    let (caught, escaped): (i64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(status='done'), 0), COALESCE(SUM(status='cancelled'), 0) FROM tasks",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let streak = streak_conn(conn)?;
    let mut s = String::new();
    match current {
        Some(t) => s.push_str(&format!("进行中任务：「{t}」。\n")),
        None => s.push_str("现在没有进行中的任务。\n"),
    }
    if open.is_empty() {
        s.push_str("待办（草丛+路线）是空的。\n");
    } else {
        s.push_str(&format!("待办共 {} 条：{}\n", open.len(), open.join("、")));
    }
    s.push_str(&format!("图鉴累计捕捉 {caught} 只、逃走 {escaped} 只。\n"));
    s.push_str(&format!(
        "连胜 {days} 天（今天已捕捉 {today} 只）。",
        days = streak.days,
        today = streak.today_count
    ));
    Ok(s)
}

/// agent 输出收敛：截到前 n 句（句末 。！？!?；; 换行），超长再按字符硬截
pub fn trim_sentences(text: &str, n: usize) -> String {
    let trimmed = text.trim();
    let mut out = String::new();
    let mut count = 0;
    for ch in trimmed.chars() {
        out.push(ch);
        if "。！？!?；;\n".contains(ch) {
            count += 1;
            if count >= n {
                break;
            }
        }
    }
    if out.chars().count() > 200 {
        out = out.chars().take(200).collect::<String>() + "…";
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::test_conn;
    use chrono::Duration;

    /// 插一条 done 任务（completed_at 为相对今天的偏移天数，UTC 时刻取正午避开边界）
    fn seed_done(conn: &Connection, title: &str, offset_days: i64) {
        let at = (chrono::Local::now().date_naive() - Duration::days(offset_days))
            .and_hms_opt(12, 0, 0)
            .unwrap()
            .and_utc()
            .to_rfc3339();
        conn.execute(
            "INSERT INTO tasks (title, category_id, status, priority, source, created_at, completed_at, focus_seconds)
             VALUES (?1, 1, 'done', 'normal', 'local', ?2, ?3, 0)",
            params![title, at, at],
        )
        .unwrap();
    }

    #[test]
    fn streak_counts_consecutive_days_from_today() {
        let conn = test_conn();
        for d in [0, 1, 2] {
            seed_done(&conn, &format!("t{d}"), d);
        }
        let s = streak_conn(&conn).unwrap();
        assert_eq!(s.days, 3);
        assert_eq!(s.today_count, 1);
    }

    #[test]
    fn streak_survives_one_grace_day() {
        let conn = test_conn();
        // 今天没做：昨天、前天做了 → 连胜 2 天且不清零（宽容日+活到今天结束）
        for d in [1, 2] {
            seed_done(&conn, &format!("t{d}"), d);
        }
        let s = streak_conn(&conn).unwrap();
        assert_eq!(s.days, 2, "今天空着用宽容日，昨天前天各计一天");
        assert_eq!(s.today_count, 0);
    }

    #[test]
    fn streak_breaks_after_two_empty_days() {
        let conn = test_conn();
        seed_done(&conn, "old", 5); // 今天/昨天/前天/大前天都空
        let s = streak_conn(&conn).unwrap();
        assert_eq!(s.days, 0);
    }

    #[test]
    fn streak_same_day_multiple_catches_counts_once() {
        let conn = test_conn();
        seed_done(&conn, "a", 0);
        seed_done(&conn, "b", 0);
        seed_done(&conn, "c", 1);
        let s = streak_conn(&conn).unwrap();
        assert_eq!(s.days, 2);
        assert_eq!(s.today_count, 2);
    }

    #[test]
    fn trim_sentences_cuts_to_two() {
        assert_eq!(
            trim_sentences("第一句。第二句！第三句？", 2),
            "第一句。第二句！"
        );
        assert_eq!(
            trim_sentences("一句话没有句读结尾", 2),
            "一句话没有句读结尾"
        );
        assert_eq!(trim_sentences("  前后空白。  ", 2), "前后空白。");
    }
}
