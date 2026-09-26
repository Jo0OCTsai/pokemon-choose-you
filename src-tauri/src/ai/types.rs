//! 判定协议类型：AiMessage（送判输入）、AiSuggestion / ProposedTag（判定结果）
//! 与批内判重兜底。
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// AI 建议的标签：名字 + 归属维度 + 是否词表外新建。
/// 反序列化兼容旧协议的纯字符串（按 topic 维度、非新建解析），
/// 保证存量 chat_messages.suggested_tags 与旧 agent 输出仍可读
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
pub struct ProposedTag {
    pub name: String,
    #[serde(default)]
    pub dimension: String,
    #[serde(rename = "isNew", default)]
    pub is_new: bool,
}

impl<'de> Deserialize<'de> for ProposedTag {
    fn deserialize<D>(d: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        use serde::de::Error;
        let v = serde_json::Value::deserialize(d)?;
        match v {
            serde_json::Value::String(s) => Ok(ProposedTag {
                name: s,
                dimension: "topic".into(),
                is_new: false,
            }),
            serde_json::Value::Object(m) => {
                let dimension = m
                    .get("dimension")
                    .and_then(|x| x.as_str())
                    .unwrap_or("topic")
                    .trim()
                    .to_string();
                Ok(ProposedTag {
                    name: m
                        .get("name")
                        .and_then(|x| x.as_str())
                        .unwrap_or_default()
                        .trim()
                        .to_string(),
                    dimension: if dimension.is_empty() {
                        "topic".into()
                    } else {
                        dimension
                    },
                    is_new: m
                        .get("isNew")
                        .or_else(|| m.get("is_new"))
                        .and_then(|x| x.as_bool())
                        .unwrap_or(false),
                })
            }
            other => Err(D::Error::custom(format!(
                "标签条目应为字符串或 {{name,dimension,isNew}} 对象: {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AiSuggestion {
    #[serde(rename = "messageId")]
    pub message_id: String,
    /// todo / update / followUp / none（缺省按 none 处理）
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    /// low / normal / high / urgent
    #[serde(default)]
    pub priority: Option<String>,
    /// ISO 时间或自然语言也被接受，直接透传给用户确认
    #[serde(default)]
    pub due: Option<String>,
    #[serde(default)]
    pub tags: Vec<ProposedTag>,
    /// action=followUp 时指向现有待办 id
    #[serde(default, rename = "followUpTaskId")]
    pub follow_up_task_id: Option<i64>,
    /// action=update 时指向要更新的待办 id
    #[serde(default, rename = "updateTaskId")]
    pub update_task_id: Option<i64>,
    /// 一句话判定理由（为什么是待办 / 为什么判重 / 为什么不算），随建议展示并落反馈库
    #[serde(default)]
    pub reason: Option<String>,
    /// high / medium / low：对判定的把握，低置信建议让用户多看一眼
    #[serde(default)]
    pub confidence: Option<String>,
}

impl AiSuggestion {
    pub fn is_todo(&self) -> bool {
        self.action == "todo"
    }
    pub fn is_follow_up(&self) -> bool {
        self.action == "followUp" && self.follow_up_task_id.is_some()
    }
    /// update 建议：明确指向一个现有待办
    pub fn is_update(&self) -> bool {
        self.action == "update" && self.update_task_id.is_some()
    }
}

/// 送 AI 判定的一条消息：除内容外还携带来源语境（私聊/群聊/机器人、发送者）
/// 与同会话近期上下文，模型据此理解指代、判断"谁要谁做什么"。
/// 内容/发送者/上下文均已假名化（代号见 anonymize 模块），真名不进 prompt。
#[derive(Debug, Clone)]
pub struct AiMessage {
    pub message_id: String,
    /// 发送者代号（「我」= 用户本人，其余为 成员_xxxx）
    pub sender: String,
    /// 来源标签，如 "飞书·群聊「项目群」" / "飞书·机器人私聊"
    pub chat_label: String,
    /// 匿名版内容（@我 / 成员代号 / （疑似@我）标记）
    pub content: String,
    /// 同会话上下文（已匿名化的 "[HH:MM] 发送者: 内容" 行，按时间升序）
    pub context: Vec<String>,
    /// 归属标注行（空 = 无标注），由 mention_note() 生成
    pub mention_note: String,
}

impl AiMessage {
    /// 不带上下文的便捷构造（连接测试等场景）
    pub fn simple(message_id: &str, sender: &str, content: &str) -> Self {
        Self {
            message_id: message_id.into(),
            sender: sender.into(),
            chat_label: String::new(),
            content: content.into(),
            context: vec![],
            mention_note: String::new(),
        }
    }
}

/// 批内判重兜底：prompt 已要求模型对同一批消息互相判重，这里防漏判——
/// 规范化标题（trim/折叠空白/小写）相同的多个 todo 只留最先出现的一条，
/// 其余降级 none 并让 reason 指向保留的那条消息。返回被降级的消息 id。
pub(crate) fn dedup_batch_todos(suggestions: &mut [AiSuggestion]) -> Vec<String> {
    let mut first_seen: HashMap<String, String> = HashMap::new();
    let mut demoted = vec![];
    for s in suggestions.iter_mut() {
        if !s.is_todo() {
            continue;
        }
        let key: String = s
            .title
            .as_deref()
            .unwrap_or_default()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        if key.is_empty() {
            continue;
        }
        match first_seen.get(&key) {
            Some(kept_id) => {
                s.action = "none".into();
                s.title = None;
                s.category = None;
                s.due = None;
                s.priority = None;
                s.note = None;
                s.tags.clear();
                s.follow_up_task_id = None;
                s.update_task_id = None;
                s.reason = Some(format!("与消息 {kept_id} 的待办重复"));
                demoted.push(s.message_id.clone());
            }
            None => {
                first_seen.insert(key, s.message_id.clone());
            }
        }
    }
    demoted
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 维度化标签协议：对象形式带 dimension/isNew；dimension 缺省归 topic；
    /// 纯字符串为旧协议（库里的存量建议仍可读）
    #[test]
    fn proposed_tag_deserializes_object_and_string_forms() {
        let tags: Vec<ProposedTag> = serde_json::from_str(
            r#"[
                {"name":"PokemonApp","dimension":"project","isNew":true},
                {"name":"重要"},
                "杂"
            ]"#,
        )
        .unwrap();
        assert_eq!(
            tags,
            vec![
                ProposedTag {
                    name: "PokemonApp".into(),
                    dimension: "project".into(),
                    is_new: true
                },
                ProposedTag {
                    name: "重要".into(),
                    dimension: "topic".into(),
                    is_new: false
                },
                ProposedTag {
                    name: "杂".into(),
                    dimension: "topic".into(),
                    is_new: false
                },
            ]
        );
    }

    // ---- dedup_batch_todos：批内判重兜底 ----

    fn todo_suggestion(id: &str, title: &str) -> AiSuggestion {
        AiSuggestion {
            message_id: id.into(),
            action: "todo".into(),
            title: Some(title.into()),
            ..Default::default()
        }
    }

    #[test]
    fn dedup_batch_todos_demotes_same_title_and_keeps_first() {
        let mut list = vec![
            todo_suggestion("m1", "发周报"),
            todo_suggestion("m2", " 发周报 "), // 仅空白差异：重复
            todo_suggestion("m3", "发周报给老板"), // 标题不同：保留
            AiSuggestion {
                message_id: "m4".into(),
                action: "none".into(),
                ..Default::default()
            },
        ];
        let demoted = dedup_batch_todos(&mut list);
        assert_eq!(demoted, vec!["m2".to_string()], "只降级重复的那条");
        assert!(list[0].is_todo(), "最先出现的保留");
        assert_eq!(list[1].action, "none", "重复条降级 none");
        assert_eq!(list[1].title, None, "降级后清掉建议载荷");
        assert!(
            list[1].reason.as_deref().unwrap().contains("m1"),
            "reason 指向保留的消息: {:?}",
            list[1].reason
        );
        assert!(list[2].is_todo(), "标题不同的不受影响");
    }

    #[test]
    fn dedup_batch_todos_normalizes_case_and_whitespace() {
        let mut list = vec![
            todo_suggestion("a1", "Send Report"),
            todo_suggestion("a2", "send   report"),
        ];
        let demoted = dedup_batch_todos(&mut list);
        assert_eq!(demoted.len(), 1, "大小写与空白折叠后视为同一待办");
        assert_eq!(list[1].action, "none");
    }

    #[test]
    fn dedup_batch_todos_keeps_empty_titles() {
        // 无标题的 todo（异常输出）不动，交给后续流程兜底
        let mut list = vec![
            AiSuggestion {
                message_id: "e1".into(),
                action: "todo".into(),
                ..Default::default()
            },
            todo_suggestion("e2", "发周报"),
        ];
        assert!(dedup_batch_todos(&mut list).is_empty());
        assert!(list.iter().all(|s| s.is_todo()));
    }
}
