use crate::db::{now, Db};
use chrono::{TimeZone, Utc};
use rusqlite::params;
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};

const BASE: &str = "https://api.todoist.com/rest/v2";

#[derive(Deserialize)]
struct TodoistTask {
    id: String,
    content: String,
    #[serde(default)]
    due: Option<TodoistDue>,
    checked: bool,
}

#[derive(Deserialize)]
struct TodoistDue {
    #[serde(default)]
    datetime: Option<String>,
    date: String,
}

fn parse_due(d: &TodoistDue) -> Option<String> {
    if let Some(dt) = &d.datetime {
        if let Ok(t) = chrono::DateTime::parse_from_rfc3339(dt) {
            return Some(t.with_timezone(&Utc).to_rfc3339());
        }
    }
    // 全天任务：当作当天 09:00 本地时间
    chrono::NaiveDate::parse_from_str(&d.date, "%Y-%m-%d")
        .ok()
        .and_then(|d| chrono::Local.from_local_datetime(&d.and_hms_opt(9, 0, 0)?).earliest())
        .map(|t| t.with_timezone(&Utc).to_rfc3339())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn due(datetime: Option<&str>, date: &str) -> Option<String> {
        parse_due(&TodoistDue {
            datetime: datetime.map(String::from),
            date: date.into(),
        })
    }

    #[test]
    fn parse_due_prefers_datetime_field() {
        let got = due(Some("2026-09-13T02:00:00Z"), "2026-09-13").unwrap();
        assert!(got.starts_with("2026-09-13T02:00:00"), "具体时间按 UTC 透传: {got}");
    }

    #[test]
    fn parse_due_converts_offset_datetime_to_utc() {
        let got = due(Some("2026-09-13T10:00:00+08:00"), "2026-09-13").unwrap();
        assert!(got.starts_with("2026-09-13T02:00:00"), "+08:00 转成 UTC: {got}");
    }

    #[test]
    fn parse_due_all_day_defaults_local_nine() {
        let got = due(None, "2026-09-13").unwrap();
        let local_9 = chrono::Local
            .from_local_datetime(&chrono::NaiveDate::from_ymd_opt(2026, 9, 13).unwrap().and_hms_opt(9, 0, 0).unwrap())
            .earliest()
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(got, local_9.to_rfc3339(), "全天任务落到本地 09:00");
    }

    #[test]
    fn parse_due_invalid_inputs() {
        assert_eq!(due(None, "not-a-date"), None);
        assert_eq!(due(Some("garbage"), "2026-09-13").unwrap(), due(None, "2026-09-13").unwrap(), "时间解析失败回退到日期规则");
    }
}

/// 双向同步：远端 -> 本地 upsert；本地新建 -> 远端创建；本地完成 -> 远端关闭
pub async fn sync(app: &AppHandle) -> Result<String, String> {
    let db = app.state::<Db>();
    let token = {
        let conn = db.0.lock().unwrap();
        conn.query_row("SELECT value FROM settings WHERE key='todoist_token'", [], |r| {
            r.get::<_, String>(0)
        })
        .ok()
    };
    let token = match token {
        Some(t) if !t.is_empty() => t,
        _ => return Err("未配置 Todoist API Token".into()),
    };
    let client = reqwest::Client::new();

    // 1. 拉取远端任务
    let remote: Vec<TodoistTask> = client
        .get(format!("{BASE}/tasks"))
        .bearer_auth(&token)
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("Todoist 请求失败: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Todoist 响应解析失败: {e}"))?;

    let mut pulled = 0;
    {
        let conn = db.0.lock().unwrap();
        for t in &remote {
            let status = if t.checked { "done" } else { "inbox" };
            let due = t.due.as_ref().and_then(parse_due);
            let n = conn.execute(
                "INSERT INTO tasks (title, category_id, status, source, external_id, due_at, created_at, completed_at)
                 VALUES (?1, 1, ?2, 'todoist', ?3, ?4, ?5, CASE WHEN ?2='done' THEN ?5 ELSE NULL END)
                 ON CONFLICT(external_id) DO UPDATE SET title=?1, status=?2, due_at=?4",
                params![t.content, status, t.id, due, now()],
            )
            .map_err(|e| e.to_string())?;
            // ON CONFLICT 需要唯一索引，这里建一下（幂等）
            if n == 0 {
                conn.execute("UPDATE tasks SET title=?1, status=?2, due_at=?3 WHERE external_id=?4 AND source='todoist'",
                    params![t.content, status, due, t.id]).map_err(|e| e.to_string())?;
            }
            pulled += 1;
        }
    }

    // 2. 推送本地新建（source=local 且无 external_id 且非 inbox）
    let to_push: Vec<(i64, String, Option<String>)> = {
        let conn = db.0.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, title, due_at FROM tasks WHERE source='local' AND external_id IS NULL AND status != 'inbox'")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    let mut pushed = 0;
    for (id, title, due) in &to_push {
        let mut body = serde_json::json!({ "content": title });
        if let Some(d) = due {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(d) {
                body["due_string"] = serde_json::Value::String(dt.with_timezone(&chrono::Local).format("%Y-%m-%d %H:%M").to_string());
                body["due_lang"] = serde_json::Value::String("en".into());
            }
        }
        let resp: Result<serde_json::Value, _> = client
            .post(format!("{BASE}/tasks"))
            .bearer_auth(&token)
            .json(&body)
            .timeout(std::time::Duration::from_secs(20))
            .send()
            .await
            .map_err(|e| format!("Todoist 创建失败: {e}"))?
            .json()
            .await;
        if let Ok(v) = resp {
            if let Some(ext) = v["id"].as_str() {
                let conn = db.0.lock().unwrap();
                conn.execute("UPDATE tasks SET external_id=?2 WHERE id=?1", params![id, ext])
                    .map_err(|e| e.to_string())?;
                pushed += 1;
            }
        }
    }

    // 3. 推送本地完成（source=todoist 且 done 但远端未关闭）
    let to_close: Vec<(i64, String)> = {
        let conn = db.0.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, external_id FROM tasks WHERE source='todoist' AND status='done' AND external_id IS NOT NULL AND completed_at > COALESCE((SELECT value FROM sync_state WHERE provider='todoist_push'), '')")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get::<_, Option<String>>(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows.into_iter().filter_map(|(id, ext)| ext.map(|e| (id, e))).collect()
    };
    let mut closed = 0;
    for (_id, ext) in &to_close {
        if client.post(format!("{BASE}/tasks/{ext}/close")).bearer_auth(&token)
            .timeout(std::time::Duration::from_secs(20)).send().await.is_ok() {
            closed += 1;
        }
    }
    {
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO sync_state (provider, cursor, updated_at) VALUES ('todoist_push', ?1, ?2)
             ON CONFLICT(provider) DO UPDATE SET cursor=?1, updated_at=?2",
            params![now(), now()],
        )
        .map_err(|e| e.to_string())?;
    }

    // 同步可能新建/完成任务，通知两窗口刷新
    let _ = app.emit("tasks-changed", ());
    Ok(format!("同步完成：拉取 {pulled}，推送 {pushed}，关闭 {closed}"))
}
