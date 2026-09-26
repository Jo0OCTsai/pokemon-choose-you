//! 收音机消息存取：chat_messages 的列投影、行映射与列表/单条查询。
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::ChatMessage;
use rusqlite::{params, Connection};
use tauri::State;

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

pub(crate) fn get_message(conn: &Connection, id: i64) -> AppResult<ChatMessage> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::ProposedTag;
    use crate::commands::radio::testsupport::*;
    use crate::db::Db;
    use tauri::Manager;

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
}
