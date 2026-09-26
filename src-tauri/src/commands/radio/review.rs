//! 收音机分诊 IPC：捕捉/逃走/撤销/应用更新/批量分诊——建议卡的人工裁决入口。
use super::store::get_message;
use super::suggest::{
    create_task_from_message, record_feedback, resolve_proposed_tags, valid_escape_reason,
};
use crate::commands::tasks::{update_task, TaskPatch};
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::events;
use crate::models::ChatMessage;
use rusqlite::{params, Connection};
use tauri::State;

/// 捕捉：把 AI 建议落成待办，并记录一条 accepted 反馈
#[tauri::command]
pub fn accept_chat_message<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    id: i64,
) -> AppResult<i64> {
    let task_id = {
        let conn = db.0.lock().unwrap();
        let msg = get_message(&conn, id)?;
        if msg.task_id.is_some() {
            return Err(AppError::Invalid("该消息已创建过待办".into()));
        }
        let task_id = create_task_from_message(&conn, &msg)?;
        record_feedback(&conn, &msg, "accepted", "")?;
        task_id
    };
    events::broadcast(&app, events::TASKS_CHANGED);
    events::broadcast(&app, events::CHAT_MESSAGES_CHANGED);
    Ok(task_id)
}

/// 逃走：忽略这条建议（消息仍保留在收音机里），可选带原因码落反馈库
#[tauri::command]
pub fn dismiss_chat_message<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    id: i64,
    reason_code: Option<String>,
) -> AppResult<()> {
    let reason = valid_escape_reason(reason_code.as_deref())?;
    {
        let conn = db.0.lock().unwrap();
        let msg = get_message(&conn, id)?;
        conn.execute(
            "UPDATE chat_messages SET review_status='dismissed', dismiss_reason=?2 WHERE id=?1",
            params![id, reason],
        )?;
        record_feedback(&conn, &msg, "dismissed", &reason)?;
    }
    events::broadcast(&app, events::CHAT_MESSAGES_CHANGED);
    Ok(())
}

/// 删掉该消息最近一条反馈：误操作的 accepted/dismissed 不该留在反馈库里污染判重分析
fn delete_last_feedback(conn: &Connection, chat_message_id: i64) -> AppResult<()> {
    conn.execute(
        "DELETE FROM chat_feedback WHERE id = (
            SELECT id FROM chat_feedback WHERE chat_message_id=?1 ORDER BY id DESC LIMIT 1
        )",
        params![chat_message_id],
    )?;
    Ok(())
}

/// 撤销最近一次分诊（收音机操作后的短撤销窗口，由前端 toast 触发）：
/// - 逃走 → review_status 回 pending，并清掉这条误操作落下的反馈
/// - 捕捉（todo 建待办）→ 删除刚建的待办并回 pending（仅限仍是原样 feishu 来源的任务）
/// 应用更新 / 跟进并入改的是既有待办内容，无法安全回滚，前端对这两类不提供撤销入口。
#[tauri::command]
pub fn undo_chat_review<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    id: i64,
) -> AppResult<()> {
    {
        let conn = db.0.lock().unwrap();
        let msg = get_message(&conn, id)?;
        match msg.review_status.as_str() {
            "dismissed" => {
                conn.execute(
                    "UPDATE chat_messages SET review_status='pending', dismiss_reason='' WHERE id=?1",
                    params![id],
                )?;
                delete_last_feedback(&conn, id)?;
            }
            "accepted" => {
                let task_id = msg.task_id.ok_or_else(|| {
                    AppError::Invalid("该消息没有可撤销的待办（应用更新/跟进不支持撤销）".into())
                })?;
                // 只回滚仍是「收音机原样」的任务：待办不存在（已被手动删）就只回状态不报错，
                // 来源不是 feishu 说明 id 已被复用，拒绝删除保安全
                // 只回滚仍是「收音机原样」的任务：feishu=飞书建议捕捉、capture=手动快速捕捉；
                // 其余来源说明 id 已被复用，拒绝删除保安全
                let source: Option<String> = conn
                    .query_row(
                        "SELECT source FROM tasks WHERE id=?1",
                        params![task_id],
                        |r| r.get(0),
                    )
                    .ok();
                match source.as_deref() {
                    Some("feishu" | "capture") => {
                        conn.execute("DELETE FROM task_tags WHERE task_id=?1", params![task_id])?;
                        conn.execute("DELETE FROM task_logs WHERE task_id=?1", params![task_id])?;
                        conn.execute("DELETE FROM task_notes WHERE task_id=?1", params![task_id])?;
                        conn.execute("DELETE FROM tasks WHERE id=?1", params![task_id])?;
                    }
                    None => { /* 任务已被手动删除：只恢复消息状态 */ }
                    Some(_) => {
                        return Err(AppError::Invalid(
                            "目标待办来源异常，为安全起见不撤销删除".into(),
                        ));
                    }
                }
                conn.execute(
                    "UPDATE chat_messages SET review_status='pending', task_id=NULL WHERE id=?1",
                    params![id],
                )?;
                delete_last_feedback(&conn, id)?;
            }
            other => {
                return Err(AppError::Invalid(format!(
                    "该消息当前是「{other}」状态，没有可撤销的分诊"
                )));
            }
        }
    }
    events::broadcast(&app, events::TASKS_CHANGED);
    events::broadcast(&app, events::CHAT_MESSAGES_CHANGED);
    Ok(())
}

