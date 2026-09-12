use crate::ai::{self, AiSuggestion};
use crate::db::{now, Db};
use crate::error::{AppError, AppResult};
use crate::events;
use rusqlite::params;
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};

const BASE: &str = "https://open.feishu.cn/open-apis";

pub struct FeishuConfig {
    pub app_id: String,
    pub app_secret: String,
    /// 测试用 wiremock 服务器替换，生产走默认官方地址
    pub base_url: String,
}

pub fn load_config(get: &dyn Fn(&str) -> Option<String>) -> Option<FeishuConfig> {
    Some(FeishuConfig {
        app_id: get("feishu_app_id")?,
        app_secret: get("feishu_app_secret")?,
        base_url: BASE.into(),
    })
}

/// 统一解析飞书响应：先读文本再校验，避免 reqwest 解码错误吞掉真实原因
/// （飞书业务错误响应没有 data 字段，直接反序列化会报 "error decoding response body"）
async fn feishu_json<T: serde::de::DeserializeOwned>(
    resp: reqwest::Response,
    what: &str,
) -> AppResult<T> {
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::Network(format!("读取{what}响应失败: {e}")))?;
    let v: serde_json::Value = serde_json::from_str(&body).map_err(|_| {
        // 网关/代理可能返回 HTML 错误页，截断避免刷屏
        let snippet: String = body.chars().take(200).collect();
        AppError::External(format!("{what}返回非 JSON（HTTP {status}）: {snippet}"))
    })?;
    if v["code"].as_i64().is_some_and(|c| c != 0) {
        let msg = v["msg"].as_str().unwrap_or("?");
        return Err(AppError::External(format!(
            "{what}失败（code {}）: {msg}",
            v["code"]
        )));
    }
    serde_json::from_value(v).map_err(|e| AppError::External(format!("{what}响应格式异常: {e}")))
}

/// tenant_access_token（飞书自建应用凭证，有效期约 2 小时，这里每次轮询重新获取，简单可靠）
async fn token(cfg: &FeishuConfig) -> AppResult<String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!(
            "{}/auth/v3/tenant_access_token/internal",
            cfg.base_url
        ))
        .json(&serde_json::json!({"app_id": cfg.app_id, "app_secret": cfg.app_secret}))
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| AppError::Network(format!("飞书 token 请求失败: {e}")))?;
    let v: serde_json::Value = feishu_json(resp, "飞书 token 获取").await?;
    v["tenant_access_token"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| AppError::External("token 字段缺失".into()))
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
async fn list_chats(cfg: &FeishuConfig) -> AppResult<Vec<(String, String)>> {
    let token = token(cfg).await?;
    let client = reqwest::Client::new();
    let mut out = vec![];
    let url = format!("{}/im/v1/chats?page_size=100", cfg.base_url);
    let resp = client
        .get(&url)
        .bearer_auth(&token)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| AppError::Network(format!("拉取会话列表失败: {e}")))?;
    let page: ChatPage = feishu_json(resp, "拉取会话列表").await?;
    for item in page.data.items.unwrap_or_default() {
        let chat_id = item["chat_id"].as_str().unwrap_or_default().to_string();
        let name = item["name"].as_str().unwrap_or("未命名会话").to_string();
        if !chat_id.is_empty() {
            out.push((chat_id, name));
        }
    }
    // 简化处理：单页最多 100 个会话，个人使用足够
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

/// 计算拉取窗口（秒级时间戳）。
/// 飞书 im/v1/messages 的 start_time/end_time 只接受秒，传毫秒会落到远未来窗口、
/// 永远返回空列表；游标内部仍以毫秒存储，出口处统一转秒。
/// 首次拉取（无游标）回看 24 小时，兼顾"装好后能捞到当天消息"与不触发海量历史。
fn window_secs(since_ms: Option<i64>, now_ms: i64) -> (i64, i64) {
    let start = since_ms
        .map(|s| s - 120_000) // 回退 2 分钟容错
        .unwrap_or(now_ms - 24 * 3_600_000);
    (start / 1000, now_ms / 1000)
}

