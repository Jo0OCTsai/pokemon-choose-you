use crate::ai::{self, AiSuggestion};
use crate::db::{now, Db};
use rusqlite::params;
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};

const BASE: &str = "https://open.feishu.cn/open-apis";

pub struct FeishuConfig {
    pub app_id: String,
    pub app_secret: String,
}

pub fn load_config(get: &dyn Fn(&str) -> Option<String>) -> Option<FeishuConfig> {
    Some(FeishuConfig {
        app_id: get("feishu_app_id")?,
        app_secret: get("feishu_app_secret")?,
    })
}

/// tenant_access_token（飞书自建应用凭证，有效期约 2 小时，这里每次轮询重新获取，简单可靠）
async fn token(cfg: &FeishuConfig) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp: serde_json::Value = client
        .post(format!("{BASE}/auth/v3/tenant_access_token/internal"))
        .json(&serde_json::json!({"app_id": cfg.app_id, "app_secret": cfg.app_secret}))
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("飞书 token 请求失败: {e}"))?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    if resp["code"].as_i64() != Some(0) {
        return Err(format!("飞书 token 获取失败: {}", resp["msg"].as_str().unwrap_or("?")));
    }
    Ok(resp["tenant_access_token"].as_str().ok_or("token 字段缺失")?.to_string())
}

#[derive(Deserialize)]
struct ChatPage {
    data: ChatData,
}
#[derive(Deserialize)]
struct ChatData {
    items: Option<Vec<serde_json::Value>>,
}

/// 机器人所在的会话列表
async fn list_chats(cfg: &FeishuConfig) -> Result<Vec<(String, String)>, String> {
    let token = token(cfg).await?;
    let client = reqwest::Client::new();
    let mut out = vec![];
    loop {
        let url = format!("{BASE}/im/v1/chats?page_size=100");
        let page: ChatPage = client
            .get(&url)
            .bearer_auth(&token)
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| format!("拉取会话列表失败: {e}"))?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        for item in page.data.items.unwrap_or_default() {
            let chat_id = item["chat_id"].as_str().unwrap_or_default().to_string();
            let name = item["name"].as_str().unwrap_or("未命名会话").to_string();
            if !chat_id.is_empty() {
                out.push((chat_id, name));
            }
        }
        // 简化处理：单页最多 100 个会话，个人使用足够
        break;
    }
    Ok(out)
}

#[derive(Deserialize)]
struct MsgPage {
    data: MsgData,
}
#[derive(Deserialize)]
struct MsgData {
    items: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    has_more: bool,
    #[serde(default)]
    page_token: Option<String>,
}

struct NewMessage {
    message_id: String,
    chat_name: String,
    sender: String,
    content: String,
}

/// 从文本类消息 body.content 里提取纯文本
fn extract_text(msg_type: &str, content: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(content).ok()?;
    match msg_type {
        "text" => v["text"].as_str().map(|s| s.to_string()),
        "post" => {
            // 富文本，粗略提取所有 text 段
            let mut buf = String::new();
            fn walk(v: &serde_json::Value, buf: &mut String) {
                if let Some(t) = v["text"].as_str() {
                    buf.push_str(t);
                    buf.push(' ');
                }
                if let Some(arr) = v.as_array() {
                    for x in arr {
                        walk(x, buf);
                    }
                }
                if let Some(obj) = v.as_object() {
                    for x in obj.values() {
                        walk(x, buf);
                    }
                }
            }
            walk(&v, &mut buf);
            Some(buf.trim().to_string())
        }
        _ => None, // 图片/文件等跳过
    }
}

