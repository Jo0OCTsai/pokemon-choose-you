//! 判定管线：分类/快速捕捉的 agent 调用与「pk 写回 → 库回读」链路（自 ai 移入）、
//! 批次判定编排（会话落库/健康登记/失败挽救/迟到回看）与批量重判。
use super::context::{chat_context_lines, chat_label_anon, format_context_lines};
use super::review::BatchFailure;
use super::store::get_message;
use super::suggest::{apply_suggestion_conn, load_suggestions_conn};
use crate::ai::{self, AgentConfig, AiMessage, AiSuggestion};
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::events;
use rusqlite::{params, Connection};
use tauri::{Manager, State};

/// 分类一批消息（便捷入口）
pub(crate) async fn classify(
    agent: &AgentConfig,
    batch: &[AiMessage],
    db: &crate::db::Db,
) -> AppResult<Vec<AiSuggestion>> {
    classify_with_session(agent, batch, db, None)
        .await
        .map(|(s, _)| s)
}

/// 预生成会话 id（收音机分类 / 快速捕捉用）：claude 与 pi 的 `--session-id` 都是
/// create-if-absent 语义，id 由应用先行确定——进程超时/出错被杀时信封拿不回 id，
/// 落库侧仍可凭预生成 id 回看现场（agent 工具的转录按 id 保存，与进程退出无关）。
/// 其他 agent 不预生成
pub(crate) fn pregen_session_id(agent: &AgentConfig) -> Option<String> {
    let kind = crate::skills::kind_for_command(&agent.command);
    matches!(kind, Some("claude-code") | Some("pi")).then(|| uuid::Uuid::new_v4().to_string())
}

/// 分类一批消息并带回会话元信息（session_id）：agent 经 pk CLI 把判定写回数据库，
/// 应用不解析其文本输出，跑完后从库回读该批消息的判定结果；
/// pregen 为预生成会话 id（见 pregen_session_id）——成功时信封 id 与之一致，
/// 失败时调用方仍可凭它落库回链
async fn classify_with_session(
    agent: &AgentConfig,
    batch: &[AiMessage],
    db: &crate::db::Db,
    pregen: Option<&str>,
) -> AppResult<(Vec<AiSuggestion>, Option<String>)> {
    let prompt = ai::build_tools_prompt(agent, batch);
    log::debug!(
        "ai: 经 agent「{}」分类 {} 条消息，prompt: {}",
        agent.name,
        batch.len(),
        ai::trunc(&prompt, 500)
    );
    let ids: Vec<String> = batch.iter().map(|m| m.message_id.clone()).collect();
    run_and_collect(agent, &prompt, &ids, db, pregen).await
}

/// 手动快速捕捉：把用户在收音机输入的一条自然语言待办交给 agent 判定结构化属性。
/// 与 IM 分类共用「pk 写回 → 库回读」链路，但提示词不同——输入本身就是用户要建的待办，
/// 不做任务归属判断，重点在抽属性与判重。
pub(crate) async fn capture_with_session(
    agent: &AgentConfig,
    input: &AiMessage,
    db: &crate::db::Db,
    pregen: Option<&str>,
) -> AppResult<(AiSuggestion, Option<String>)> {
    let prompt = ai::build_capture_prompt(agent, input);
    log::debug!(
        "ai: 经 agent「{}」快速捕捉，prompt: {}",
        agent.name,
        ai::trunc(&prompt, 500)
    );
    let (mut list, session_id) = run_and_collect(
        agent,
        &prompt,
        std::slice::from_ref(&input.message_id),
        db,
        pregen,
    )
    .await?;
    let s = list
        .pop()
        .ok_or_else(|| AppError::External("agent 未返回捕捉判定".into()))?;
    Ok((s, session_id))
}

/// 预生成 id 注入 agent 参数（克隆后追加 `--session-id <id>`，不动调用方配置）
fn inject_pregen_args(agent: &AgentConfig, pregen: Option<&str>) -> AgentConfig {
    let mut a = agent.clone();
    if let Some(id) = pregen.map(str::trim).filter(|s| !s.is_empty()) {
        a.args.push_str(" --session-id ");
        a.args.push_str(id);
    }
    a
}