/// 由消息上的更新建议构建待办补丁（只含 AI **明确给出**的字段，留空一律不动）。
/// apply_chat_message_update 与批量分诊共用。
fn update_patch_from_message(conn: &Connection, msg: &ChatMessage) -> AppResult<(i64, TaskPatch)> {
    let Some(task_id) = msg.update_task_id else {
        return Err(AppError::Invalid("更新建议缺少目标待办".into()));
    };
    // 目标已删除则无法应用（提前报错，避免先接受再失败）
    conn.query_row(
        "SELECT title FROM tasks WHERE id=?1",
        params![task_id],
        |r| r.get::<_, String>(0),
    )
    .map_err(|_| AppError::NotFound(format!("目标待办 No.{task_id} 已不存在，无法应用更新")))?;

    let mut patch = TaskPatch {
        id: task_id,
        title: None,
        note: None,
        category_id: None,
        priority: None,
        due_at: None,
        remind_at: None,
        status: None,
        tag_ids: None,
    };
    if let Some(v) = msg
        .suggested_title
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        patch.title = Some(v.to_string());
    }
    if let Some(v) = msg
        .suggested_note
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        patch.note = Some(v.to_string());
    }
    if let Some(v) = msg.suggested_due.as_deref().filter(|s| !s.is_empty()) {
        patch.due_at = Some(serde_json::Value::String(v.to_string()));
    }
    if let Some(v) = msg
        .suggested_priority
        .as_deref()
        .filter(|p| matches!(*p, "low" | "normal" | "high" | "urgent"))
    {
        patch.priority = Some(v.to_string());
    }
    // 分类只认启用中的同名分类，认不出就不动（不同于新建的回落策略）
    if let Some(name) = msg.suggested_category.as_deref().filter(|s| !s.is_empty()) {
        if let Ok(cid) = conn.query_row(
            "SELECT id FROM categories WHERE name=?1 AND enabled=1",
            params![name],
            |r| r.get::<_, i64>(0),
        ) {
            patch.category_id = Some(cid);
        }
    }
    // AI 给了新标签数组（非空）才全量替换
    if !msg.suggested_tags.is_empty() {
        patch.tag_ids = Some(resolve_proposed_tags(conn, &msg.suggested_tags)?);
    }
    if patch.title.is_none()
        && patch.note.is_none()
        && patch.category_id.is_none()
        && patch.priority.is_none()
        && patch.due_at.is_none()
        && patch.tag_ids.is_none()
    {
        return Err(AppError::Invalid("更新建议没有任何可应用的变更".into()));
    }
    Ok((task_id, patch))
}

/// 应用 AI 的更新建议：把消息建议字段里**明确给出**的部分打补丁到目标待办
/// （复用 update_task 的校验 / 标签替换 / 草丛不变量 / 字段级操作日志），
/// 然后把消息标记为已接受。留空的字段一律不动。
#[tauri::command]
pub fn apply_chat_message_update<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    id: i64,
) -> AppResult<i64> {
    let (task_id, patch) = {
        let conn = db.0.lock().unwrap();
        let msg = get_message(&conn, id)?;
        if msg.review_status != "pending" || msg.ai_status != "update" {
            return Err(AppError::Invalid("该消息不是待确认的更新建议".into()));
        }
        let (task_id, patch) = update_patch_from_message(&conn, &msg)?;
        conn.execute(
            "UPDATE chat_messages SET review_status='accepted' WHERE id=?1",
            params![id],
        )?;
        record_feedback(&conn, &msg, "accepted", "")?;
        (task_id, patch)
    };
    update_task(app.clone(), db, patch, Some("radio".into()))?;
    events::broadcast(&app, events::CHAT_MESSAGES_CHANGED);
    Ok(task_id)
}