/// 增量拉取：只处理上一次轮询之后的新消息
async fn pull_new_messages(cfg: &FeishuConfig, since_ms: Option<i64>) -> Result<(Vec<NewMessage>, i64), String> {
    let token = token(cfg).await?;
    let client = reqwest::Client::new();
    let chats = list_chats(cfg).await?;
    let now_ms = chrono::Utc::now().timestamp_millis();
    // 拉取窗口：上次游标（回退 2 分钟容错）到当前
    let start = since_ms.map(|s| s - 120_000).unwrap_or(now_ms - 10 * 60_000);
    let mut out = vec![];
    for (chat_id, chat_name) in chats {
        // 处理当前会话的所有分页
        let mut page_token: Option<String> = None;
        loop {
            let mut url = format!(
                "{BASE}/im/v1/messages?container_id_type=chat&container_id={chat_id}&page_size=50&start_time={start}&end_time={now_ms}"
            );
            if let Some(t) = &page_token {
                url.push_str(&format!("&page_token={t}"));
            }
            let resp = client
                .get(&url)
                .bearer_auth(&token)
                .timeout(std::time::Duration::from_secs(20))
                .send()
                .await
                .map_err(|e| format!("拉取消息失败: {e}"))?;
            if !resp.status().is_success() {
                log::warn!("feishu: chat {} 拉取失败 {}", chat_id, resp.status());
                break;
            }
            let page: MsgPage = resp.json().await.map_err(|e| e.to_string())?;
            for m in page.data.items.unwrap_or_default() {
                let msg_type = m["msg_type"].as_str().unwrap_or_default();
                let content = m["body"]["content"].as_str().unwrap_or_default();
                let sender_id = m["sender"]["id"].as_str().unwrap_or("unknown").to_string();
                if let Some(text) = extract_text(msg_type, content) {
                    if text.trim().is_empty() {
                        continue;
                    }
                    out.push(NewMessage {
                        message_id: m["message_id"].as_str().unwrap_or_default().to_string(),
                        chat_name: chat_name.clone(),
                        sender: sender_id,
                        content: text,
                    });
                }
            }
            if !page.data.has_more {
                break;
            }
            page_token = page.data.page_token;
        }
    }
    Ok((out, now_ms))
}

/// 连接测试：获取 token 并列出会话数
pub async fn poll_once_test(cfg: &FeishuConfig) -> Result<String, String> {
    let chats = list_chats(cfg).await?;
    Ok(format!("连接成功，机器人在 {} 个会话中", chats.len()))
}

/// 一轮完整的"拉取 → AI 分类 → 写入收件箱建议"
pub async fn poll_once(app: &AppHandle) -> Result<usize, String> {
    let db = app.state::<Db>();
    let get = |k: &str| -> Option<String> {
        let conn = db.0.lock().unwrap();
        conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| {
            r.get::<_, String>(0)
        })
        .ok()
    };
    let fcfg = match feishu_config(&get) {
        Some(c) => c,
        None => return Ok(0), // 未配置，静默跳过
    };
    let acfg = match ai::load_config(&get) {
        Some(c) => c,
        None => return Err("已配置飞书但未配置 AI 接口，无法分类".into()),
    };

    let since: Option<i64> = get("feishu_cursor").and_then(|s| s.parse().ok());
    let (messages, cursor) = pull_new_messages(&fcfg, since).await?;

    let mut saved = 0;
    // 分批送 AI（每批 20 条，避免超 token）
    for chunk in messages.chunks(20) {
        let batch: Vec<(String, String, String)> = chunk
            .iter()
            .map(|m| (m.message_id.clone(), m.sender.clone(), m.content.clone()))
            .collect();
        let suggestions: Vec<AiSuggestion> = match ai::classify(&acfg, &batch).await {
            Ok(s) => s,
            Err(e) => {
                log::warn!("AI 分类失败（本轮跳过）: {e}");
                continue;
            }
        };
        let by_id: std::collections::HashMap<String, &AiSuggestion> =
            suggestions.iter().map(|s| (s.message_id.clone(), s)).collect();
        for m in chunk {
            let sug = by_id.get(&m.message_id).and_then(|s| if s.todo { Some(s) } else { None });
            if sug.is_none() {
                continue;
            }
            let sug = sug.unwrap();
            let conn = db.0.lock().unwrap();
            let inserted = conn.execute(
                "INSERT OR IGNORE INTO im_suggestions (message_id, chat_name, sender, content, suggested_title, suggested_category, suggested_due, review_status, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,'pending',?8)",
                params![m.message_id, m.chat_name, m.sender, m.content, sug.title, sug.category, sug.due, now()],
            );
            if let Ok(n) = inserted {
                if n > 0 {
                    saved += 1;
                }
            }
        }
    }

    if saved > 0 {
        let _ = app.emit("im-suggestions-changed", saved);
    }
    {
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO sync_state (provider, cursor, updated_at) VALUES ('feishu', ?1, ?2)
             ON CONFLICT(provider) DO UPDATE SET cursor=?1, updated_at=?2",
            params![cursor.to_string(), now()],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('feishu_cursor', ?1) ON CONFLICT(key) DO UPDATE SET value=?1",
            params![cursor.to_string()],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(saved)
}

