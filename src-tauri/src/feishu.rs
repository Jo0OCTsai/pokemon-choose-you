use crate::ai::{self, AiMessage};
use crate::db::{now, Db};
use crate::error::{AppError, AppResult};
use crate::events;
use rusqlite::params;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const BASE: &str = "https://open.feishu.cn/open-apis";
/// OAuth 本地回调固定端口；redirect_uri 需在飞书开放平台
/// 「安全设置 → 重定向 URL」中原样配置，授权时必须完全匹配
const OAUTH_CALLBACK_PORT: u16 = 23981;
const OAUTH_REDIRECT_URI: &str = "http://127.0.0.1:23981/callback";
/// 等待用户在浏览器完成授权的上限
const OAUTH_WAIT: Duration = Duration::from_secs(180);
/// AI 判定附带的同会话上下文窗口：往前 30 分钟、最多 10 条
const CONTEXT_WINDOW_MS: i64 = 30 * 60 * 1000;
const CONTEXT_MAX_MESSAGES: i64 = 10;
/// 群成员名缓存刷新的翻页上限（单页 100，超出的大群发送者退化为短 id）
const MEMBERS_MAX_PAGES: u32 = 3;

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

/// settings 表读写小助手：OAuth 凭证持久化与轮询时读取共用。
/// 秘钥类键（app_secret / user_token / refresh_token）经 secrets 模块优先走 OS 钥匙串，
/// 无钥匙串环境自动回落 settings 表。
struct Settings<'a>(&'a Db);

impl Settings<'_> {
    fn get(&self, key: &str) -> Option<String> {
        let conn = self.0 .0.lock().unwrap();
        crate::secrets::secret_get(&conn, key)
    }
    fn set(&self, key: &str, value: &str) -> AppResult<()> {
        let conn = self.0 .0.lock().unwrap();
        if crate::secrets::is_secret_key(key) {
            return crate::secrets::secret_set(&conn, key, value);
        }
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=?2",
            params![key, value],
        )?;
        Ok(())
    }
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
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| AppError::Network(format!("飞书 token 请求失败: {e}")))?;
    let v: serde_json::Value = feishu_json(resp, "飞书 token 获取").await?;
    v["tenant_access_token"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| AppError::External("token 字段缺失".into()))
}

// ---- OAuth：用户身份授权（user_access_token） ----

#[derive(Clone, Debug)]
struct TokenSet {
    access_token: String,
    refresh_token: String,
    /// 有效期（秒）
    expires_in: i64,
}

/// OAuth v2 换取/刷新 user_access_token 的公共出口：
/// POST /authen/v2/oauth/token，业务错误码（20029 重定向不符 / 20054 code 失效等）带 msg 上抛
async fn oauth_token_request(
    cfg: &FeishuConfig,
    body: serde_json::Value,
    what: &str,
) -> AppResult<TokenSet> {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/authen/v2/oauth/token", cfg.base_url))
        .json(&body)
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| AppError::Network(format!("{what}请求失败: {e}")))?;
    let v: serde_json::Value = feishu_json(resp, what).await?;
    let access_token = v["access_token"]
        .as_str()
        .or_else(|| v["user_access_token"].as_str())
        .map(String::from);
    let Some(access_token) = access_token else {
        // 兼容标准 OAuth 错误体（无 code 字段只有 error/error_description）
        let desc = v["error_description"]
            .as_str()
            .or_else(|| v["error"].as_str())
            .unwrap_or("响应缺少 access_token");
        return Err(AppError::External(format!("{what}失败: {desc}")));
    };
    let refresh_token = v["refresh_token"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| AppError::External(format!("{what}响应缺少 refresh_token")))?;
    Ok(TokenSet {
        access_token,
        refresh_token,
        expires_in: v["expires_in"].as_i64().unwrap_or(7200),
    })
}

/// 授权码换 token 并持久化（含提前 5 分钟的过期余量）
async fn exchange_code(cfg: &FeishuConfig, st: &Settings<'_>, code: &str) -> AppResult<TokenSet> {
    let ts = oauth_token_request(
        cfg,
        serde_json::json!({
            "grant_type": "authorization_code",
            "client_id": cfg.app_id,
            "client_secret": cfg.app_secret,
            "code": code,
            "redirect_uri": OAUTH_REDIRECT_URI,
        }),
        "飞书授权登录",
    )
    .await?;
    persist_token_set(st, &ts)?;
    Ok(ts)
}

/// refresh_token 刷新（飞书刷新后轮换，旧值不可复用，必须落库新值）
async fn refresh_access(
    cfg: &FeishuConfig,
    st: &Settings<'_>,
    refresh_token: &str,
) -> AppResult<String> {
    let ts = oauth_token_request(
        cfg,
        serde_json::json!({
            "grant_type": "refresh_token",
            "client_id": cfg.app_id,
            "client_secret": cfg.app_secret,
            "refresh_token": refresh_token,
        }),
        "刷新飞书用户凭证",
    )
    .await?;
    persist_token_set(st, &ts)?;
    Ok(ts.access_token)
}

fn persist_token_set(st: &Settings<'_>, ts: &TokenSet) -> AppResult<()> {
    let expires_at = chrono::Utc::now().timestamp_millis() + (ts.expires_in - 300) * 1000;
    st.set("feishu_user_token", &ts.access_token)?;
    st.set("feishu_refresh_token", &ts.refresh_token)?;
    st.set("feishu_token_expires_at", &expires_at.to_string())?;
    Ok(())
}

/// 当前授权用户信息：GET /authen/v1/user_info
async fn fetch_user_info(cfg: &FeishuConfig, user_token: &str) -> AppResult<(String, String)> {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/authen/v1/user_info", cfg.base_url))
        .bearer_auth(user_token)
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| AppError::Network(format!("获取飞书用户信息失败: {e}")))?;
    let v: serde_json::Value = feishu_json(resp, "获取飞书用户信息").await?;
    let open_id = v["data"]["open_id"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    if open_id.is_empty() {
        return Err(AppError::External("用户信息缺少 open_id".into()));
    }
    let name = v["data"]["name"]
        .as_str()
        .filter(|s| !s.is_empty())
        .or_else(|| v["data"]["en_name"].as_str())
        .unwrap_or("飞书用户")
        .to_string();
    Ok((open_id, name))
}

/// 用户授权状态（设置页展示）：是否已授权 + 授权用户名
pub fn oauth_status(db: &Db) -> (bool, String) {
    let st = Settings(db);
    let authorized = st
        .get("feishu_refresh_token")
        .is_some_and(|t| !t.is_empty());
    let name = st.get("feishu_user_name").unwrap_or_default();
    (authorized, name)
}

/// 浏览器授权全流程：起本地回调监听 → 打开授权页 → 等 code → 换 token → 拉用户信息 → 落库。
/// 返回给前端的成功文案含授权用户名。
pub async fn oauth_login(app: &AppHandle) -> AppResult<String> {
    let db = app.state::<Db>();
    let st = Settings(&db);
    let get = |k: &str| st.get(k);
    let cfg = match feishu_config(&get) {
        Some(c) => c,
        None => {
            return Err(AppError::Invalid(
                "请先填写并保存飞书 App ID / App Secret".into(),
            ))
        }
    };

    let listener = TcpListener::bind(("127.0.0.1", OAUTH_CALLBACK_PORT)).map_err(|e| {
        AppError::Invalid(format!(
            "本地回调端口 {OAUTH_CALLBACK_PORT} 被占用（{e}），请释放后重试"
        ))
    })?;
    // 随机 state 防 CSRF；无 rand 依赖，时间戳+进程号足够桌面单机场景
    let state = format!(
        "{:x}{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0),
        std::process::id()
    );
    let url = format!(
        "{}/authen/v1/authorize?app_id={}&redirect_uri={}&state={state}",
        cfg.base_url,
        cfg.app_id,
        urlencode(OAUTH_REDIRECT_URI),
    );
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url.clone(), None::<&str>)
        .map_err(|e| AppError::External(format!("打开浏览器失败: {e}")))?;
    log::info!("feishu: 已打开授权页，等待浏览器回调（{OAUTH_REDIRECT_URI}）");

    // 阻塞式等回调放独立线程；外层用稍长的 timeout 兜底，超时后自连接唤醒 accept 让线程退出
    let stop = Arc::new(AtomicBool::new(false));
    let wait_state = state.clone();
    let wait_stop = Arc::clone(&stop);
    let wait_listener = listener;
    let handle = tauri::async_runtime::spawn_blocking(move || {
        wait_for_code(
            wait_listener,
            wait_state,
            Instant::now() + OAUTH_WAIT,
            wait_stop,
        )
    });
    let code = match tokio::time::timeout(OAUTH_WAIT + Duration::from_secs(10), handle).await {
        Ok(Ok(Some(code))) => code,
        Ok(Ok(None)) => {
            return Err(AppError::Invalid(
                "未在浏览器中完成授权（state 校验失败或连接中断），请重试".into(),
            ))
        }
        Ok(Err(_)) => return Err(AppError::External("授权等待线程异常退出".into())),
        Err(_) => {
            stop.store(true, Ordering::Relaxed);
            let _ = TcpStream::connect(("127.0.0.1", OAUTH_CALLBACK_PORT));
            return Err(AppError::Invalid(
                "等待授权超时（3 分钟未回调），请重新点击「授权登录」".into(),
            ));
        }
    };

    let ts = exchange_code(&cfg, &st, &code).await?;
    let (open_id, name) = fetch_user_info(&cfg, &ts.access_token).await?;
    st.set("feishu_user_open_id", &open_id)?;
    st.set("feishu_user_name", &name)?;
    log::info!("feishu: 用户「{name}」授权成功");
    Ok(format!("授权成功：{name}"))
}

