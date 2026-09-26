//! 手动捕捉：快速捕捉（自然语言 → AI 判定 → 待办/建议卡）与强制建待办（AI 判重优先）。
use super::context::{chat_context_lines, chat_label, chat_label_anon, format_context_lines};
use super::judge::{capture_with_session, classify, mark_ai_error_conn, pregen_session_id};
use super::store::get_message;
use super::suggest::{apply_suggestion_conn, create_task_from_message, record_feedback};
use crate::ai::{self, AgentConfig, AiMessage};
use crate::db::{now, Db};
use crate::error::{AppError, AppResult};
use crate::events;
use crate::models::ChatMessage;
use rusqlite::params;
use tauri::{Manager, State};

/// 强制为消息创建待办：先让 AI 判重（对照现有待办清单），
/// 判定为跟进/重复则不建并告知；其余情况照建（AI 建议优先，无建议用消息截断）。
#[tauri::command]
pub async fn force_create_todo<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<'_, Db>,
    id: i64,
) -> AppResult<i64> {
    let (msg, agent) = {
        let conn = db.0.lock().unwrap();
        let msg = get_message(&conn, id)?;
        if msg.task_id.is_some() {
            return Err(AppError::Invalid("该消息已创建过待办".into()));
        }
        let get = |k: &str| -> Option<String> {
            conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| {
                r.get::<_, String>(0)
            })
            .ok()
        };
        let agent: Option<AgentConfig> = ai::primary_agent(&get);
        (msg, agent)
    };
    let agent = agent.ok_or_else(|| AppError::Invalid("请先在设置中配置 AI Agent".into()))?;

    // 判定对象带上来源标签与同会话近期上下文，和后台轮询的语境一致
    // （判重上下文由 agent 执行 pk context 自取）；送 AI 的文本全部匿名化
    let (label, context, sender_anon, content_anon, note) = {
        let conn = db.0.lock().unwrap();
        let mut rules = crate::anonymize::AnonRules::build(&conn);
        let label = chat_label_anon(
            &conn,
            &mut rules,
            &msg.chat_id,
            &msg.chat_type,
            &msg.chat_name,
        );
        let (anon, at_me): (String, String) = conn
            .query_row(
                "SELECT content_anon, at_me FROM chat_messages WHERE message_id=?1",
                params![msg.message_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap_or_default();
        // 老数据无匿名列：现场 scrub 真名版兜底，真名同样不进 prompt
        let content = if anon.is_empty() {
            rules.scrub(&msg.content)
        } else {
            anon
        };
        let sender = if msg.is_self {
            crate::anonymize::ME.to_string()
        } else if msg.sender_id.is_empty() {
            "成员".to_string()
        } else {
            rules.alias_of(&conn, &msg.sender_id)
        };
        let context = match msg.sent_at {
            Some(at) => format_context_lines(
                &conn,
                &mut rules,
                chat_context_lines(&conn, &msg.chat_id, at, &msg.message_id, 30 * 60 * 1000, 10),
            ),
            None => vec![],
        };
        let note = ai::mention_note(&at_me, &content, rules.same_name_risk);
        (label, context, sender, content, note)
    };
    let res = classify(
        &agent,
        &[AiMessage {
            message_id: msg.message_id.clone(),
            sender: sender_anon,
            chat_label: label,
            content: content_anon,
            context,
            mention_note: note,
        }],
        &db,
    )
    .await;

    let sugg = match res {
        Ok(s) => s.into_iter().find(|s| s.message_id == msg.message_id),
        Err(e) => {
            let conn = db.0.lock().unwrap();
            // 只翻转仍未落库判定的消息：分类失败前 pk 可能已把判定写库，不能覆盖
            let _ = mark_ai_error_conn(&conn, std::slice::from_ref(&msg.message_id));
            app.state::<crate::health::HealthState>().record_failure(
                &app,
                crate::health::AI,
                &e.to_string(),
            );
            return Err(e);
        }
    };
    if sugg.is_some() {
        app.state::<crate::health::HealthState>()
            .record_success(&app, crate::health::AI);
    }

    // AI 判重：消息是现有待办的跟进 → 挂跟进记录，不重复建待办
    if let Some(s) = &sugg {
        if s.is_follow_up() {
            let task_id = s.follow_up_task_id.unwrap();
            let title: Option<String> = {
                let conn = db.0.lock().unwrap();
                let title: Option<String> = conn
                    .query_row(
                        "SELECT title FROM tasks WHERE id=?1",
                        params![task_id],
                        |r| r.get(0),
                    )
                    .ok();
                if title.is_some() {
                    apply_suggestion_conn(&conn, s, &agent.id)?;
                }
                title
            };
            let Some(title) = title else {
                return Err(AppError::Invalid(format!(
                    "AI 认为是待办 {task_id} 的跟进，但该待办已不存在"
                )));
            };
            events::broadcast(&app, events::TASKS_CHANGED);
            events::broadcast(&app, events::CHAT_MESSAGES_CHANGED);
            return Err(AppError::Invalid(format!(
                "AI 判重：该消息是待办 No.{task_id}「{title}」的跟进，已添加跟进记录"
            )));
        }
    }

    // AI 判定消息是现有待办的变更（改期/改优先级等）→ 不建新待办，
    // 落成「更新建议」卡由用户在收音机确认应用
    if let Some(s) = &sugg {
        if s.is_update() {
            let task_id = s.update_task_id.unwrap();
            let conn = db.0.lock().unwrap();
            let title: Option<String> = conn
                .query_row(
                    "SELECT title FROM tasks WHERE id=?1",
                    params![task_id],
                    |r| r.get(0),
                )
                .ok();
            if title.is_none() {
                return Err(AppError::Invalid(format!(
                    "AI 认为是待办 {task_id} 的变更，但该待办已不存在"
                )));
            }
            apply_suggestion_conn(&conn, s, &agent.id)?;
            drop(conn);
            events::broadcast(&app, events::CHAT_MESSAGES_CHANGED);
            let title = title.unwrap_or_default();
            return Err(AppError::Invalid(format!(
                "AI 判定：该消息是待办 No.{task_id}「{title}」的变更而非新待办，已生成更新建议，请到收音机确认应用"
            )));
        }
    }

    // 照建：AI 给了建议就用建议（todo），否则用消息截断兜底（none/缺失）
    let task_id = {
        let conn = db.0.lock().unwrap();
        let mut msg = get_message(&conn, id)?;
        if let Some(s) = &sugg {
            apply_suggestion_conn(&conn, s, &agent.id)?;
            msg = get_message(&conn, id)?;
        }
        let task_id = create_task_from_message(&conn, &msg)?;
        // 强制捕捉本身是反馈：AI 原判（none/error/miss）被用户推翻
        record_feedback(&conn, &msg, "forced", "")?;
        task_id
    };
    events::broadcast(&app, events::TASKS_CHANGED);
    events::broadcast(&app, events::CHAT_MESSAGES_CHANGED);
    Ok(task_id)
}

/// 快速捕捉的结果：判定后的消息（前端据此选中新条目）+ 自动捕捉已建的待办 id
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureOutcome {
    pub message: ChatMessage,
    /// action=todo 时自动落成的待办 id（撤销走 undo_chat_review）；其余为 None
    pub task_id: Option<i64>,
}

/// 收音机手动快速捕捉：把用户输入的一条自然语言落成 local 消息，交 AI 判定
/// 结构化属性（标题/分类/标签/截止/优先级/备注），再按判定结果分流：
/// - todo → 直接建待办（用户自己输入的，意图明确无需再确认；5 秒撤销窗口兜底）
/// - update / followUp / none（判重命中现有待办）→ 留在收音机待人工确认
/// - 判定失败 → 消息标 error 保留，可在收音机强制捕捉或逃走
#[tauri::command]
pub async fn capture_todo<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<'_, Db>,
    input: String,
) -> AppResult<CaptureOutcome> {
    const MAX_CAPTURE_CHARS: usize = 500;
    let text = input.trim().to_string();
    if text.is_empty() {
        return Err(AppError::Invalid("请输入待办内容".into()));
    }
    if text.chars().count() > MAX_CAPTURE_CHARS {
        return Err(AppError::Invalid(format!(
            "捕捉内容太长（最多 {MAX_CAPTURE_CHARS} 字），拆成几条分别记吧"
        )));
    }

    let agent = {
        let conn = db.0.lock().unwrap();
        let get = |k: &str| -> Option<String> {
            conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| {
                r.get::<_, String>(0)
            })
            .ok()
        };
        ai::primary_agent(&get)
    }
    .ok_or_else(|| AppError::Invalid("请先在设置中配置 AI Agent".into()))?;

    // 落库成 local 消息：与飞书消息同一张表、同一套建议列与分诊流，AI 出口（pk suggest）无需区分。
    // content 存原文（真名，用户可见），content_anon 存匿名版（用户输入里提及的成员名代号化）
    let message_id = format!("cap_{}", uuid::Uuid::new_v4());
    let (row_id, anon) = {
        let conn = db.0.lock().unwrap();
        let rules = crate::anonymize::AnonRules::build(&conn);
        let anon = rules.scrub(&text);
        conn.execute(
            "INSERT INTO chat_messages (message_id, chat_id, chat_name, chat_type, sender, sender_id,
                                        content, content_anon, sent_at, is_self, ai_status, review_status, created_at)
             VALUES (?1,'','', 'local', '我', '', ?2, ?3, ?4, 1, 'pending', 'pending', ?5)",
            params![message_id, text, anon, chrono::Utc::now().timestamp_millis(), now()],
        )?;
        (conn.last_insert_rowid(), anon)
    };

    // 会话回链与健康记录与飞书轮询同口径：时长 / session_id / 成败（预生成 id 失败也落库）
    let started = std::time::Instant::now();
    let pregen = pregen_session_id(&agent);
    let workdir_snapshot = ai::session_workdir_snapshot(&agent, &agent.workdir);
    let judged = capture_with_session(
        &agent,
        &AiMessage {
            message_id: message_id.clone(),
            sender: "我".into(),
            chat_label: chat_label("local", ""),
            content: anon,
            context: vec![],
            mention_note: String::new(),
        },
        &db,
        pregen.as_deref(),
    )
    .await;
    let duration_ms = started.elapsed().as_millis() as i64;

    let (suggestion, session_id) = match judged {
        Ok(v) => v,
        Err(e) => {
            {
                let conn = db.0.lock().unwrap();
                let _ = mark_ai_error_conn(&conn, std::slice::from_ref(&message_id));
                let mut rec = crate::commands::sessions::NewAgentSession::for_run(
                    "capture",
                    &agent,
                    &workdir_snapshot,
                );
                rec.session_id = pregen.clone();
                rec.status = "error".into();
                rec.duration_ms = Some(duration_ms);
                let _ = crate::commands::sessions::log_session_conn(&conn, &rec);
            }
            app.state::<crate::health::HealthState>().record_failure(
                &app,
                crate::health::AI,
                &e.to_string(),
            );
            events::broadcast(&app, events::CHAT_MESSAGES_CHANGED);
            return Err(e);
        }
    };
    app.state::<crate::health::HealthState>()
        .record_success(&app, crate::health::AI);
    {
        let conn = db.0.lock().unwrap();
        let mut rec = crate::commands::sessions::NewAgentSession::for_run(
            "capture",
            &agent,
            &workdir_snapshot,
        );
        rec.session_id = session_id.or(pregen.clone());
        rec.duration_ms = Some(duration_ms);
        let _ = crate::commands::sessions::log_session_conn(&conn, &rec);
    }
    log::info!(
        "capture: 快速捕捉「{text}」判定为 {}（{}）",
        suggestion.action,
        suggestion.reason.as_deref().unwrap_or("")
    );

    // todo → 直接建待办（含记录 accepted 反馈）；判重类结果留待收音机确认
    let task_id = if suggestion.is_todo() {
        let conn = db.0.lock().unwrap();
        let msg = get_message(&conn, row_id)?;
        let task_id = create_task_from_message(&conn, &msg)?;
        record_feedback(&conn, &msg, "accepted", "")?;
        Some(task_id)
    } else {
        None
    };
    events::broadcast(&app, events::TASKS_CHANGED);
    events::broadcast(&app, events::CHAT_MESSAGES_CHANGED);
    let message = {
        let conn = db.0.lock().unwrap();
        get_message(&conn, row_id)?
    };
    Ok(CaptureOutcome { message, task_id })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::radio::testsupport::*;
    use crate::commands::radio::{accept_chat_message, list_chat_messages, undo_chat_review};
    use crate::commands::tasks::get_task;
    use crate::db::Db;
    use tauri::Manager;

    /// 强制建待办的 AI 判重分支（不走 HTTP，直接构造 AppError 路径之外的状态机）：
    /// 已建过待办的消息直接拒绝
    #[test]
    fn force_create_rejects_message_with_existing_task() {
        let app = setup();
        let mid = seed_message(&app, "om_1");
        {
            let db = app.state::<Db>();
            accept_chat_message(app.handle().clone(), db, mid).unwrap();
        }
        let err = tauri::async_runtime::block_on(async {
            let db = app.state::<Db>();
            force_create_todo(app.handle().clone(), db, mid).await
        })
        .unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)));
    }

    /// 未配置 AI 时强制建待办给出可操作的提示
    #[test]
    fn force_create_requires_ai_config() {
        let app = setup();
        let mid = seed_message(&app, "om_1");
        let err = tauri::async_runtime::block_on(async {
            let db = app.state::<Db>();
            force_create_todo(app.handle().clone(), db, mid).await
        })
        .unwrap_err();
        assert!(err.to_string().contains("AI"), "提示配置 AI: {err}");
    }

    /// 未配置 AI / 空输入 / 超长输入：可操作的报错，且不落消息
    #[test]
    fn capture_rejects_missing_agent_and_bad_input() {
        let app = setup();
        let text = "明天 10 点交周报".to_string();
        let err = tauri::async_runtime::block_on(async {
            let db = app.state::<Db>();
            capture_todo(app.handle().clone(), db, text).await
        })
        .unwrap_err();
        assert!(err.to_string().contains("AI"), "提示配置 AI: {err}");

        seed_agent(&app, "/usr/bin/true");
        for bad in ["  ".to_string(), "a".repeat(501)] {
            let err = tauri::async_runtime::block_on(async {
                let db = app.state::<Db>();
                capture_todo(app.handle().clone(), db, bad).await
            })
            .unwrap_err();
            assert!(matches!(err, AppError::Invalid(_)), "{err}");
        }
        let n: i64 = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.query_row("SELECT COUNT(*) FROM chat_messages", [], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(n, 0, "校验失败不落消息");
    }

    /// agent 执行失败（非零退出）：消息保留并标 error，命令报错（前端 toast、可强制捕捉）
    #[test]
    fn capture_agent_failure_marks_error() {
        let app = setup();
        seed_agent(&app, "/usr/bin/false");
        let err = tauri::async_runtime::block_on(async {
            let db = app.state::<Db>();
            capture_todo(app.handle().clone(), db, "明天 10 点交周报".into()).await
        })
        .unwrap_err();
        assert!(!err.to_string().is_empty());
        let msgs = {
            let db = app.state::<Db>();
            list_chat_messages(db, None).unwrap()
        };
        assert_eq!(msgs.len(), 1, "失败的消息仍保留在收音机");
        assert_eq!(msgs[0].chat_type, "local");
        assert_eq!(msgs[0].ai_status, "error");
        assert_eq!(msgs[0].review_status, "pending");
    }

    /// local 消息捕捉建待办：source=capture，撤销窗口内可回滚（与 feishu 同一套安全域）
    #[test]
    fn accept_local_message_creates_capture_source_task_and_undo_deletes() {
        let app = setup();
        let mid = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO chat_messages (message_id, chat_type, sender, content, suggested_title,
                                            suggested_due, ai_status, review_status, created_at)
                 VALUES ('cap_1', 'local', '我', '明天 10 点交周报', '交周报', '2026-09-21T10:00',
                         'todo', 'pending', '2026-09-20T00:00:00Z')",
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
        assert_eq!(task.source, "capture", "手动捕捉的任务来源标记");
        {
            let db = app.state::<Db>();
            undo_chat_review(app.handle().clone(), db.clone(), mid).unwrap();
        }
        let n: i64 = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.query_row(
                "SELECT COUNT(*) FROM tasks WHERE source='capture'",
                [],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(n, 0, "capture 来源在撤销安全域内，可删除回滚");
    }
}
