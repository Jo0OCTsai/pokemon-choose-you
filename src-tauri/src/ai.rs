use crate::db::Db;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};

/// OpenAI 兼容接口配置（支持 OpenAI / DeepSeek / GLM / Kimi 等）
#[derive(Debug, Clone)]
pub struct AiConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

pub fn load_config(get: &dyn Fn(&str) -> Option<String>) -> Option<AiConfig> {
    Some(AiConfig {
        base_url: get("ai_base_url")?.trim_end_matches('/').to_string(),
        api_key: get("ai_api_key")?,
        model: get("ai_model").unwrap_or_else(|| "gpt-4o-mini".into()),
    })
}

/// 分类时的判重上下文：现有未完成待办 + 可用分类/标签，
/// 由调用方从库里加载后拼进 prompt，AI 借此判重并为新待办决定全部属性
#[derive(Debug, Clone, Default)]
pub struct ClassifyContext {
    /// (task_id, title)
    pub open_tasks: Vec<(i64, String)>,
    pub categories: Vec<String>,
    /// (name, description)
    pub tags: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiSuggestion {
    #[serde(rename = "messageId")]
    pub message_id: String,
    /// todo / followUp / none（缺省按 none 处理）
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
    pub tags: Vec<String>,
    /// action=followUp 时指向现有待办 id
    #[serde(default, rename = "followUpTaskId")]
    pub follow_up_task_id: Option<i64>,
}

impl AiSuggestion {
    pub fn is_todo(&self) -> bool {
        self.action == "todo"
    }
    pub fn is_follow_up(&self) -> bool {
        self.action == "followUp" && self.follow_up_task_id.is_some()
    }
}

/// 一次 AI 调用的完整留痕（AI 链路可观测性）：落 ai_logs 表供设置页查看
#[derive(Debug, Clone)]
pub struct AiCallRecord {
    pub scene: String,
    pub model: String,
    /// 实际发出的 system + user 消息（JSON 序列化）
    pub request: String,
    /// 模型原始输出（失败时为空）
    pub response: String,
    pub ok: bool,
    pub error: Option<String>,
    pub duration_ms: i64,
}

const SYSTEM_PROMPT: &str = r#"你是待办事项提取助手。给你一组 IM 消息（含发送者和内容）、用户当前未完成的待办清单、可用分类和标签，找出其中隐含的待办事项、承诺、或对方希望你完成/参加的事情。
规则：
- 只提取"需要用户行动"的内容（任务、承诺、会议、deadline、请求）。闲聊、通知、纯信息分享不算。
- 判重：判定待办前先对照「现有待办清单」。如果已有本质相同的未完成待办，绝不再生成新待办：这条消息若是该待办的补充、跟进、确认或改期，action 填 "followUp" 并在 followUpTaskId 填该待办 id；若只是重复提及没有新信息，action 填 "none"。
- action 只能是 "todo"、"followUp"、"none" 之一。
- title 用简短的祈使句中文概括要做的事（不超过 20 字）。
- note 一句话补充上下文（谁提出的、在哪里、要什么），没有就留空。
- category 从「可用分类」里选最贴切的一个。
- priority 从 low/normal/high/urgent 里选：对方明确催促或当天到期用 urgent/high，默认 normal。
- due: 消息里有明确时间就用 YYYY-MM-DDTHH:MM 格式（参考「当前时间」换算年份），否则留空。
- tags: 从「可用标签」里选 0~3 个最贴切的标签名组成数组，没有合适的返回 []。
- followUpTaskId 只在 action="followUp" 时填写，取值必须是「现有待办清单」里出现的 id。
只输出 JSON（不要多余文字）：{"results":[{"messageId":"m1","action":"todo","title":"...","note":"...","category":"...","priority":"normal","due":"...","tags":[],"followUpTaskId":null}]}"#;

/// 组装分类请求的 user 消息：判重上下文 + 消息列表
fn build_user_content(
    batch: &[(String, String, String)], // (message_id, sender, content)
    ctx: &ClassifyContext,
) -> String {
    let mut s = String::new();
    s.push_str(&format!(
        "当前时间：{}\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M（%A）")
    ));
    if ctx.open_tasks.is_empty() {
        s.push_str("现有待办清单：（无）\n");
    } else {
        s.push_str("现有待办清单（id. 标题）：\n");
        for (id, title) in &ctx.open_tasks {
            s.push_str(&format!("[{id}] {title}\n"));
        }
    }
    s.push_str(&format!("可用分类：{}\n", ctx.categories.join("/")));
    if ctx.tags.is_empty() {
        s.push_str("可用标签：无\n");
    } else {
        s.push_str("可用标签（名称：描述）：\n");
        for (name, desc) in &ctx.tags {
            if desc.is_empty() {
                s.push_str(&format!("{name}\n"));
            } else {
                s.push_str(&format!("{name}：{desc}\n"));
            }
        }
    }
    s.push_str("消息：\n");
    for (id, sender, content) in batch {
        s.push_str(&format!("[{id}] {sender}: {content}\n"));
    }
    s
}

