use crate::ai::{self, AgentConfig, AiMessage, AiSuggestion, ProposedTag};
use crate::commands::tags as tag_cmds;
use crate::commands::tasks::{update_task, TaskPatch};
use crate::db::{now, Db};
use crate::error::{AppError, AppResult};
use crate::events;
use crate::models::ChatMessage;
use chrono::TimeZone;
use rusqlite::{params, Connection};
use tauri::{Manager, State};

const MSG_COLS: &str = "id, message_id, chat_id, chat_name, chat_type, sender, sender_id, sent_at, is_self, content, \
                        suggested_title, suggested_category, suggested_due, suggested_priority, suggested_note, suggested_tags, \
                        suggested_reason, suggested_confidence, ai_agent, \
                        ai_status, review_status, task_id, update_task_id, followup_task_id, created_at, dismiss_reason";

fn row_to_message(row: &rusqlite::Row) -> rusqlite::Result<ChatMessage> {
    let tags_raw: String = row.get(15)?;
    Ok(ChatMessage {
        id: row.get(0)?,
        message_id: row.get(1)?,
        chat_id: row.get(2)?,
        chat_name: row.get(3)?,
        chat_type: row.get(4)?,
        sender: row.get(5)?,
        sender_id: row.get(6)?,
        sent_at: row.get(7)?,
        is_self: row.get::<_, i64>(8)? != 0,
        content: row.get(9)?,
        suggested_title: row.get(10)?,
        suggested_category: row.get(11)?,
        suggested_due: row.get(12)?,
        suggested_priority: row.get(13)?,
        suggested_note: row.get(14)?,
        suggested_tags: serde_json::from_str(&tags_raw).unwrap_or_default(),
        suggested_reason: row.get(16)?,
        suggested_confidence: row.get(17)?,
        ai_agent: row.get(18)?,
        ai_status: row.get(19)?,
        review_status: row.get(20)?,
        task_id: row.get(21)?,
        update_task_id: row.get(22)?,
        followup_task_id: row.get(23)?,
        created_at: row.get(24)?,
        dismiss_reason: row.get(25)?,
    })
}

/// 收音机电波列表：展示送过 AI 判定的消息（skipped 的仅作上下文，不进列表），可按关键词过滤
#[tauri::command]
pub fn list_chat_messages(db: State<Db>, query: Option<String>) -> AppResult<Vec<ChatMessage>> {
    let conn = db.0.lock().unwrap();
    let q = query.unwrap_or_default().trim().to_string();
    let rows = if q.is_empty() {
        let mut stmt = conn.prepare(&format!(
            "SELECT {MSG_COLS} FROM chat_messages WHERE ai_status != 'skipped' ORDER BY id DESC LIMIT 300"
        ))?;
        let rows = stmt
            .query_map([], row_to_message)?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    } else {
        let like = format!(
            "%{}%",
            q.replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        );
        let mut stmt = conn.prepare(&format!(
            "SELECT {MSG_COLS} FROM chat_messages
             WHERE ai_status != 'skipped'
               AND (content LIKE ?1 ESCAPE '\\' OR chat_name LIKE ?1 ESCAPE '\\' OR sender LIKE ?1 ESCAPE '\\'
                    OR suggested_title LIKE ?1 ESCAPE '\\')
             ORDER BY id DESC LIMIT 300"
        ))?;
        let rows = stmt
            .query_map(params![like], row_to_message)?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    Ok(rows)
}

fn get_message(conn: &Connection, id: i64) -> AppResult<ChatMessage> {
    conn.query_row(
        &format!("SELECT {MSG_COLS} FROM chat_messages WHERE id=?1"),
        params![id],
        row_to_message,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("消息 {id} 不存在")),
        other => AppError::Db(other),
    })
}

/// AI 建议标签 → 标签 id 列表（捕捉建任务 / 应用更新共用）：
/// - 词表内：按「维度 + 名」精确命中；未中再按名全局兜底一次（AI 归错维度时不丢标签）
/// - isNew 的词表外名字：直接创建（origin=ai，配额满/维度停用时跳过并告警）
/// - 未标 isNew 的词表外名字：告警跳过（AI 违反协议的观测点，不再静默丢弃）
fn resolve_proposed_tags(conn: &Connection, proposed: &[ProposedTag]) -> AppResult<Vec<i64>> {
    let mut ids = vec![];
    for p in proposed {
        let name = p.name.trim();
        if name.is_empty() {
            continue;
        }
        let exact = match tag_cmds::dimension_id_by_key(conn, &p.dimension) {
            Ok(dim_id) => conn
                .query_row(
                    "SELECT id FROM tags WHERE name=?1 AND dimension_id=?2",
                    params![name, dim_id],
                    |r| r.get::<_, i64>(0),
                )
                .ok(),
            Err(_) => None, // 维度 key 非法：走全局按名兜底
        };
        let hit = exact.or_else(|| {
            conn.query_row("SELECT id FROM tags WHERE name=?1", params![name], |r| {
                r.get::<_, i64>(0)
            })
            .ok()
        });
        match hit {
            Some(id) => ids.push(id),
            None if p.is_new => match tag_cmds::create_tag_conn(conn, name, "", &p.dimension, "ai")
            {
                Ok(t) => ids.push(t.id),
                Err(e) => log::warn!("radio: 新建标签「{name}」失败，跳过: {e}"),
            },
            None => log::warn!("radio: AI 建议了词表外标签「{name}」但未标 isNew，跳过"),
        }
    }
    Ok(ids)
}

