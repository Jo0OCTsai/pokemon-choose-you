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
) -> Result<Vec<AiSuggestion>, String> {
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
        .map_err(|e| format!("AI 请求失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("AI 返回 {}: {}", resp.status(), resp.text().await.unwrap_or_default()));
    }
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let content = body["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("AI 响应格式异常")?;
    // 兼容模型输出 ```json 包裹的情况
    let content = content.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```").trim();
    let parsed: serde_json::Value = serde_json::from_str(content).map_err(|e| format!("AI 输出不是合法 JSON: {e}"))?;
    let suggestions = parsed["suggestions"]
        .as_array()
        .ok_or("AI 输出缺少 suggestions 数组")?;
    serde_json::from_value(serde_json::Value::Array(suggestions.clone()))
        .map_err(|e| format!("解析建议失败: {e}"))
}

/// 连接测试
pub async fn test(cfg: &AiConfig) -> Result<String, String> {
    let r = classify(cfg, &[("test".into(), "系统".into(), "明天上午10点开周会".into())]).await?;
    Ok(if r.first().map(|s| s.todo).unwrap_or(false) {
        format!("连接成功，模型正确识别了测试待办：{}", r[0].title.clone().unwrap_or_default())
    } else {
        "连接成功，但模型未识别测试待办，建议换模型".into()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

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

    // ---- classify：本地假 OpenAI 服务器 ----

    /// 把模型输出包成 OpenAI chat completion 响应（classify 读取 choices[0].message.content）
    fn openai_body(content: &str) -> String {
        serde_json::json!({ "choices": [ { "message": { "content": content } } ] }).to_string()
    }

    /// 单连接 HTTP 假服务器：记录请求头/请求体，返回固定响应
    fn spawn_openai_mock(response_body: String) -> (String, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let recorded = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let rec = recorded.clone();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 8192];
                let mut raw = Vec::new();
                // 读完请求头 + Content-Length 长度的 body
                loop {
                    let n = stream.read(&mut buf).unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    raw.extend_from_slice(&buf[..n]);
                    let s = String::from_utf8_lossy(&raw);
                    if let Some(pos) = s.find("\r\n\r\n") {
                        let len: usize = s
                            .lines()
                            .find(|l| l.to_ascii_lowercase().starts_with("content-length:"))
                            .and_then(|l| l.split(':').nth(1))
                            .and_then(|v| v.trim().parse().ok())
                            .unwrap_or(0);
                        if raw.len() >= pos + 4 + len {
                            break;
                        }
                    }
                }
                *rec.lock().unwrap() = String::from_utf8_lossy(&raw)
                    .split("\r\n\r\n")
                    .map(str::to_string)
                    .collect::<Vec<_>>();
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response_body.len(),
                    response_body
                );
                let _ = stream.write_all(resp.as_bytes());
            }
        });
        (format!("http://127.0.0.1:{port}/v1"), recorded)
    }

    fn cfg_for(base_url: &str) -> AiConfig {
        AiConfig {
            base_url: base_url.into(),
            api_key: "sk-test".into(),
            model: "glm-test".into(),
        }
    }

    #[test]
    fn classify_parses_plain_json_response() {
        let suggestions = r#"{"suggestions":[{"messageId":"m1","todo":true,"title":"参加周会","category":"工作","due":"2026-09-13T10:00"}]}"#;
        let (base, rec) = spawn_openai_mock(openai_body(suggestions));
        let out = tauri::async_runtime::block_on(classify(
            &cfg_for(&base),
            &[("m1".into(), "张三".into(), "明天上午10点开周会".into())],
        ))
        .unwrap();
        assert_eq!(out.len(), 1);
        assert!(out[0].todo);
        assert_eq!(out[0].title.as_deref(), Some("参加周会"));
        assert_eq!(out[0].due.as_deref(), Some("2026-09-13T10:00"));
        // 请求侧：路径 /v1/chat/completions、Bearer 鉴权、模型名、消息拼接
        let rec = rec.lock().unwrap();
        let head = &rec[0];
        assert!(head.contains("POST /v1/chat/completions"), "请求打到 base_url 下的 chat/completions");
        assert!(head.contains("authorization: Bearer sk-test"), "带 Bearer 鉴权");
        let body = &rec[1];
        assert!(body.contains("\"model\":\"glm-test\""));
        assert!(body.contains("[m1] 张三: 明天上午10点开周会"));
    }

    #[test]
    fn classify_strips_markdown_code_fence() {
        let suggestions = r#"{"suggestions":[{"messageId":"m1","todo":false}]}"#;
        let fenced = format!("```json\n{suggestions}\n```");
        let (base, _) = spawn_openai_mock(openai_body(&fenced));
        let out = tauri::async_runtime::block_on(classify(
            &cfg_for(&base),
            &[("m1".into(), "s".into(), "c".into())],
        ))
        .unwrap();
        assert_eq!(out.len(), 1);
        assert!(!out[0].todo);
    }

    #[test]
    fn classify_errors_on_non_json() {
        let (base, _) = spawn_openai_mock(openai_body("我觉得这不是待办"));
        let err = tauri::async_runtime::block_on(classify(
            &cfg_for(&base),
            &[("m1".into(), "s".into(), "c".into())],
        ))
        .unwrap_err();
        assert!(err.contains("JSON"), "错误信息说明不是合法 JSON: {err}");
    }
}
