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
    /// 标签名列表（task_tags JOIN tags 聚合，非独立列）
    #[serde(default)]
    pub tags: Vec<String>,
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
    /// 停用后不出现在新建/编辑与 AI 分类选项中，已有任务不受影响
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskNote {
    pub id: i64,
    pub task_id: i64,
    pub content: String,
    /// manual / ai
    pub source: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: i64,
    pub message_id: String,
    pub chat_name: String,
    pub sender: String,
    pub content: String,
    /// AI 给出的建议标题；为空表示 AI 认为不含待办
    pub suggested_title: Option<String>,
    pub suggested_category: Option<String>,
    pub suggested_due: Option<String>,
    pub suggested_priority: Option<String>,
    pub suggested_note: Option<String>,
    /// AI 建议的标签名（JSON 数组字符串解析而来）
    pub suggested_tags: Vec<String>,
    /// pending / todo / none / followup / error
    pub ai_status: String,
    /// pending / accepted / dismissed
    pub review_status: String,
    /// 该消息已创建的待办 id
    pub task_id: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiLog {
    pub id: i64,
    /// classify / force_create / test
    pub scene: String,
    pub model: String,
    pub request_body: String,
    pub response_body: String,
    pub ok: bool,
    pub error: Option<String>,
    pub duration_ms: i64,
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
            tags: vec!["重要".into()],
        };
        assert_eq!(
            keys_of(serde_json::to_value(&t).unwrap()),
            vec![
                "categoryId",
                "completedAt",
                "createdAt",
                "dueAt",
                "externalId",
                "focusSeconds",
                "id",
                "note",
                "priority",
                "remindAt",
                "reminded",
                "source",
                "status",
                "tags",
                "title",
            ]
        );
        // 反向：前端可能回传完整对象（update_task 的 patch 基于 Task 字段）
        let back: Task = serde_json::from_value(serde_json::to_value(&t).unwrap()).unwrap();
        assert_eq!(back.id, t.id);
        // tags 缺失时容忍（老前端载荷）
        let no_tags: Task = serde_json::from_value(serde_json::json!({
            "id": 1, "title": "t", "categoryId": 1, "status": "inbox", "priority": "normal",
            "reminded": false, "source": "local", "createdAt": "2026-09-01T00:00:00Z",
            "focusSeconds": 0
        }))
        .unwrap();
        assert!(no_tags.tags.is_empty());
    }

    #[test]
    fn category_json_contract_matches_ts_interface() {
        let c = Category {
            id: 1,
            name: "工作".into(),
            pokemon: "皮卡丘".into(),
            sprite: "pikachu".into(),
            enabled: true,
        };
        assert_eq!(
            keys_of(serde_json::to_value(&c).unwrap()),
            vec!["enabled", "id", "name", "pokemon", "sprite"]
        );
        // enabled 缺失时容忍（老载荷按启用处理）
        let old: Category = serde_json::from_value(serde_json::json!({
            "id": 1, "name": "工作", "pokemon": "皮卡丘", "sprite": "pikachu"
        }))
        .unwrap();
        assert!(old.enabled);
    }

    #[test]
    fn tag_json_contract_matches_ts_interface() {
        let g = Tag {
            id: 1,
            name: "重要".into(),
            description: "核心目标相关".into(),
        };
        assert_eq!(
            keys_of(serde_json::to_value(&g).unwrap()),
            vec!["description", "id", "name"]
        );
    }

    #[test]
    fn task_note_json_contract_matches_ts_interface() {
        let n = TaskNote {
            id: 1,
            task_id: 2,
            content: "对方确认周五交付".into(),
            source: "ai".into(),
            created_at: "2026-09-01T00:00:00Z".into(),
        };
        assert_eq!(
            keys_of(serde_json::to_value(&n).unwrap()),
            vec!["content", "createdAt", "id", "source", "taskId"]
        );
    }

    #[test]
    fn chat_message_json_contract_matches_ts_interface() {
        let m = ChatMessage {
            id: 1,
            message_id: "m".into(),
            chat_name: String::new(),
            sender: String::new(),
            content: "c".into(),
            suggested_title: None,
            suggested_category: None,
            suggested_due: None,
            suggested_priority: None,
            suggested_note: None,
            suggested_tags: vec![],
            ai_status: "pending".into(),
            review_status: "pending".into(),
            task_id: None,
            created_at: "2026-09-01T00:00:00Z".into(),
        };
        assert_eq!(
            keys_of(serde_json::to_value(&m).unwrap()),
            vec![
                "aiStatus",
                "chatName",
                "content",
                "createdAt",
                "id",
                "messageId",
                "reviewStatus",
                "sender",
                "suggestedCategory",
                "suggestedDue",
                "suggestedNote",
                "suggestedPriority",
                "suggestedTags",
                "suggestedTitle",
                "taskId",
            ]
        );
    }

    #[test]
    fn ai_log_json_contract_matches_ts_interface() {
        let l = AiLog {
            id: 1,
            scene: "classify".into(),
            model: "gpt-4o-mini".into(),
            request_body: "{}".into(),
            response_body: "{}".into(),
            ok: true,
            error: None,
            duration_ms: 800,
            created_at: "2026-09-01T00:00:00Z".into(),
        };
        assert_eq!(
            keys_of(serde_json::to_value(&l).unwrap()),
            vec![
                "createdAt",
                "durationMs",
                "error",
                "id",
                "model",
                "ok",
                "requestBody",
                "responseBody",
                "scene",
            ]
        );
    }
}