/// 批量分诊：accept = todo 建议落成待办 / update 建议应用更新；dismiss = 批量逃走。
/// 单条失败（已建过/目标已删等）不影响其余，结果逐条汇报。
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchFailure {
    pub id: i64,
    pub error: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchReviewResult {
    pub ok: usize,
    pub failed: Vec<BatchFailure>,
}

#[tauri::command]
pub fn batch_review_chat_messages<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    ids: Vec<i64>,
    action: String,
    reason_code: Option<String>,
) -> AppResult<BatchReviewResult> {
    if ids.is_empty() {
        return Err(AppError::Invalid("未选择任何消息".into()));
    }
    if action != "accept" && action != "dismiss" {
        return Err(AppError::Invalid(format!("未知操作：{action}")));
    }
    let reason = valid_escape_reason(reason_code.as_deref())?;
    let feedback_action = if action == "accept" {
        "accepted"
    } else {
        "dismissed"
    };
    let mut result = BatchReviewResult {
        ok: 0,
        failed: vec![],
    };
    let mut tasks_touched = false;
    for id in ids {
        if action == "accept" {
            // 先在锁内校验并落库状态，再在锁外调 update_task（它自己会拿锁）
            let prepared = {
                let conn = db.0.lock().unwrap();
                let msg = match get_message(&conn, id) {
                    Ok(m) => m,
                    Err(e) => {
                        result.failed.push(BatchFailure {
                            id,
                            error: e.to_string(),
                        });
                        continue;
                    }
                };
                if msg.review_status != "pending" {
                    result.failed.push(BatchFailure {
                        id,
                        error: "该消息已处理过".into(),
                    });
                    continue;
                }
                if msg.ai_status == "update" {
                    match update_patch_from_message(&conn, &msg) {
                        Ok((_, patch)) => {
                            conn.execute(
                                "UPDATE chat_messages SET review_status='accepted' WHERE id=?1",
                                params![id],
                            )?;
                            record_feedback(&conn, &msg, feedback_action, &reason)?;
                            Prepared::ApplyUpdate(Box::new(patch))
                        }
                        Err(e) => {
                            result.failed.push(BatchFailure {
                                id,
                                error: e.to_string(),
                            });
                            continue;
                        }
                    }
                } else {
                    match create_task_from_message(&conn, &msg) {
                        Ok(_) => {
                            record_feedback(&conn, &msg, feedback_action, &reason)?;
                            Prepared::Created
                        }
                        Err(e) => {
                            result.failed.push(BatchFailure {
                                id,
                                error: e.to_string(),
                            });
                            continue;
                        }
                    }
                }
            };
            match prepared {
                Prepared::Created => {
                    result.ok += 1;
                    tasks_touched = true;
                }
                Prepared::ApplyUpdate(patch) => {
                    match update_task(app.clone(), db.clone(), *patch, Some("radio".into())) {
                        Ok(_) => {
                            result.ok += 1;
                            tasks_touched = true;
                        }
                        Err(e) => {
                            // 应用失败回滚确认状态，让用户还能单独重试
                            let conn = db.0.lock().unwrap();
                            let _ = conn.execute(
                                "UPDATE chat_messages SET review_status='pending' WHERE id=?1",
                                params![id],
                            );
                            result.failed.push(BatchFailure {
                                id,
                                error: e.to_string(),
                            });
                        }
                    }
                }
            }
        } else {
            let n = {
                let conn = db.0.lock().unwrap();
                let n = conn.execute(
                    "UPDATE chat_messages SET review_status='dismissed', dismiss_reason=?2
                     WHERE id=?1 AND review_status='pending'",
                    params![id, reason],
                )?;
                if n > 0 {
                    if let Ok(msg) = get_message(&conn, id) {
                        record_feedback(&conn, &msg, feedback_action, &reason)?;
                    }
                }
                n
            };
            if n > 0 {
                result.ok += 1;
            } else {
                result.failed.push(BatchFailure {
                    id,
                    error: "该消息已处理过".into(),
                });
            }
        }
    }
    if tasks_touched {
        events::broadcast(&app, events::TASKS_CHANGED);
    }
    events::broadcast(&app, events::CHAT_MESSAGES_CHANGED);
    Ok(result)
}

