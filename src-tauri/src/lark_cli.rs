//! 官方 lark-cli（https://github.com/larksuite/cli，MIT）子进程封装：
//! 用户身份经 lark-cli 自己的 OAuth（凭证由其保管，不进本应用库），
//! 消息拉取走 `lark-cli api GET ... --format json`。
//! 语境过滤（谁的消息送 AI）与同会话上下文组装仍在 feishu.rs，与引擎无关。
use crate::error::{AppError, AppResult};
use serde_json::Value;
use std::time::Duration;

/// lark-cli 可执行文件：LARK_CLI_BIN 可覆盖（测试注入脚本用）
pub fn lark_bin() -> String {
    std::env::var("LARK_CLI_BIN").unwrap_or_else(|_| "lark-cli".into())
}

/// 跑一条 lark-cli 命令，要求退出码 0，返回 stdout 文本
async fn run(bin: &str, args: &[&str], timeout: Duration) -> AppResult<String> {
    let out = tokio::time::timeout(
        timeout,
        tokio::process::Command::new(bin)
            .args(args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| {
        AppError::External(format!(
            "lark-cli「{args:?}」执行超时（{} 秒）",
            timeout.as_secs()
        ))
    })?
    .map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::Invalid(
                "找不到 lark-cli：请先 `npm install -g @larksuite/cli` 并重新登录终端".into(),
            )
        } else {
            AppError::External(format!("启动 lark-cli 失败: {e}"))
        }
    })?;
    if out.status.success() {
        String::from_utf8(out.stdout)
            .map_err(|e| AppError::External(format!("lark-cli 输出不是 UTF-8: {e}")))
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr);
        // lark-cli 错误走 stderr（非零退出码），截断避免刷屏
        let snippet: String = stderr.trim().chars().take(300).collect();
        Err(AppError::External(format!(
            "lark-cli「{args:?}」失败（退出码 {}）: {snippet}",
            out.status.code().unwrap_or(-1)
        )))
    }
}

/// lark-cli 的 --format json 信封：`{"ok": true, "data": {...}}`（成功无 code 字段）。
/// ok=false 或缺少 ok 时按错误处理；data 缺失时返回整个信封（部分命令直接给结果）。
fn unwrap_envelope(stdout: &str, what: &str) -> AppResult<Value> {
    let trimmed = stdout.trim();
    let parsed: Option<Value> = serde_json::from_str(trimmed).ok().or_else(|| {
        // 前后有日志文字时截取首个 { 到最后一个 }
        match (trimmed.find('{'), trimmed.rfind('}')) {
            (Some(s), Some(e)) if s < e => serde_json::from_str(&trimmed[s..=e]).ok(),
            _ => None,
        }
    });
    let v: Value = parsed.ok_or_else(|| AppError::External(format!("{what}输出不是合法 JSON")))?;
    if v.get("ok").and_then(|b| b.as_bool()) == Some(false) {
        let msg = v["error"]
            .as_str()
            .or_else(|| v["message"].as_str())
            .unwrap_or("未知错误");
        return Err(AppError::External(format!("{what}失败: {msg}")));
    }
    // ok=true 或无 ok 字段（宽容处理）：data 存在则取 data，否则整体返回
    match v.get("data") {
        Some(d) if d.is_object() || d.is_array() => Ok(d.clone()),
        _ => Ok(v),
    }
}

/// GET 透传调用：`lark-cli api GET <path> --params '<json>' --format json`
pub async fn api_get(bin: &str, path: &str, params: Value) -> AppResult<Value> {
    let args: Vec<String> = vec![
        "api".into(),
        "GET".into(),
        path.into(),
        "--params".into(),
        params.to_string(),
        "--format".into(),
        "json".into(),
    ];
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = run(bin, &arg_refs, Duration::from_secs(30)).await?;
    unwrap_envelope(&out, &format!("lark-cli {path}"))
}

/// POST 透传调用：`lark-cli api POST <path> --data '<json>' --format json`
pub async fn api_post(bin: &str, path: &str, body: Value) -> AppResult<Value> {
    let args: Vec<String> = vec![
        "api".into(),
        "POST".into(),
        path.into(),
        "--data".into(),
        body.to_string(),
        "--format".into(),
        "json".into(),
    ];
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = run(bin, &arg_refs, Duration::from_secs(30)).await?;
    unwrap_envelope(&out, &format!("lark-cli {path}"))
}

/// 批量查询会话的个人设置（免打扰等，每批最多 10 个会话）：
/// POST /open-apis/im/v1/chat_user_setting/batch_query
pub async fn chat_user_settings(bin: &str, chat_ids: &[String]) -> AppResult<Value> {
    api_post(
        bin,
        "/open-apis/im/v1/chat_user_setting/batch_query",
        serde_json::json!({ "chat_ids": chat_ids }),
    )
    .await
}

/// 登录态：`lark-cli auth status --json`（auth 域不支持 --format，输出开关是 --json）
#[derive(Debug)]
pub struct CliAuthStatus {
    pub logged_in: bool,
    pub user_name: String,
}