/// 非阻塞 accept 轮询回调：浏览器 GET /callback?code=..&state=..，
/// state 匹配则回一页成功提示并返回 code，其余请求（favicon 等）应答后继续等
fn wait_for_code(
    listener: TcpListener,
    want_state: String,
    deadline: Instant,
    stop: Arc<AtomicBool>,
) -> Option<String> {
    let _ = listener.set_nonblocking(true);
    while !stop.load(Ordering::Relaxed) && Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                if let Some((code, state)) = read_callback_request(&mut stream) {
                    let ok = state == want_state && !code.is_empty();
                    write_callback_response(&mut stream, ok);
                    if ok {
                        return Some(code);
                    }
                    log::debug!("feishu: 回调 state 不匹配，继续等待");
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(200))
            }
            Err(e) => {
                log::warn!("feishu: 回调监听异常: {e}");
                return None;
            }
        }
    }
    None
}

/// 读一个 HTTP 请求并解析出 query 里的 code/state（读超时 2 秒，只看请求行）
fn read_callback_request(stream: &mut TcpStream) -> Option<(String, String)> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut buf = vec![0u8; 8192];
    let mut n = 0;
    while n < buf.len() {
        match stream.read(&mut buf[n..]) {
            Ok(0) => break,
            Ok(k) => {
                n += k;
                // 读完请求头即可（GET 无 body）
                if buf[..n].windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    let head = String::from_utf8_lossy(&buf[..n]);
    let path = head.split_whitespace().nth(1)?;
    let query = path.split_once('?')?.1;
    let mut code = String::new();
    let mut state = String::new();
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        match urldecode(k).as_str() {
            "code" => code = urldecode(v),
            "state" => state = urldecode(v),
            _ => {}
        }
    }
    Some((code, state))
}

fn write_callback_response(stream: &mut TcpStream, ok: bool) {
    let body = if ok {
        "<html><body><h2>✔ 授权成功</h2><p>请回到「宝可梦来敲门」继续。</p></body></html>"
    } else {
        "<html><body><h2>授权参数异常</h2><p>请回到应用重新发起授权。</p></body></html>"
    };
    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}

fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn urldecode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(b) => {
                        out.push(b);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ---- 用户身份凭证（轮询时取可用 token，必要时刷新） ----

#[derive(Debug)]
struct UserAuth {
    token: String,
    open_id: String,
    name: String,
}

/// 取可用的 user_access_token：缓存未过期直接用；过期用 refresh_token 轮换；
/// 未授权给出带操作指引的错误。顺带补齐缺失的用户 open_id/姓名。
async fn user_auth(cfg: &FeishuConfig, st: &Settings<'_>) -> AppResult<UserAuth> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let cached = st.get("feishu_user_token").filter(|t| !t.is_empty());
    let expires_at: i64 = st
        .get("feishu_token_expires_at")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let token = match cached {
        Some(t) if expires_at > now_ms + 60_000 => t,
        _ => {
            let refresh_token = st
                .get("feishu_refresh_token")
                .filter(|t| !t.is_empty())
                .ok_or_else(|| {
                    AppError::Invalid(
                        "飞书尚未授权：请到 设置 → 集成 → 飞书 点击「授权登录」".into(),
                    )
                })?;
            refresh_access(cfg, st, &refresh_token).await?
        }
    };
    let mut open_id = st.get("feishu_user_open_id").unwrap_or_default();
    let mut name = st.get("feishu_user_name").unwrap_or_default();
    if open_id.is_empty() || name.is_empty() {
        let (oid, nm) = fetch_user_info(cfg, &token).await?;
        if open_id.is_empty() {
            open_id = oid;
            st.set("feishu_user_open_id", &open_id)?;
        }
        if name.is_empty() {
            name = nm;
            st.set("feishu_user_name", &name)?;
        }
    }
    Ok(UserAuth {
        token,
        open_id,
        name,
    })
}

// ---- 会话与消息拉取（用户身份） ----

#[derive(Deserialize)]
struct ChatPage {
    data: ChatData,
}
#[derive(Deserialize)]
struct ChatData {
    items: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    has_more: bool,
    #[serde(default)]
    page_token: Option<String>,
}

/// 会话概要。user_access_token 调用时 chat_mode 区分 p2p（单聊）/ group（群聊），
/// 私聊无需再把机器人拉进会话
#[derive(Debug)]
struct ChatSummary {
    chat_id: String,
    name: String,
    chat_mode: String,
}

/// 会话列表（tenant token 返回机器人所在会话；user token 返回授权用户的全部会话，含单聊）
async fn list_chats(cfg: &FeishuConfig, access_token: &str) -> AppResult<Vec<ChatSummary>> {
    let client = reqwest::Client::new();
    let url = format!("{}/im/v1/chats?page_size=100", cfg.base_url);
    let resp = client
        .get(&url)
        .bearer_auth(access_token)
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| AppError::Network(format!("拉取会话列表失败: {e}")))?;
    let page: ChatPage = feishu_json(resp, "拉取会话列表").await?;
    if page.data.has_more {
        log::warn!("feishu: 会话超过 100 个，本轮只覆盖第一页");
    }
    let mut out = vec![];
    for item in page.data.items.unwrap_or_default() {
        let chat_id = item["chat_id"].as_str().unwrap_or_default().to_string();
        if chat_id.is_empty() {
            continue;
        }
        out.push(ChatSummary {
            chat_id,
            name: item["name"].as_str().unwrap_or("未命名会话").to_string(),
            chat_mode: item["chat_mode"].as_str().unwrap_or("group").to_string(),
        });
    }
    Ok(out)
}

/// 机器人身份上下文：bot 的 open_id/名字（/bot/v3/info）+ bot 所在单聊集合。
/// 用于把「用户与本应用机器人的单聊」识别出来——那条链路只处理用户发给机器人的消息。
/// 任何一步失败都降级（不阻断用户身份拉取），靠消息里 sender_type=app 兜底识别。
struct BotContext {
    open_id: Option<String>,
    name: String,
    p2p_chat_ids: HashSet<String>,
}

async fn bot_context(cfg: &FeishuConfig) -> BotContext {
    let mut ctx = BotContext {
        open_id: None,
        name: "机器人".into(),
        p2p_chat_ids: HashSet::new(),
    };
    let Ok(t) = token(cfg).await else {
        log::warn!("feishu: 获取应用凭证失败，机器人单聊识别降级为消息内探测");
        return ctx;
    };
    // bot 信息：响应字段在顶层（部分应用包 data），失败不阻断
    if let Ok(resp) = reqwest::Client::new()
        .get(format!("{}/bot/v3/info", cfg.base_url))
        .bearer_auth(&t)
        .timeout(Duration::from_secs(10))
        .send()
        .await
    {
        if let Ok(v) = feishu_json::<serde_json::Value>(resp, "获取机器人信息").await {
            let open_id = v["open_id"]
                .as_str()
                .or_else(|| v["data"]["open_id"].as_str())
                .map(String::from);
            if let Some(name) = v["open_name"]
                .as_str()
                .or_else(|| v["data"]["open_name"].as_str())
                .filter(|s| !s.is_empty())
            {
                ctx.name = name.to_string();
            }
            ctx.open_id = open_id;
        }
    }
    // bot 所在单聊：与用户会话列表求交集即得「用户 ↔ 本机器人」单聊
    match list_chats(cfg, &t).await {
        Ok(chats) => {
            ctx.p2p_chat_ids = chats
                .into_iter()
                .filter(|c| c.chat_mode == "p2p")
                .map(|c| c.chat_id)
                .collect();
        }
        Err(e) => log::warn!("feishu: 拉取机器人会话列表失败（单聊识别降级）: {e}"),
    }
    ctx
}

#[derive(Deserialize, Default)]
struct MsgPage {
    data: MsgData,
}
#[derive(Deserialize, Default)]
struct MsgData {
    items: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    has_more: bool,
    #[serde(default)]
    page_token: Option<String>,
}

/// 入库前的一条消息（含会话/发送者元数据与是否送 AI）
struct NewMessage {
    message_id: String,
    chat_id: String,
    chat_name: String,
    /// p2p / group / bot（与机器人的单聊）
    chat_type: String,
    sender_id: String,
    sender_name: String,
    is_self: bool,
    sent_at: i64,
    content: String,
    needs_ai: bool,
}

/// 纯媒体类消息：保留占位符入上下文，但不送 AI 判定
fn is_media_only(msg_type: &str) -> bool {
    matches!(
        msg_type,
        "image"
            | "audio"
            | "media"
            | "file"
            | "sticker"
            | "share_chat"
            | "share_user"
            | "merged_forward"
    )
}

/// 把消息 body.content 渲染成可读文本。
/// text/post/卡片保留语义结构（@人名、链接），媒体类给占位符，无法理解的返回 None 跳过。
/// mentions：消息级 @ 映射（key "@_user_1" → name/open_id），text 占位符与 post 的 user_key 都靠它还原人名。
fn render_content(
    msg_type: &str,
    content: &str,
    mentions: &serde_json::Value,
    resolve_name: &dyn Fn(&str) -> Option<String>,
) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(content).ok()?;
    let mention_name = |key: &str| -> Option<String> {
        mentions
            .as_array()?
            .iter()
            .find(|m| m["key"].as_str() == Some(key))
            .and_then(|m| {
                let named = m["name"].as_str().map(String::from);
                named.or_else(|| m["id"]["open_id"].as_str().and_then(resolve_name))
            })
    };
    match msg_type {
        "text" => {
            let mut text = v["text"].as_str()?.to_string();
            if let Some(arr) = mentions.as_array() {
                for m in arr {
                    if let Some(key) = m["key"].as_str() {
                        let name = m["name"]
                            .as_str()
                            .map(String::from)
                            .or_else(|| m["id"]["open_id"].as_str().and_then(resolve_name))
                            .unwrap_or_else(|| "成员".into());
                        text = text.replace(key, &format!("@{name}"));
                    }
                }
            }
            Some(text)
        }
        "post" => {
            // 富文本可能按语言分包（zh_cn/en_us/...），取第一个语言包，否则整体即内容
            let body = ["zh_cn", "en_us", "ja_jp"]
                .iter()
                .find_map(|k| v[k].as_object().map(|_| &v[k]))
                .unwrap_or(&v);
            let mut out = String::new();
            if let Some(title) = body["title"].as_str().filter(|s| !s.is_empty()) {
                out.push_str(&format!("{title}\n"));
            }
            let paragraphs = body["content"].as_array()?;
            let mut lines = vec![];
            for para in paragraphs {
                let mut line = vec![];
                if let Some(segs) = para.as_array() {
                    for seg in segs {
                        line.push(render_post_segment(seg, &mention_name, resolve_name));
                    }
                }
                let joined: String = line
                    .into_iter()
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
                    .join(" ");
                lines.push(joined);
            }
            out.push_str(&lines.join("\n"));
            Some(out)
        }
        "interactive" => {
            // 卡片消息（机器人通知居多）：收集文本节点拼一段摘要
            let mut buf = String::new();
            fn walk(v: &serde_json::Value, buf: &mut String) {
                if buf.chars().count() > 500 {
                    return;
                }
                if let Some(obj) = v.as_object() {
                    for (k, x) in obj {
                        if k == "text" || k == "content" || k == "title" {
                            if let Some(s) = x.as_str().filter(|s| !s.trim().is_empty()) {
                                buf.push_str(s);
                                buf.push(' ');
                            }
                        }
                        walk(x, buf);
                    }
                } else if let Some(arr) = v.as_array() {
                    for x in arr {
                        walk(x, buf);
                    }
                }
            }
            walk(&v, &mut buf);
            let s = buf.trim().to_string();
            if s.is_empty() {
                None
            } else {
                Some(format!("[卡片] {s}"))
            }
        }
        "image" => Some("[图片]".into()),
        "audio" => Some("[语音]".into()),
        "media" => Some("[视频]".into()),
        "file" => {
            let name = v["file_name"].as_str().unwrap_or_default();
            Some(if name.is_empty() {
                "[文件]".into()
            } else {
                format!("[文件:{name}]")
            })
        }
        "sticker" => Some("[表情]".into()),
        "share_chat" => Some("[群名片]".into()),
        "share_user" => Some("[个人名片]".into()),
        "merged_forward" => Some("[合并转发]".into()),
        _ => None,
    }
}