/// 无头跑一次 agent 并从库回读该批消息的判定（分类 / 快速捕捉共用）：
/// 回读后做批内判重兜底，整批遗漏判失败（见各调用方的错误处理约定）。
/// pregen 预生成 id 注入为 `--session-id`（agent 参数克隆后追加，不动调用方配置）
async fn run_and_collect(
    agent: &AgentConfig,
    prompt: &str,
    ids: &[String],
    db: &crate::db::Db,
    pregen: Option<&str>,
) -> AppResult<(Vec<AiSuggestion>, Option<String>)> {
    let a = inject_pregen_args(agent, pregen);
    let out = ai::run_agent(&a, prompt).await?;
    log::debug!("ai: agent 原始输出: {}", ai::trunc(&out, 800));
    let (_, session_id) = ai::extract_payload(&out);
    // agent 进程已结束才拿锁，回读期间不跨 await 持锁
    let suggestions = {
        let conn = db.0.lock().unwrap();
        let mut loaded = load_suggestions_conn(&conn, ids)?;
        let demoted = ai::dedup_batch_todos(&mut loaded);
        for s in loaded.iter().filter(|s| demoted.contains(&s.message_id)) {
            // agent 已把重复 todo 写进建议列：清掉建议载荷并置 none，
            // 收音机里不再出现第二张建议卡
            let _ = conn.execute(
                "UPDATE chat_messages SET ai_status='none', suggested_title=NULL, suggested_note=NULL,
                        suggested_category=NULL, suggested_due=NULL, suggested_priority=NULL,
                        suggested_tags='[]', suggested_reason=?2
                 WHERE message_id=?1",
                rusqlite::params![s.message_id, s.reason],
            );
        }
        if !demoted.is_empty() {
            log::info!("ai: 批内判重兜底，降级 {} 条重复待办", demoted.len());
        }
        loaded
    };
    // agent 退出 0 但一条都没落库（pk 不在 PATH / 工具白名单没放行等）→ 判失败，
    // 让调用方按错误路径标记，避免整批被静默标 none；部分遗漏由调用方按 none 兜底
    let missed = suggestions.iter().filter(|s| s.action == "pending").count();
    if missed == ids.len() {
        return Err(AppError::External(format!(
            "agent「{}」执行完成但没有任何判定落库（{} 条全部遗漏）——请确认其无头模式允许执行 pk 命令（工具白名单，本机 pk 目录已随调用注入 PATH）；可用「测试」按钮跑一次工具探针",
            agent.name, missed
        )));
    }
    // 信封 id 优先（与预生成一致）；拿不回时回退预生成 id（进程异常退出也保住回链）
    let session_id = session_id.or_else(|| pregen.map(str::to_string));
    Ok((suggestions, session_id))
}

/// 把消息标记为「AI 判定失败」的统一实现：只翻转仍是 pending 的消息，并清空残留
/// 建议载荷（error 态没有可展示的建议）。agent 超时被杀前后，它派出的 `pk suggest`
/// 都可能已把判定写库（todo/none/…），无条件覆盖会把已到手的结果抹成失败。
/// 返回实际标记的条数。
pub(crate) fn mark_ai_error_conn(conn: &Connection, message_ids: &[String]) -> AppResult<usize> {
    let mut marked = 0usize;
    for id in message_ids {
        marked += conn.execute(
            "UPDATE chat_messages SET ai_status='error',
                    suggested_title=NULL, suggested_note=NULL, suggested_category=NULL,
                    suggested_due=NULL, suggested_priority=NULL, suggested_tags='[]',
                    suggested_reason=NULL, suggested_confidence=NULL, update_task_id=NULL
             WHERE message_id=?1 AND ai_status='pending'",
            params![id],
        )?;
    }
    Ok(marked)
}

/// 迟到判定的延迟回看：agent 超时被杀后，它已派出的 `pk suggest` 子进程不会随主进程
/// 一起死（孤儿进程），常在几秒后把判定写库、把 error 翻正——pk 是独立进程发不出
/// 应用事件，界面不会自己刷新。等一小段再回看一次，有翻正就广播消息变更。
const LATE_JUDGMENT_GRACE_SECS: u64 = 30;

