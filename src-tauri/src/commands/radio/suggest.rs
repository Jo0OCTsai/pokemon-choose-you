//! AI 判定的落库原语：建议快照写入/回读（chat_messages 建议列）、标签与分类解析、
//! 待办创建与跟进挂接、人工反馈记录——pk suggest 与应用内分诊共用的单一实现。
use crate::ai::{self, ProposedTag};
use crate::commands::tags as tag_cmds;
use crate::db::now;
use crate::error::{AppError, AppResult};
use crate::models::ChatMessage;
use rusqlite::{params, Connection};

/// AI 建议标签 → 标签 id 列表（捕捉建任务 / 应用更新共用）：
/// - 词表内：按「维度 + 名」精确命中；未中再按名全局兜底一次（AI 归错维度时不丢标签）
/// - isNew 的词表外名字：直接创建（origin=ai，配额满/维度停用时跳过并告警）
/// - 未标 isNew 的词表外名字：告警跳过（AI 违反协议的观测点，不再静默丢弃）
pub(crate) fn resolve_proposed_tags(
    conn: &Connection,
    proposed: &[ProposedTag],
) -> AppResult<Vec<i64>> {
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

pub(crate) fn valid_escape_reason(code: Option<&str>) -> AppResult<String> {
    match code {
        None => Ok(String::new()),
        Some(c) if ESCAPE_REASONS.contains(&c) => Ok(c.to_string()),
        Some(c) => Err(AppError::Invalid(format!("未知逃走原因码：{c}"))),
    }
}

/// 把人工裁决落 chat_feedback：关联建议快照（message_id / AI 动作）与判定时的 agent，
/// 为判重与提示词迭代积累本地数据。agent 名从设置里的 agent 列表反查（尽力而为）。
pub(crate) fn record_feedback(
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::radio::store::get_message;
    use crate::commands::radio::testsupport::*;
    use crate::commands::radio::{accept_chat_message, list_chat_messages};
    use crate::commands::tasks::get_task;
    use crate::db::Db;
    use tauri::Manager;

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
}