/// 分类名 → 分类 id（只匹配启用中的分类；未匹配回落第一个启用分类）
fn resolve_category(conn: &Connection, name: Option<&str>) -> AppResult<i64> {
    match name {
        Some(n) if !n.is_empty() => {
            let hit: Option<i64> = conn
                .query_row(
                    "SELECT id FROM categories WHERE name=?1 AND enabled=1",
                    params![n],
                    |r| r.get(0),
                )
                .ok();
            Ok(hit.unwrap_or_else(|| crate::commands::categories::first_enabled_category(conn)))
        }
        _ => Ok(crate::commands::categories::first_enabled_category(conn)),
    }
}

fn valid_priority(p: Option<&str>) -> String {
    match p {
        Some(v @ ("low" | "normal" | "high" | "urgent")) => v.to_string(),
        _ => "normal".into(),
    }
}

/// 逃走原因码（前端选项与此一一对应，落 chat_feedback 供判重与提示词迭代分析）
pub const ESCAPE_REASONS: &[&str] = &[
    "duplicate",  // 已有类似待办
    "not_task",   // 不是给我的任务
    "wrong_info", // 建议内容不对（标题/时间/分类错了）
    "noise",      // 闲聊/噪音
    "outdated",   // 已过期
    "other",      // 其他
];

fn valid_escape_reason(code: Option<&str>) -> AppResult<String> {
    match code {
        None => Ok(String::new()),
        Some(c) if ESCAPE_REASONS.contains(&c) => Ok(c.to_string()),
        Some(c) => Err(AppError::Invalid(format!("未知逃走原因码：{c}"))),
    }
}

/// 把人工裁决落 chat_feedback：关联建议快照（message_id / AI 动作）与判定时的 agent，
/// 为判重与提示词迭代积累本地数据。agent 名从设置里的 agent 列表反查（尽力而为）。
fn record_feedback(
    conn: &Connection,
    msg: &ChatMessage,
    action: &str,
    reason_code: &str,
) -> AppResult<()> {
    let agent_name = conn
        .query_row(
            "SELECT value FROM settings WHERE key='ai_agents'",
            [],
            |r| r.get::<_, String>(0),
        )
        .ok()
        .and_then(|raw| {
            let agents: Vec<crate::ai::AgentConfig> = serde_json::from_str(&raw).ok()?;
            agents
                .iter()
                .find(|a| a.id == msg.ai_agent)
                .map(|a| a.name.clone())
        })
        .unwrap_or_default();
    conn.execute(
        "INSERT INTO chat_feedback (chat_message_id, message_id, ai_action, action, reason_code,
                                    agent_id, agent_name, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            msg.id,
            msg.message_id,
            msg.ai_status,
            action,
            reason_code,
            msg.ai_agent,
            agent_name,
            now(),
        ],
    )?;
    Ok(())
}

/// 用消息上的 AI 建议创建待办（含标签/优先级/截止时间），并回写消息状态。
/// accept_chat_message、force_create_todo 与 capture_todo 共用。
/// 任务来源跟随消息类型：飞书消息 → feishu，手动输入 → capture（撤销时的安全域判断依赖它）。
pub(crate) fn create_task_from_message(conn: &Connection, msg: &ChatMessage) -> AppResult<i64> {
    let title = msg
        .suggested_title
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| msg.content.chars().take(40).collect());
    let category_id = resolve_category(conn, msg.suggested_category.as_deref())?;
    let priority = valid_priority(msg.suggested_priority.as_deref());
    // 模型把 due「留空」常输出成空串：与 update_patch_from_message 同口径，trim 后
    // 非空才算有截止，且落库存 NULL 而非 ''——空串会绕过草丛不变量的 IS NULL 判定
    let due = msg
        .suggested_due
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let status = if due.is_some() { "scheduled" } else { "inbox" };
    let source = if msg.chat_type == "local" {
        "capture"
    } else {
        "feishu"
    };
    conn.execute(
        "INSERT INTO tasks (title, note, category_id, status, priority, due_at, source, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            title,
            msg.suggested_note,
            category_id,
            status,
            priority,
            due,
            source,
            now()
        ],
    )?;
    let task_id = conn.last_insert_rowid();
    let tag_ids = resolve_proposed_tags(conn, &msg.suggested_tags)?;
    if !tag_ids.is_empty() {
        let mut stmt =
            conn.prepare("INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?1, ?2)")?;
        for tag_id in &tag_ids {
            stmt.execute(params![task_id, tag_id])?;
        }
    }
    crate::commands::tasks::log_change(
        conn,
        task_id,
        "create",
        "title",
        None,
        Some(&title),
        "radio",
    )?;
    // 原因随状态一起清：已逃走消息被强制捕捉时不留陈旧原因
    conn.execute(
        "UPDATE chat_messages SET review_status='accepted', task_id=?2, dismiss_reason='' WHERE id=?1",
        params![msg.id, task_id],
    )?;
    Ok(task_id)
}

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

/// 把消息记为某待办的跟进：插入跟进记录并把消息标记为已并入（followup）。
/// 后台轮询与强制捕捉的判重分支共用；调用方需先确认目标待办存在。
pub(crate) fn attach_followup(
    conn: &Connection,
    message_id: &str,
    task_id: i64,
    content: &str,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO task_notes (task_id, content, source, created_at) VALUES (?1, ?2, 'ai', ?3)",
        params![task_id, content, now()],
    )?;
    conn.execute(
        "UPDATE chat_messages SET ai_status='followup', followup_task_id=?2, review_status='accepted',
                dismiss_reason=''
         WHERE message_id=?1",
        params![message_id, task_id],
    )?;
    Ok(())
}

