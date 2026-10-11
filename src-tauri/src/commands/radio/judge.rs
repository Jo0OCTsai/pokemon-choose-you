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

/// 分类一批消息（便捷入口；未走 claim 协议——强制建待办的判重语境，沿用 pending 语义）
pub(crate) async fn classify(
    agent: &AgentConfig,
    batch: &[AiMessage],
    db: &crate::db::Db,
) -> AppResult<Vec<AiSuggestion>> {
    classify_with_session(agent, batch, db, None, None)
        .await
        .map(|(s, _, _)| s)
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
/// 失败时调用方仍可凭它落库回链；
/// claim_ts 为判定 claim 令牌（classify_and_apply 抢占所得，§5.4 / 条目 3）：
/// 回读按它做消费侧守卫（A22），None = 未走 claim 协议（不校验归属）。
/// 返回 (建议, 会话 id, claim 失配丢弃的 message_id)
async fn classify_with_session(
    agent: &AgentConfig,
    batch: &[AiMessage],
    db: &crate::db::Db,
    pregen: Option<&str>,
    claim_ts: Option<&str>,
) -> AppResult<(Vec<AiSuggestion>, Option<String>, Vec<String>)> {
    // 锁内点查覆盖行并解析（微秒级点查，不跨 await），释锁后再拼装与调用
    let resolved = {
        let conn = db.0.lock().unwrap();
        let get = |k: &str| -> Option<String> {
            conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| {
                r.get::<_, String>(0)
            })
            .ok()
        };
        ai::effective_system_prompt(&get, ai::PromptFeature::ImClassify)
    };
    let prompt = ai::build_tools_prompt(&resolved.text, agent, batch);
    log::debug!(
        "ai: 经 agent「{}」分类 {} 条消息，prompt: {}",
        agent.name,
        batch.len(),
        prompt_debug_preview(&resolved, &prompt)
    );
    let ids: Vec<String> = batch.iter().map(|m| m.message_id.clone()).collect();
    run_and_collect(agent, &prompt, &ids, db, pregen, claim_ts).await
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
    let resolved = {
        let conn = db.0.lock().unwrap();
        let get = |k: &str| -> Option<String> {
            conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| {
                r.get::<_, String>(0)
            })
            .ok()
        };
        ai::effective_system_prompt(&get, ai::PromptFeature::Capture)
    };
    let prompt = ai::build_capture_prompt(&resolved.text, agent, input);
    log::debug!(
        "ai: 经 agent「{}」快速捕捉，prompt: {}",
        agent.name,
        prompt_debug_preview(&resolved, &prompt)
    );
    let (mut list, session_id, _) = run_and_collect(
        agent,
        &prompt,
        std::slice::from_ref(&input.message_id),
        db,
        pregen,
        None, // 手动捕捉未走 claim 协议（消息由本命令创建，无并发判定方）
    )
    .await?;
    let s = list
        .pop()
        .ok_or_else(|| AppError::External("agent 未返回捕捉判定".into()))?;
    Ok((s, session_id))
}