/// 增量拉取：只处理上一次轮询之后的新消息
async fn pull_new_messages(
    cfg: &FeishuConfig,
    since_ms: Option<i64>,
) -> AppResult<(Vec<NewMessage>, i64)> {
    let token = token(cfg).await?;
    let client = reqwest::Client::new();
    let chats = list_chats(cfg).await?;
    if chats.is_empty() {
        log::info!("feishu: 机器人不在任何会话中，无消息可拉取（把机器人拉进群、或私聊它后重试）");
    }
    let now_ms = chrono::Utc::now().timestamp_millis();
    let (start_s, end_s) = window_secs(since_ms, now_ms);
    let mut out = vec![];
    for (chat_id, chat_name) in chats {
        // 处理当前会话的所有分页
        let mut page_token: Option<String> = None;
        let mut chat_count = 0usize;
        loop {
            let mut url = format!(
                "{}/im/v1/messages?container_id_type=chat&container_id={chat_id}&page_size=50&start_time={start_s}&end_time={end_s}",
                cfg.base_url
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
                .map_err(|e| AppError::Network(format!("拉取消息失败: {e}")))?;
            if !resp.status().is_success() {
                log::warn!("feishu: chat {} 拉取失败 {}", chat_id, resp.status());
                break;
            }
            let page: MsgPage = feishu_json(resp, "拉取消息").await?;
            for m in page.data.items.unwrap_or_default() {
                let msg_type = m["msg_type"].as_str().unwrap_or_default();
                let content = m["body"]["content"].as_str().unwrap_or_default();
                let sender_id = m["sender"]["id"].as_str().unwrap_or("unknown").to_string();
                if let Some(text) = extract_text(msg_type, content) {
                    if text.trim().is_empty() {
                        continue;
                    }
                    log::debug!("feishu: 新消息「{chat_name}」{sender_id}: {text}");
                    out.push(NewMessage {
                        message_id: m["message_id"].as_str().unwrap_or_default().to_string(),
                        chat_name: chat_name.clone(),
                        sender: sender_id,
                        content: text,
                    });
                    chat_count += 1;
                }
            }
            if !page.data.has_more {
                break;
            }
            page_token = page.data.page_token;
        }
        log::debug!("feishu: 会话「{chat_name}」本轮共 {chat_count} 条消息");
    }
    Ok((out, now_ms))
}

/// 连接测试：获取 token 并列出会话数
pub async fn poll_once_test(cfg: &FeishuConfig) -> AppResult<String> {
    let chats = list_chats(cfg).await?;
    Ok(format!("连接成功，机器人在 {} 个会话中", chats.len()))
}

/// 一轮完整的"拉取 → AI 分类 → 写入收件箱建议"
pub async fn poll_once(app: &AppHandle) -> AppResult<usize> {
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
        None => {
            return Err(AppError::Invalid(
                "已配置飞书但未配置 AI 接口，无法分类".into(),
            ))
        }
    };

    let since: Option<i64> = get("feishu_cursor").and_then(|s| s.parse().ok());
    let (messages, cursor) = pull_new_messages(&fcfg, since).await?;
    if messages.is_empty() {
        log::debug!("feishu: 本轮无新消息");
    } else {
        log::info!("feishu: 本轮拉取到 {} 条新消息，送 AI 分类", messages.len());
    }

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
        let n_todo = suggestions.iter().filter(|s| s.todo).count();
        log::info!("feishu: AI 判定 {n_todo}/{} 条为待办", batch.len());
        for s in suggestions.iter().filter(|s| s.todo) {
            log::info!(
                "feishu: 待办「{}」分类 {} due {:?}（消息 {}）",
                s.title.as_deref().unwrap_or("-"),
                s.category.as_deref().unwrap_or("-"),
                s.due,
                s.message_id
            );
        }
        let by_id: std::collections::HashMap<String, &AiSuggestion> = suggestions
            .iter()
            .map(|s| (s.message_id.clone(), s))
            .collect();
        for m in chunk {
            let sug = by_id.get(&m.message_id).filter(|&s| s.todo);
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
        log::info!("feishu: 新增 {saved} 条收件箱建议");
        let _ = app.emit(events::IM_SUGGESTIONS_CHANGED, saved);
    }
    {
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO sync_state (provider, cursor, updated_at) VALUES ('feishu', ?1, ?2)
             ON CONFLICT(provider) DO UPDATE SET cursor=?1, updated_at=?2",
            params![cursor.to_string(), now()],
        )?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('feishu_cursor', ?1) ON CONFLICT(key) DO UPDATE SET value=?1",
            params![cursor.to_string()],
        )?;
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