/// 批量分诊中单条消息的锁内处理结果（ApplyUpdate 需要锁外调 update_task）
enum Prepared {
    Created,
    ApplyUpdate(Box<TaskPatch>),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::radio::list_chat_messages;
    use crate::commands::radio::testsupport::*;
    use crate::commands::tasks::{get_task, list_tasks};
    use crate::db::Db;
    use tauri::Manager;

    #[test]
    fn accept_creates_task_with_all_ai_attributes() {
        let app = setup();
        seed_tag(&app, "重要");
        let mid = seed_message(&app, "om_1");
        let task_id = {
            let db = app.state::<Db>();
            accept_chat_message(app.handle().clone(), db, mid).unwrap()
        };
        let task = {
            let db = app.state::<Db>();
            get_task(db, task_id).unwrap()
        };
        assert_eq!(task.title, "参加周会");
        assert_eq!(task.note.as_deref(), Some("张三在群里安排"));
        assert_eq!(task.priority, "high");
        assert_eq!(task.due_at.as_deref(), Some("2026-09-13T10:00"));
        assert_eq!(task.status, "scheduled", "有截止时间直接进路线");
        assert_eq!(task.source, "feishu");
        assert_eq!(
            task.tags,
            vec![crate::models::TagRef {
                name: "重要".into(),
                dimension: "topic".into()
            }],
            "AI 建议标签挂上（旧字符串协议归 topic）"
        );
        // 二次接受被拒绝
        let err = {
            let db = app.state::<Db>();
            accept_chat_message(app.handle().clone(), db, mid).unwrap_err()
        };
        assert!(matches!(err, AppError::Invalid(_)));
    }

