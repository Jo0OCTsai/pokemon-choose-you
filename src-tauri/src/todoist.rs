use crate::db::{now, Db};
use crate::error::{AppError, AppResult};
use crate::events;
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
        .and_then(|d| {
            chrono::Local
                .from_local_datetime(&d.and_hms_opt(9, 0, 0)?)
                .earliest()
        })
        .map(|t| t.with_timezone(&Utc).to_rfc3339())
}

/// 双向同步：远端 -> 本地 upsert；本地新建 -> 远端创建；本地完成 -> 远端关闭
pub async fn sync(app: &AppHandle) -> AppResult<String> {
    let result = sync_with(app, BASE).await;
    let state = app.state::<crate::health::HealthState>();
    match &result {
        Ok(_) => state.record_success(app, crate::health::TODOIST),
        Err(e) => state.record_failure(app, crate::health::TODOIST, &e.to_string()),
    }
    result
}

/// base 可注入：生产走官方地址，集成测试指向 wiremock 服务器
pub(crate) async fn sync_with<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    base: &str,
) -> AppResult<String> {
    let db = app.state::<Db>();
    let token = {
        let conn = db.0.lock().unwrap();
        conn.query_row(
            "SELECT value FROM settings WHERE key='todoist_token'",
            [],
            |r| r.get::<_, String>(0),
        )
        .ok()
    };
    let token = match token {
        Some(t) if !t.is_empty() => t,
        _ => return Err(AppError::Invalid("未配置 Todoist API Token".into())),
    };
    let client = reqwest::Client::new();

    // 1. 拉取远端任务
    let remote: Vec<TodoistTask> = client
        .get(format!("{base}/tasks"))
        .bearer_auth(&token)
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Todoist 请求失败: {e}")))?
        .json()
        .await
        .map_err(|e| AppError::External(format!("Todoist 响应解析失败: {e}")))?;

    let mut pulled = 0;
    {
        let conn = db.0.lock().unwrap();
        for t in &remote {
            // 状态归位规则：远端勾选 → done；未勾选按有无截止时间 → scheduled / inbox
            let status = if t.checked {
                "done"
            } else if t.due.is_some() {
                "scheduled"
            } else {
                "inbox"
            };
            let due = t.due.as_ref().and_then(parse_due);
            // diff-first：已存在且无变化就跳过（无变化的 upsert 既浪费写也刷日志）
            let existing: Option<(i64, String, String, Option<String>)> = conn
                .query_row(
                    "SELECT id, title, status, due_at FROM tasks WHERE external_id=?1 AND source='todoist'",
                    params![t.id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .ok();
            if existing
                .as_ref()
                .is_some_and(|(_, et, es, ed)| et == &t.content && es == status && ed == &due)
            {
                pulled += 1;
                continue;
            }
            let n = conn.execute(
                // 冲突目标必须带与部分唯一索引相同的 WHERE 子句，否则 SQLite 报
                // "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint"
                // （wiremock 集成测试覆盖到的回归点）
                "INSERT INTO tasks (title, category_id, status, source, external_id, due_at, created_at, completed_at)
                 VALUES (?1, 1, ?2, 'todoist', ?3, ?4, ?5, CASE WHEN ?2='done' THEN ?5 ELSE NULL END)
                 ON CONFLICT(external_id) WHERE external_id IS NOT NULL DO UPDATE SET title=?1, status=?2, due_at=?4",
                params![t.content, status, t.id, due, now()],
            )?;
            // ON CONFLICT 需要唯一索引，这里建一下（幂等）
            if n == 0 {
                conn.execute(
                    "UPDATE tasks SET title=?1, status=?2, due_at=?3 WHERE external_id=?4 AND source='todoist'",
                    params![t.content, status, due, t.id],
                )?;
            }
            if let Some((local_id, et, es, ed)) = &existing {
                if et != &t.content {
                    crate::commands::tasks::log_change(
                        &conn,
                        *local_id,
                        "update",
                        "title",
                        Some(et),
                        Some(&t.content),
                        "todoist",
                    )?;
                }
                if es != status {
                    crate::commands::tasks::log_change(
                        &conn,
                        *local_id,
                        "update",
                        "status",
                        Some(es),
                        Some(status),
                        "todoist",
                    )?;
                }
                if ed != &due {
                    crate::commands::tasks::log_change(
                        &conn,
                        *local_id,
                        "update",
                        "due_at",
                        ed.as_deref(),
                        due.as_deref(),
                        "todoist",
                    )?;
                }
            } else {
                let local_id = conn.query_row(
                    "SELECT id FROM tasks WHERE external_id=?1 AND source='todoist'",
                    params![t.id],
                    |r| r.get::<_, i64>(0),
                )?;
                crate::commands::tasks::log_change(
                    &conn,
                    local_id,
                    "create",
                    "title",
                    None,
                    Some(&t.content),
                    "todoist",
                )?;
            }
            pulled += 1;
        }
    }

    // 2. 推送本地新建（source=local 且无 external_id 且非 inbox）
    let to_push: Vec<(i64, String, Option<String>)> = {
        let conn = db.0.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, title, due_at FROM tasks WHERE source='local' AND external_id IS NULL AND status != 'inbox'")?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    let mut pushed = 0;
    for (id, title, due) in &to_push {
        let mut body = serde_json::json!({ "content": title });
        if let Some(d) = due {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(d) {
                body["due_string"] = serde_json::Value::String(
                    dt.with_timezone(&chrono::Local)
                        .format("%Y-%m-%d %H:%M")
                        .to_string(),
                );
                body["due_lang"] = serde_json::Value::String("en".into());
            }
        }
        let resp: Result<serde_json::Value, _> = client
            .post(format!("{base}/tasks"))
            .bearer_auth(&token)
            .json(&body)
            .timeout(std::time::Duration::from_secs(20))
            .send()
            .await
            .map_err(|e| AppError::Network(format!("Todoist 创建失败: {e}")))?
            .json()
            .await;
        if let Ok(v) = resp {
            if let Some(ext) = v["id"].as_str() {
                let conn = db.0.lock().unwrap();
                conn.execute(
                    "UPDATE tasks SET external_id=?2 WHERE id=?1",
                    params![id, ext],
                )?;
                crate::commands::tasks::log_change(
                    &conn,
                    *id,
                    "sync_push",
                    "external_id",
                    None,
                    Some(ext),
                    "todoist",
                )?;
                pushed += 1;
            }
        }
    }

    // 3. 推送本地完成/取消（source=todoist 且 done/cancelled 但远端未关闭）
    let to_close: Vec<(i64, String)> = {
        let conn = db.0.lock().unwrap();
        // 回归：这里曾误写成 sync_state.value（实际列名是 cursor），导致同步在关闭阶段必然失败
        let mut stmt = conn
            .prepare("SELECT id, external_id FROM tasks WHERE source='todoist'
                      AND status IN ('done','cancelled') AND external_id IS NOT NULL
                      AND COALESCE(completed_at, cancelled_at) > COALESCE((SELECT cursor FROM sync_state WHERE provider='todoist_push'), '')")?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get::<_, Option<String>>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter()
            .filter_map(|(id, ext)| ext.map(|e| (id, e)))
            .collect()
    };
    let mut closed = 0;
    for (_id, ext) in &to_close {
        if let Ok(resp) = client
            .post(format!("{base}/tasks/{ext}/close"))
            .bearer_auth(&token)
            .timeout(std::time::Duration::from_secs(20))
            .send()
            .await
        {
            // 只有远端确认成功才计入，4xx/5xx 不能假装关闭了
            if resp.status().is_success() {
                closed += 1;
                let conn = db.0.lock().unwrap();
                crate::commands::tasks::log_change(
                    &conn,
                    *_id,
                    "sync_close",
                    "external_id",
                    None,
                    Some(ext),
                    "todoist",
                )?;
            }
        }
    }
    {
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO sync_state (provider, cursor, updated_at) VALUES ('todoist_push', ?1, ?2)
             ON CONFLICT(provider) DO UPDATE SET cursor=?1, updated_at=?2",
            params![now(), now()],
        )?;
    }

    // 同步可能新建/完成任务，通知两窗口刷新
    let _ = app.emit(events::TASKS_CHANGED, ());
    Ok(format!(
        "同步完成：拉取 {pulled}，推送 {pushed}，关闭 {closed}"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::test_conn;
    use std::sync::Mutex;
    use tauri::Manager;
    use wiremock::matchers::{body_string_contains, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn due(datetime: Option<&str>, date: &str) -> Option<String> {
        parse_due(&TodoistDue {
            datetime: datetime.map(String::from),
            date: date.into(),
        })
    }

    #[test]
    fn parse_due_prefers_datetime_field() {
        let got = due(Some("2026-09-13T02:00:00Z"), "2026-09-13").unwrap();
        assert!(
            got.starts_with("2026-09-13T02:00:00"),
            "具体时间按 UTC 透传: {got}"
        );
    }

    #[test]
    fn parse_due_converts_offset_datetime_to_utc() {
        let got = due(Some("2026-09-13T10:00:00+08:00"), "2026-09-13").unwrap();
        assert!(
            got.starts_with("2026-09-13T02:00:00"),
            "+08:00 转成 UTC: {got}"
        );
    }

    #[test]
    fn parse_due_all_day_defaults_local_nine() {
        let got = due(None, "2026-09-13").unwrap();
        let local_9 = chrono::Local
            .from_local_datetime(
                &chrono::NaiveDate::from_ymd_opt(2026, 9, 13)
                    .unwrap()
                    .and_hms_opt(9, 0, 0)
                    .unwrap(),
            )
            .earliest()
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(got, local_9.to_rfc3339(), "全天任务落到本地 09:00");
    }

    #[test]
    fn parse_due_invalid_inputs() {
        assert_eq!(due(None, "not-a-date"), None);
        assert_eq!(
            due(Some("garbage"), "2026-09-13").unwrap(),
            due(None, "2026-09-13").unwrap(),
            "时间解析失败回退到日期规则"
        );
    }

    // ---- reqwest 分支：wiremock 覆盖拉取 / 推送 / 关闭 ----

    fn app_with(token: &str) -> tauri::AppHandle<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        let conn = test_conn();
        if !token.is_empty() {
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('todoist_token', ?1)",
                params![token],
            )
            .unwrap();
        }
        app.manage(Db(Mutex::new(conn)));
        app.handle().clone()
    }

    #[test]
    fn sync_without_token_is_invalid_input() {
        tauri::async_runtime::block_on(async {
            let app = app_with("");
            let err = sync_with(&app, "http://unused").await.unwrap_err();
            assert!(
                matches!(err, AppError::Invalid(_)),
                "缺 token 归 invalid: {err}"
            );
        });
    }

    /// 全链路：拉取 2 条远端任务 upsert；本地 1 条排期任务推送到远端并回写 external_id；
    /// 本地 1 条已完成 todoist 任务关闭远端；结果串带三个计数
    #[test]
    fn sync_pulls_pushes_and_closes_via_mock_api() {
        tauri::async_runtime::block_on(async {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/tasks"))
                .and(header("authorization", "Bearer tok"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                    { "id": "ext-1", "content": "远端任务", "checked": false,
                      "due": { "datetime": "2026-09-13T02:00:00Z", "date": "2026-09-13" } },
                    { "id": "ext-2", "content": "远端已完成", "checked": true, "due": null }
                ])))
                .mount(&server)
                .await;
            Mock::given(method("POST"))
                .and(path("/tasks"))
                .and(body_string_contains("本地排期任务"))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_body_json(serde_json::json!({ "id": "ext-new" })),
                )
                .expect(1)
                .mount(&server)
                .await;
            Mock::given(method("POST"))
                .and(path("/tasks/ext-done/close"))
                .respond_with(ResponseTemplate::new(204))
                .expect(1)
                .mount(&server)
                .await;
            // 拉取回来的已勾选任务（completed_at=now）也会触发一次幂等关闭
            Mock::given(method("POST"))
                .and(path("/tasks/ext-2/close"))
                .respond_with(ResponseTemplate::new(204))
                .expect(1)
                .mount(&server)
                .await;

            let app = app_with("tok");
            {
                let db = app.state::<Db>();
                let conn = db.0.lock().unwrap();
                conn.execute(
                    "INSERT INTO tasks (title, status, source, created_at) VALUES ('本地排期任务', 'scheduled', 'local', '2026-09-01T00:00:00Z')",
                    [],
                )
                .unwrap();
                conn.execute(
                    "INSERT INTO tasks (title, status, source, external_id, completed_at, created_at)
                     VALUES ('远端要关的', 'done', 'todoist', 'ext-done', '2999-01-01T00:00:00Z', '2026-09-01T00:00:00Z')",
                    [],
                )
                .unwrap();
            }

            let summary = sync_with(&app, &server.uri()).await.unwrap();
            assert!(summary.contains("拉取 2"), "{summary}");
            assert!(summary.contains("推送 1"), "{summary}");
            assert!(summary.contains("关闭 2"), "{summary}");

            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let (pulled_status, pushed_ext): (String, Option<String>) = conn
                .query_row(
                    "SELECT (SELECT status FROM tasks WHERE external_id='ext-1'), (SELECT external_id FROM tasks WHERE title='本地排期任务')",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!(
                pulled_status, "scheduled",
                "远端未完成但有截止时间的任务落本地 scheduled"
            );
            assert_eq!(
                pushed_ext.as_deref(),
                Some("ext-new"),
                "推送后回写 external_id"
            );
        });
    }

    /// reqwest 分支：上游 4xx 时拉取失败归为外部服务错误
    #[test]
    fn sync_maps_remote_error_to_external() {
        tauri::async_runtime::block_on(async {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/tasks"))
                .respond_with(ResponseTemplate::new(401).set_body_string("unauthorized"))
                .mount(&server)
                .await;
            let app = app_with("bad-token");
            let err = sync_with(&app, &server.uri()).await.unwrap_err();
            assert!(
                matches!(err, AppError::External(_)),
                "401 归 external: {err}"
            );
        });
    }
}