/// post 富文本的单个元素 → 文本（@人、链接带 href，媒体给占位符）
fn render_post_segment(
    seg: &serde_json::Value,
    mention_name: &dyn Fn(&str) -> Option<String>,
    resolve_name: &dyn Fn(&str) -> Option<String>,
) -> String {
    let tag = seg["tag"].as_str().unwrap_or_default();
    match tag {
        "text" => seg["text"].as_str().unwrap_or_default().to_string(),
        "a" => {
            let text = seg["text"].as_str().unwrap_or_default();
            match seg["href"].as_str().filter(|h| !h.is_empty()) {
                Some(href) => format!("{text}({href})"),
                None => text.to_string(),
            }
        }
        "at" => {
            let name = seg["user_key"]
                .as_str()
                .and_then(mention_name)
                .or_else(|| {
                    seg["user_id"]
                        .as_str()
                        .or_else(|| seg["open_id"].as_str())
                        .and_then(resolve_name)
                })
                .unwrap_or_else(|| "成员".into());
            format!("@{name}")
        }
        "img" => "[图片]".into(),
        "media" => "[视频]".into(),
        "emotion" => "[表情]".into(),
        _ => String::new(),
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

/// feishu_users 名字缓存（open_id → 姓名），群消息发送者显示名靠它
fn cached_names(db: &Db) -> HashMap<String, String> {
    let conn = db.0.lock().unwrap();
    let mut out = HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT open_id, name FROM feishu_users") {
        if let Ok(rows) =
            stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        {
            for row in rows.flatten() {
                out.insert(row.0, row.1);
            }
        }
    }
    out
}

fn save_names(db: &Db, names: &[(String, String)]) {
    if names.is_empty() {
        return;
    }
    let Ok(conn) = db.0.lock() else { return };
    for (open_id, name) in names {
        let _ = conn.execute(
            "INSERT INTO feishu_users (open_id, name, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(open_id) DO UPDATE SET name=?2, updated_at=?3",
            params![open_id, name, now()],
        );
    }
}

/// 拉群成员列表（open_id + 姓名），失败不阻断（发送者退化为短 id）
async fn fetch_members(
    cfg: &FeishuConfig,
    user_token: &str,
    chat_id: &str,
) -> Vec<(String, String)> {
    let client = reqwest::Client::new();
    let mut out = vec![];
    let mut page_token: Option<String> = None;
    for _ in 0..MEMBERS_MAX_PAGES {
        let mut url = format!(
            "{}/im/v1/chats/{chat_id}/members?member_id_type=open_id&page_size=100",
            cfg.base_url
        );
        if let Some(t) = &page_token {
            url.push_str(&format!("&page_token={t}"));
        }
        let resp = match client
            .get(&url)
            .bearer_auth(user_token)
            .timeout(Duration::from_secs(15))
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                log::warn!("feishu: 拉取群「{chat_id}」成员失败: {e}");
                return out;
            }
        };
        let page: ChatPage = match feishu_json(resp, "拉取群成员").await {
            Ok(p) => p,
            Err(e) => {
                log::warn!("feishu: 解析群成员失败（发送者名将退化）: {e}");
                return out;
            }
        };
        for item in page.data.items.unwrap_or_default() {
            if let Some(id) = item["member_id"].as_str().filter(|s| !s.is_empty()) {
                out.push((
                    id.to_string(),
                    item["name"].as_str().unwrap_or_default().to_string(),
                ));
            }
        }
        if !page.data.has_more {
            break;
        }
        page_token = page.data.page_token;
    }
    out
}

/// 拉取引擎的用户身份（token 仅供内置引擎后续 REST 调用；lark-cli 引擎凭证自管）
struct UserIdentity {
    open_id: String,
    name: String,
    token: Option<String>,
}

/// 消息拉取引擎：内置直连（自建应用 OAuth + REST）或官方 lark-cli 子进程。
/// 语境过滤（谁的消息送 AI）与上下文组装在两引擎间完全一致。
pub enum FetchEngine {
    /// 内置直连：需要自建应用的 App ID/Secret + 用户 OAuth
    Builtin(FeishuConfig),
    /// 官方 lark-cli：用户经 lark-cli 自己的授权登录（凭证由 lark-cli 保管，不进本应用库）
    LarkCli(String),
}

/// 便捷入口：从设置构建引擎（commands 层用）
pub fn fetch_engine_from(get: &dyn Fn(&str) -> Option<String>) -> Option<FetchEngine> {
    FetchEngine::from_settings(get)
}

impl FetchEngine {
    /// 设置 feishu_engine = "cli" 时走 lark-cli；否则内置直连（缺省）
    fn from_settings(get: &dyn Fn(&str) -> Option<String>) -> Option<FetchEngine> {
        match get("feishu_engine").as_deref() {
            Some("cli") => Some(FetchEngine::LarkCli(crate::lark_cli::lark_bin())),
            _ => feishu_config(get).map(FetchEngine::Builtin),
        }
    }