fn feishu_config(get: &dyn Fn(&str) -> Option<String>) -> Option<FeishuConfig> {
    let cfg = load_config(get)?;
    if cfg.app_id.is_empty() || cfg.app_secret.is_empty() {
        return None;
    }
    Some(cfg)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- extract_text：飞书消息内容提取 ----

    #[test]
    fn extract_text_from_text_message() {
        let content = r#"{"text":"明天上午10点开周会"}"#;
        assert_eq!(extract_text("text", content).as_deref(), Some("明天上午10点开周会"));
    }

    #[test]
    fn extract_text_from_post_rich_text() {
        let content = r#"{"title":"纪要","content":[[{"tag":"text","text":"周三前"},{"tag":"text","text":"交报告"}]]}"#;
        assert_eq!(extract_text("post", content).as_deref(), Some("周三前 交报告"));
    }

    #[test]
    fn extract_text_skips_non_text_and_invalid() {
        assert_eq!(extract_text("image", r#"{"image_key":"x"}"#), None, "图片消息跳过");
        assert_eq!(extract_text("text", "not-json"), None, "非法 JSON 跳过");
        assert_eq!(extract_text("text", r#"{"text":""}"#).as_deref(), Some(""), "空文本交给上层过滤");
    }

    // ---- 配置加载 ----

    fn getter<'a>(map: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |k| map.iter().find(|(key, _)| *key == k).map(|(_, v)| v.to_string())
    }

    #[test]
    fn load_config_requires_both_credentials() {
        assert!(load_config(&getter(&[("feishu_app_id", "cli_x")])).is_none());
        assert!(load_config(&getter(&[("feishu_app_secret", "s")])).is_none());
        let cfg = load_config(&getter(&[("feishu_app_id", "cli_x"), ("feishu_app_secret", "sec")])).unwrap();
        assert_eq!(cfg.app_id, "cli_x");
    }

    #[test]
    fn feishu_config_ignores_empty_strings() {
        let g = getter(&[("feishu_app_id", ""), ("feishu_app_secret", "")]);
        assert!(feishu_config(&g).is_none(), "空串视为未配置，poll_once 静默跳过");
    }
}

/// 后台轮询循环：间隔从设置读取（默认 120 秒），失败指数退避（上限 15 分钟）
pub fn spawn_poll_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut backoff = 1u64;
        loop {
            let (enabled, interval) = {
                let db = app.state::<Db>();
                let conn = db.0.lock().unwrap();
                let enabled = conn
                    .query_row("SELECT value FROM settings WHERE key='feishu_enabled'", [], |r| {
                        r.get::<_, String>(0)
                    })
                    .ok()
                    .map(|v| v == "true")
                    .unwrap_or(false);
                let interval = conn
                    .query_row("SELECT value FROM settings WHERE key='feishu_poll_interval'", [], |r| {
                        r.get::<_, String>(0)
                    })
                    .ok()
                    .and_then(|v| v.parse::<u64>().ok())
                    .filter(|s| *s >= 30)
                    .unwrap_or(120);
                (enabled, interval)
            };
            if enabled {
                match poll_once(&app).await {
                    Ok(_) => backoff = 1,
                    Err(e) => {
                        log::warn!("feishu poll failed: {e}");
                        backoff = (backoff * 2).min(8);
                    }
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(interval * backoff)).await;
        }
    });
}