/// 后台轮询循环：间隔从设置读取（默认 120 秒），失败指数退避（上限 15 分钟）
pub fn spawn_poll_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut backoff = 1u64;
        loop {
            let (enabled, interval) = {
                let db = app.state::<Db>();
                let conn = db.0.lock().unwrap();
                let enabled = conn
                    .query_row(
                        "SELECT value FROM settings WHERE key='feishu_enabled'",
                        [],
                        |r| r.get::<_, String>(0),
                    )
                    .ok()
                    .map(|v| v == "true")
                    .unwrap_or(false);
                let interval = conn
                    .query_row(
                        "SELECT value FROM settings WHERE key='feishu_poll_interval'",
                        [],
                        |r| r.get::<_, String>(0),
                    )
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

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    // ---- extract_text：飞书消息内容提取 ----

    #[test]
    fn extract_text_from_text_message() {
        let content = r#"{"text":"明天上午10点开周会"}"#;
        assert_eq!(
            extract_text("text", content).as_deref(),
            Some("明天上午10点开周会")
        );
    }

    #[test]
    fn extract_text_from_post_rich_text() {
        let content = r#"{"title":"纪要","content":[[{"tag":"text","text":"周三前"},{"tag":"text","text":"交报告"}]]}"#;
        assert_eq!(
            extract_text("post", content).as_deref(),
            Some("周三前 交报告")
        );
    }

    #[test]
    fn extract_text_skips_non_text_and_invalid() {
        assert_eq!(
            extract_text("image", r#"{"image_key":"x"}"#),
            None,
            "图片消息跳过"
        );
        assert_eq!(extract_text("text", "not-json"), None, "非法 JSON 跳过");
        assert_eq!(
            extract_text("text", r#"{"text":""}"#).as_deref(),
            Some(""),
            "空文本交给上层过滤"
        );
    }

    // ---- 配置加载 ----

    fn getter<'a>(map: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |k| {
            map.iter()
                .find(|(key, _)| *key == k)
                .map(|(_, v)| v.to_string())
        }
    }

    #[test]
    fn load_config_requires_both_credentials() {
        assert!(load_config(&getter(&[("feishu_app_id", "cli_x")])).is_none());
        assert!(load_config(&getter(&[("feishu_app_secret", "s")])).is_none());
        let cfg = load_config(&getter(&[
            ("feishu_app_id", "cli_x"),
            ("feishu_app_secret", "sec"),
        ]))
        .unwrap();
        assert_eq!(cfg.app_id, "cli_x");
        assert_eq!(cfg.base_url, BASE, "生产配置指向官方地址");
    }

    #[test]
    fn feishu_config_ignores_empty_strings() {
        let g = getter(&[("feishu_app_id", ""), ("feishu_app_secret", "")]);
        assert!(
            feishu_config(&g).is_none(),
            "空串视为未配置，poll_once 静默跳过"
        );
    }

    // ---- reqwest 分支：wiremock 覆盖 token / 会话列表 / 消息拉取 ----

    fn test_cfg(base_url: &str) -> FeishuConfig {
        FeishuConfig {
            app_id: "cli_x".into(),
            app_secret: "sec".into(),
            base_url: base_url.into(),
        }
    }

    #[test]
    fn token_error_is_external() {
        tauri::async_runtime::block_on(async {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/auth/v3/tenant_access_token/internal"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 99991663, "msg": "app secret invalid"
                })))
                .mount(&server)
                .await;
            let err = token(&test_cfg(&server.uri())).await.unwrap_err();
            assert!(
                err.to_string().contains("app secret invalid"),
                "错误带飞书返回信息: {err}"
            );
        });
    }

    #[test]
    fn list_chats_returns_named_chats() {
        tauri::async_runtime::block_on(async {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "tenant_access_token": "t-xyz"
                })))
                .mount(&server)
                .await;
            Mock::given(method("GET"))
                .and(path("/im/v1/chats"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "data": { "items": [
                        { "chat_id": "oc_1", "name": "项目群" },
                        { "chat_id": "", "name": "脏数据跳过" }
                    ]}
                })))
                .mount(&server)
                .await;
            let chats = list_chats(&test_cfg(&server.uri())).await.unwrap();
            assert_eq!(chats, vec![("oc_1".to_string(), "项目群".to_string())]);
        });
    }

    /// 回归：飞书业务错误响应（code != 0，无 data 字段）不能只报 "error decoding response body"，
    /// 必须带出飞书的 code/msg（如未开通 im:chat 权限），否则用户无从排查
    #[test]
    fn list_chats_api_error_reports_feishu_msg() {
        tauri::async_runtime::block_on(async {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "tenant_access_token": "t-xyz"
                })))
                .mount(&server)
                .await;
            Mock::given(method("GET"))
                .and(path("/im/v1/chats"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 99991672, "msg": "access control: you have no permission"
                })))
                .mount(&server)
                .await;
            let err = list_chats(&test_cfg(&server.uri())).await.unwrap_err();
            let msg = err.to_string();
            assert!(
                msg.contains("99991672") && msg.contains("no permission"),
                "错误应包含飞书 code 与 msg: {msg}"
            );
        });
    }

    /// 回归：网关/代理返回非 JSON（如 HTML 错误页）时错误应带 HTTP 状态与内容片段
    #[test]
    fn list_chats_non_json_body_reports_status_and_snippet() {
        tauri::async_runtime::block_on(async {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "tenant_access_token": "t-xyz"
                })))
                .mount(&server)
                .await;
            Mock::given(method("GET"))
                .and(path("/im/v1/chats"))
                .respond_with(
                    ResponseTemplate::new(502)
                        .set_body_string("<html><body>Bad Gateway</body></html>"),
                )
                .mount(&server)
                .await;
            let err = list_chats(&test_cfg(&server.uri())).await.unwrap_err();
            let msg = err.to_string();
            assert!(
                msg.contains("502") && msg.contains("Bad Gateway"),
                "错误应包含状态码与响应片段: {msg}"
            );
        });
    }

    #[test]
    fn window_secs_uses_seconds_and_first_pull_looks_back_24h() {
        let now_ms = 1_789_211_331_894i64;
        // 首次拉取（无游标）：回看 24 小时，输出为秒级
        let (start, end) = window_secs(None, now_ms);
        assert_eq!(end, 1_789_211_331, "毫秒游标出口转秒");
        assert_eq!(start, end - 24 * 3600);
        // 增量拉取：上次游标回退 2 分钟容错
        let (start, end) = window_secs(Some(now_ms - 600_000), now_ms);
        assert_eq!(start, (now_ms - 600_000 - 120_000) / 1000);
        assert_eq!(end, now_ms / 1000);
    }

    /// 拉取链路：会话 + 文本/富文本消息入库为 NewMessage，图片消息跳过
    #[test]
    fn pull_new_messages_extracts_text_and_post_only() {
        tauri::async_runtime::block_on(async {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "tenant_access_token": "t-xyz"
                })))
                .mount(&server)
                .await;
            Mock::given(method("GET"))
                .and(path("/im/v1/chats"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "data": { "items": [ { "chat_id": "oc_1", "name": "项目群" } ] }
                })))
                .mount(&server)
                .await;
            Mock::given(method("GET"))
                .and(path("/im/v1/messages"))
                .and(query_param("container_id", "oc_1"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "data": { "items": [
                        { "message_id": "om_1", "msg_type": "text", "sender": { "id": "u1" },
                          "body": { "content": "{\"text\":\"明天上午10点开周会\"}" } },
                        { "message_id": "om_2", "msg_type": "post", "sender": { "id": "u2" },
                          "body": { "content": "{\"content\":[[{\"tag\":\"text\",\"text\":\"周三前\"}]]}" } },
                        { "message_id": "om_3", "msg_type": "image", "sender": { "id": "u3" },
                          "body": { "content": "{\"image_key\":\"k\"}" } }
                    ], "has_more": false }
                })))
                .mount(&server)
                .await;

            let (msgs, _cursor) = pull_new_messages(&test_cfg(&server.uri()), None)
                .await
                .unwrap();
            assert_eq!(msgs.len(), 2, "图片消息不入列");
            assert_eq!(msgs[0].content, "明天上午10点开周会");
            assert_eq!(msgs[0].chat_name, "项目群");
            assert_eq!(msgs[1].content, "周三前");
        });
    }
}