    async fn identity(&self, db: &Db) -> AppResult<UserIdentity> {
        match self {
            FetchEngine::Builtin(cfg) => {
                let st = Settings(db);
                let a = user_auth(cfg, &st).await?;
                Ok(UserIdentity {
                    open_id: a.open_id,
                    name: a.name,
                    token: Some(a.token),
                })
            }
            FetchEngine::LarkCli(bin) => {
                let (open_id, name) = crate::lark_cli::user_identity(bin).await?;
                Ok(UserIdentity {
                    open_id,
                    name,
                    token: None,
                })
            }
        }
    }

    async fn chats(&self, token: Option<&str>) -> AppResult<Vec<ChatSummary>> {
        match self {
            FetchEngine::Builtin(cfg) => {
                let t = token.expect("内置引擎的身份必带 token");
                list_chats(cfg, t).await
            }
            FetchEngine::LarkCli(bin) => {
                let mut out = vec![];
                let mut page_token: Option<String> = None;
                loop {
                    let d = crate::lark_cli::list_chats(bin, 100, page_token.as_deref()).await?;
                    for item in d["items"].as_array().cloned().unwrap_or_default() {
                        let chat_id = item["chat_id"].as_str().unwrap_or_default().to_string();
                        if chat_id.is_empty() {
                            continue;
                        }
                        out.push(ChatSummary {
                            chat_id,
                            name: item["name"].as_str().unwrap_or("未命名会话").to_string(),
                            chat_mode: item["chat_mode"].as_str().unwrap_or("group").to_string(),
                        });
                    }
                    let has_more = d["has_more"].as_bool().unwrap_or(false);
                    page_token = d["page_token"].as_str().map(String::from);
                    if !has_more || page_token.is_none() || out.len() > 500 {
                        break;
                    }
                }
                Ok(out)
            }
        }
    }

    async fn messages_page(
        &self,
        token: Option<&str>,
        chat_id: &str,
        start_s: i64,
        end_s: i64,
        page_token: Option<String>,
    ) -> AppResult<MsgPage> {
        match self {
            FetchEngine::Builtin(cfg) => {
                let t = token.expect("内置引擎的身份必带 token");
                let client = reqwest::Client::new();
                let mut url = format!(
                    "{}/im/v1/messages?container_id_type=chat&container_id={}&page_size=50&start_time={start_s}&end_time={end_s}",
                    cfg.base_url, chat_id
                );
                if let Some(t) = &page_token {
                    url.push_str(&format!("&page_token={t}"));
                }
                let resp = client
                    .get(&url)
                    .bearer_auth(t)
                    .timeout(Duration::from_secs(20))
                    .send()
                    .await
                    .map_err(|e| AppError::Network(format!("拉取消息失败: {e}")))?;
                if !resp.status().is_success() {
                    log::warn!("feishu: chat {chat_id} 拉取失败 {}", resp.status());
                    return Ok(MsgPage::default());
                }
                feishu_json(resp, "拉取消息").await
            }
            FetchEngine::LarkCli(bin) => {
                let d = crate::lark_cli::list_messages(
                    bin,
                    chat_id,
                    start_s,
                    end_s,
                    page_token.as_deref(),
                )
                .await?;
                Ok(MsgPage {
                    data: MsgData {
                        items: d["items"].as_array().cloned(),
                        has_more: d["has_more"].as_bool().unwrap_or(false),
                        page_token: d["page_token"].as_str().map(String::from),
                    },
                })
            }
        }
    }

    async fn members(&self, token: Option<&str>, chat_id: &str) -> Vec<(String, String)> {
        match self {
            FetchEngine::Builtin(cfg) => {
                let t = token.expect("内置引擎的身份必带 token");
                fetch_members(cfg, t, chat_id).await
            }
            FetchEngine::LarkCli(bin) => {
                let mut out = vec![];
                let mut page_token: Option<String> = None;
                for _ in 0..MEMBERS_MAX_PAGES {
                    match crate::lark_cli::list_members(bin, chat_id, page_token.as_deref()).await {
                        Ok(d) => {
                            for item in d["items"].as_array().cloned().unwrap_or_default() {
                                if let Some(id) =
                                    item["member_id"].as_str().filter(|s| !s.is_empty())
                                {
                                    out.push((
                                        id.to_string(),
                                        item["name"].as_str().unwrap_or_default().to_string(),
                                    ));
                                }
                            }
                            let has_more = d["has_more"].as_bool().unwrap_or(false);
                            page_token = d["page_token"].as_str().map(String::from);
                            if !has_more || page_token.is_none() {
                                break;
                            }
                        }
                        Err(e) => {
                            log::warn!("feishu: lark-cli 拉取群「{chat_id}」成员失败: {e}");
                            break;
                        }
                    }
                }
                out
            }
        }
    }

    async fn bot(&self) -> BotContext {
        match self {
            FetchEngine::Builtin(cfg) => bot_context(cfg).await,
            // lark-cli 用它自己的内置应用身份，不存在「本应用机器人」：
            // 单聊一律按 p2p 处理（对方消息送 AI），机器人语境自然缺席
            FetchEngine::LarkCli(_) => BotContext {
                open_id: None,
                name: String::new(),
                p2p_chat_ids: HashSet::new(),
            },
        }
    }
}

/// 用户身份增量拉取。消息处理语境：
/// - 与机器人的单聊：只把「当前用户发给机器人的」送 AI（bot 回复与其他人的消息只作上下文）；
/// - 与他人的单聊：只把「对方发来的」送 AI（用户自己发出的作上下文）；
/// - 群聊：除自己与本应用机器人外的消息送 AI。
async fn pull_new_messages(
    engine: &FetchEngine,
    db: &Db,
    since_ms: Option<i64>,
) -> AppResult<(Vec<NewMessage>, i64)> {
    let identity = engine.identity(db).await?;
    let chats = engine.chats(identity.token.as_deref()).await?;
    if chats.is_empty() {
        log::info!("feishu: 授权用户不在任何会话中，无消息可拉取");
    }
    let bot = engine.bot().await;
    let mut names = cached_names(db);
    let mut refreshed_chats: HashSet<String> = HashSet::new();

    let now_ms = chrono::Utc::now().timestamp_millis();
    let (start_s, end_s) = window_secs(since_ms, now_ms);
    let mut out = vec![];
    for chat in &chats {
        let mut chat_is_bot = chat.chat_mode == "p2p" && bot.p2p_chat_ids.contains(&chat.chat_id);
        // 处理当前会话的所有分页
        let mut page_token: Option<String> = None;
        let mut chat_count = 0usize;
        loop {
            let page = engine
                .messages_page(
                    identity.token.as_deref(),
                    &chat.chat_id,
                    start_s,
                    end_s,
                    page_token,
                )
                .await?;
            for m in page.data.items.unwrap_or_default() {
                let message_id = m["message_id"].as_str().unwrap_or_default().to_string();
                if message_id.is_empty() {
                    continue;
                }
                let msg_type = m["msg_type"].as_str().unwrap_or_default();
                let content = m["body"]["content"].as_str().unwrap_or_default();
                let sender_id = m["sender"]["id"].as_str().unwrap_or("unknown").to_string();
                let sender_type = m["sender"]["sender_type"].as_str().unwrap_or("user");
                // create_time 为毫秒字符串；异常时用当前时间兜底
                let sent_at = m["create_time"]
                    .as_str()
                    .and_then(|s| s.parse::<i64>().ok())
                    .unwrap_or(now_ms);
                let mentions = &m["mentions"];
                let names_ref = &names;
                let resolve = move |oid: &str| names_ref.get(oid).cloned();
                let Some(text) = render_content(msg_type, content, mentions, &resolve) else {
                    continue;
                };
                if text.trim().is_empty() {
                    continue;
                }
                let is_self = sender_type == "user" && sender_id == identity.open_id;
                let is_our_bot =
                    sender_type == "app" && bot.open_id.as_deref() == Some(sender_id.as_str());
                // 消息内兜底：单聊里出现本应用机器人 → 该会话就是机器人单聊
                if !chat_is_bot && chat.chat_mode == "p2p" && is_our_bot {
                    chat_is_bot = true;
                }
                let chat_type = if chat_is_bot {
                    "bot"
                } else if chat.chat_mode == "p2p" {
                    "p2p"
                } else {
                    "group"
                };
                let needs_ai = match chat_type {
                    "bot" => is_self,
                    "p2p" => !is_self,
                    _ => !is_self && !is_our_bot,
                } && !is_media_only(msg_type);
                // 发送者显示名：自己/机器人/单聊对方（会话名即对方）/群成员缓存
                let sender_name = if is_self {
                    identity.name.clone()
                } else if is_our_bot {
                    bot.name.clone()
                } else if chat.chat_mode == "p2p" {
                    chat.name.clone()
                } else if sender_type != "user" {
                    "应用".to_string()
                } else {
                    match names.get(&sender_id) {
                        Some(n) if !n.is_empty() => n.clone(),
                        _ => {
                            // 首次遇到陌生发送者：拉一次群成员名单补缓存（每群每轮最多一次）
                            if !refreshed_chats.contains(&chat.chat_id) {
                                refreshed_chats.insert(chat.chat_id.clone());
                                let members = engine
                                    .members(identity.token.as_deref(), &chat.chat_id)
                                    .await;
                                save_names(db, &members);
                                for (oid, n) in &members {
                                    names.insert(oid.clone(), n.clone());
                                }
                            }
                            names
                                .get(&sender_id)
                                .filter(|n| !n.is_empty())
                                .cloned()
                                .unwrap_or_else(|| short_id(&sender_id))
                        }
                    }
                };
                log::debug!(
                    "feishu: 新消息「{chat_type}·{}」{sender_name}: {text}",
                    chat.name
                );
                out.push(NewMessage {
                    message_id,
                    chat_id: chat.chat_id.clone(),
                    chat_name: chat.name.clone(),
                    chat_type: chat_type.to_string(),
                    sender_id,
                    sender_name,
                    is_self,
                    sent_at,
                    content: text,
                    needs_ai,
                });
                chat_count += 1;
            }
            if !page.data.has_more {
                break;
            }
            page_token = page.data.page_token;
        }
        log::debug!("feishu: 会话「{}」本轮共 {chat_count} 条消息", chat.name);
    }
    Ok((out, now_ms))
}