/// 把一条 AI 判定落到 chat_messages：todo/update 写建议列等用户确认，
/// followUp 直接挂跟进记录（复用 attach_followup），其余按 none 记状态。
/// 后台轮询（feishu）、强制捕捉与 `pk suggest` 共用的单一落库实现；
/// 调用方负责前置校验（消息存在、枚举合法、目标待办存在）。
/// 同一消息重复提交 todo/update/none 为覆盖写（幂等）；followUp 二次提交
/// 会因 review_status 已是 accepted 而被 pk 侧校验拒绝。
pub fn apply_suggestion_conn(
    conn: &Connection,
    s: &ai::AiSuggestion,
    agent_id: &str,
) -> AppResult<()> {
    // 模型把 due「留空」输出成空串时归一成 NULL：suggested_due 的所有读取方
    // （捕捉建任务 / 更新补丁 / 前端展示）都以 NULL 表示无截止
    let due = s.due.as_deref().map(str::trim).filter(|v| !v.is_empty());
    if s.is_todo() {
        conn.execute(
            "UPDATE chat_messages SET suggested_title=?2, suggested_category=?3, suggested_due=?4,
                    suggested_priority=?5, suggested_note=?6, suggested_tags=?7,
                    suggested_reason=?8, suggested_confidence=?9, ai_agent=?10, ai_status='todo'
             WHERE message_id=?1",
            params![
                s.message_id,
                s.title,
                s.category,
                due,
                s.priority,
                s.note,
                serde_json::to_string(&s.tags).unwrap_or_else(|_| "[]".into()),
                s.reason,
                s.confidence,
                agent_id,
            ],
        )?;
    } else if s.is_update() {
        conn.execute(
            "UPDATE chat_messages SET suggested_title=?2, suggested_category=?3, suggested_due=?4,
                    suggested_priority=?5, suggested_note=?6, suggested_tags=?7, update_task_id=?8,
                    suggested_reason=?9, suggested_confidence=?10, ai_agent=?11, ai_status='update'
             WHERE message_id=?1",
            params![
                s.message_id,
                s.title,
                s.category,
                due,
                s.priority,
                s.note,
                serde_json::to_string(&s.tags).unwrap_or_else(|_| "[]".into()),
                s.update_task_id,
                s.reason,
                s.confidence,
                agent_id,
            ],
        )?;
    } else if s.is_follow_up() {
        // 幂等：tools 模式下 pk 已落库，应用侧回读后重放建议时不重复挂跟进
        let applied: Option<String> = conn
            .query_row(
                "SELECT ai_status FROM chat_messages WHERE message_id=?1 AND review_status='accepted'",
                params![s.message_id],
                |r| r.get(0),
            )
            .ok();
        if applied.as_deref() == Some("followup") {
            return Ok(());
        }
        // 跟进记录的正文就是消息原文（保留「谁说的、什么时候确认的」）
        let content: String = conn
            .query_row(
                "SELECT content FROM chat_messages WHERE message_id=?1",
                params![s.message_id],
                |r| r.get(0),
            )
            .map_err(|_| AppError::NotFound(format!("消息 {} 不存在", s.message_id)))?;
        attach_followup(
            conn,
            &s.message_id,
            s.follow_up_task_id.unwrap_or(0),
            &content,
        )?;
        conn.execute(
            "UPDATE chat_messages SET suggested_reason=?2, suggested_confidence=?3, ai_agent=?4
             WHERE message_id=?1",
            params![s.message_id, s.reason, s.confidence, agent_id],
        )?;
    } else {
        conn.execute(
            "UPDATE chat_messages SET suggested_reason=?2, suggested_confidence=?3, ai_agent=?4,
                    ai_status='none'
             WHERE message_id=?1",
            params![s.message_id, s.reason, s.confidence, agent_id],
        )?;
    }
    Ok(())
}

/// tools 模式的回读：agent 经 `pk suggest` 把判定落库后，应用侧从 chat_messages
/// 读回该批消息的判定结果（替代解析 agent 文本输出）。
/// 仍为 pending（agent 遗漏未处理）或其他未落库状态的消息，action 标为 "pending"，
/// 由调用方决定兜底策略（feishu 循环会按 none 落库；全批遗漏则整次判失败）。
pub fn load_suggestions_conn(
    conn: &Connection,
    message_ids: &[String],
) -> AppResult<Vec<ai::AiSuggestion>> {
    let mut out = Vec::with_capacity(message_ids.len());
    for id in message_ids {
        let hit = conn.query_row(
            "SELECT ai_status, suggested_title, suggested_category, suggested_due,
                    suggested_priority, suggested_note, suggested_tags, suggested_reason,
                    suggested_confidence, update_task_id, followup_task_id
             FROM chat_messages WHERE message_id=?1",
            params![id],
            |r| {
                let status: String = r.get(0)?;
                let tags: String = r.get(6)?;
                Ok(ai::AiSuggestion {
                    message_id: id.clone(),
                    action: match status.as_str() {
                        "todo" => "todo",
                        "update" => "update",
                        "followup" => "followUp",
                        other => {
                            log::warn!("radio: 消息 {id} 分类后状态仍为「{other}」");
                            "pending"
                        }
                    }
                    .to_string(),
                    title: r.get(1)?,
                    category: r.get(2)?,
                    due: r.get(3)?,
                    priority: r.get(4)?,
                    note: r.get(5)?,
                    tags: serde_json::from_str(&tags).unwrap_or_default(),
                    reason: r.get(7)?,
                    confidence: r.get(8)?,
                    follow_up_task_id: r.get(10)?,
                    update_task_id: r.get(9)?,
                })
            },
        );
        match hit {
            Ok(s) => out.push(s),
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                log::warn!("radio: 回读消息 {id} 不存在，按 none 兜底");
                out.push(ai::AiSuggestion {
                    message_id: id.clone(),
                    ..Default::default()
                });
            }
            Err(e) => return Err(AppError::Db(e)),
        }
    }
    Ok(out)
}