fn spawn_late_judgment_recheck<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    message_ids: Vec<String>,
) {
    if message_ids.is_empty() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(LATE_JUDGMENT_GRACE_SECS)).await;
        let db = app.state::<Db>();
        let placeholders = std::iter::repeat_n("?", message_ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let flipped: Option<i64> = {
            let conn = db.0.lock().unwrap();
            conn.query_row(
                &format!(
                    "SELECT COUNT(*) FROM chat_messages
                     WHERE ai_status NOT IN ('pending','error') AND message_id IN ({placeholders})"
                ),
                rusqlite::params_from_iter(message_ids.iter()),
                |r| r.get(0),
            )
            .ok()
        };
        if flipped.unwrap_or(0) > 0 {
            log::info!(
                "radio: 迟到的 pk 判定落库（{} 条），广播刷新收音机",
                flipped.unwrap_or(0)
            );
            events::broadcast(&app, events::CHAT_MESSAGES_CHANGED);
        }
    });
}

/// 一批消息的 AI 判定管道：飞书后台轮询与「重判失败」共用。
/// 按 agent_sessions 落分类会话（时长 / 会话 id / 成败）并登记 AI 链路健康；
/// 判定失败时先回读数据库——agent 在超时/出错前可能已把部分判定经 pk 写库
/// （判定落库与进程退出是两件事），已落库的照常收下，未落库的按 pending→error
/// 标记（可重判），并安排迟到回调的延迟回看。返回判定出的新待办数。
pub(crate) async fn classify_and_apply<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    db: &Db,
    agent: &AgentConfig,
    batch: &[AiMessage],
) -> AppResult<usize> {
    let ids: Vec<String> = batch.iter().map(|m| m.message_id.clone()).collect();
    let started = std::time::Instant::now();
    // 预生成会话 id + 执行时快照：失败路径也保住回链（id 落库可回看现场），
    // 历史回放按当时的目录/端点路由，不随 agent 配置后续变更漂移
    let pregen = pregen_session_id(agent);
    let workdir_snapshot = ai::session_workdir_snapshot(agent, &agent.workdir);
    let classified = classify_with_session(agent, batch, db, pregen.as_deref()).await;
    let duration_ms = started.elapsed().as_millis() as i64;
    let suggestions = match classified {
        Ok((s, session_id)) => {
            let conn = db.0.lock().unwrap();
            let mut rec = crate::commands::sessions::NewAgentSession::for_run(
                "classify",
                agent,
                &workdir_snapshot,
            );
            rec.session_id = session_id.or(pregen.clone());
            rec.duration_ms = Some(duration_ms);
            let _ = crate::commands::sessions::log_session_conn(&conn, &rec);
            s
        }
        Err(e) => {
            log::warn!("AI 分类失败（本轮跳过）: {e}");
            app.state::<crate::health::HealthState>().record_failure(
                app,
                crate::health::AI,
                &e.to_string(),
            );
            {
                let conn = db.0.lock().unwrap();
                let mut rec = crate::commands::sessions::NewAgentSession::for_run(
                    "classify",
                    agent,
                    &workdir_snapshot,
                );
                rec.session_id = pregen.clone();
                rec.status = "error".into();
                rec.duration_ms = Some(duration_ms);
                let _ = crate::commands::sessions::log_session_conn(&conn, &rec);
                // 失败回读挽救：已落库的判定保留（pk 已写入，无需重放），
                // 未落库的标 error 待重判；迟到的孤儿回调交给延迟回看
                let loaded = load_suggestions_conn(&conn, &ids)?;
                let landed = loaded.iter().filter(|s| s.action != "pending").count();
                let missed: Vec<String> = loaded
                    .iter()
                    .filter(|s| s.action == "pending")
                    .map(|s| s.message_id.clone())
                    .collect();
                mark_ai_error_conn(&conn, &missed)?;
                if landed > 0 {
                    log::info!(
                        "radio: AI 判定失败但 {landed} / {} 条判定已落库，收下（其余 {} 条标记可重判）",
                        ids.len(),
                        missed.len()
                    );
                }
                spawn_late_judgment_recheck(app.clone(), missed);
                let todos = loaded.iter().filter(|s| s.is_todo()).count();
                return Ok(todos);
            }
        }
    };
    app.state::<crate::health::HealthState>()
        .record_success(app, crate::health::AI);
    let n_todo = suggestions.iter().filter(|s| s.is_todo()).count();
    let n_update = suggestions.iter().filter(|s| s.is_update()).count();
    let n_follow = suggestions.iter().filter(|s| s.is_follow_up()).count();
    log::info!(
        "radio: AI 判定 {}/{} 条：新待办 {n_todo} · 变更建议 {n_update} · 跟进 {n_follow}",
        n_todo + n_update + n_follow,
        batch.len()
    );
    let by_id: std::collections::HashMap<String, &ai::AiSuggestion> = suggestions
        .iter()
        .map(|s| (s.message_id.clone(), s))
        .collect();
    let conn = db.0.lock().unwrap();
    let mut saved = 0usize;
    for m in batch {
        // 未被提及的消息按 none 记状态（AI 没给判定不等于跳过）
        let fallback;
        let s: &ai::AiSuggestion = match by_id.get(&m.message_id) {
            Some(s) => s,
            None => {
                fallback = ai::AiSuggestion {
                    message_id: m.message_id.clone(),
                    ..Default::default()
                };
                &fallback
            }
        };
        if s.is_todo() {
            log::info!(
                "radio: 新待办「{}」分类 {} 优先级 {} due {:?} 标签 {:?}（消息 {}）",
                s.title.as_deref().unwrap_or("-"),
                s.category.as_deref().unwrap_or("-"),
                s.priority.as_deref().unwrap_or("-"),
                s.due,
                s.tags,
                s.message_id
            );
        }
        apply_suggestion_conn(&conn, s, &agent.id)?;
        if s.is_todo() {
            saved += 1;
        }
    }
    Ok(saved)
}