/// 分类一批消息。无论成败都返回 (结果, 调用留痕)，调用方负责把留痕写库。
pub async fn classify(
    cfg: &AiConfig,
    scene: &str,
    batch: &[(String, String, String)], // (message_id, sender, content)
    ctx: &ClassifyContext,
) -> (AppResult<Vec<AiSuggestion>>, AiCallRecord) {
    let user_content = build_user_content(batch, ctx);
    let messages = serde_json::json!([
        { "role": "system", "content": SYSTEM_PROMPT },
        { "role": "user", "content": user_content }
    ]);
    let request = serde_json::to_string(&messages).unwrap_or_default();
    let record = AiCallRecord {
        scene: scene.into(),
        model: cfg.model.clone(),
        request,
        response: String::new(),
        ok: false,
        error: None,
        duration_ms: 0,
    };
    log::debug!(
        "ai: 请求 {} 共 {} 条消息: {}",
        cfg.model,
        batch.len(),
        trunc(&user_content, 500)
    );

    let started = std::time::Instant::now();
    let outcome = classify_http(cfg, &messages).await;
    let record = AiCallRecord {
        duration_ms: started.elapsed().as_millis() as i64,
        ..record
    };
    match outcome {
        Ok(content) => {
            log::debug!("ai: 原始响应: {}", trunc(&content, 800));
            let record = AiCallRecord {
                response: content.clone(),
                ok: true,
                ..record
            };
            let parsed = parse_suggestions(&content);
            if parsed.is_err() {
                let record = AiCallRecord {
                    ok: false,
                    error: parsed.as_ref().err().map(|e| e.to_string()),
                    ..record
                };
                return (parsed, record);
            }
            (parsed, record)
        }
        Err(e) => {
            log::warn!("ai: 调用失败: {e}");
            let record = AiCallRecord {
                ok: false,
                error: Some(e.to_string()),
                ..record
            };
            (Err(e), record)
        }
    }
}

async fn classify_http(cfg: &AiConfig, messages: &serde_json::Value) -> AppResult<String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/chat/completions", cfg.base_url))
        .bearer_auth(&cfg.api_key)
        .json(&serde_json::json!({
            "model": cfg.model,
            "temperature": 0.1,
            "messages": messages
        }))
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| AppError::Network(format!("AI 请求失败: {e}")))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::External(format!("AI 返回 {status}: {body}")));
    }
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::External(e.to_string()))?;
    body["choices"][0]["message"]["content"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| AppError::External("AI 响应格式异常".into()))
}

/// 解析模型输出（兼容 ```json 包裹），要求 results 数组
fn parse_suggestions(content: &str) -> AppResult<Vec<AiSuggestion>> {
    let content = content
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    let parsed: serde_json::Value = serde_json::from_str(content)
        .map_err(|e| AppError::External(format!("AI 输出不是合法 JSON: {e}")))?;
    let results = parsed["results"].as_array().cloned().or_else(|| {
        // 兼容旧字段名 suggestions
        parsed["suggestions"].as_array().cloned()
    });
    let results = results.ok_or_else(|| AppError::External("AI 输出缺少 results 数组".into()))?;
    serde_json::from_value(serde_json::Value::Array(results))
        .map_err(|e| AppError::External(format!("解析建议失败: {e}")))
}

/// 把一次调用的留痕写入 ai_logs（失败静默：日志链路不能反过来打断业务）
pub fn save_log(db: &Db, rec: &AiCallRecord) {
    let Ok(conn) = db.0.lock() else { return };
    let _ = conn.execute(
        "INSERT INTO ai_logs (scene, model, request_body, response_body, ok, error, duration_ms, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        rusqlite::params![
            rec.scene,
            rec.model,
            rec.request,
            rec.response,
            rec.ok as i64,
            rec.error,
            rec.duration_ms,
            crate::db::now()
        ],
    );
    // 只保留最近 200 条，避免无界增长
    let _ = conn.execute(
        "DELETE FROM ai_logs WHERE id <= (SELECT COALESCE(MAX(id), 0) FROM ai_logs) - 200",
        [],
    );
}