/// debug 日志的 prompt 回显（隐私 NFR）：自定义覆盖不回显内容（用户手输文本可能含
/// 个人信息），默认/回落文本是编译常量照常截断回显
fn prompt_debug_preview(resolved: &ai::ResolvedPrompt, prompt: &str) -> String {
    if resolved.source == ai::PromptSource::Custom {
        format!(
            "[自定义覆盖 {} 字符，内容不回显]",
            resolved.text.chars().count()
        )
    } else {
        ai::trunc(prompt, 500)
    }
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
/// pregen 预生成 id 注入为 `--session-id`（agent 参数克隆后追加，不动调用方配置）。
/// claim_ts（条目 3 / A22）：回读做消费侧守卫——只采纳仍属本批 claim 的行；
/// 返回三元组 (建议, 会话 id, 失配丢弃的 message_id)，丢弃行不进建议列表、
/// 调用方不得对它们落任何兜底态（留给持有 claim 的一方 / 下一轮）
async fn run_and_collect(
    agent: &AgentConfig,
    prompt: &str,
    ids: &[String],
    db: &crate::db::Db,
    pregen: Option<&str>,
    claim_ts: Option<&str>,
) -> AppResult<(Vec<AiSuggestion>, Option<String>, Vec<String>)> {
    let a = inject_pregen_args(agent, pregen);
    let out = ai::run_agent(&a, prompt).await?;
    log::debug!("ai: agent 原始输出: {}", ai::trunc(&out, 800));
    let (_, session_id) = ai::extract_payload(&out);
    // agent 进程已结束才拿锁，回读期间不跨 await 持锁
    let (loaded, dropped) = {
        let conn = db.0.lock().unwrap();
        let loaded = load_suggestions_conn(&conn, ids)?;
        // 消费侧守卫（A22）：claim 令牌失配的判定不采纳——迟到孤儿写不污染新判定
        let (mut loaded, dropped) = match claim_ts {
            Some(ts) => filter_by_claim_conn(&conn, loaded, ts)?,
            None => (loaded, vec![]),
        };
        if !dropped.is_empty() {
            log::info!("radio: {} 条判定因 claim 失配不采纳（A22）", dropped.len());
        }
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
        (loaded, dropped)
    };
    // agent 退出 0 但 claim 到的一条都没落库（pk 不在 PATH / 工具白名单没放行等）→ 判失败，
    // 让调用方按错误路径标记，避免整批被静默标 none；部分遗漏由调用方按 none 兜底
    // （条目 3：整批失败口径 = claim 后仍全部未落库；失配丢弃行同样算未落库）
    let landed = loaded.iter().filter(|s| s.action != "pending").count();
    if landed == 0 && !ids.is_empty() {
        return Err(AppError::External(format!(
            "agent「{}」执行完成但没有任何判定落库（{} 条全部遗漏）——请确认其无头模式允许执行 pk 命令（工具白名单，本机 pk 目录已随调用注入 PATH）；可用「测试」按钮跑一次工具探针",
            agent.name, ids.len()
        )));
    }
    // 信封 id 优先（与预生成一致）；拿不回时回退预生成 id（进程异常退出也保住回链）
    let session_id = session_id.or_else(|| pregen.map(str::to_string));
    Ok((loaded, session_id, dropped))
}

/// 把消息标记为「AI 判定失败」的统一实现：只翻转仍未落库判定的消息，并清空残留
/// 建议载荷（error 态没有可展示的建议）。agent 超时被杀前后，它派出的 `pk suggest`
/// 都可能已把判定写库（todo/none/…），无条件覆盖会把已到手的结果抹成失败。
/// claim（条目 3 / A22）：None = 未走 claim 协议的路径（快速捕捉/强制建待办），
/// 沿用 pending 守卫；Some = claim 路径，只翻转本 claim 抢到的行（judging 且令牌
/// 匹配）——令牌失配（被回收/重归属）的留在原状待重判，不污染其他形态的判定。
/// 返回实际标记的条数。
pub(crate) fn mark_ai_error_conn(
    conn: &Connection,
    message_ids: &[String],
    claim: Option<&str>,
) -> AppResult<usize> {
    let mut marked = 0usize;
    for id in message_ids {
        marked += match claim {
            None => conn.execute(
                "UPDATE chat_messages SET ai_status='error',
                        suggested_title=NULL, suggested_note=NULL, suggested_category=NULL,
                        suggested_due=NULL, suggested_priority=NULL, suggested_tags='[]',
                        suggested_reason=NULL, suggested_confidence=NULL, update_task_id=NULL
                 WHERE message_id=?1 AND ai_status='pending'",
                params![id],
            )?,
            Some(ts) => conn.execute(
                "UPDATE chat_messages SET ai_status='error',
                        suggested_title=NULL, suggested_note=NULL, suggested_category=NULL,
                        suggested_due=NULL, suggested_priority=NULL, suggested_tags='[]',
                        suggested_reason=NULL, suggested_confidence=NULL, update_task_id=NULL
                 WHERE message_id=?1 AND ai_status='judging' AND judge_claimed_at=?2",
                params![id, ts],
            )?,
        };
    }
    Ok(marked)
}

/// 判定 claim 超时回收窗口（A6）：claim 后进程崩溃/被杀不会自己恢复，超过该窗口的
/// judging 行回置 pending 待任一形态重判（rfc3339 字典序与时间序一致）
const JUDGING_TIMEOUT_MINUTES: i64 = 10;

/// 判定 claim（§5.4 / §7.1 条目 3，A22）：pending → judging 原子抢占并写 claim 令牌
/// （judge_claimed_at 时间戳，本批共用一个）。返回实际 claim 到的子集——claim 落空的
/// 消息属其他形态/下一轮（不报错），调用方只对子集继续判定。
pub(crate) fn claim_judging_conn(
    conn: &Connection,
    message_ids: &[String],
    claim_ts: &str,
) -> AppResult<Vec<String>> {
    let mut claimed = vec![];
    for id in message_ids {
        let n = conn.execute(
            "UPDATE chat_messages SET ai_status='judging', judge_claimed_at=?2
             WHERE message_id=?1 AND ai_status='pending'",
            params![id, claim_ts],
        )?;
        if n > 0 {
            claimed.push(id.clone());
        }
    }
    Ok(claimed)
}

/// judging 超时回收（A6）：claim 后崩溃/被杀的判定卡在 judging——超过 10 分钟的行
/// 回置 pending（令牌清空）待重判，任一形态在轮询/重判开头调用即可崩溃自愈。
/// 守卫限定 `judge_claimed_at < now-10分钟`，在判中的行（令牌新鲜）不会被误回收
pub(crate) fn reclaim_stale_judging_conn(conn: &Connection) -> AppResult<usize> {
    let cutoff =
        (chrono::Utc::now() - chrono::Duration::minutes(JUDGING_TIMEOUT_MINUTES)).to_rfc3339();
    let n = conn.execute(
        "UPDATE chat_messages SET ai_status='pending', judge_claimed_at=''
         WHERE ai_status='judging' AND judge_claimed_at <> '' AND judge_claimed_at < ?1",
        params![cutoff],
    )?;
    Ok(n)
}

/// 消费侧 claim 守卫（A22）：agent 结束回读时逐行校验令牌归属，迟到落库的孤儿写
/// 不污染新判定——
/// - 令牌匹配 → 采纳（含 pk 已落库的判定与本批未落库的 pending 语义行）
/// - 失配且 ai_status='judging' → claim 已被回收重归属、对方在判：丢弃不动行
/// - 失配且已落态/已回 pending → 迟到结果：不采纳不广播，回置 pending 清残留
///   建议载荷（error 态同口径）待重判
///
/// 返回（保留的判定, 失配丢弃的 message_id）
fn filter_by_claim_conn(
    conn: &Connection,
    loaded: Vec<AiSuggestion>,
    claim_ts: &str,
) -> AppResult<(Vec<AiSuggestion>, Vec<String>)> {
    let mut kept = vec![];
    let mut dropped = vec![];
    for s in loaded {
        let row: Option<(String, String)> = conn
            .query_row(
                "SELECT ai_status, judge_claimed_at FROM chat_messages WHERE message_id=?1",
                params![s.message_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        let owned = row.as_ref().is_some_and(|(_, ts)| ts == claim_ts);
        if owned {
            kept.push(s);
            continue;
        }
        dropped.push(s.message_id.clone());
        if row.as_ref().is_some_and(|(status, _)| status == "judging") {
            log::info!(
                "radio: 消息 {} 的 claim 已被重归属（对方判定中），本批结果不采纳",
                s.message_id
            );
        } else {
            log::warn!(
                "radio: 消息 {} 的判定迟到但 claim 已失配，回置 pending 待重判（A22）",
                s.message_id
            );
            conn.execute(
                "UPDATE chat_messages SET ai_status='pending', judge_claimed_at='',
                        suggested_title=NULL, suggested_note=NULL, suggested_category=NULL,
                        suggested_due=NULL, suggested_priority=NULL, suggested_tags='[]',
                        suggested_reason=NULL, suggested_confidence=NULL, update_task_id=NULL
                 WHERE message_id=?1",
                params![s.message_id],
            )?;
        }
    }
    Ok((kept, dropped))
}

/// 失败挽救（classify_and_apply 错误路径，claim 口径）：回读本批 claim 到的消息——
/// 已落库且令牌匹配的照常收下（计数照旧），令牌失配的按重判处理不采纳（A22），
/// 未落库（judging 且令牌匹配）的标 error 待重判。
/// 返回（已落库判定中的新待办数, 标 error 的消息 id —— 供迟到回看）。
fn salvage_claimed_batch_conn(
    conn: &Connection,
    claimed: &[String],
    claim_ts: &str,
) -> AppResult<(usize, Vec<String>)> {
    let loaded = load_suggestions_conn(conn, claimed)?;
    let (kept, dropped) = filter_by_claim_conn(conn, loaded, claim_ts)?;
    let landed = kept.iter().filter(|s| s.action != "pending").count();
    let missed: Vec<String> = kept
        .iter()
        .filter(|s| s.action == "pending")
        .map(|s| s.message_id.clone())
        .collect();
    mark_ai_error_conn(conn, &missed, Some(claim_ts))?;
    if landed > 0 {
        log::info!(
            "radio: AI 判定失败但 {landed} / {} 条判定已落库，收下（其余 {} 条标记可重判，{} 条 claim 失配不采纳）",
            claimed.len(),
            missed.len(),
            dropped.len()
        );
    }
    let todos = kept.iter().filter(|s| s.is_todo()).count();
    Ok((todos, missed))
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
                    // 条目 3：翻正只认已落库的判定（todo/update/followup/none）——
                    // 排除 pending/error 与 judging（判定中/待重判不算翻正，也不广播）
                    "SELECT COUNT(*) FROM chat_messages
                     WHERE ai_status IN ('todo','update','followup','none') AND message_id IN ({placeholders})"
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
/// 判定 claim 协议（§5.4 / §7.1 条目 3，A22）：派 agent 前先把本批消息
/// pending → judging 原子 claim（judge_claimed_at 写入本批令牌），只对 claim 到的
/// 子集继续——claim 落空的消息属另一形态/下一轮，不报错；agent 结束回读时按令牌
/// 做消费侧守卫（失配的结果不采纳不广播，见 filter_by_claim_conn）。
/// 按 agent_sessions 落分类会话（时长 / 会话 id / 成败）并登记 AI 链路健康；
/// 判定失败时先回读数据库——agent 在超时/出错前可能已把部分判定经 pk 写库
/// （判定落库与进程退出是两件事），已落库的照常收下，未落库的按 error
/// 标记（可重判），并安排迟到回调的延迟回看。返回判定出的新待办数。
pub(crate) async fn classify_and_apply<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    db: &Db,
    agent: &AgentConfig,
    batch: &[AiMessage],
) -> AppResult<usize> {
    let ids: Vec<String> = batch.iter().map(|m| m.message_id.clone()).collect();
    // 判定 claim（条目 3）：先原子抢占，只判 claim 到的子集
    let claim_ts = crate::db::now();
    let claimed: Vec<String> = {
        let conn = db.0.lock().unwrap();
        claim_judging_conn(&conn, &ids, &claim_ts)?
    };
    if claimed.is_empty() {
        log::info!(
            "radio: 本批 {} 条均未 claim 到（其他形态判定中或已处理），本轮跳过",
            ids.len()
        );
        return Ok(0);
    }
    let batch: Vec<AiMessage> = batch
        .iter()
        .filter(|m| claimed.contains(&m.message_id))
        .cloned()
        .collect();
    let started = std::time::Instant::now();
    // 预生成会话 id + 执行时快照：失败路径也保住回链（id 落库可回看现场），
    // 历史回放按当时的目录/端点路由，不随 agent 配置后续变更漂移
    let pregen = pregen_session_id(agent);
    let workdir_snapshot = ai::session_workdir_snapshot(agent, &agent.workdir);
    let classified =
        classify_with_session(agent, &batch, db, pregen.as_deref(), Some(&claim_ts)).await;
    let duration_ms = started.elapsed().as_millis() as i64;
    let (suggestions, dropped) = match classified {
        Ok((s, session_id, dropped)) => {
            let conn = db.0.lock().unwrap();
            let mut rec = crate::commands::sessions::NewAgentSession::for_run(
                "classify",
                agent,
                &workdir_snapshot,
            );
            rec.session_id = session_id.or(pregen.clone());
            rec.duration_ms = Some(duration_ms);
            let _ = crate::commands::sessions::log_session_conn(&conn, &rec);
            (s, dropped)
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
                // 失败挽救（claim 口径，条目 3 / A22）：已落库且令牌匹配的判定保留
                // （pk 已写入，无需重放），未落库的标 error 待重判，失配的不采纳；
                // 迟到的孤儿回调交给延迟回看
                let (todos, missed) = salvage_claimed_batch_conn(&conn, &claimed, &claim_ts)?;
                spawn_late_judgment_recheck(app.clone(), missed);
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
    for m in &batch {
        // 消费侧守卫丢弃的失配行不落任何兜底态（A22）：留给持有 claim 的一方处理
        if dropped.contains(&m.message_id) {
            continue;
        }
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
        // judging 超时回收（A6，条目 3）：重判前先扫一遍超时 claim——claim 后崩溃/
        // 被杀的消息卡在 judging，回收回 pending 后才能被下面的重置/重判流程接住
        let reclaimed = reclaim_stale_judging_conn(&conn)?;
        if reclaimed > 0 {
            log::info!("radio: 回收 {reclaimed} 条超时 judging 待重判（A6）");
        }
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
    // 送 AI 的文本人名匿名化（群聊名不脱敏；老数据无匿名列时现场 scrub 兜底）
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
                    chat_label: chat_label_anon(&rules, &msg.chat_type, &msg.chat_name),
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
    /// pending 的残留建议载荷一并清空（error 态没有可展示的建议）。
    /// claim=None（快速捕捉/强制建待办路径，未走 claim 协议）沿用 pending 守卫——
    /// 条目 3 只改 claim 路径，单形态行为不变
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
                None,
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

    /// 判定失败路径（claim 口径，条目 3）：只动本批 claim 到的消息——claim 落空的
    /// （如已被其他形态判完的 todo）原样保留不计入新待办数；claim 到未落库的标
    /// error 待重判。已落库判定的挽救语义由 salvage_claimed_batch_conn 单测覆盖
    #[test]
    fn classify_failure_only_touches_claimed_subset() {
        let app = setup();
        // om_landed 模拟已被其他形态判完的消息（非 pending，本批 claim 落空）
        seed_status_message(&app, "om_landed", "todo", "pending");
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "UPDATE chat_messages SET suggested_title='参加周会' WHERE message_id='om_landed'",
                [],
            )
            .unwrap();
        }
        // om_missed 仍是 pending → 本批 claim 到
        seed_status_message(&app, "om_missed", "pending", "pending");
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
        assert_eq!(todos, 0, "claim 落空的消息不属本批，不计入新待办数");
        assert_eq!(
            ai_status_of(&app, "om_landed"),
            ("todo".into(), Some("参加周会".into())),
            "claim 落空的消息原样保留（留给持有判定的一方/下一轮）"
        );
        assert_eq!(
            ai_status_of(&app, "om_missed").0,
            "error",
            "claim 到未落库的标记判定失败（可重判）"
        );
    }

    /// 失败挽救（claim 口径，条目 3 / A22）：已落库且令牌匹配的判定保留计数；
    /// claim 到未落库的标 error；令牌失配的（已被重归属/回收）不标 error 不采纳
    #[test]
    fn salvage_keeps_landed_marks_error_and_ignores_foreign_claim() {
        let app = setup();
        let ts = "2026-10-11T00:00:00+00:00";
        seed_status_message(&app, "om_landed", "pending", "pending");
        seed_status_message(&app, "om_missed", "pending", "pending");
        seed_status_message(&app, "om_foreign", "pending", "pending");
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let ids = [
                "om_landed".to_string(),
                "om_missed".to_string(),
                "om_foreign".to_string(),
            ];
            let claimed = claim_judging_conn(&conn, &ids, ts).unwrap();
            assert_eq!(claimed.len(), 3, "三条 pending 全部 claim 到");
            // om_landed：agent 被杀前 pk 已落库的判定（令牌保持本批）；
            // om_foreign：claim 后被其他形态回收重归属（令牌翻新 + 对方在判）
            conn.execute(
                "UPDATE chat_messages SET ai_status='todo', suggested_title='参加周会'
                 WHERE message_id='om_landed'",
                [],
            )
            .unwrap();
            conn.execute(
                "UPDATE chat_messages SET judge_claimed_at='2026-10-11T00:08:00+00:00'
                 WHERE message_id='om_foreign'",
                [],
            )
            .unwrap();
            let (todos, missed) = salvage_claimed_batch_conn(&conn, &claimed, ts).unwrap();
            assert_eq!(todos, 1, "已落库的 todo 照常收下计数");
            assert_eq!(
                missed,
                vec!["om_missed".to_string()],
                "只有未落库的标 error"
            );
        }
        assert_eq!(
            ai_status_of(&app, "om_landed"),
            ("todo".into(), Some("参加周会".into())),
            "已落库判定保留，不被失败标记覆盖"
        );
        assert_eq!(ai_status_of(&app, "om_missed").0, "error");
        let (status, token): (String, String) = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.query_row(
                "SELECT ai_status, judge_claimed_at FROM chat_messages WHERE message_id='om_foreign'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap()
        };
        assert_eq!(
            (status.as_str(), token.as_str()),
            ("judging", "2026-10-11T00:08:00+00:00"),
            "失配行不标 error 不回置——对方正在判定，留给持有方"
        );
    }

    /// 判定 claim（条目 3）：只抢占 pending 行，非 pending（已落库/判定中/失败）不动；
    /// 令牌写入 judge_claimed_at 供消费侧守卫校验
    #[test]
    fn claim_judging_grabs_pending_subset_only() {
        let app = setup();
        seed_status_message(&app, "om_p", "pending", "pending");
        seed_status_message(&app, "om_t", "todo", "pending");
        seed_status_message(&app, "om_j", "judging", "pending");
        let claimed = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            claim_judging_conn(
                &conn,
                &["om_p".into(), "om_t".into(), "om_j".into(), "om_x".into()],
                "2026-10-11T00:00:00+00:00",
            )
            .unwrap()
        };
        assert_eq!(claimed, vec!["om_p".to_string()], "只有 pending 被 claim");
        let (status, token): (String, String) = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.query_row(
                "SELECT ai_status, judge_claimed_at FROM chat_messages WHERE message_id='om_p'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap()
        };
        assert_eq!(
            (status.as_str(), token.as_str()),
            ("judging", "2026-10-11T00:00:00+00:00")
        );
        // 非 pending 行的令牌不被碰（om_j 保持原空令牌）
        let t: String = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.query_row(
                "SELECT judge_claimed_at FROM chat_messages WHERE message_id='om_j'",
                [],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(t, "", "未 claim 到的行不写令牌");
    }

    /// judging 超时回收（A6）：只回置超过 10 分钟窗口的 claim——在判中的（令牌新鲜）
    /// 不动；pending/error 行不碰
    #[test]
    fn reclaim_stale_judging_resets_only_expired() {
        let app = setup();
        let stale = (chrono::Utc::now() - chrono::Duration::minutes(11)).to_rfc3339();
        let fresh = chrono::Utc::now().to_rfc3339();
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            for (id, status, ts) in [
                ("om_stale", "judging", stale.as_str()),
                ("om_fresh", "judging", fresh.as_str()),
                ("om_pending", "pending", stale.as_str()),
            ] {
                conn.execute(
                    "INSERT INTO chat_messages (message_id, content, ai_status, judge_claimed_at, created_at)
                     VALUES (?1, 'x', ?2, ?3, '2026-09-11T00:00:00Z')",
                    params![id, status, ts],
                )
                .unwrap();
            }
        }
        let n = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            reclaim_stale_judging_conn(&conn).unwrap()
        };
        assert_eq!(n, 1, "只有超时的 judging 被回收");
        let rows: Vec<(String, String)> = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let mut stmt = conn
                .prepare(
                    "SELECT message_id, ai_status || '/' || judge_claimed_at FROM chat_messages
                     ORDER BY message_id",
                )
                .unwrap();
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert!(
            rows.contains(&("om_fresh".into(), format!("judging/{fresh}"))),
            "在判中的不动"
        );
        assert!(
            rows.contains(&("om_stale".into(), "pending/".into())),
            "超时 claim 回置 pending 并清令牌"
        );
        assert!(
            rows.contains(&("om_pending".into(), format!("pending/{stale}"))),
            "pending 行不碰（即便令牌列脏数据）"
        );
    }

    /// 判定失败标记的 claim 守卫（A22）：Some 路径只翻转 judging 且令牌匹配的行——
    /// 令牌失配（被回收/重归属）与已回 pending 的都不标，留给持有方/重判
    #[test]
    fn mark_ai_error_with_claim_guards_judging_token() {
        let app = setup();
        let ts = "2026-10-11T00:00:00+00:00";
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            for (id, status, token) in [
                ("om_mine", "judging", ts),
                ("om_reclaimed", "judging", "2026-10-11T00:08:00+00:00"),
                ("om_back_pending", "pending", ""),
            ] {
                conn.execute(
                    "INSERT INTO chat_messages (message_id, content, ai_status, judge_claimed_at,
                                                suggested_title, created_at)
                     VALUES (?1, 'x', ?2, ?3, '残留', '2026-09-11T00:00:00Z')",
                    params![id, status, token],
                )
                .unwrap();
            }
        }
        let n = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            mark_ai_error_conn(
                &conn,
                &[
                    "om_mine".into(),
                    "om_reclaimed".into(),
                    "om_back_pending".into(),
                ],
                Some(ts),
            )
            .unwrap()
        };
        assert_eq!(n, 1, "只翻转本 claim 的 judging 行");
        assert_eq!(ai_status_of(&app, "om_mine"), ("error".into(), None));
        assert_eq!(
            ai_status_of(&app, "om_reclaimed"),
            ("judging".into(), Some("残留".into())),
            "令牌失配的行原样保留"
        );
        assert_eq!(
            ai_status_of(&app, "om_back_pending").0,
            "pending",
            "claim 路径不再翻 pending 行（防误吞回收后的待重判消息）"
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

    /// 消费侧守卫（A22）：令牌匹配的已落库判定照常采纳（单形态主路径恒真）
    #[test]
    fn run_and_collect_adopts_owned_claim_results() {
        let app = setup();
        let ts = "2026-10-11T00:00:00+00:00";
        seed_status_message(&app, "om_ok", "pending", "pending");
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            claim_judging_conn(&conn, &["om_ok".into()], ts).unwrap();
            // 模拟 pk 已落库（apply_suggestion_conn 不动令牌列——零改动的落库原语）
            conn.execute(
                "UPDATE chat_messages SET ai_status='todo', suggested_title='交周报'
                 WHERE message_id='om_ok'",
                [],
            )
            .unwrap();
        }
        let agent = AgentConfig {
            id: "fake".into(),
            name: "Fake".into(),
            command: "/usr/bin/true".into(),
            timeout_secs: 10,
            ..Default::default()
        };
        let (list, _, dropped) = {
            let db = app.state::<Db>();
            tauri::async_runtime::block_on(run_and_collect(
                &agent,
                "prompt",
                &["om_ok".into()],
                &db,
                None,
                Some(ts),
            ))
        }
        .unwrap();
        assert!(dropped.is_empty(), "令牌匹配不丢弃");
        assert_eq!(list.len(), 1);
        assert!(list[0].is_todo());
        assert_eq!(list[0].title.as_deref(), Some("交周报"));
    }

    /// 消费侧守卫（A22）：claim 失配的迟到落库不采纳——回置 pending 清残留载荷，
    /// 不污染新判定（判定进行中与待判定同观感，待下一轮重判）
    #[test]
    fn run_and_collect_resets_foreign_landed_results() {
        let app = setup();
        let ts = "2026-10-11T00:00:00+00:00";
        seed_status_message(&app, "om_fl", "pending", "pending");
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            claim_judging_conn(&conn, &["om_fl".into()], ts).unwrap();
            // 模拟：本批 claim 超时被回收（A6）后他形态判定落库——令牌已翻新
            conn.execute(
                "UPDATE chat_messages SET ai_status='todo', suggested_title='别人的判定',
                        judge_claimed_at='2026-10-11T00:30:00+00:00'
                 WHERE message_id='om_fl'",
                [],
            )
            .unwrap();
        }
        let agent = AgentConfig {
            id: "fake".into(),
            name: "Fake".into(),
            command: "/usr/bin/true".into(),
            timeout_secs: 10,
            ..Default::default()
        };
        let err = {
            let db = app.state::<Db>();
            tauri::async_runtime::block_on(run_and_collect(
                &agent,
                "prompt",
                &["om_fl".into()],
                &db,
                None,
                Some(ts),
            ))
        }
        .unwrap_err();
        assert!(
            err.to_string().contains("全部遗漏"),
            "失配丢弃后本批无落库判定 → 整批判失败: {err}"
        );
        let (status, token): (String, String) = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.query_row(
                "SELECT ai_status, judge_claimed_at FROM chat_messages WHERE message_id='om_fl'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap()
        };
        assert_eq!(
            (status.as_str(), token.as_str()),
            ("pending", ""),
            "失配的迟到落库回置 pending 并清令牌与残留建议"
        );
        assert_eq!(
            ai_status_of(&app, "om_fl").1,
            None,
            "残留建议载荷一并清空（pending 态不挂建议卡）"
        );
    }

    /// 消费侧守卫（A22）：claim 失配且对方在判（judging）——行不动，本批结果丢弃
    #[test]
    fn run_and_collect_leaves_foreign_judging_rows() {
        let app = setup();
        let ts = "2026-10-11T00:00:00+00:00";
        seed_status_message(&app, "om_fj", "pending", "pending");
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            // 模拟：本批 claim 后被回收，他形态重新 claim 在判（judging + 新令牌）
            conn.execute(
                "UPDATE chat_messages SET ai_status='judging',
                        judge_claimed_at='2026-10-11T00:30:00+00:00' WHERE message_id='om_fj'",
                [],
            )
            .unwrap();
        }
        let agent = AgentConfig {
            id: "fake".into(),
            name: "Fake".into(),
            command: "/usr/bin/true".into(),
            timeout_secs: 10,
            ..Default::default()
        };
        let err = {
            let db = app.state::<Db>();
            tauri::async_runtime::block_on(run_and_collect(
                &agent,
                "prompt",
                &["om_fj".into()],
                &db,
                None,
                Some(ts),
            ))
        }
        .unwrap_err();
        assert!(err.to_string().contains("全部遗漏"), "{err}");
        let (status, token): (String, String) = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.query_row(
                "SELECT ai_status, judge_claimed_at FROM chat_messages WHERE message_id='om_fj'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap()
        };
        assert_eq!(
            (status.as_str(), token.as_str()),
            ("judging", "2026-10-11T00:30:00+00:00"),
            "对方在判的行原样保留（回收判定权会破坏在途判定）"
        );
    }

    /// claim 协议（条目 3）：claim 落空的消息不进 agent prompt——只判 claim 到的子集，
    /// 落空的留给另一形态/下一轮，不报错
    #[test]
    #[cfg(unix)]
    fn classify_and_apply_prompts_only_claimed_subset() {
        let app = setup();
        let dir = std::env::temp_dir().join(format!("pk-judge-claim-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let agent_bin = dir.join("fake-agent.sh");
        let stdin_marker = dir.join("prompt.txt");
        std::fs::write(
            &agent_bin,
            format!(
                "#!/bin/sh\ncat > {m}\nprintf '%s' ''",
                m = stdin_marker.to_string_lossy()
            ),
        )
        .unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&agent_bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        // om_todo：他形态已判完（非 pending，本批 claim 落空）；om_p：本批 claim 到
        seed_status_message(&app, "om_todo", "todo", "pending");
        seed_status_message(&app, "om_p", "pending", "pending");
        let agent = AgentConfig {
            id: "fake".into(),
            name: "Fake".into(),
            command: agent_bin.to_string_lossy().into_owned(),
            timeout_secs: 10,
            ..Default::default()
        };
        let batch = vec![
            AiMessage::simple("om_todo", "张三", "明天 10 点开周会"),
            AiMessage::simple("om_p", "李四", "记得交周报"),
        ];
        let todos = {
            let db = app.state::<Db>();
            tauri::async_runtime::block_on(classify_and_apply(app.handle(), &db, &agent, &batch))
        }
        .unwrap();
        assert_eq!(todos, 0, "agent 无落库（fake 不写库）→ 全批遗漏走失败路径");
        let prompt = std::fs::read_to_string(&stdin_marker).unwrap();
        assert!(
            prompt.contains("[om_p]"),
            "claim 到的消息进 prompt: {prompt}"
        );
        assert!(
            !prompt.contains("[om_todo]"),
            "claim 落空的消息不进 prompt: {prompt}"
        );
        assert_eq!(
            ai_status_of(&app, "om_todo").0,
            "todo",
            "claim 落空的消息原样保留"
        );
        assert_eq!(
            ai_status_of(&app, "om_p").0,
            "error",
            "claim 到未落库的按整批遗漏标 error（可重判）"
        );
        let _ = std::fs::remove_dir_all(&dir);
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

    /// debug 回显纪律（隐私 NFR）：custom 来源不回显内容（只报字符数），
    /// 默认/回落文本是编译常量照常截断回显
    #[test]
    fn prompt_debug_preview_masks_custom_content() {
        let custom = ai::ResolvedPrompt {
            text: "自定义覆盖内容".into(),
            source: ai::PromptSource::Custom,
            missing: vec![],
            overlong: false,
        };
        let p = prompt_debug_preview(&custom, "自定义覆盖内容 + 消息正文");
        assert_eq!(
            p,
            format!(
                "[自定义覆盖 {} 字符，内容不回显]",
                "自定义覆盖内容".chars().count()
            )
        );
        assert!(!p.contains("消息正文"), "整条 prompt 不回显: {p}");
        for source in [ai::PromptSource::Default, ai::PromptSource::DefaultWarned] {
            let r = ai::ResolvedPrompt {
                text: "默认文本".into(),
                source,
                missing: vec![],
                overlong: false,
            };
            assert_eq!(
                prompt_debug_preview(&r, "默认文本 + 消息正文"),
                "默认文本 + 消息正文"
            );
        }
    }

    /// 分类自定义覆盖生效（fake-agent 装置）：ai_prompt_im_classify 行经解析后拼进
    /// agent stdin 载荷，<AGENT_ID> 替换为 agent id（SDD：保存后下一次调用即生效）
    #[test]
    #[cfg(unix)]
    fn classify_custom_override_reaches_agent_payload() {
        let app = setup();
        let dir = std::env::temp_dir().join(format!("pk-judge-ov-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let agent_bin = dir.join("fake-agent.sh");
        let stdin_marker = dir.join("prompt.txt");
        std::fs::write(
            &agent_bin,
            format!(
                "#!/bin/sh\ncat > {m}\nprintf '%s' ''",
                m = stdin_marker.to_string_lossy()
            ),
        )
        .unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&agent_bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        // 预置一条已落库判定：fake agent 不写库，run_and_collect 须有存量才不判失败
        seed_status_message(&app, "om_ov", "todo", "pending");
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('ai_prompt_im_classify', ?1)",
                params!["我的自定义分类规则，agent 是 <AGENT_ID>。"],
            )
            .unwrap();
        }
        let agent = AgentConfig {
            id: "ag9".into(),
            name: "假 agent".into(),
            command: agent_bin.to_string_lossy().into_owned(),
            timeout_secs: 10,
            ..Default::default()
        };
        let batch = vec![AiMessage::simple("om_ov", "张三", "明天 10 点开周会")];
        {
            let db = app.state::<Db>();
            tauri::async_runtime::block_on(classify_with_session(&agent, &batch, &db, None, None))
                .unwrap();
        }
        let prompt = std::fs::read_to_string(&stdin_marker).unwrap();
        assert!(
            prompt.contains("我的自定义分类规则，agent 是 ag9"),
            "{prompt}"
        );
        assert!(!prompt.contains("<AGENT_ID>"), "占位符已替换: {prompt}");
        assert!(prompt.contains("[om_ov]"), "消息正文照常拼接: {prompt}");
        assert!(
            !prompt.contains("你是待办事项提取助手"),
            "默认系统提示词不出现（覆盖生效）: {prompt}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