pub async fn auth_status(bin: &str) -> AppResult<CliAuthStatus> {
    let out = run(bin, &["auth", "status", "--json"], Duration::from_secs(15)).await?;
    // 输出不稳定时按未登录处理，让上层给登录指引
    let v: Value = serde_json::from_str(out.trim()).unwrap_or(Value::Null);
    // 宽容解析：不同版本字段名可能是 logged_in / authenticated / ok
    let logged_in = ["logged_in", "authenticated", "ok"]
        .iter()
        .any(|k| v[k].as_bool() == Some(true));
    let user_name = v["name"]
        .as_str()
        .or_else(|| v["user"]["name"].as_str())
        .or_else(|| v["identity"]["name"].as_str())
        .unwrap_or("飞书用户")
        .to_string();
    Ok(CliAuthStatus {
        logged_in,
        user_name,
    })
}

/// lark-cli 是否已初始化配置（绑定应用）：`lark-cli config show` 退出码 0 即已配置。
/// 未配置时 auth login 会直接报 not_configured，需先走 `config init --new`。
pub async fn config_ready(bin: &str) -> bool {
    run(bin, &["config", "show"], Duration::from_secs(10))
        .await
        .is_ok()
}

/// 当前用户身份（open_id + 姓名）：GET /open-apis/authen/v1/user_info
pub async fn user_identity(bin: &str) -> AppResult<(String, String)> {
    let d = api_get(bin, "/open-apis/authen/v1/user_info", serde_json::json!({})).await?;
    let open_id = d["open_id"]
        .as_str()
        .or_else(|| d["data"]["open_id"].as_str())
        .unwrap_or_default()
        .to_string();
    if open_id.is_empty() {
        return Err(AppError::External(
            "lark-cli 未登录或未授权用户信息（先 lark-cli auth login --domain im）".into(),
        ));
    }
    let name = d["name"]
        .as_str()
        .filter(|s| !s.is_empty())
        .or_else(|| d["en_name"].as_str())
        .unwrap_or("飞书用户")
        .to_string();
    Ok((open_id, name))
}

/// 会话列表（用户身份）：GET /open-apis/im/v1/chats（--page-all 语义由上层翻页保证）。
/// types=p2p,group 才会带出单聊（p2p 项含 p2p_target_type/p2p_target_id）。
pub async fn list_chats(bin: &str, page_size: i64, page_token: Option<&str>) -> AppResult<Value> {
    let mut params = serde_json::json!({
        "page_size": page_size,
        "user_id_type": "open_id",
        "types": "p2p,group",
    });
    if let Some(t) = page_token {
        params["page_token"] = Value::String(t.to_string());
    }
    api_get(bin, "/open-apis/im/v1/chats", params).await
}

/// 会话消息页：GET /open-apis/im/v1/messages（container_id=chat，start/end 为秒）
pub async fn list_messages(
    bin: &str,
    chat_id: &str,
    start_s: i64,
    end_s: i64,
    page_token: Option<&str>,
) -> AppResult<Value> {
    let mut params = serde_json::json!({
        "container_id_type": "chat",
        "container_id": chat_id,
        "start_time": start_s.to_string(),
        "end_time": end_s.to_string(),
        "page_size": 50,
    });
    if let Some(t) = page_token {
        params["page_token"] = Value::String(t.to_string());
    }
    api_get(bin, "/open-apis/im/v1/messages", params).await
}