    #[test]
    fn accept_without_suggestion_truncates_content() {
        let app = setup();
        let mid = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let long = "很长的消息".repeat(20);
            conn.execute(
                "INSERT INTO chat_messages (message_id, chat_name, sender, content, ai_status, review_status, created_at)
                 VALUES ('om_2', '', '', ?1, 'none', 'pending', '2026-09-01T00:00:00Z')",
                params![long],
            )
            .unwrap();
            conn.last_insert_rowid()
        };
        let task_id = {
            let db = app.state::<Db>();
            accept_chat_message(app.handle().clone(), db, mid).unwrap()
        };
        let task = {
            let db = app.state::<Db>();
            get_task(db, task_id).unwrap()
        };
        assert_eq!(task.title.chars().count(), 40);
        assert_eq!(task.status, "inbox", "无截止时间进草丛");
        assert_eq!(task.category_id, 1, "未知分类回落默认");
    }

    /// 模型把 due「留空」输出成空串：捕捉时按无截止处理进草丛，due_at 落库 NULL
    #[test]
    fn accept_with_blank_due_goes_inbox() {
        let app = setup();
        let mid = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO chat_messages (message_id, chat_name, sender, content, suggested_title, suggested_due,
                                            ai_status, review_status, created_at)
                 VALUES ('om_b', '项目群', '张三', '记得交周报', '交周报', '', 'todo', 'pending', '2026-09-11T00:00:00Z')",
                [],
            )
            .unwrap();
            conn.last_insert_rowid()
        };
        let task_id = {
            let db = app.state::<Db>();
            accept_chat_message(app.handle().clone(), db, mid).unwrap()
        };
        let task = {
            let db = app.state::<Db>();
            get_task(db, task_id).unwrap()
        };
        assert_eq!(task.status, "inbox", "空串截止按无截止处理进草丛");
        assert!(task.due_at.is_none(), "due_at 落库 NULL 而非空串");
    }

    #[test]
    fn dismiss_marks_review_status() {
        let app = setup();
        let mid = seed_message(&app, "om_1");
        {
            let db = app.state::<Db>();
            dismiss_chat_message(app.handle().clone(), db, mid, None).unwrap();
        }
        let msgs = {
            let db = app.state::<Db>();
            list_chat_messages(db, None).unwrap()
        };
        assert_eq!(msgs[0].review_status, "dismissed");
        assert!(msgs[0].task_id.is_none(), "逃走不删消息");
    }

    /// 逃走带原因码：原因落 chat_feedback 并关联判定时的 agent
    #[test]
    fn dismiss_with_reason_records_feedback() {
        let app = setup();
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('ai_agents', ?1)",
                params![serde_json::to_string(&[crate::ai::AgentConfig {
                    id: "claude-code".into(),
                    name: "Claude Code".into(),
                    command: "claude".into(),
                    ..Default::default()
                }])
                .unwrap()],
            )
            .unwrap();
        }
        let mid = seed_message(&app, "om_1");
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "UPDATE chat_messages SET ai_agent='claude-code' WHERE id=?1",
                params![mid],
            )
            .unwrap();
        }
        {
            let db = app.state::<Db>();
            dismiss_chat_message(app.handle().clone(), db, mid, Some("duplicate".into())).unwrap();
        }
        let (action, reason, agent_id, agent_name, ai_action): (
            String,
            String,
            String,
            String,
            String,
        ) = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.query_row(
                "SELECT action, reason_code, agent_id, agent_name, ai_action FROM chat_feedback WHERE chat_message_id=?1",
                params![mid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .unwrap()
        };
        assert_eq!(action, "dismissed");
        assert_eq!(reason, "duplicate");
        assert_eq!(agent_id, "claude-code", "反馈关联判定时的 agent");
        assert_eq!(
            agent_name, "Claude Code",
            "agent 名快照防配置删改后无法辨识"
        );
        assert_eq!(ai_action, "todo", "关联建议的 AI 动作");
        let msgs = {
            let db = app.state::<Db>();
            list_chat_messages(db, None).unwrap()
        };
        assert_eq!(
            msgs[0].dismiss_reason, "duplicate",
            "原因随消息行落库（供列表展示）"
        );
    }

    /// 逃走原因码只认白名单；直接逃走（无原因码）也记反馈
    #[test]
    fn dismiss_rejects_unknown_reason_and_allows_plain() {
        let app = setup();
        let mid = seed_message(&app, "om_1");
        let err = {
            let db = app.state::<Db>();
            dismiss_chat_message(app.handle().clone(), db, mid, Some("nope".into())).unwrap_err()
        };
        assert!(matches!(err, AppError::Invalid(_)), "{err}");
        // 无原因码：正常逃走，reason_code 落空串
        {
            let db = app.state::<Db>();
            dismiss_chat_message(app.handle().clone(), db, mid, None).unwrap();
        }
        let (action, reason): (String, String) = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.query_row(
                "SELECT action, reason_code FROM chat_feedback WHERE chat_message_id=?1",
                params![mid],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap()
        };
        assert_eq!((action.as_str(), reason.as_str()), ("dismissed", ""));
    }

    /// 撤销逃走：消息回 pending，误操作落下的反馈被清掉
    #[test]
    fn undo_dismiss_restores_pending_and_clears_feedback() {
        let app = setup();
        let mid = seed_message(&app, "om_1");
        {
            let db = app.state::<Db>();
            dismiss_chat_message(app.handle().clone(), db.clone(), mid, Some("noise".into()))
                .unwrap();
            undo_chat_review(app.handle().clone(), db, mid).unwrap();
        }
        let msgs = {
            let db = app.state::<Db>();
            list_chat_messages(db, None).unwrap()
        };
        assert_eq!(msgs[0].review_status, "pending");
        assert_eq!(msgs[0].dismiss_reason, "", "撤销后原因随状态一起清");
        let feedback: i64 = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.query_row(
                "SELECT COUNT(*) FROM chat_feedback WHERE chat_message_id=?1",
                params![mid],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(feedback, 0, "误操作的反馈不该留在库里");
    }

    /// 撤销捕捉：删除刚建的待办（连带标签/日志）并恢复消息为 pending
    #[test]
    fn undo_accept_deletes_created_task_and_restores() {
        let app = setup();
        seed_tag(&app, "重要");
        let mid = seed_message(&app, "om_1");
        let task_id = {
            let db = app.state::<Db>();
            accept_chat_message(app.handle().clone(), db, mid).unwrap()
        };
        {
            let db = app.state::<Db>();
            undo_chat_review(app.handle().clone(), db, mid).unwrap();
        }
        let msgs = {
            let db = app.state::<Db>();
            list_chat_messages(db, None).unwrap()
        };
        assert_eq!(msgs[0].review_status, "pending");
        assert!(msgs[0].task_id.is_none());
        let (tasks, tags, logs): (i64, i64, i64) = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.query_row(
                "SELECT (SELECT COUNT(*) FROM tasks WHERE id=?1),
                        (SELECT COUNT(*) FROM task_tags WHERE task_id=?1),
                        (SELECT COUNT(*) FROM task_logs WHERE task_id=?1)",
                params![task_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap()
        };
        assert_eq!((tasks, tags, logs), (0, 0, 0), "任务与关联记录一并清理");
    }

    /// 撤销的边界：pending 状态没得撤；待办已被手动删除时只恢复消息状态
    #[test]
    fn undo_rejects_pending_and_tolerates_missing_task() {
        let app = setup();
        let mid = seed_message(&app, "om_1");
        let err = {
            let db = app.state::<Db>();
            undo_chat_review(app.handle().clone(), db, mid).unwrap_err()
        };
        assert!(matches!(err, AppError::Invalid(_)));
        // 捕捉后手动删掉待办：撤销不报错，消息照常回 pending
        let _task_id = {
            let db = app.state::<Db>();
            accept_chat_message(app.handle().clone(), db, mid).unwrap()
        };
        {
            let db = app.state::<Db>();
            {
                let conn = db.0.lock().unwrap();
                conn.execute("DELETE FROM tasks", []).unwrap();
            }
            undo_chat_review(app.handle().clone(), db, mid).unwrap();
        }
        let msgs = {
            let db = app.state::<Db>();
            list_chat_messages(db, None).unwrap()
        };
        assert_eq!(msgs[0].review_status, "pending");
    }

    /// 捕捉与应用更新也落 accepted 反馈
    #[test]
    fn accept_and_apply_update_record_feedback() {
        let app = setup();
        seed_tag(&app, "重要");
        let mid = seed_message(&app, "om_1");
        {
            let db = app.state::<Db>();
            accept_chat_message(app.handle().clone(), db, mid).unwrap();
        }
        let task_id = seed_task(&app, "参加周会");
        let umid = seed_update_message(
            &app,
            "om_u1",
            Some(task_id),
            Some("2026-09-14T10:00"),
            None,
            None,
            "[]",
        );
        {
            let db = app.state::<Db>();
            apply_chat_message_update(app.handle().clone(), db, umid).unwrap();
        }
        let actions: Vec<String> = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let mut stmt = conn
                .prepare("SELECT action FROM chat_feedback ORDER BY id")
                .unwrap();
            stmt.query_map([], |r| r.get::<_, String>(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(actions, vec!["accepted".to_string(); 2]);
    }

    /// 批量逃走带原因码逐条落反馈
    #[test]
    fn batch_dismiss_records_feedback_with_reason() {
        let app = setup();
        let m1 = seed_message(&app, "om_d1");
        let m2 = seed_message(&app, "om_d2");
        {
            let db = app.state::<Db>();
            batch_review_chat_messages(
                app.handle().clone(),
                db,
                vec![m1, m2],
                "dismiss".into(),
                Some("noise".into()),
            )
            .unwrap();
        }
        let rows: Vec<(String, String)> = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let mut stmt = conn
                .prepare("SELECT action, reason_code FROM chat_feedback ORDER BY id")
                .unwrap();
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(
            rows,
            vec![
                ("dismissed".to_string(), "noise".to_string()),
                ("dismissed".to_string(), "noise".to_string())
            ]
        );
        let msgs = {
            let db = app.state::<Db>();
            list_chat_messages(db, None).unwrap()
        };
        assert!(
            msgs.iter().all(|m| m.dismiss_reason == "noise"),
            "批量逃走的原因也随消息行落库"
        );
    }

    /// 应用更新建议：只改 AI 明确给出的字段，其余保持；写入字段级操作日志；消息转为已接受
    #[test]
    fn apply_update_patches_only_given_fields() {
        let app = setup();
        seed_tag(&app, "重要");
        let task_id = seed_task(&app, "参加周会");
        let mid = seed_update_message(
            &app,
            "om_u1",
            Some(task_id),
            Some("2026-09-14T10:00"),
            Some("high"),
            Some("周会（改期）"),
            "[\"重要\"]",
        );
        {
            let db = app.state::<Db>();
            apply_chat_message_update(app.handle().clone(), db, mid).unwrap();
        }
        let task = {
            let db = app.state::<Db>();
            get_task(db, task_id).unwrap()
        };
        assert_eq!(task.title, "周会（改期）");
        assert_eq!(task.due_at.as_deref(), Some("2026-09-14T10:00"));
        assert_eq!(task.priority, "high");
        assert_eq!(
            task.tags,
            vec![crate::models::TagRef {
                name: "重要".into(),
                dimension: "topic".into()
            }],
            "标签全量替换"
        );
        assert_eq!(task.status, "scheduled");
        // 字段级日志（origin=radio）
        let logs: Vec<(String, String)> = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let mut stmt = conn
                .prepare("SELECT field, origin FROM task_logs WHERE task_id=?1 AND action='update'")
                .unwrap();
            stmt.query_map(params![task_id], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert!(logs.len() >= 3, "title/due/priority 各一条: {logs:?}");
        assert!(logs.iter().all(|(_, o)| o == "radio"));
        // 消息转为已接受
        let msgs = {
            let db = app.state::<Db>();
            list_chat_messages(db, None).unwrap()
        };
        let m = msgs.iter().find(|m| m.id == mid).unwrap();
        assert_eq!(m.review_status, "accepted");
        assert_eq!(m.update_task_id, Some(task_id));
        // 二次应用被拒绝
        let err = {
            let db = app.state::<Db>();
            apply_chat_message_update(app.handle().clone(), db, mid).unwrap_err()
        };
        assert!(matches!(err, AppError::Invalid(_)));
    }

    /// 部分字段的建议只动那一处：只改 due，标题/优先级/标签都不变
    #[test]
    fn apply_update_partial_only_touches_due() {
        let app = setup();
        let task_id = seed_task(&app, "参加周会");
        let mid = seed_update_message(
            &app,
            "om_u2",
            Some(task_id),
            Some("2026-09-15T09:00"),
            None,
            None,
            "[]",
        );
        {
            let db = app.state::<Db>();
            apply_chat_message_update(app.handle().clone(), db, mid).unwrap();
        }
        let task = {
            let db = app.state::<Db>();
            get_task(db, task_id).unwrap()
        };
        assert_eq!(task.due_at.as_deref(), Some("2026-09-15T09:00"));
        assert_eq!(task.title, "参加周会");
        assert_eq!(task.priority, "normal");
        assert!(task.tags.is_empty());
    }

    /// 异常路径：非 update 状态 / 缺目标 / 目标已删 / 无可应用字段
    #[test]
    fn apply_update_rejects_invalid_states() {
        let app = setup();
        // 1. 普通 todo 建议不能走应用更新
        let todo_mid = seed_message(&app, "om_t");
        let err = {
            let db = app.state::<Db>();
            apply_chat_message_update(app.handle().clone(), db, todo_mid).unwrap_err()
        };
        assert!(matches!(err, AppError::Invalid(_)));
        // 2. 缺目标待办
        let mid = seed_update_message(
            &app,
            "om_u3",
            None,
            Some("2026-09-15T09:00"),
            None,
            None,
            "[]",
        );
        let err = {
            let db = app.state::<Db>();
            apply_chat_message_update(app.handle().clone(), db, mid).unwrap_err()
        };
        assert!(matches!(err, AppError::Invalid(_)));
        // 3. 目标待办不存在 → NotFound
        let mid = seed_update_message(
            &app,
            "om_u4",
            Some(999),
            Some("2026-09-15T09:00"),
            None,
            None,
            "[]",
        );
        let err = {
            let db = app.state::<Db>();
            apply_chat_message_update(app.handle().clone(), db, mid).unwrap_err()
        };
        assert!(matches!(err, AppError::NotFound(_)), "{err}");
        // 4. 没有任何建议字段（目标存在但没有可应用变更）
        let real_task = seed_task(&app, "真实任务");
        let mid = seed_update_message(&app, "om_u5", Some(real_task), None, None, None, "[]");
        let err = {
            let db = app.state::<Db>();
            apply_chat_message_update(app.handle().clone(), db, mid).unwrap_err()
        };
        assert!(err.to_string().contains("可应用"), "{err}");
    }

    /// 批量捕捉：todo 建待办 + update 应用更新；已处理过的单独报失败不影响其余
    #[test]
    fn batch_accept_mixes_todo_and_update() {
        let app = setup();
        seed_tag(&app, "重要");
        let task_id = seed_task(&app, "参加周会");
        let todo_mid = seed_message(&app, "om_b1");
        let update_mid = seed_update_message(
            &app,
            "om_b2",
            Some(task_id),
            Some("2026-09-16T09:00"),
            None,
            None,
            "[]",
        );
        // 预先逃走一条，批量时按已处理报失败
        let gone_mid = seed_message(&app, "om_b3");
        {
            let db = app.state::<Db>();
            dismiss_chat_message(app.handle().clone(), db, gone_mid, None).unwrap();
        }

        let result = {
            let db = app.state::<Db>();
            batch_review_chat_messages(
                app.handle().clone(),
                db,
                vec![todo_mid, update_mid, gone_mid],
                "accept".into(),
                None,
            )
            .unwrap()
        };
        assert_eq!(result.ok, 2, "{result:?}");
        assert_eq!(result.failed.len(), 1);
        assert_eq!(result.failed[0].id, gone_mid);

        // todo 消息建了待办；update 消息应用了改期
        let task = {
            let db = app.state::<Db>();
            get_task(db, task_id).unwrap()
        };
        assert_eq!(task.due_at.as_deref(), Some("2026-09-16T09:00"));
        let msgs = {
            let db = app.state::<Db>();
            list_chat_messages(db, None).unwrap()
        };
        let todo = msgs.iter().find(|m| m.id == todo_mid).unwrap();
        assert_eq!(todo.review_status, "accepted");
        assert!(todo.task_id.is_some());
        let upd = msgs.iter().find(|m| m.id == update_mid).unwrap();
        assert_eq!(upd.review_status, "accepted");
    }

    /// 批量逃走：pending 全部标记 dismissed，非 pending 的进失败列表
    #[test]
    fn batch_dismiss_marks_pending_only() {
        let app = setup();
        let m1 = seed_message(&app, "om_d1");
        let m2 = seed_message(&app, "om_d2");
        {
            let db = app.state::<Db>();
            accept_chat_message(app.handle().clone(), db, m1).unwrap();
        }
        let result = {
            let db = app.state::<Db>();
            batch_review_chat_messages(
                app.handle().clone(),
                db,
                vec![m1, m2],
                "dismiss".into(),
                None,
            )
            .unwrap()
        };
        assert_eq!(result.ok, 1);
        assert_eq!(result.failed.len(), 1, "已捕捉的不能再逃走");
        let msgs = {
            let db = app.state::<Db>();
            list_chat_messages(db, None).unwrap()
        };
        assert_eq!(
            msgs.iter().find(|m| m.id == m2).unwrap().review_status,
            "dismissed"
        );
    }

    /// 空选集与未知操作直接报输入错误
    #[test]
    fn batch_rejects_empty_and_unknown_action() {
        let app = setup();
        let err = {
            let db = app.state::<Db>();
            batch_review_chat_messages(app.handle().clone(), db, vec![], "accept".into(), None)
                .unwrap_err()
        };
        assert!(matches!(err, AppError::Invalid(_)));
        let mid = seed_message(&app, "om_x1");
        let err = {
            let db = app.state::<Db>();
            batch_review_chat_messages(app.handle().clone(), db, vec![mid], "delete".into(), None)
                .unwrap_err()
        };
        assert!(err.to_string().contains("未知操作"), "{err}");
    }

    /// 回归：accept 后任务出现在 open 列表（避免 INSERT 字段错位静默失败）
    #[test]
    fn accepted_task_shows_in_open_list() {
        let app = setup();
        let mid = seed_message(&app, "om_1");
        let task_id = {
            let db = app.state::<Db>();
            accept_chat_message(app.handle().clone(), db, mid).unwrap()
        };
        let open = {
            let db = app.state::<Db>();
            list_tasks(db, "open".into()).unwrap()
        };
        assert!(open.iter().any(|t| t.id == task_id));
    }
}