/// 日志截断：按字符数截断（中文安全），避免长消息刷爆 512KB 轮转日志
fn trunc(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// 连接测试
pub async fn test(cfg: &AiConfig) -> (AppResult<String>, AiCallRecord) {
    let ctx = ClassifyContext {
        categories: vec!["工作".into()],
        ..Default::default()
    };
    let (res, record) = classify(
        cfg,
        "test",
        &[("test".into(), "系统".into(), "明天上午10点开周会".into())],
        &ctx,
    )
    .await;
    let out = match res {
        Ok(r) if r.first().is_some_and(|s| s.is_todo()) => Ok(format!(
            "连接成功，模型正确识别了测试待办：{}",
            r[0].title.clone().unwrap_or_default()
        )),
        Ok(_) => Ok("连接成功，但模型未识别测试待办，建议换模型".into()),
        Err(e) => Err(e),
    };
    (out, record)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::test_conn;
    use wiremock::matchers::{body_string_contains, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    // ---- load_config ----

    #[test]
    fn load_config_requires_api_key_and_trims_base_url() {
        let get = |k: &str| match k {
            "ai_base_url" => Some("https://api.openai.com/v1/".into()),
            "ai_api_key" => Some("sk-test".into()),
            "ai_model" => Some("gpt-4o-mini".into()),
            _ => None,
        };
        let cfg = load_config(&get).unwrap();
        assert_eq!(cfg.base_url, "https://api.openai.com/v1", "去掉结尾斜杠");
        assert_eq!(cfg.model, "gpt-4o-mini");

        let missing_key = |k: &str| match k {
            "ai_base_url" => Some("https://x".into()),
            _ => None,
        };
        assert!(load_config(&missing_key).is_none(), "缺 API Key 返回 None");
    }

    #[test]
    fn load_config_defaults_model() {
        let get = |k: &str| match k {
            "ai_base_url" => Some("https://x".into()),
            "ai_api_key" => Some("k".into()),
            _ => None,
        };
        assert_eq!(load_config(&get).unwrap().model, "gpt-4o-mini");
    }

    // ---- build_user_content：判重上下文必须进 prompt ----

    #[test]
    fn user_content_carries_dedup_context() {
        let ctx = ClassifyContext {
            open_tasks: vec![(3, "写周报".into()), (5, "修登录 bug".into())],
            categories: vec!["工作".into(), "学习".into()],
            tags: vec![
                ("重要".into(), "核心目标相关".into()),
                ("杂".into(), String::new()),
            ],
        };
        let s = build_user_content(&[("m1".into(), "张三".into(), "开会".into())], &ctx);
        assert!(s.contains("[3] 写周报"), "待办清单进 prompt: {s}");
        assert!(s.contains("可用分类：工作/学习"));
        assert!(s.contains("重要：核心目标相关"));
        assert!(s.lines().any(|l| l.trim() == "杂"), "无描述标签只打名称");
        assert!(s.contains("[m1] 张三: 开会"));
        assert!(s.contains("当前时间："));
    }

    #[test]
    fn user_content_empty_context_degrades_gracefully() {
        let s = build_user_content(&[], &ClassifyContext::default());
        assert!(s.contains("（无）"));
        assert!(s.contains("可用标签：无"));
    }

    // ---- classify：wiremock 假 OpenAI 服务器 ----

    /// 把模型输出包成 OpenAI chat completion 响应（classify 读取 choices[0].message.content）
    fn openai_body(content: &str) -> serde_json::Value {
        serde_json::json!({ "choices": [ { "message": { "content": content } } ] })
    }

    /// base_url 形态对齐真实配置（https://api.openai.com/v1 → 请求 /v1/chat/completions）
    fn cfg_for(server_uri: &str) -> AiConfig {
        AiConfig {
            base_url: format!("{server_uri}/v1"),
            api_key: "sk-test".into(),
            model: "glm-test".into(),
        }
    }

    #[test]
    fn classify_parses_todo_with_full_attributes() {
        tauri::async_runtime::block_on(async {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/v1/chat/completions"))
                .and(header("authorization", "Bearer sk-test"))
                .and(body_string_contains("\"model\":\"glm-test\""))
                .and(body_string_contains("[3] 写周报"))
                .and(body_string_contains("[m1] 张三: 明天上午10点开周会"))
                .respond_with(ResponseTemplate::new(200).set_body_json(openai_body(
                    r#"{"results":[{"messageId":"m1","action":"todo","title":"参加周会","note":"张三在项目群安排","category":"工作","priority":"high","due":"2026-09-13T10:00","tags":["重要"],"followUpTaskId":null}]}"#,
                )))
                .expect(1)
                .mount(&server)
                .await;

            let ctx = ClassifyContext {
                open_tasks: vec![(3, "写周报".into())],
                categories: vec!["工作".into()],
                tags: vec![("重要".into(), "".into())],
            };
            let (res, record) = classify(
                &cfg_for(&server.uri()),
                "classify",
                &[("m1".into(), "张三".into(), "明天上午10点开周会".into())],
                &ctx,
            )
            .await;
            let out = res.unwrap();
            assert_eq!(out.len(), 1);
            assert!(out[0].is_todo());
            assert_eq!(out[0].title.as_deref(), Some("参加周会"));
            assert_eq!(out[0].note.as_deref(), Some("张三在项目群安排"));
            assert_eq!(out[0].priority.as_deref(), Some("high"));
            assert_eq!(out[0].tags, vec!["重要".to_string()]);
            assert_eq!(out[0].due.as_deref(), Some("2026-09-13T10:00"));
            assert!(record.ok, "成功调用留痕 ok=true");
            assert!(record.duration_ms >= 0);
            assert!(
                record.request.contains("系统") || record.request.contains("role"),
                "请求体留痕"
            );
            assert!(record.response.contains("参加周会"), "响应体留痕");
        });
    }

    #[test]
    fn classify_parses_follow_up_action() {
        tauri::async_runtime::block_on(async {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .respond_with(ResponseTemplate::new(200).set_body_json(openai_body(
                    r#"{"results":[{"messageId":"m1","action":"followUp","followUpTaskId":3,"title":"周会改期"}]}"#,
                )))
                .mount(&server)
                .await;
            let (res, _) = classify(
                &cfg_for(&server.uri()),
                "classify",
                &[("m1".into(), "张三".into(), "周会改到下午".into())],
                &ClassifyContext::default(),
            )
            .await;
            let out = res.unwrap();
            assert!(out[0].is_follow_up());
            assert!(!out[0].is_todo());
            assert_eq!(out[0].follow_up_task_id, Some(3));
        });
    }

    #[test]
    fn classify_strips_markdown_code_fence() {
        tauri::async_runtime::block_on(async {
            let results = r#"{"results":[{"messageId":"m1","action":"none"}]}"#;
            let fenced = format!("```json\n{results}\n```");
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .respond_with(ResponseTemplate::new(200).set_body_json(openai_body(&fenced)))
                .mount(&server)
                .await;

            let (res, _) = classify(
                &cfg_for(&server.uri()),
                "classify",
                &[("m1".into(), "s".into(), "c".into())],
                &ClassifyContext::default(),
            )
            .await;
            let out = res.unwrap();
            assert_eq!(out.len(), 1);
            assert!(!out[0].is_todo());
            assert_eq!(out[0].action, "none");
        });
    }

    #[test]
    fn classify_errors_on_non_json() {
        tauri::async_runtime::block_on(async {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(openai_body("我觉得这不是待办")),
                )
                .mount(&server)
                .await;

            let (res, record) = classify(
                &cfg_for(&server.uri()),
                "classify",
                &[("m1".into(), "s".into(), "c".into())],
                &ClassifyContext::default(),
            )
            .await;
            assert!(res.is_err());
            assert!(
                res.unwrap_err().to_string().contains("JSON"),
                "错误信息说明不是合法 JSON"
            );
            assert!(!record.ok, "解析失败也留痕");
            assert!(record.error.as_deref().unwrap_or("").contains("JSON"));
            // 响应原文保留，便于在日志页排查模型到底回了什么
            assert!(record.response.contains("我觉得这不是待办"));
        });
    }

    /// reqwest 分支：上游 5xx 时归为外部服务错误（可提示重试/换配置）
    #[test]
    fn classify_maps_http_error_to_external_kind() {
        tauri::async_runtime::block_on(async {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .respond_with(ResponseTemplate::new(500).set_body_string("boom"))
                .mount(&server)
                .await;

            let (res, record) = classify(
                &cfg_for(&server.uri()),
                "classify",
                &[("m1".into(), "s".into(), "c".into())],
                &ClassifyContext::default(),
            )
            .await;
            let err = res.unwrap_err();
            assert!(
                matches!(err, AppError::External(_)),
                "5xx 归 external: {err}"
            );
            assert!(err.to_string().contains("500"));
            assert!(!record.ok && record.error.is_some(), "失败调用留痕");
        });
    }

    // ---- save_log：留痕落库并限量保留 ----

    #[test]
    fn save_log_persists_and_caps_entries() {
        let conn = test_conn();
        let db = Db(std::sync::Mutex::new(conn));
        for i in 0..205 {
            save_log(
                &db,
                &AiCallRecord {
                    scene: "classify".into(),
                    model: "m".into(),
                    request: format!("req-{i}"),
                    response: format!("resp-{i}"),
                    ok: i % 2 == 0,
                    error: if i % 2 == 0 { None } else { Some("err".into()) },
                    duration_ms: i,
                },
            );
        }
        let (count, oldest_id): (i64, i64) = {
            let c = db.0.lock().unwrap();
            c.query_row("SELECT COUNT(*), MIN(id) FROM ai_logs", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap()
        };
        assert_eq!(count, 200, "只保留最近 200 条");
        assert_eq!(oldest_id, 6, "最老的 5 条被清掉（按 id 而非字符串序）");
    }
}
