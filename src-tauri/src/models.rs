use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub note: Option<String>,
    pub category_id: i64,
    /// inbox / scheduled / active / paused / done
    pub status: String,
    /// low / normal / high / urgent
    pub priority: String,
    pub due_at: Option<String>,
    pub remind_at: Option<String>,
    pub reminded: bool,
    /// local / feishu / todoist
    pub source: String,
    pub external_id: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub focus_seconds: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: i64,
    pub name: String,
    /// 宝可梦名称（用于显示），如 pikachu
    pub pokemon: String,
    /// 素材文件名 /pokemon/{key}.png
    pub sprite: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImSuggestion {
    pub id: i64,
    pub message_id: String,
    pub chat_name: String,
    pub sender: String,
    pub content: String,
    /// AI 给出的建议标题；为空表示 AI 认为不含待办
    pub suggested_title: Option<String>,
    pub suggested_category: Option<String>,
    pub suggested_due: Option<String>,
    /// pending / accepted / dismissed
    pub review_status: String,
    pub created_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 序列化结果的键集合必须与前端 src/types.ts 的 TS 接口逐字段一致，
    /// 任何一端增删字段都会让此测试失败，防止 IPC 契约悄悄漂移
    fn keys_of(v: serde_json::Value) -> Vec<String> {
        let mut ks = v
            .as_object()
            .unwrap()
            .keys()
            .map(String::clone)
            .collect::<Vec<_>>();
        ks.sort();
        ks
    }

    #[test]
    fn task_json_contract_matches_ts_interface() {
        let t = Task {
            id: 1,
            title: "t".into(),
            note: None,
            category_id: 1,
            status: "inbox".into(),
            priority: "normal".into(),
            due_at: None,
            remind_at: None,
            reminded: false,
            source: "local".into(),
            external_id: None,
            created_at: "2026-09-01T00:00:00Z".into(),
            completed_at: None,
            focus_seconds: 0,
        };
        assert_eq!(
            keys_of(serde_json::to_value(&t).unwrap()),
            vec![
                "categoryId", "completedAt", "createdAt", "dueAt", "externalId", "focusSeconds",
                "id", "note", "priority", "remindAt", "reminded", "source", "status", "title",
            ]
        );
        // 反向：前端可能回传完整对象（update_task 的 patch 基于 Task 字段）
        let back: Task = serde_json::from_value(serde_json::to_value(&t).unwrap()).unwrap();
        assert_eq!(back.id, t.id);
    }

    #[test]
    fn category_json_contract_matches_ts_interface() {
        let c = Category { id: 1, name: "工作".into(), pokemon: "皮卡丘".into(), sprite: "pikachu".into() };
        assert_eq!(
            keys_of(serde_json::to_value(&c).unwrap()),
            vec!["id", "name", "pokemon", "sprite"]
        );
    }

    #[test]
    fn im_suggestion_json_contract_matches_ts_interface() {
        let s = ImSuggestion {
            id: 1,
            message_id: "m".into(),
            chat_name: String::new(),
            sender: String::new(),
            content: "c".into(),
            suggested_title: None,
            suggested_category: None,
            suggested_due: None,
            review_status: "pending".into(),
            created_at: "2026-09-01T00:00:00Z".into(),
        };
        assert_eq!(
            keys_of(serde_json::to_value(&s).unwrap()),
            vec![
                "chatName", "content", "createdAt", "id", "messageId", "reviewStatus",
                "sender", "suggestedCategory", "suggestedDue", "suggestedTitle",
            ]
        );
    }
}