/// open_id 过长，缓存未命中时截短展示（如 ou_ab12cd34）
fn short_id(id: &str) -> String {
    id.chars().take(11).collect()
}

/// 连接测试（引擎化）：验证身份 + 会话可见性
pub async fn poll_once_test(engine: &FetchEngine, db: &Db) -> AppResult<String> {
    let identity = engine.identity(db).await?;
    let chats = engine.chats(identity.token.as_deref()).await?;
    let groups = chats.iter().filter(|c| c.chat_mode != "p2p").count();
    let p2p = chats.len() - groups;
    let engine_label = match engine {
        FetchEngine::LarkCli(_) => "lark-cli",
        FetchEngine::Builtin(_) => "直连",
    };
    Ok(format!(
        "连接成功（{engine_label}）：已授权「{}」，可见 {} 个会话（群聊 {groups} · 单聊 {p2p}）",
        identity.name,
        chats.len()
    ))
}

/// 一轮完整的"拉取 → 全量入库（待判定/仅上下文）→ AI 分类（带判重与同会话上下文）
/// → 更新消息状态 → 清理过期消息"。外层同时登记飞书链路健康（成功/失败）。
pub async fn poll_once(app: &AppHandle) -> AppResult<usize> {
    let result = poll_once_inner(app).await;
    let state = app.state::<crate::health::HealthState>();
    match &result {
        Ok(_) => state.record_success(app, crate::health::FEISHU),
        Err(e) => state.record_failure(app, crate::health::FEISHU, &e.to_string()),
    }
    result
}