/// 分类一批消息（便捷入口）
async fn classify(
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
fn pregen_session_id(agent: &AgentConfig) -> Option<String> {
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
async fn capture_with_session(
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

/// AI prompt 里的来源标签：告诉模型消息来自哪种会话、谁在说话
pub(crate) fn chat_label(chat_type: &str, chat_name: &str) -> String {
    match chat_type {
        "bot" => "飞书·机器人私聊".into(),
        "p2p" => format!("飞书·私聊「{chat_name}」"),
        "group" => format!("飞书·群聊「{chat_name}」"),
        "local" => "手动输入·快速捕捉".into(),
        _ => {
            if chat_name.is_empty() {
                "飞书".into()
            } else {
                format!("飞书「{chat_name}」")
            }
        }
    }
}

/// AI prompt 来源标签的匿名版：群名换成稳定代号（群_xxxx）、单聊对方名过人名词表
/// scrub——真名/真群名不进 prompt（display 场景仍用上面的 chat_label）。
/// 群代号分配失败（老库无表等）降级为不带名的「飞书·群聊」
pub(crate) fn chat_label_anon(
    conn: &Connection,
    rules: &mut crate::anonymize::AnonRules,
    chat_id: &str,
    chat_type: &str,
    chat_name: &str,
) -> String {
    match chat_type {
        "group" => match rules.chat_alias_of(conn, chat_id, chat_name) {
            Some(alias) => format!("飞书·群聊「{alias}」"),
            None => "飞书·群聊".into(),
        },
        // 单聊对方名过人名词表 scrub（词表未覆盖的名字是已知边界）
        "p2p" => format!("飞书·私聊「{}」", rules.scrub(chat_name)),
        // 机器人私聊/快速捕捉是常量标签；兜底形态带名时同样 scrub
        "bot" | "local" => chat_label(chat_type, chat_name),
        _ => {
            if chat_name.is_empty() {
                "飞书".into()
            } else {
                format!("飞书「{}」", rules.scrub(chat_name))
            }
        }
    }
}

/// 一条上下文消息的原料（未格式化）：匿名化由调用方持规则包完成
#[derive(Debug, Clone)]
pub(crate) struct ContextLine {
    pub time: String,
    pub sender_id: String,
    pub is_self: bool,
    /// 用户可见版（真名）
    pub content: String,
    /// 匿名版（老数据空串，格式化时现场 scrub）
    pub content_anon: String,
}

/// 同会话近期上下文（发送时间在 [sent_at - window, sent_at) 内的最近 max 条）。
/// 返回未匿名化的原料行，经 format_context_lines 格式化为 "[HH:MM] 发送者: 内容"。
pub(crate) fn chat_context_lines(
    conn: &Connection,
    chat_id: &str,
    sent_at: i64,
    exclude_message_id: &str,
    window_ms: i64,
    max_messages: i64,
) -> Vec<ContextLine> {
    if chat_id.is_empty() || sent_at <= 0 {
        return vec![];
    }
    let mut stmt = match conn.prepare(
        "SELECT sender_id, is_self, content, content_anon, sent_at FROM chat_messages
         WHERE chat_id=?1 AND sent_at IS NOT NULL AND sent_at >= ?2 AND sent_at < ?3 AND message_id != ?4
         ORDER BY sent_at DESC LIMIT ?5",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let rows: Vec<(String, i64, String, String, i64)> = match stmt.query_map(
        params![
            chat_id,
            sent_at - window_ms,
            sent_at,
            exclude_message_id,
            max_messages
        ],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    ) {
        Ok(rows) => rows.flatten().collect(),
        Err(_) => return vec![],
    };
    rows.into_iter()
        .rev() // 查询取最近 N 条的倒序，还原为时间升序
        .map(
            |(sender_id, is_self, content, content_anon, at)| ContextLine {
                time: chrono::Local
                    .timestamp_millis_opt(at)
                    .single()
                    .map(|t| t.format("%H:%M").to_string())
                    .unwrap_or_default(),
                sender_id,
                is_self: is_self != 0,
                content,
                content_anon,
            },
        )
        .collect()
}

/// 上下文行的匿名化格式化：发送者用代号（自己标注「我」），内容用匿名版
/// （老数据无匿名列时现场 scrub 真名版兜底），真名不进 prompt。
pub(crate) fn format_context_lines(
    conn: &Connection,
    rules: &mut crate::anonymize::AnonRules,
    lines: Vec<ContextLine>,
) -> Vec<String> {
    lines
        .into_iter()
        .map(|l| {
            let who = if l.is_self {
                crate::anonymize::ME.to_string()
            } else if l.sender_id.is_empty() {
                // 老数据缺 sender_id：宁丢发送者信息也不泄真名
                "成员".to_string()
            } else {
                rules.alias_of(conn, &l.sender_id)
            };
            let text = if l.content_anon.is_empty() {
                rules.scrub(&l.content)
            } else {
                l.content_anon
            };
            let clipped: String = text.chars().take(200).collect();
            format!("[{}] {who}: {clipped}", l.time)
        })
        .collect()
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
    use crate::commands::tasks::{get_task, list_tasks};
    use crate::commands::windows::PendingMainReopen;
    use crate::db::tests::test_conn;
    use std::sync::Mutex;
    use tauri::Manager;

    fn setup() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(Db(Mutex::new(test_conn())));
        app.manage(crate::health::HealthState::default());
        app.manage(PendingMainReopen(std::sync::atomic::AtomicBool::new(false)));
        app
    }

    fn seed_message(app: &tauri::App<tauri::test::MockRuntime>, msg_id: &str) -> i64 {
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO chat_messages (message_id, chat_name, sender, content, suggested_title, suggested_category,
                                        suggested_due, suggested_priority, suggested_note, suggested_tags, ai_status, review_status, created_at)
             VALUES (?1, '项目群', '张三', '明天上午10点开周会', '参加周会', '工作',
                     '2026-09-13T10:00', 'high', '张三在群里安排', '[\"重要\"]', 'todo', 'pending', '2026-09-11T00:00:00Z')",
            params![msg_id],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn seed_tag(app: &tauri::App<tauri::test::MockRuntime>, name: &str) -> i64 {
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO tags (name, description, created_at) VALUES (?1, '', '2026-09-01T00:00:00Z')",
            params![name],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

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
    fn list_and_search_chat_messages() {
        let app = setup();
        seed_message(&app, "om_1");
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO chat_messages (message_id, chat_name, sender, content, ai_status, review_status, created_at)
                 VALUES ('om_2', '闲聊群', '李四', '哈哈哈', 'none', 'pending', '2026-09-01T00:00:00Z')",
                [],
            )
            .unwrap();
        }
        let all = {
            let db = app.state::<Db>();
            list_chat_messages(db, None).unwrap()
        };
        assert_eq!(all.len(), 2, "未识别为待办的消息也展示");
        assert_eq!(all[0].message_id, "om_2", "倒序");

        let hit = {
            let db = app.state::<Db>();
            list_chat_messages(db, Some("周会".into())).unwrap()
        };
        assert_eq!(hit.len(), 1);
        assert_eq!(hit[0].suggested_title.as_deref(), Some("参加周会"));
        assert_eq!(
            hit[0].suggested_tags,
            vec![ProposedTag {
                name: "重要".into(),
                dimension: "topic".into(),
                is_new: false
            }]
        );

        let by_chat = {
            let db = app.state::<Db>();
            list_chat_messages(db, Some("闲聊".into())).unwrap()
        };
        assert_eq!(by_chat.len(), 1, "按会话名搜索");

        let none = {
            let db = app.state::<Db>();
            list_chat_messages(db, Some("%".into())).unwrap()
        };
        assert!(none.is_empty(), "LIKE 通配符转义");
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

    /// 已逃走消息被强制捕捉（或 AI 改判跟进）后 review_status 翻 accepted，
    /// 行上的逃走原因必须随之清掉，不留陈旧残留
    #[test]
    fn create_task_from_message_clears_dismiss_reason() {
        let app = setup();
        let mid = seed_message(&app, "om_1");
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        conn.execute(
            "UPDATE chat_messages SET review_status='dismissed', dismiss_reason='noise' WHERE id=?1",
            params![mid],
        )
        .unwrap();
        let msg = get_message(&conn, mid).unwrap();
        assert_eq!(msg.dismiss_reason, "noise");
        create_task_from_message(&conn, &msg).unwrap();
        let msg = get_message(&conn, mid).unwrap();
        assert_eq!(msg.review_status, "accepted");
        assert_eq!(msg.dismiss_reason, "", "状态翻 accepted 时原因一起清");
    }

    /// AI 建议了停用分类名时，回落到第一个启用分类而不是停用的同名分类
    #[test]
    fn resolve_category_skips_disabled_fallback() {
        let app = setup();
        {
            let db = app.state::<Db>();
            crate::commands::categories::set_category_enabled(app.handle().clone(), db, 1, false)
                .unwrap();
        }
        let task_id = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO chat_messages (message_id, content, suggested_title, suggested_category, ai_status, review_status, created_at)
                 VALUES ('om_d', '内容', '标题', '工作', 'todo', 'pending', '2026-09-01T00:00:00Z')",
                [],
            )
            .unwrap();
            let msg = get_message(&conn, 1).unwrap();
            create_task_from_message(&conn, &msg).unwrap()
        };
        let task = {
            let db = app.state::<Db>();
            crate::commands::tasks::get_task(db, task_id).unwrap()
        };
        assert_eq!(
            task.category_id, 2,
            "停用的「工作」被跳过，落到第一个启用分类"
        );
    }

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

    #[test]
    fn create_task_from_message_resolves_partial_attributes() {
        let app = setup();
        seed_tag(&app, "重要");
        let task_id = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            // 非法优先级、未知分类、未知标签都应安全回落
            conn.execute(
                "INSERT INTO chat_messages (message_id, content, suggested_title, suggested_category, suggested_priority, suggested_tags, ai_status, review_status, created_at)
                 VALUES ('om_x', '周五之前交报告', '交报告', '不存在的分类', 'super-urgent', '[\"重要\",\"不存在的标签\"]', 'todo', 'pending', '2026-09-01T00:00:00Z')",
                [],
            )
            .unwrap();
            let msg = get_message(&conn, 1).unwrap();
            create_task_from_message(&conn, &msg).unwrap()
        };
        let task = {
            let db = app.state::<Db>();
            get_task(db, task_id).unwrap()
        };
        assert_eq!(task.priority, "normal", "非法优先级回落 normal");
        assert_eq!(task.category_id, 1, "未知分类回落 1");
        assert_eq!(
            task.tags,
            vec![crate::models::TagRef {
                name: "重要".into(),
                dimension: "topic".into()
            }],
            "未知标签丢弃"
        );
    }

    /// isNew 标签：接受建议时词表外标签直接创建（带维度与 origin=ai）并挂上任务
    #[test]
    fn accept_creates_new_tag_marked_is_new() {
        let app = setup();
        seed_tag(&app, "重要");
        let mid = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO chat_messages (message_id, chat_name, sender, content, suggested_title, suggested_tags, ai_status, review_status, created_at)
                 VALUES ('om_new', 'PokemonApp 群', '张三', '记得发版', '发版', ?1, 'todo', 'pending', '2026-09-12T00:00:00Z')",
                params![serde_json::to_string(&vec![
                    ProposedTag { name: "PokemonApp".into(), dimension: "project".into(), is_new: true },
                    ProposedTag { name: "重要".into(), dimension: "topic".into(), is_new: false },
                ]).unwrap()],
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
        assert_eq!(
            task.tags,
            vec![
                crate::models::TagRef {
                    name: "PokemonApp".into(),
                    dimension: "project".into()
                },
                crate::models::TagRef {
                    name: "重要".into(),
                    dimension: "topic".into()
                },
            ],
            "新建的项目标签排序在前"
        );
        let (origin, dim): (String, String) = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.query_row(
                "SELECT t.origin, d.key FROM tags t JOIN tag_dimensions d ON d.id=t.dimension_id WHERE t.name='PokemonApp'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap()
        };
        assert_eq!(
            (origin.as_str(), dim.as_str()),
            ("ai", "project"),
            "新建标签记 origin 与维度"
        );
        // 词表外但未标 isNew：不创建（旧协议兼容路径的安全侧）
        let mid2 = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO chat_messages (message_id, content, suggested_title, suggested_tags, ai_status, review_status, created_at)
                 VALUES ('om_old', 'x', 'y', '[\"幻觉标签\"]', 'todo', 'pending', '2026-09-12T00:00:00Z')",
                [],
            )
            .unwrap();
            conn.last_insert_rowid()
        };
        let task_id2 = {
            let db = app.state::<Db>();
            accept_chat_message(app.handle().clone(), db, mid2).unwrap()
        };
        let task2 = {
            let db = app.state::<Db>();
            get_task(db, task_id2).unwrap()
        };
        assert!(task2.tags.is_empty(), "未标 isNew 的词表外标签不落库");
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

    /// 仅作上下文的消息（自己发的/机器人回复，ai_status=skipped）不进收音机列表与搜索
    #[test]
    fn list_hides_context_only_messages() {
        let app = setup();
        seed_message(&app, "om_1");
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO chat_messages (message_id, chat_name, sender, content, ai_status, review_status, created_at)
                 VALUES ('om_ctx', '项目群', '我', '好的马上', 'skipped', 'pending', '2026-09-12T00:00:00Z')",
                [],
            )
            .unwrap();
        }
        let all = {
            let db = app.state::<Db>();
            list_chat_messages(db, None).unwrap()
        };
        assert_eq!(all.len(), 1, "只展示送 AI 判定的消息");
        assert_eq!(all[0].message_id, "om_1");
        let hit = {
            let db = app.state::<Db>();
            list_chat_messages(db, Some("好的马上".into())).unwrap()
        };
        assert!(hit.is_empty(), "上下文消息不进搜索");
    }

    /// 上下文窗口：同会话、时间在 [t-30min, t) 的消息按时间升序，
    /// 自己发的标注「我」；之后的/超窗的/别的会话的都不算。
    /// 匿名化格式化后：他人 sender 用代号、老数据无匿名版现场 scrub，真名不进 prompt
    #[test]
    fn chat_context_lines_picks_recent_same_chat_only() {
        let app = setup();
        let t = 1_789_200_000_000i64;
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let ins = |mid: &str, chat: &str, sender: &str, sid: &str, is_self: i64, at: i64| {
                conn.execute(
                    "INSERT INTO chat_messages (message_id, chat_id, chat_name, chat_type, sender, sender_id, content, sent_at, is_self, ai_status, review_status, created_at)
                     VALUES (?1, ?2, '项目群', 'group', ?3, ?4, '内容', ?5, ?6, 'skipped', 'pending', '2026-09-12T00:00:00Z')",
                    params![mid, chat, sender, sid, at, is_self],
                )
                .unwrap();
            };
            ins("om_me", "oc_g", "我的显示名", "ou_me", 1, t - 60_000);
            ins("om_other", "oc_g", "李四", "ou_li", 0, t - 30_000);
            ins("om_after", "oc_g", "李四", "ou_li", 0, t + 10_000);
            ins("om_stale", "oc_g", "李四", "ou_li", 0, t - 40 * 60_000);
            ins("om_else", "oc_h", "李四", "ou_li", 0, t - 10_000);
            conn.execute(
                "INSERT INTO feishu_users (open_id, name, alias, updated_at)
                 VALUES ('ou_li', '李四', '成员_00dd', '2026-09-01')",
                [],
            )
            .unwrap();
        }
        let (lines, formatted) = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let mut rules = crate::anonymize::AnonRules::build(&conn);
            let lines = chat_context_lines(&conn, "oc_g", t, "om_target", 30 * 60 * 1000, 10);
            let formatted = format_context_lines(&conn, &mut rules, lines.clone());
            (lines, formatted)
        };
        assert_eq!(lines.len(), 2, "{lines:?}");
        assert!(lines[0].is_self, "时间升序：第一条是我");
        assert!(
            formatted[0].contains("我: 内容"),
            "自己标注为「我」: {formatted:?}"
        );
        assert!(
            !formatted[0].contains("我的显示名"),
            "不暴露原始显示名以免与「我」混淆: {formatted:?}"
        );
        assert!(
            formatted[1].contains("成员_00dd: 内容"),
            "他人 sender 用代号: {formatted:?}"
        );
        assert!(
            !formatted[1].contains("李四"),
            "上下文行真名不进 prompt: {formatted:?}"
        );
        // 空会话 / 老数据（无 sent_at）安全退化为空
        let empty = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            chat_context_lines(&conn, "", t, "om_target", 30 * 60 * 1000, 10)
        };
        assert!(empty.is_empty());
    }

    /// 种一条「更新建议」消息（pending，指向 task_id，可指定建议字段）
    fn seed_update_message(
        app: &tauri::App<tauri::test::MockRuntime>,
        msg_id: &str,
        update_task_id: Option<i64>,
        suggested_due: Option<&str>,
        suggested_priority: Option<&str>,
        suggested_title: Option<&str>,
        suggested_tags: &str,
    ) -> i64 {
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO chat_messages (message_id, chat_name, sender, content, suggested_title, suggested_due,
                                        suggested_priority, suggested_tags, update_task_id, ai_status, review_status, created_at)
             VALUES (?1, '项目群', '张三', '周会改到周四上午10点', ?2, ?3, ?4, ?5, ?6, 'update', 'pending', '2026-09-12T00:00:00Z')",
            params![
                msg_id,
                suggested_title,
                suggested_due,
                suggested_priority,
                suggested_tags,
                update_task_id
            ],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn seed_task(app: &tauri::App<tauri::test::MockRuntime>, title: &str) -> i64 {
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO tasks (title, status, priority, due_at, created_at)
             VALUES (?1, 'scheduled', 'normal', '2026-09-13T10:00', '2026-09-01T00:00:00Z')",
            params![title],
        )
        .unwrap();
        conn.last_insert_rowid()
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

    #[test]
    fn chat_label_variants() {
        assert_eq!(chat_label("bot", "皮卡丘助手"), "飞书·机器人私聊");
        assert_eq!(chat_label("p2p", "李四"), "飞书·私聊「李四」");
        assert_eq!(chat_label("group", "项目群"), "飞书·群聊「项目群」");
        assert_eq!(chat_label("", ""), "飞书");
    }

    /// 匿名版来源标签：群名 → 稳定代号、单聊对方名过词表、真名/真群名不进 prompt
    #[test]
    fn chat_label_anon_pseudonymizes_names() {
        let conn = crate::db::tests::test_conn();
        conn.execute(
            "INSERT INTO feishu_users (open_id, name, updated_at, alias)
             VALUES ('ou_z', '张三', '2026-09-01', '成员_00aa')",
            [],
        )
        .unwrap();
        let mut rules = crate::anonymize::AnonRules::build(&conn);
        // 群名换稳定代号，且两次调用同一代号
        let g1 = chat_label_anon(&conn, &mut rules, "oc_g", "group", "项目攻坚群");
        let g2 = chat_label_anon(&conn, &mut rules, "oc_g", "group", "项目攻坚群");
        assert_eq!(g1, g2);
        assert!(
            g1.starts_with("飞书·群聊「群_") && g1.ends_with("」"),
            "{g1}"
        );
        assert!(!g1.contains("项目攻坚群"), "真群名不出现: {g1}");
        // 单聊对方名在词表内 → 代号；不在词表的名字保持原样（词表边界）
        let p = chat_label_anon(&conn, &mut rules, "oc_p", "p2p", "张三");
        assert_eq!(p, "飞书·私聊「成员_00aa」");
        let unknown = chat_label_anon(&conn, &mut rules, "oc_p2", "p2p", "陌生人名X");
        assert_eq!(unknown, "飞书·私聊「陌生人名X」");
        // 常量标签不带入名字
        assert_eq!(
            chat_label_anon(&conn, &mut rules, "", "bot", "皮卡丘助手"),
            "飞书·机器人私聊"
        );
        assert_eq!(
            chat_label_anon(&conn, &mut rules, "", "local", ""),
            "手动输入·快速捕捉"
        );
    }

    /// 跟进并入：插入跟进记录并把消息标记 followup + 记录目标待办（收音机可见）
    #[test]
    fn attach_followup_records_note_and_target() {
        let app = setup();
        let task_id = seed_task(&app, "参加周会");
        let mid = seed_message(&app, "om_f1");
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            attach_followup(&conn, "om_f1", task_id, "材料已经寄出了").unwrap();
        }
        let msgs = {
            let db = app.state::<Db>();
            list_chat_messages(db, None).unwrap()
        };
        let m = msgs.iter().find(|m| m.id == mid).unwrap();
        assert_eq!(m.ai_status, "followup");
        assert_eq!(m.followup_task_id, Some(task_id));
        assert_eq!(m.review_status, "accepted");
        let notes: Vec<(String, String)> = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let mut stmt = conn
                .prepare("SELECT content, source FROM task_notes WHERE task_id=?1")
                .unwrap();
            stmt.query_map(params![task_id], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(
            notes,
            vec![("材料已经寄出了".to_string(), "ai".to_string())]
        );
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

    /// tools 模式回读：已落库的判定还原成 AiSuggestion（含 update/followup 的目标 id），
    /// agent 遗漏（仍 pending）标 action=pending，不存在的消息兜底 none
    #[test]
    fn load_suggestions_maps_status_and_flags_missed() {
        let conn = crate::db::tests::test_conn();
        conn.execute(
            "INSERT INTO chat_messages (message_id, content, suggested_title, suggested_priority, ai_status, created_at)
             VALUES ('om_a', '内容', '交周报', 'high', 'todo', 'x')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO chat_messages (message_id, content, suggested_title, update_task_id, ai_status, created_at)
             VALUES ('om_b', '改期', '周会', 7, 'update', 'x')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO chat_messages (message_id, content, followup_task_id, ai_status, review_status, created_at)
             VALUES ('om_c', '进展', 9, 'followup', 'accepted', 'x')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO chat_messages (message_id, content, created_at) VALUES ('om_d', '遗漏', 'x')",
            [],
        )
        .unwrap();

        let out = load_suggestions_conn(
            &conn,
            &[
                "om_a".into(),
                "om_b".into(),
                "om_c".into(),
                "om_d".into(),
                "om_none".into(),
            ],
        )
        .unwrap();
        assert!(out[0].is_todo());
        assert_eq!(out[0].title.as_deref(), Some("交周报"));
        assert_eq!(out[0].priority.as_deref(), Some("high"));
        assert!(out[1].is_update());
        assert_eq!(out[1].update_task_id, Some(7));
        assert!(out[2].is_follow_up());
        assert_eq!(out[2].follow_up_task_id, Some(9));
        assert_eq!(
            out[3].action, "pending",
            "agent 遗漏的消息标 pending 待上层兜底"
        );
        assert_eq!(out[4].action, "", "不存在的消息兜底 none 语义");
    }

    /// apply 的 follow-up 幂等：已应用过（followup + accepted）再重放不重复挂跟进
    #[test]
    fn apply_follow_up_is_idempotent_on_replay() {
        let conn = crate::db::tests::test_conn();
        conn.execute(
            "INSERT INTO tasks (title, category_id, status, priority, created_at) VALUES ('目标', 1, 'inbox', 'normal', 'x')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO chat_messages (message_id, content, created_at) VALUES ('om_f', '周五交付确认了', 'x')",
            [],
        )
        .unwrap();
        let s = ai::AiSuggestion {
            message_id: "om_f".into(),
            action: "followUp".into(),
            follow_up_task_id: Some(1),
            reason: Some("进展".into()),
            ..Default::default()
        };
        apply_suggestion_conn(&conn, &s, "ag1").unwrap();
        // tools 模式回读后的重放：不应再插一条跟进
        apply_suggestion_conn(&conn, &s, "ag1").unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM task_notes WHERE task_id=1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(n, 1, "重放不重复挂跟进");
        let status: String = conn
            .query_row(
                "SELECT ai_status FROM chat_messages WHERE message_id='om_f'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(status, "followup");
    }

    /// 模型把 due「留空」输出成空串/纯空格：落库归一成 NULL，后续捕捉/更新按无截止判定
    #[test]
    fn apply_suggestion_normalizes_blank_due_to_null() {
        let conn = crate::db::tests::test_conn();
        conn.execute(
            "INSERT INTO chat_messages (message_id, content, created_at) VALUES ('om_d', '记得交周报', 'x')",
            [],
        )
        .unwrap();
        let s = ai::AiSuggestion {
            message_id: "om_d".into(),
            action: "todo".into(),
            title: Some("交周报".into()),
            due: Some("  ".into()),
            ..Default::default()
        };
        apply_suggestion_conn(&conn, &s, "ag1").unwrap();
        let due: Option<String> = conn
            .query_row(
                "SELECT suggested_due FROM chat_messages WHERE message_id='om_d'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(due.is_none(), "空串/纯空格 due 落库为 NULL");
    }

    // ---- 收音机手动快速捕捉 ----

    fn seed_agent(app: &tauri::App<tauri::test::MockRuntime>, command: &str) {
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('ai_agents', ?1)",
            params![serde_json::to_string(&[crate::ai::AgentConfig {
                id: "fake".into(),
                name: "Fake".into(),
                command: command.into(),
                timeout_secs: 10,
                ..Default::default()
            }])
            .unwrap()],
        )
        .unwrap();
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

    // ---- 判定失败标记 / 挽救 / 批量重判 ----

    fn seed_status_message(
        app: &tauri::App<tauri::test::MockRuntime>,
        msg_id: &str,
        ai_status: &str,
        review_status: &str,
    ) -> i64 {
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO chat_messages (message_id, chat_name, sender, content, suggested_title,
                                        ai_status, review_status, created_at)
             VALUES (?1, '项目群', '张三', '明天 10 点开周会', '残留建议', ?2, ?3, '2026-09-11T00:00:00Z')",
            params![msg_id, ai_status, review_status],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn ai_status_of(
        app: &tauri::App<tauri::test::MockRuntime>,
        msg_id: &str,
    ) -> (String, Option<String>) {
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        conn.query_row(
            "SELECT ai_status, suggested_title FROM chat_messages WHERE message_id=?1",
            params![msg_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap()
    }

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

    // ---- 预生成会话 id 与参数注入（随判定管线自 ai 移入） ----

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