/// 批量重判「AI 判定失败」的结果：ok = 重新拿到判定的条数，仍失败的逐条汇报
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryAiResult {
    pub ok: usize,
    pub failed: Vec<BatchFailure>,
}

/// 批量重判 AI 判定失败的消息：把 error 且未分诊的消息重置 pending（清掉不可信的
/// 残留建议）后重新送 AI——复用轮询的判定管道（含失败挽救与迟到回调回看）。
/// 非 error / 已分诊的逐条报失败，不影响其余。判定失败的明细见诊断中心（AI 链路）。
#[tauri::command]
pub async fn retry_ai_judgment<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<'_, Db>,
    ids: Vec<i64>,
) -> AppResult<RetryAiResult> {
    if ids.is_empty() {
        return Err(AppError::Invalid("未选择任何消息".into()));
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

    let mut result = RetryAiResult {
        ok: 0,
        failed: vec![],
    };
    // 锁内校验并重置 pending；判定对象带上来源标签与同会话上下文（与轮询同语境），
    // 送 AI 的文本全部匿名化（老数据无匿名列时现场 scrub 兜底）
    let mut targets: Vec<(i64, AiMessage)> = vec![];
    {
        let conn = db.0.lock().unwrap();
        let mut rules = crate::anonymize::AnonRules::build(&conn);
        for id in ids {
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
            if msg.ai_status != "error" || msg.review_status != "pending" {
                result.failed.push(BatchFailure {
                    id,
                    error: format!(
                        "该消息当前是「{}」状态，不是可重判的判定失败",
                        msg.ai_status
                    ),
                });
                continue;
            }
            let n = conn.execute(
                "UPDATE chat_messages SET ai_status='pending',
                        suggested_title=NULL, suggested_note=NULL, suggested_category=NULL,
                        suggested_due=NULL, suggested_priority=NULL, suggested_tags='[]',
                        suggested_reason=NULL, suggested_confidence=NULL, update_task_id=NULL
                 WHERE id=?1 AND ai_status='error' AND review_status='pending'",
                params![id],
            )?;
            if n == 0 {
                // 与校验间被并发改掉（如恰好分诊/重判）：跳过不报错
                continue;
            }
            let (anon, at_me): (String, String) = conn
                .query_row(
                    "SELECT content_anon, at_me FROM chat_messages WHERE message_id=?1",
                    params![msg.message_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap_or_default();
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
                    chat_context_lines(
                        &conn,
                        &msg.chat_id,
                        at,
                        &msg.message_id,
                        30 * 60 * 1000,
                        10,
                    ),
                ),
                None => vec![],
            };
            targets.push((
                id,
                AiMessage {
                    message_id: msg.message_id.clone(),
                    sender,
                    chat_label: chat_label_anon(
                        &conn,
                        &mut rules,
                        &msg.chat_id,
                        &msg.chat_type,
                        &msg.chat_name,
                    ),
                    content,
                    context,
                    mention_note: ai::mention_note(&at_me, "", rules.same_name_risk),
                },
            ));
        }
    }
    for chunk in targets.chunks(20) {
        let batch: Vec<AiMessage> = chunk.iter().map(|(_, m)| m.clone()).collect();
        classify_and_apply(&app, &db, &agent, &batch).await?;
    }
    // 按最终状态汇总：不再是 error 即拿到判定（todo/update/followup/none 都算）
    {
        let conn = db.0.lock().unwrap();
        for (id, m) in &targets {
            let status: String = conn
                .query_row(
                    "SELECT ai_status FROM chat_messages WHERE message_id=?1",
                    params![m.message_id],
                    |r| r.get(0),
                )
                .unwrap_or_else(|_| "error".into());
            if status == "error" {
                result.failed.push(BatchFailure {
                    id: *id,
                    error: "AI 判定仍失败（明细见诊断中心）".into(),
                });
            } else {
                result.ok += 1;
            }
        }
    }
    events::broadcast(&app, events::CHAT_MESSAGES_CHANGED);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::radio::testsupport::*;
    use crate::db::Db;
    use tauri::Manager;

    /// 判定失败标记只翻转 pending：pk 已落库的判定（todo/none）不被覆盖成 error，
    /// pending 的残留建议载荷一并清空（error 态没有可展示的建议）
    #[test]
    fn mark_ai_error_only_flips_pending_and_clears_payload() {
        let app = setup();
        seed_status_message(&app, "om_pending", "pending", "pending");
        seed_status_message(&app, "om_todo", "todo", "pending");
        seed_status_message(&app, "om_none", "none", "pending");
        seed_status_message(&app, "om_error", "error", "pending");
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let n = mark_ai_error_conn(
                &conn,
                &[
                    "om_pending".into(),
                    "om_todo".into(),
                    "om_none".into(),
                    "om_error".into(),
                    "om_missing".into(),
                ],
            )
            .unwrap();
            assert_eq!(n, 1, "只有 pending 被标记，不存在的 id 不计");
        }
        assert_eq!(
            ai_status_of(&app, "om_pending"),
            ("error".into(), None),
            "pending → error 且残留建议被清"
        );
        assert_eq!(
            ai_status_of(&app, "om_todo"),
            ("todo".into(), Some("残留建议".into())),
            "已落库判定不被覆盖"
        );
        assert_eq!(ai_status_of(&app, "om_none").0, "none");
        assert_eq!(ai_status_of(&app, "om_error").0, "error");
    }

    /// 失败挽救（用户报告的核心场景）：agent 超时/非零退出时，pk 可能已把部分判定写库
    /// ——已落库的保留，未落库的标 error 待重判，新待办数按已落库的计
    #[test]
    fn classify_failure_salvages_landed_judgments() {
        let app = setup();
        // om_landed 模拟 agent 被杀前 pk 已写入的 todo 判定；om_missed 仍是 pending
        seed_status_message(&app, "om_landed", "pending", "pending");
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO chat_messages (message_id, chat_name, sender, content, ai_status, review_status, created_at)
                 VALUES ('om_missed', '项目群', '李四', '记得交周报', 'pending', 'pending', '2026-09-11T00:00:00Z')",
                [],
            )
            .unwrap();
            conn.execute(
                "UPDATE chat_messages SET ai_status='todo', suggested_title='参加周会' WHERE message_id='om_landed'",
                [],
            )
            .unwrap();
        }
        let agent = AgentConfig {
            id: "fake".into(),
            name: "Fake".into(),
            command: "/usr/bin/false".into(),
            timeout_secs: 10,
            ..Default::default()
        };
        let batch = vec![
            AiMessage::simple("om_landed", "张三", "明天 10 点开周会"),
            AiMessage::simple("om_missed", "李四", "记得交周报"),
        ];
        let todos = {
            let db = app.state::<Db>();
            tauri::async_runtime::block_on(classify_and_apply(app.handle(), &db, &agent, &batch))
        }
        .unwrap();
        assert_eq!(todos, 1, "挽救出的 todo 计入新待办数");
        assert_eq!(
            ai_status_of(&app, "om_landed"),
            ("todo".into(), Some("参加周会".into())),
            "已落库判定保留，不被失败标记覆盖"
        );
        assert_eq!(
            ai_status_of(&app, "om_missed").0,
            "error",
            "未落库的标记判定失败（可重判）"
        );
    }

    /// 批量重判：只动 error 且未分诊的消息（重置→重判；失败则回到 error 且残留建议被清），
    /// 其余状态逐条报失败；空选择直接拒绝
    #[test]
    fn retry_ai_judgment_rejects_non_error_and_reports_still_failed() {
        let app = setup();
        seed_agent(&app, "/usr/bin/false");
        let err1 = seed_status_message(&app, "om_err1", "error", "pending");
        let err2 = seed_status_message(&app, "om_err2", "error", "pending");
        let todo_id = seed_status_message(&app, "om_todo", "todo", "pending");
        let dismissed_err = seed_status_message(&app, "om_err3", "error", "dismissed");

        let err = tauri::async_runtime::block_on(async {
            let db = app.state::<Db>();
            retry_ai_judgment(app.handle().clone(), db, vec![]).await
        })
        .unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)), "空选择拒绝: {err}");

        let r = tauri::async_runtime::block_on(async {
            let db = app.state::<Db>();
            retry_ai_judgment(
                app.handle().clone(),
                db,
                vec![err1, err2, todo_id, dismissed_err],
            )
            .await
        })
        .unwrap();
        assert_eq!(r.ok, 0, "agent 失败 → 无一拿到判定");
        assert_eq!(r.failed.len(), 4, "仍失败的 + 状态不符的逐条汇报");
        assert_eq!(
            ai_status_of(&app, "om_err1").0,
            "error",
            "重判失败回到 error"
        );
        assert_eq!(
            ai_status_of(&app, "om_err2"),
            ("error".into(), None),
            "重置时清掉不可信的残留建议"
        );
        assert_eq!(
            ai_status_of(&app, "om_todo"),
            ("todo".into(), Some("残留建议".into())),
            "非 error 状态不被重置"
        );
        assert_eq!(
            ai_status_of(&app, "om_err3").0,
            "error",
            "已分诊的 error 不被动"
        );
    }

    /// 预生成会话 id 只给 create-if-absent 语义的 agent（claude / pi），其他不预生成
    #[test]
    fn pregen_session_id_gates_by_agent_kind() {
        let claude = AgentConfig {
            command: "claude".into(),
            ..Default::default()
        };
        let pi = AgentConfig {
            command: "pi".into(),
            ..Default::default()
        };
        let opencode = AgentConfig {
            command: "opencode".into(),
            ..Default::default()
        };
        assert!(pregen_session_id(&claude).is_some());
        assert!(pregen_session_id(&pi).is_some());
        let id = pregen_session_id(&claude).unwrap();
        assert!(uuid::Uuid::parse_str(&id).is_ok(), "uuid v4: {id}");
        assert!(
            pregen_session_id(&opencode).is_none(),
            "无 create-if-absent 语义的 agent 不预生成"
        );
    }

    #[test]
    fn inject_pregen_args_appends_session_flag() {
        let agent = AgentConfig {
            args: "-p {prompt} --allowedTools Bash(pk:*) --output-format json".into(),
            ..Default::default()
        };
        let injected = inject_pregen_args(&agent, Some("0b0ae984-x"));
        assert!(
            injected
                .args
                .ends_with("--output-format json --session-id 0b0ae984-x"),
            "追加在原参数之后: {}",
            injected.args
        );
        assert_eq!(
            agent.args, "-p {prompt} --allowedTools Bash(pk:*) --output-format json",
            "原配置不动"
        );
        assert_eq!(inject_pregen_args(&agent, None).args, agent.args);
        assert_eq!(inject_pregen_args(&agent, Some("  ")).args, agent.args);
    }
}