async fn poll_once_inner(app: &AppHandle) -> AppResult<usize> {
    let db = app.state::<Db>();
    let get = |k: &str| -> Option<String> {
        let conn = db.0.lock().unwrap();
        conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| {
            r.get::<_, String>(0)
        })
        .ok()
    };
    let engine = match FetchEngine::from_settings(&get) {
        Some(e) => e,
        None => return Ok(0), // 未配置（引擎及其凭证），静默跳过
    };
    let agent = match ai::primary_agent(&get) {
        Some(a) => a,
        None => {
            return Err(AppError::Invalid(
                "已配置飞书但未配置 AI Agent，无法分类".into(),
            ))
        }
    };

    let since: Option<i64> = get("feishu_cursor").and_then(|s| s.parse().ok());
    let (messages, cursor) = pull_new_messages(&engine, &db, since).await?;

    // 1. 全量入库：待判定的进收音机，其余（自己发的、机器人回复等）标记 skipped 只作上下文
    let fresh: Vec<NewMessage> = {
        let conn = db.0.lock().unwrap();
        messages
            .into_iter()
            .filter(|m| {
                let known: bool = conn
                    .query_row(
                        "SELECT 1 FROM chat_messages WHERE message_id=?1",
                        params![m.message_id],
                        |_| Ok(true),
                    )
                    .is_ok();
                !known
            })
            .collect()
    };
    {
        let conn = db.0.lock().unwrap();
        for m in &fresh {
            let sent_rfc3339 = chrono::DateTime::from_timestamp_millis(m.sent_at)
                .map(|t| t.to_rfc3339())
                .unwrap_or_else(now);
            conn.execute(
                "INSERT INTO chat_messages (message_id, chat_id, chat_name, chat_type, sender, sender_id,
                                            content, sent_at, is_self, ai_status, review_status, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'pending',?11)",
                params![
                    m.message_id,
                    m.chat_id,
                    m.chat_name,
                    m.chat_type,
                    m.sender_name,
                    m.sender_id,
                    m.content,
                    m.sent_at,
                    m.is_self as i64,
                    if m.needs_ai { "pending" } else { "skipped" },
                    sent_rfc3339,
                ],
            )?;
        }
    }
    if fresh.is_empty() {
        log::debug!("feishu: 本轮无新消息");
    } else {
        let pending = fresh.iter().filter(|m| m.needs_ai).count();
        log::info!(
            "feishu: 本轮拉取 {} 条消息（{pending} 条待 AI 判定，其余作上下文）",
            fresh.len()
        );
    }

    // 2. 分批送 AI（每批 20 条，避免超 token），带判重上下文与同会话近期消息
    let actionable: Vec<&NewMessage> = fresh.iter().filter(|m| m.needs_ai).collect();
    let mut saved = 0usize;
    for chunk in actionable.chunks(20) {
        let batch = {
            let conn = db.0.lock().unwrap();
            chunk
                .iter()
                .map(|m| AiMessage {
                    message_id: m.message_id.clone(),
                    sender: m.sender_name.clone(),
                    chat_label: crate::commands::radio::chat_label(&m.chat_type, &m.chat_name),
                    content: m.content.clone(),
                    context: crate::commands::radio::chat_context_lines(
                        &conn,
                        &m.chat_id,
                        m.sent_at,
                        &m.message_id,
                        CONTEXT_WINDOW_MS,
                        CONTEXT_MAX_MESSAGES,
                    ),
                })
                .collect::<Vec<_>>()
        };
        let ctx = {
            let conn = db.0.lock().unwrap();
            crate::commands::radio::classify_context(&conn)?
        };
        // 分类调用按次落 agent_sessions（会话回链与成本观察：时长 / 会话 id / 成败）
        let started = std::time::Instant::now();
        let classified = ai::classify_with_session(&agent, &batch, &ctx).await;
        let duration_ms = started.elapsed().as_millis() as i64;
        let suggestions = match classified {
            Ok((s, session_id)) => {
                let conn = db.0.lock().unwrap();
                let _ = crate::commands::sessions::log_session_conn(
                    &conn,
                    &crate::commands::sessions::NewAgentSession {
                        task_id: None,
                        agent_id: agent.id.clone(),
                        session_id,
                        command: None,
                        exit_code: Some(0),
                        status: "ok".into(),
                        duration_ms: Some(duration_ms),
                        cost_usd: None,
                        input_tokens: None,
                        output_tokens: None,
                    },
                );
                s
            }
            Err(e) => {
                log::warn!("AI 分类失败（本轮跳过）: {e}");
                app.state::<crate::health::HealthState>().record_failure(
                    app,
                    crate::health::AI,
                    &e.to_string(),
                );
                let conn = db.0.lock().unwrap();
                let _ = crate::commands::sessions::log_session_conn(
                    &conn,
                    &crate::commands::sessions::NewAgentSession {
                        task_id: None,
                        agent_id: agent.id.clone(),
                        session_id: None,
                        command: None,
                        exit_code: None,
                        status: "error".into(),
                        duration_ms: Some(duration_ms),
                        cost_usd: None,
                        input_tokens: None,
                        output_tokens: None,
                    },
                );
                for m in chunk {
                    let _ = conn.execute(
                        "UPDATE chat_messages SET ai_status='error' WHERE message_id=?1",
                        params![m.message_id],
                    );
                }
                continue;
            }
        };
        app.state::<crate::health::HealthState>()
            .record_success(app, crate::health::AI);
        let n_todo = suggestions.iter().filter(|s| s.is_todo()).count();
        let n_update = suggestions.iter().filter(|s| s.is_update()).count();
        let n_follow = suggestions.iter().filter(|s| s.is_follow_up()).count();
        log::info!(
            "feishu: AI 判定 {}/{} 条：新待办 {n_todo} · 变更建议 {n_update} · 跟进 {n_follow}",
            n_todo + n_update + n_follow,
            batch.len()
        );
        let by_id: HashMap<String, &ai::AiSuggestion> = suggestions
            .iter()
            .map(|s| (s.message_id.clone(), s))
            .collect();
        let conn = db.0.lock().unwrap();
        for m in chunk {
            match by_id.get(&m.message_id) {
                Some(s) if s.is_todo() => {
                    log::info!(
                        "feishu: 新待办「{}」分类 {} 优先级 {} due {:?} 标签 {:?}（消息 {}）",
                        s.title.as_deref().unwrap_or("-"),
                        s.category.as_deref().unwrap_or("-"),
                        s.priority.as_deref().unwrap_or("-"),
                        s.due,
                        s.tags,
                        s.message_id
                    );
                    let n = conn.execute(
                        "UPDATE chat_messages SET suggested_title=?2, suggested_category=?3, suggested_due=?4,
                                suggested_priority=?5, suggested_note=?6, suggested_tags=?7,
                                suggested_reason=?8, suggested_confidence=?9, ai_agent=?10, ai_status='todo'
                         WHERE message_id=?1",
                        params![
                            m.message_id,
                            s.title,
                            s.category,
                            s.due,
                            s.priority,
                            s.note,
                            serde_json::to_string(&s.tags).unwrap_or_else(|_| "[]".into()),
                            s.reason,
                            s.confidence,
                            agent.id,
                        ],
                    )?;
                    if n > 0 {
                        saved += 1;
                    }
                }
                Some(s) if s.is_update() => {
                    // AI 判定是对现有待办的变更（改期/改优先级等）：
                    // 落成「更新建议」卡，用户在收音机确认后才应用
                    log::info!(
                        "feishu: 消息 {} 判定为待办 {} 的变更建议（待确认）",
                        m.message_id,
                        s.update_task_id.unwrap_or(0)
                    );
                    conn.execute(
                        "UPDATE chat_messages SET suggested_title=?2, suggested_category=?3, suggested_due=?4,
                                suggested_priority=?5, suggested_note=?6, suggested_tags=?7, update_task_id=?8,
                                suggested_reason=?9, suggested_confidence=?10, ai_agent=?11, ai_status='update'
                         WHERE message_id=?1",
                        params![
                            m.message_id,
                            s.title,
                            s.category,
                            s.due,
                            s.priority,
                            s.note,
                            serde_json::to_string(&s.tags).unwrap_or_else(|_| "[]".into()),
                            s.update_task_id,
                            s.reason,
                            s.confidence,
                            agent.id,
                        ],
                    )?;
                }
                Some(s) if s.is_follow_up() => {
                    // AI 判定是对现有待办的跟进：直接挂跟进记录，不建新待办
                    let task_id = s.follow_up_task_id.unwrap_or(0);
                    log::info!(
                        "feishu: 消息 {} 判定为待办 {task_id} 的跟进，已记录",
                        m.message_id
                    );
                    crate::commands::radio::attach_followup(
                        &conn,
                        &m.message_id,
                        task_id,
                        &m.content,
                    )?;
                    conn.execute(
                        "UPDATE chat_messages SET suggested_reason=?2, suggested_confidence=?3, ai_agent=?4
                         WHERE message_id=?1",
                        params![m.message_id, s.reason, s.confidence, agent.id],
                    )?;
                }
                _ => {
                    conn.execute(
                        "UPDATE chat_messages SET ai_agent=?2, ai_status='none' WHERE message_id=?1",
                        params![m.message_id, agent.id],
                    )?;
                }
            }
        }
    }

    if !fresh.is_empty() {
        let _ = app.emit(events::CHAT_MESSAGES_CHANGED, fresh.len());
    }

    // 3. 清理：超过 60 天仍未创建待办的消息
    {
        let conn = db.0.lock().unwrap();
        let cutoff = (chrono::Utc::now() - chrono::Duration::days(60)).to_rfc3339();
        let removed = conn.execute(
            "DELETE FROM chat_messages WHERE task_id IS NULL AND created_at < ?1",
            params![cutoff],
        )?;
        if removed > 0 {
            log::info!("feishu: 清理 {removed} 条超期未捕捉消息（>60 天）");
        }
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

/// 后台轮询循环：间隔从设置读取（默认 120 秒），失败指数退避（上限 8 倍）
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
            let sleep_secs = interval * backoff;
            // 入睡前登记下次预计轮询时间（诊断页倒计时展示）
            app.state::<crate::health::HealthState>().set_next_run(
                crate::health::FEISHU,
                chrono::Utc::now().timestamp_millis() + sleep_secs as i64 * 1000,
            );
            tokio::time::sleep(Duration::from_secs(sleep_secs)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::test_conn;
    use std::sync::Mutex;
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn test_db() -> Db {
        Db(Mutex::new(test_conn()))
    }

    // ---- render_content：富文本与占位符渲染 ----

    #[test]
    fn render_text_message_with_mentions() {
        let content = r#"{"text":"@_user_1 看一下这个"}"#;
        let mentions = serde_json::json!([
            {"key": "@_user_1", "name": "张三", "id": {"open_id": "ou_z"}}
        ]);
        assert_eq!(
            render_content("text", content, &mentions, &|_| None).as_deref(),
            Some("@张三 看一下这个")
        );
        // 无 mentions 映射时保留原文
        assert_eq!(
            render_content("text", content, &serde_json::Value::Null, &|_| None).as_deref(),
            Some("@_user_1 看一下这个")
        );
    }

    #[test]
    fn render_post_rich_text_with_at_link_and_media() {
        let content = r#"{"title":"纪要","content":[[
            {"tag":"text","text":"周三前"},
            {"tag":"at","user_id":"ou_z"},
            {"tag":"a","text":"需求文档","href":"https://doc.example/x"},
            {"tag":"img","image_key":"k"}
        ]]}"#;
        let out = render_content("post", content, &serde_json::Value::Null, &|id| {
            (id == "ou_z").then(|| "张三".to_string())
        })
        .unwrap();
        assert!(out.starts_with("纪要\n"), "标题单独成行: {out}");
        assert!(out.contains("周三前"));
        assert!(out.contains("@张三"), "at 段解析成 @人名: {out}");
        assert!(
            out.contains("需求文档(https://doc.example/x)"),
            "链接带 href: {out}"
        );
        assert!(out.contains("[图片]"), "图片给占位符: {out}");
    }

    #[test]
    fn render_post_localized_pack_and_media_placeholders() {
        // 语言包形态：取 zh_cn
        let content = r#"{"title":"外层","zh_cn":{"title":"中文标题","content":[[{"tag":"text","text":"你好"}]]}}"#;
        assert_eq!(
            render_content("post", content, &serde_json::Value::Null, &|_| None).as_deref(),
            Some("中文标题\n你好")
        );
        assert_eq!(
            render_content(
                "image",
                r#"{"image_key":"k"}"#,
                &serde_json::Value::Null,
                &|_| None
            )
            .as_deref(),
            Some("[图片]")
        );
        assert_eq!(
            render_content(
                "file",
                r#"{"file_name":"合同.pdf"}"#,
                &serde_json::Value::Null,
                &|_| None
            )
            .as_deref(),
            Some("[文件:合同.pdf]")
        );
        assert_eq!(
            render_content("audio", "{}", &serde_json::Value::Null, &|_| None).as_deref(),
            Some("[语音]")
        );
    }

    #[test]
    fn render_interactive_card_collects_text() {
        let content = r#"{"header":{"title":{"content":"审批提醒"}},"elements":[{"tag":"div","text":{"text":"张三提交了请假申请"}}]}"#;
        let out =
            render_content("interactive", content, &serde_json::Value::Null, &|_| None).unwrap();
        assert!(out.starts_with("[卡片]"));
        assert!(
            out.contains("审批提醒") && out.contains("请假申请"),
            "{out}"
        );
    }

    #[test]
    fn render_unknown_and_invalid_returns_none() {
        assert_eq!(
            render_content("system", "{}", &serde_json::Value::Null, &|_| None),
            None,
            "系统消息跳过"
        );
        assert_eq!(
            render_content("text", "not-json", &serde_json::Value::Null, &|_| None),
            None,
            "非法 JSON 跳过"
        );
        assert!(is_media_only("image") && is_media_only("merged_forward"));
        assert!(!is_media_only("text") && !is_media_only("interactive"));
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

    // ---- url 编解码（OAuth 回调解析用） ----

    #[test]
    fn url_roundtrip() {
        assert_eq!(
            urlencode("http://127.0.0.1:23981/callback"),
            "http%3A%2F%2F127.0.0.1%3A23981%2Fcallback"
        );
        assert_eq!(urldecode("a%2Fb+c"), "a/b c");
        assert_eq!(urldecode("abc"), "abc");
    }

    // ---- reqwest 分支：wiremock 覆盖 token / OAuth / 会话列表 / 消息拉取 ----

    fn test_cfg(base_url: &str) -> FeishuConfig {
        FeishuConfig {
            app_id: "cli_x".into(),
            app_secret: "sec".into(),
            base_url: base_url.into(),
        }
    }

    /// lark-cli 引擎拉取：假 CLI 脚本按 API 路由返回数据；无机器人语境（单聊全部按 p2p）
    #[cfg(unix)]
    #[test]
    fn pull_via_lark_cli_engine_keeps_context_rules() {
        tauri::async_runtime::block_on(async {
            let dir = std::env::temp_dir().join(format!("pk-lark-pull-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let script = dir.join("lark-cli");
            // 用户信息 / 会话列表 / 消息页：identity=ou_me(我)，两个会话（p2p 李四 + 群）
            std::fs::write(
                &script,
                r#"#!/bin/sh
case "$3" in
  /open-apis/authen/v1/user_info)
    printf '%s' '{"ok":true,"data":{"open_id":"ou_me","name":"我"}}' ;;
  /open-apis/im/v1/chats)
    printf '%s' '{"ok":true,"data":{"items":[{"chat_id":"oc_p2p","name":"李四","chat_mode":"p2p"},{"chat_id":"oc_g","name":"项目群","chat_mode":"group"}],"has_more":false}}' ;;
  /open-apis/im/v1/messages)
    printf '%s' '{"ok":true,"data":{"items":[{"message_id":"om_1","msg_type":"text","create_time":"1789200000000","sender":{"id":"ou_li","sender_type":"user"},"body":{"content":"{\"text\":\"明天交报告\"}"}},{"message_id":"om_2","msg_type":"text","create_time":"1789200001000","sender":{"id":"ou_me","sender_type":"user"},"body":{"content":"{\"text\":\"收到\"}"}}],"has_more":false}}' ;;
  /open-apis/im/v1/chats/oc_g/members)
    printf '%s' '{"ok":true,"data":{"items":[{"member_id":"ou_li","name":"李四"}],"has_more":false}}' ;;
  *)
    echo 'unexpected path' >&2; exit 1 ;;
esac
"#,
            )
            .unwrap();
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            let bin = script.to_string_lossy().into_owned();

            let app = tauri::test::mock_app();
            use tauri::Manager;
            app.manage(Db(std::sync::Mutex::new(crate::db::tests::test_conn())));
            let db = app.state::<Db>();
            let (msgs, cursor) = pull_new_messages(&FetchEngine::LarkCli(bin), &db, None)
                .await
                .unwrap();
            assert!(!msgs.is_empty(), "消息解析成功");
            assert!(cursor > 0);
            let find = |id: &str| msgs.iter().find(|m| m.message_id == id).unwrap();
            let m1 = find("om_1");
            assert_eq!(m1.chat_type, "p2p", "无自建机器人语境，单聊即 p2p");
            assert!(!m1.is_self && m1.needs_ai, "对方发来的送 AI");
            assert_eq!(m1.content, "明天交报告");
            assert_eq!(m1.sender_name, "李四", "单聊发送者名取会话名");
            let m2 = find("om_2");
            assert!(m2.is_self && !m2.needs_ai, "自己发的只作上下文");
            assert_eq!(m2.sender_name, "我");
            let _ = std::fs::remove_dir_all(&dir);
        });
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
    fn oauth_token_request_parses_and_reports_errors() {
        tauri::async_runtime::block_on(async {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/authen/v2/oauth/token"))
                .and(wiremock::matchers::body_string_contains(
                    "authorization_code",
                ))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "access_token": "u-1", "refresh_token": "ur-1", "expires_in": 7200
                })))
                .mount(&server)
                .await;
            let ts = oauth_token_request(
                &test_cfg(&server.uri()),
                serde_json::json!({"grant_type": "authorization_code"}),
                "飞书授权登录",
            )
            .await
            .unwrap();
            assert_eq!(ts.access_token, "u-1");
            assert_eq!(ts.refresh_token, "ur-1");
            assert_eq!(ts.expires_in, 7200);
        });
        tauri::async_runtime::block_on(async {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/authen/v2/oauth/token"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 20029, "msg": "redirect uri not match"
                })))
                .mount(&server)
                .await;
            let err = oauth_token_request(
                &test_cfg(&server.uri()),
                serde_json::json!({"grant_type": "authorization_code"}),
                "飞书授权登录",
            )
            .await
            .unwrap_err();
            assert!(
                err.to_string().contains("20029") && err.to_string().contains("redirect"),
                "OAuth 错误带 code 与 msg: {err}"
            );
        });
    }

    /// 未授权（无 refresh_token）时 user_auth 给出可操作指引
    #[test]
    fn user_auth_requires_authorization() {
        tauri::async_runtime::block_on(async {
            let db = test_db();
            let st = Settings(&db);
            let err = user_auth(&test_cfg("http://unused"), &st)
                .await
                .unwrap_err();
            assert!(err.to_string().contains("授权"), "提示去授权: {err}");
        });
    }

    /// 缓存 token 未过期直接复用（零 HTTP）；过期则走 refresh 并落库轮换后的新值
    #[test]
    fn user_auth_uses_cache_then_refreshes() {
        tauri::async_runtime::block_on(async {
            let db = test_db();
            {
                let conn = db.0.lock().unwrap();
                let later = (chrono::Utc::now().timestamp_millis() + 3_600_000).to_string();
                conn.execute(
                    "INSERT INTO settings (key, value) VALUES ('feishu_user_token','u-old'),('feishu_token_expires_at',?1),
                     ('feishu_user_open_id','ou_me'),('feishu_user_name','我'),('feishu_refresh_token','ur-old')",
                    params![later],
                )
                .unwrap();
            }
            let st = Settings(&db);
            let auth = user_auth(&test_cfg("http://unused"), &st).await.unwrap();
            assert_eq!(auth.token, "u-old");
            assert_eq!(auth.open_id, "ou_me");

            // 过期缓存 → refresh（wiremock 返回轮换后的 token，需已持久化）
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/authen/v2/oauth/token"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "access_token": "u-new", "refresh_token": "ur-new", "expires_in": 7200
                })))
                .mount(&server)
                .await;
            {
                let conn = db.0.lock().unwrap();
                let past = (chrono::Utc::now().timestamp_millis() - 1_000).to_string();
                conn.execute(
                    "UPDATE settings SET value=?1 WHERE key='feishu_token_expires_at'",
                    params![past],
                )
                .unwrap();
            }
            let auth = user_auth(&test_cfg(&server.uri()), &st).await.unwrap();
            assert_eq!(auth.token, "u-new");
            assert_eq!(
                st.get("feishu_refresh_token").as_deref(),
                Some("ur-new"),
                "轮换后的 refresh_token 落库"
            );
        });
    }

    #[test]
    fn list_chats_returns_chat_mode() {
        tauri::async_runtime::block_on(async {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/im/v1/chats"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "data": { "items": [
                        { "chat_id": "oc_1", "name": "项目群", "chat_mode": "group" },
                        { "chat_id": "oc_p", "name": "李四", "chat_mode": "p2p" },
                        { "chat_id": "", "name": "脏数据跳过" }
                    ]}
                })))
                .mount(&server)
                .await;
            let chats = list_chats(&test_cfg(&server.uri()), "t").await.unwrap();
            assert_eq!(chats.len(), 2);
            assert_eq!(chats[0].chat_mode, "group");
            assert_eq!(chats[1].chat_mode, "p2p");
        });
    }

    /// 回归：飞书业务错误响应（code != 0，无 data 字段）不能只报 "error decoding response body"，
    /// 必须带出飞书的 code/msg（如未开通 im:chat 权限），否则用户无从排查
    #[test]
    fn list_chats_api_error_reports_feishu_msg() {
        tauri::async_runtime::block_on(async {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/im/v1/chats"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 99991672, "msg": "access control: you have no permission"
                })))
                .mount(&server)
                .await;
            let err = list_chats(&test_cfg(&server.uri()), "t").await.unwrap_err();
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
            Mock::given(method("GET"))
                .and(path("/im/v1/chats"))
                .respond_with(
                    ResponseTemplate::new(502)
                        .set_body_string("<html><body>Bad Gateway</body></html>"),
                )
                .mount(&server)
                .await;
            let err = list_chats(&test_cfg(&server.uri()), "t").await.unwrap_err();
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

    /// 用户身份拉取全链路：三类会话的处理语境 + 富文本/占位符 + 名字缓存兜底
    #[test]
    fn pull_new_messages_applies_chat_type_rules() {
        tauri::async_runtime::block_on(async {
            let db = test_db();
            let t0 = 1_789_200_000_000i64; // 固定窗口起点，断言 sent_at 换算
            {
                let conn = db.0.lock().unwrap();
                let later = (chrono::Utc::now().timestamp_millis() + 3_600_000).to_string();
                conn.execute(
                    "INSERT INTO settings (key, value) VALUES ('feishu_user_token','u-tok'),('feishu_token_expires_at',?1),
                     ('feishu_user_open_id','ou_me'),('feishu_user_name','我')",
                    params![later],
                )
                .unwrap();
            }
            let server = MockServer::start().await;
            // 应用凭证（bot_context 用）
            Mock::given(method("POST"))
                .and(path("/auth/v3/tenant_access_token/internal"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "tenant_access_token": "t-bot"
                })))
                .mount(&server)
                .await;
            Mock::given(method("GET"))
                .and(path("/bot/v3/info"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "open_id": "ou_bot", "open_name": "皮卡丘助手"
                })))
                .mount(&server)
                .await;
            // 机器人会话列表（tenant token）：只有 oc_bot 单聊
            Mock::given(method("GET"))
                .and(path("/im/v1/chats"))
                .and(header("authorization", "Bearer t-bot"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "data": { "items": [ { "chat_id": "oc_bot", "name": "皮卡丘助手", "chat_mode": "p2p" } ] }
                })))
                .mount(&server)
                .await;
            // 用户会话列表（user token）：机器人单聊 + 好友单聊 + 项目群
            Mock::given(method("GET"))
                .and(path("/im/v1/chats"))
                .and(header("authorization", "Bearer u-tok"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "data": { "items": [
                        { "chat_id": "oc_bot", "name": "皮卡丘助手", "chat_mode": "p2p" },
                        { "chat_id": "oc_friend", "name": "李四", "chat_mode": "p2p" },
                        { "chat_id": "oc_group", "name": "项目群", "chat_mode": "group" }
                    ]}
                })))
                .mount(&server)
                .await;
            let msg = |id: &str, sender: (&str, &str), ctype: &str, body: &str, t: i64| {
                serde_json::json!({
                    "message_id": id, "msg_type": ctype, "create_time": t.to_string(),
                    "sender": { "id": sender.0, "sender_type": sender.1 },
                    "body": { "content": body }
                })
            };
            let text = |s: &str| serde_json::json!({ "text": s }).to_string();
            // 机器人单聊：我→bot（送AI）、bot→我（跳过）
            Mock::given(method("GET"))
                .and(path("/im/v1/messages"))
                .and(query_param("container_id", "oc_bot"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "data": { "items": [
                        msg("om_b1", ("ou_me", "user"), "text",
                            &text("提醒我明早9点站会"), t0),
                        msg("om_b2", ("ou_bot", "app"), "text",
                            &text("收到啦，我会提醒你"), t0 + 1000)
                    ], "has_more": false }
                })))
                .mount(&server)
                .await;
            // 好友单聊：对方发的（送AI）、我发的（跳过）
            Mock::given(method("GET"))
                .and(path("/im/v1/messages"))
                .and(query_param("container_id", "oc_friend"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "data": { "items": [
                        msg("om_f1", ("ou_li", "user"), "text",
                            &text("把合同发我一下"), t0),
                        msg("om_f2", ("ou_me", "user"), "text",
                            &text("好的马上"), t0 + 1000)
                    ], "has_more": false }
                })))
                .mount(&server)
                .await;
            // 群聊：张三带 @我 的文字（送AI）、我的消息（跳过）、bot 的群消息（跳过）、图片（占位但不送AI）
            Mock::given(method("GET"))
                .and(path("/im/v1/messages"))
                .and(query_param("container_id", "oc_group"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "data": { "items": [
                        { "message_id": "om_g1", "msg_type": "text", "create_time": t0.to_string(),
                          "sender": { "id": "ou_z", "sender_type": "user" },
                          "body": { "content": text("@_user_1 周会改到周四10点") },
                          "mentions": [ { "key": "@_user_1", "name": "我", "id": { "open_id": "ou_me" } } ] },
                        msg("om_g2", ("ou_me", "user"), "text",
                            &text("收到"), t0 + 1000),
                        msg("om_g3", ("ou_bot", "app"), "text",
                            &text("每日站会提醒"), t0 + 2000),
                        msg("om_g4", ("ou_z", "user"), "image",
                            r#"{"image_key":"k"}"#, t0 + 3000)
                    ], "has_more": false }
                })))
                .mount(&server)
                .await;
            // 群成员名单：只含张三（ou_z），用于名字解析与未命中退化
            Mock::given(method("GET"))
                .and(path("/im/v1/chats/oc_group/members"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "data": { "items": [ { "member_id": "ou_z", "name": "张三" } ], "has_more": false }
                })))
                .mount(&server)
                .await;

            let (msgs, _cursor) =
                pull_new_messages(&FetchEngine::Builtin(test_cfg(&server.uri())), &db, None)
                    .await
                    .unwrap();
            let find = |id: &str| msgs.iter().find(|m| m.message_id == id).unwrap();
            let b1 = find("om_b1");
            assert_eq!(b1.chat_type, "bot");
            assert!(b1.is_self && b1.needs_ai, "我发给机器人的要送 AI");
            assert_eq!(b1.sender_name, "我");
            let b2 = find("om_b2");
            assert!(!b2.needs_ai, "机器人的回复只作上下文");
            assert_eq!(b2.sender_name, "皮卡丘助手");
            let f1 = find("om_f1");
            assert_eq!(f1.chat_type, "p2p");
            assert!(f1.needs_ai && !f1.is_self, "对方单聊消息送 AI");
            assert_eq!(f1.sender_name, "李四", "单聊会话名即对方");
            assert!(!find("om_f2").needs_ai, "我自己发的只作上下文");
            let g1 = find("om_g1");
            assert_eq!(g1.chat_type, "group");
            assert!(g1.needs_ai);
            assert_eq!(g1.sender_name, "张三", "群成员缓存解析名字");
            assert!(
                g1.content.contains("@我"),
                "mentions 还原成 @我: {}",
                g1.content
            );
            assert!(!find("om_g2").needs_ai, "群里我自己的消息跳过");
            assert!(!find("om_g3").needs_ai, "本应用机器人的群消息跳过");
            let g4 = find("om_g4");
            assert!(!g4.needs_ai, "图片消息只作上下文");
            assert_eq!(g4.content, "[图片]");
            assert_eq!(g1.sent_at, t0, "create_time 毫秒时间戳入库");
            // 名字缓存已落库
            let cached: String = {
                let conn = db.0.lock().unwrap();
                conn.query_row(
                    "SELECT name FROM feishu_users WHERE open_id='ou_z'",
                    [],
                    |r| r.get(0),
                )
                .unwrap()
            };
            assert_eq!(cached, "张三");
        });
    }

    /// 机器人信息缺失时靠消息内 sender_type=app + bot open_id 兜底识别机器人单聊
    #[test]
    fn pull_detects_bot_chat_from_message_sender() {
        tauri::async_runtime::block_on(async {
            let db = test_db();
            {
                let conn = db.0.lock().unwrap();
                let later = (chrono::Utc::now().timestamp_millis() + 3_600_000).to_string();
                conn.execute(
                    "INSERT INTO settings (key, value) VALUES ('feishu_user_token','u-tok'),('feishu_token_expires_at',?1),
                     ('feishu_user_open_id','ou_me'),('feishu_user_name','我')",
                    params![later],
                )
                .unwrap();
            }
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "tenant_access_token": "t-bot"
                })))
                .mount(&server)
                .await;
            // bot info 与机器人会话列表都拿不到（识别降级）
            Mock::given(method("GET"))
                .and(path("/bot/v3/info"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "open_id": "ou_bot", "open_name": "助手"
                })))
                .mount(&server)
                .await;
            Mock::given(method("GET"))
                .and(path("/im/v1/chats"))
                .and(header("authorization", "Bearer t-bot"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(
                        serde_json::json!({ "code": 99991672, "msg": "no permission" }),
                    ),
                )
                .mount(&server)
                .await;
            Mock::given(method("GET"))
                .and(path("/im/v1/chats"))
                .and(header("authorization", "Bearer u-tok"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "data": { "items": [ { "chat_id": "oc_bot", "name": "助手", "chat_mode": "p2p" } ] }
                })))
                .mount(&server)
                .await;
            Mock::given(method("GET"))
                .and(path("/im/v1/messages"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "data": { "items": [
                        { "message_id": "om_1", "msg_type": "text", "create_time": "1789200000001",
                          "sender": { "id": "ou_bot", "sender_type": "app" },
                          "body": { "content": "{\"text\":\"你好\"}" } },
                        { "message_id": "om_2", "msg_type": "text", "create_time": "1789200000002",
                          "sender": { "id": "ou_me", "sender_type": "user" },
                          "body": { "content": "{\"text\":\"记一下明早买咖啡\"}" } }
                    ], "has_more": false }
                })))
                .mount(&server)
                .await;
            let (msgs, _) =
                pull_new_messages(&FetchEngine::Builtin(test_cfg(&server.uri())), &db, None)
                    .await
                    .unwrap();
            let by_id = |id: &str| msgs.iter().find(|m| m.message_id == id).unwrap();
            // 机器人的消息先出现 → 会话被识别为 bot 单聊，我的消息随后送 AI
            assert!(!by_id("om_1").needs_ai);
            assert_eq!(by_id("om_1").chat_type, "bot");
            assert!(by_id("om_2").needs_ai, "识别后我发给机器人的送 AI");
            assert_eq!(by_id("om_2").chat_type, "bot");
        });
    }

    #[test]
    fn short_id_truncates() {
        assert_eq!(short_id("ou_abcdef1234567890"), "ou_abcdef12");
    }
}
