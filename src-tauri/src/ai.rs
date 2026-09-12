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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiSuggestion {
    #[serde(rename = "messageId")]
    pub message_id: String,
    pub todo: bool,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    /// ISO 时间或自然语言也被接受，直接透传给用户确认
    #[serde(default)]
    pub due: Option<String>,
}

const SYSTEM_PROMPT: &str = r#"你是待办事项提取助手。给你一组 IM 消息（含发送者和内容），找出其中隐含的待办事项、承诺、或对方希望你完成/参加的事情。
规则：
- 只提取"需要用户行动"的内容（任务、承诺、会议、deadline、请求）。闲聊、通知、纯信息分享不算。
- title 用简短的祈使句中文概括要做的事（不超过 20 字）。
- category 从这些里选一个：工作/学习/生活/健康/社交/紧急，不确定就选工作。
- due: 如果消息里有明确时间，用 YYYY-MM-DDTHH:MM 格式（今年），否则留空。
- 不是待办的消息，todo 填 false。
只输出 JSON：{"suggestions":[{"messageId":"...","todo":true,"title":"...","category":"...","due":"..."}]}"#;

pub async fn classify(
    cfg: &AiConfig,
    batch: &[(String, String, String)], // (message_id, sender, content)
) -> AppResult<Vec<AiSuggestion>> {
    let client = reqwest::Client::new();
    let user_content = batch
        .iter()
        .map(|(id, sender, content)| format!("[{id}] {sender}: {content}"))
        .collect::<Vec<_>>()
        .join("\n");
    let resp = client
        .post(format!("{}/chat/completions", cfg.base_url))
        .bearer_auth(&cfg.api_key)
        .json(&serde_json::json!({
            "model": cfg.model,
            "temperature": 0.1,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_content}
            ]
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
    let content = body["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| AppError::External("AI 响应格式异常".into()))?;
    // 兼容模型输出 ```json 包裹的情况
    let content = content
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    let parsed: serde_json::Value = serde_json::from_str(content)
        .map_err(|e| AppError::External(format!("AI 输出不是合法 JSON: {e}")))?;
    let suggestions = parsed["suggestions"]
        .as_array()
        .ok_or_else(|| AppError::External("AI 输出缺少 suggestions 数组".into()))?;
    serde_json::from_value(serde_json::Value::Array(suggestions.clone()))
        .map_err(|e| AppError::External(format!("解析建议失败: {e}")))
}

/// 连接测试
pub async fn test(cfg: &AiConfig) -> AppResult<String> {
    let r = classify(
        cfg,
        &[("test".into(), "系统".into(), "明天上午10点开周会".into())],
    )
    .await?;
    Ok(if r.first().map(|s| s.todo).unwrap_or(false) {
        format!(
            "连接成功，模型正确识别了测试待办：{}",
            r[0].title.clone().unwrap_or_default()
        )
    } else {
        "连接成功，但模型未识别测试待办，建议换模型".into()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
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
    fn classify_parses_plain_json_response() {
        tauri::async_runtime::block_on(async {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/v1/chat/completions"))
                .and(header("authorization", "Bearer sk-test"))
                .and(body_string_contains("\"model\":\"glm-test\""))
                .and(body_string_contains("[m1] 张三: 明天上午10点开周会"))
                .respond_with(ResponseTemplate::new(200).set_body_json(openai_body(
                    r#"{"suggestions":[{"messageId":"m1","todo":true,"title":"参加周会","category":"工作","due":"2026-09-13T10:00"}]}"#,
                )))
                .expect(1)
                .mount(&server)
                .await;

            let out = classify(
                &cfg_for(&server.uri()),
                &[("m1".into(), "张三".into(), "明天上午10点开周会".into())],
            )
            .await
            .unwrap();
            assert_eq!(out.len(), 1);
            assert!(out[0].todo);
            assert_eq!(out[0].title.as_deref(), Some("参加周会"));
            assert_eq!(out[0].due.as_deref(), Some("2026-09-13T10:00"));
        });
    }

    #[test]
    fn classify_strips_markdown_code_fence() {
        tauri::async_runtime::block_on(async {
            let suggestions = r#"{"suggestions":[{"messageId":"m1","todo":false}]}"#;
            let fenced = format!("```json\n{suggestions}\n```");
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .respond_with(ResponseTemplate::new(200).set_body_json(openai_body(&fenced)))
                .mount(&server)
                .await;

            let out = classify(
                &cfg_for(&server.uri()),
                &[("m1".into(), "s".into(), "c".into())],
            )
            .await
            .unwrap();
            assert_eq!(out.len(), 1);
            assert!(!out[0].todo);
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

            let err = classify(
                &cfg_for(&server.uri()),
                &[("m1".into(), "s".into(), "c".into())],
            )
            .await
            .unwrap_err();
            assert!(
                err.to_string().contains("JSON"),
                "错误信息说明不是合法 JSON: {err}"
            );
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

            let err = classify(
                &cfg_for(&server.uri()),
                &[("m1".into(), "s".into(), "c".into())],
            )
            .await
            .unwrap_err();
            assert!(
                matches!(err, AppError::External(_)),
                "5xx 归 external: {err}"
            );
            assert!(err.to_string().contains("500"));
        });
    }
}