/// 群成员页：GET /open-apis/im/v1/chats/{chat_id}/members
pub async fn list_members(bin: &str, chat_id: &str, page_token: Option<&str>) -> AppResult<Value> {
    let mut params = serde_json::json!({ "member_id_type": "open_id", "page_size": 100 });
    if let Some(t) = page_token {
        params["page_token"] = Value::String(t.to_string());
    }
    api_get(
        bin,
        &format!("/open-apis/im/v1/chats/{chat_id}/members"),
        params,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 写一个假 lark-cli 脚本：按 argv 前缀返回给定 payload（unix）
    #[cfg(unix)]
    fn fake_cli(name: &str, match_args: &[&str], payload: &str, extra_shell: &str) -> String {
        let dir = std::env::temp_dir().join(format!("pk-lark-{}-{}", name, std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("lark-cli");
        let matched = match_args
            .iter()
            .map(|a| format!("\"{a}\""))
            .collect::<Vec<_>>()
            .join(" ");
        std::fs::write(
            &script,
            format!(
                "#!/bin/sh\n{extra_shell}\nif [ \"$1\" = \"api\" ] && [ \"$3\" = {matched} ]; then printf '%s' '{payload}'; else echo '{{\"error\":\"unexpected args\"}}' >&2; exit 1; fi\n"
            ),
        )
        .unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        script.to_string_lossy().into_owned()
    }

    #[cfg(unix)]
    #[test]
    fn api_get_unwraps_envelope_data() {
        tauri::async_runtime::block_on(async {
            let bin = fake_cli(
                "ok",
                &["/open-apis/im/v1/chats"],
                r#"{"ok":true,"identity":"user","data":{"items":[],"has_more":false}}"#,
                "",
            );
            let d = api_get(&bin, "/open-apis/im/v1/chats", serde_json::json!({}))
                .await
                .unwrap();
            assert_eq!(d["items"].as_array().map(Vec::len), Some(0));
        });
    }

    #[cfg(unix)]
    #[test]
    fn api_get_maps_error_envelope() {
        tauri::async_runtime::block_on(async {
            let bin = fake_cli(
                "err",
                &["/open-apis/im/v1/messages"],
                "{}",
                r#"echo '{"ok":false,"error":"invalid chat id"}'; exit 0"#,
            );
            // ok=false 但退出码 0：信封按错误处理
            let err = api_get(&bin, "/open-apis/im/v1/messages", serde_json::json!({}))
                .await
                .unwrap_err();
            assert!(err.to_string().contains("invalid chat id"), "{err}");
        });
    }

    #[cfg(unix)]
    #[test]
    fn nonzero_exit_carries_stderr() {
        tauri::async_runtime::block_on(async {
            let dir = std::env::temp_dir().join(format!("pk-lark-boom-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let script = dir.join("lark-cli");
            std::fs::write(&script, "#!/bin/sh\necho 'not logged in' >&2\nexit 3\n").unwrap();
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            let bin = script.to_string_lossy().into_owned();
            let err = auth_status(&bin).await.unwrap_err();
            assert!(err.to_string().contains("not logged in"), "{err}");
        });
    }

    #[test]
    fn missing_binary_gives_install_hint() {
        tauri::async_runtime::block_on(async {
            let err = auth_status("definitely-not-lark-cli-xyz")
                .await
                .unwrap_err();
            assert!(matches!(err, AppError::Invalid(_)), "{err}");
            assert!(err.to_string().contains("npm install"));
        });
    }

    /// 写一个假 lark-cli 脚本，按给定 shell 片段响应（unix）
    #[cfg(unix)]
    fn fake_cli_script(name: &str, body: &str) -> String {
        let dir = std::env::temp_dir().join(format!("pk-lark-{}-{}", name, std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("lark-cli");
        std::fs::write(&script, format!("#!/bin/sh\n{body}\n")).unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        script.to_string_lossy().into_owned()
    }

    /// auth status 只认 --json（1.x 无 --format），且能解析登录态
    #[cfg(unix)]
    #[test]
    fn auth_status_uses_json_flag() {
        tauri::async_runtime::block_on(async {
            let bin = fake_cli_script(
                "st",
                r#"if [ "$1" = "auth" ] && [ "$2" = "status" ] && [ "$3" = "--json" ]; then printf '%s' '{"ok":true,"logged_in":true,"name":"测试用户"}'; else echo "unexpected args: $*" >&2; exit 1; fi"#,
            );
            let s = auth_status(&bin).await.unwrap();
            assert!(s.logged_in);
            assert_eq!(s.user_name, "测试用户");
        });
    }

    /// config_ready 按 `config show` 退出码判定是否已初始化
    #[cfg(unix)]
    #[test]
    fn config_ready_maps_exit_code() {
        tauri::async_runtime::block_on(async {
            let ok = fake_cli_script("cfg-ok", r#"echo '{"ok":true}'; exit 0"#);
            assert!(config_ready(&ok).await);
            let missing = fake_cli_script(
                "cfg-missing",
                r#"echo '{"ok":false,"error":{"subtype":"not_configured"}}' >&2; exit 3"#,
            );
            assert!(!config_ready(&missing).await);
        });
    }

    /// 免打扰批量查询走 POST 透传并解信封
    #[cfg(unix)]
    #[test]
    fn chat_user_settings_posts_batch_query() {
        tauri::async_runtime::block_on(async {
            let bin = fake_cli(
                "mute",
                &["/open-apis/im/v1/chat_user_setting/batch_query"],
                r#"{"ok":true,"data":{"items":[{"chat_id":"oc_a","is_muted":true}]}}"#,
                "",
            );
            let d = chat_user_settings(&bin, &["oc_a".to_string()])
                .await
                .unwrap();
            assert_eq!(d["items"][0]["chat_id"].as_str(), Some("oc_a"));
            assert_eq!(d["items"][0]["is_muted"].as_bool(), Some(true));
        });
    }

    /// 信封宽容解析：无 data 字段时整体返回、有 ok=false 时报错
    #[test]
    fn envelope_parsing_rules() {
        let d = unwrap_envelope(r#"{"ok":true,"items":[1]}"#, "t").unwrap();
        assert_eq!(
            d["items"].as_array().map(Vec::len),
            Some(1),
            "无 data 返回整体"
        );
        let err = unwrap_envelope(r#"{"ok":false,"error":"x"}"#, "t").unwrap_err();
        assert!(err.to_string().contains('x'));
        // 前后带日志文字
        let d = unwrap_envelope("log line\n{\"ok\":true,\"data\":{\"a\":1}}\n", "t").unwrap();
        assert_eq!(d["a"], 1);
    }
}
