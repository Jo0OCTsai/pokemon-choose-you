use crate::ai::{self, AgentConfig};
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::events;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::UpdaterExt;

// ---- 集成：AI Agent CLI / 飞书 / Todoist ----

/// 设置读取：秘钥类键经 secrets 模块（OS 钥匙串优先，settings 表回落），其余直读表
fn settings_getter(conn: &rusqlite::Connection) -> impl Fn(&str) -> Option<String> + '_ {
    move |k| crate::secrets::secret_get(conn, k)
}

/// 测试一个 agent（不指定 id 时用收音机分类所用的主 agent）
#[tauri::command]
pub async fn test_ai_config(db: State<'_, Db>, agent_id: Option<String>) -> AppResult<String> {
    let agent = {
        let conn = db.0.lock().unwrap();
        let get = settings_getter(&conn);
        match agent_id.as_deref() {
            Some(id) if !id.is_empty() => ai::agent_by_id(&get, id),
            _ => ai::primary_agent(&get),
        }
        .ok_or_else(|| AppError::Invalid("请先在设置中配置 AI Agent CLI".into()))?
    };
    ai::test(&agent).await
}

/// 在系统终端里打开 agent 的历史记录界面（claude --resume / opencode 等）。
/// 历史/会话由 agent 工具自己保存，这里只负责唤起。
/// session_id 存在时追加为第一个参数（如 claude --resume <session_id>）直接回放该会话转录。
#[tauri::command]
pub async fn open_agent_history(
    db: State<'_, Db>,
    agent_id: String,
    session_id: Option<String>,
) -> AppResult<String> {
    let agent = {
        let conn = db.0.lock().unwrap();
        let get = settings_getter(&conn);
        ai::agent_by_id(&get, &agent_id)
            .ok_or_else(|| AppError::Invalid(format!("Agent {agent_id} 不存在，请先保存配置")))?
    };
    open_agent_in_terminal(&agent, session_id.as_deref()).await
}

async fn open_agent_in_terminal(
    agent: &AgentConfig,
    resume_session: Option<&str>,
) -> AppResult<String> {
    let mut args: Vec<String> = agent
        .history_args
        .split_whitespace()
        .map(String::from)
        .collect();
    if let (Some(sess), Some(first)) = (resume_session, args.first()) {
        // claude 语法：--resume <session_id>；其余 agent 同样把 id 追加到首个历史参数后
        if first == "--resume" || first == "resume" {
            args.push(sess.to_string());
        }
    }
    spawn_in_terminal(&agent.command, &args)
        .await
        .map(|term| format!("已在 {term} 中启动「{}」", agent.name))
}

/// 在一个新的终端窗口里运行命令（各系统终端差异大，尽力而为）。
/// 成功返回实际使用的终端程序名。
async fn spawn_in_terminal(program: &str, args: &[String]) -> AppResult<&'static str> {
    #[cfg(target_os = "macos")]
    {
        // Terminal.app 不接受命令参数，用 osascript 让它执行一条 shell 命令
        let mut line = shell_quote(program).to_string();
        for a in args {
            line.push(' ');
            line.push_str(&shell_quote(a));
        }
        let script = format!("tell application \"Terminal\" to do script \"{line}\"");
        if tokio::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .spawn()
            .is_ok()
        {
            return Ok("Terminal");
        }
        return Err(AppError::External("无法打开 macOS 终端".into()));
    }

    #[cfg(target_os = "windows")]
    {
        let mut line = shell_quote(program).to_string();
        for a in args {
            line.push(' ');
            line.push_str(&shell_quote(a));
        }
        let title = "pokemon-knock agent";
        tokio::process::Command::new("cmd")
            .args(["/C", "start", title, "cmd", "/K", &line])
            .spawn()
            .map_err(|e| AppError::External(format!("打开终端失败: {e}")))?;
        return Ok("cmd");
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // 常见 Linux 终端 ×（命令参数风格），逐个尝试
        let candidates: &[(&str, &str)] = &[
            ("gnome-terminal", "--"),
            ("konsole", "-e"),
            ("xfce4-terminal", "-x"),
            ("kitty", ""),
            ("alacritty", "-e"),
            ("wezterm", "start --"),
            ("foot", ""),
            ("x-terminal-emulator", "-e"),
        ];
        for (term, flag) in candidates {
            let mut cmd = tokio::process::Command::new(term);
            if !flag.is_empty() {
                cmd.args(flag.split_whitespace());
            }
            cmd.arg(program).args(args);
            match cmd.spawn() {
                Ok(_) => return Ok(term),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => {
                    return Err(AppError::External(format!("启动 {term} 失败: {e}")));
                }
            }
        }
        Err(AppError::External(
            "未找到可用的终端模拟器（gnome-terminal / konsole / kitty …），请手动打开终端运行"
                .into(),
        ))
    }

    #[cfg(not(any(unix, windows)))]
    {
        let _ = (program, args);
        Err(AppError::External("当前平台不支持打开终端".into()))
    }
}

/// POSIX 风格的 shell 引用：含特殊字符时包单引号，内部单引号转义。
/// 仅 macOS（osascript）/ Windows（cmd /K）分支使用。
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
fn shell_quote(s: &str) -> String {
    if s.is_empty() {
        return "''".into();
    }
    let safe = s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "/_.-+=@:,%".contains(c));
    if safe {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', r"'\''"))
    }
}

#[tauri::command]
pub async fn test_feishu_config(db: State<'_, Db>) -> AppResult<String> {
    let engine = {
        let conn = db.0.lock().unwrap();
        let get = settings_getter(&conn);
        crate::feishu::fetch_engine_from(&get).ok_or_else(|| {
            AppError::Invalid("请先填写飞书 App ID / App Secret，或切换到 lark-cli 引擎".into())
        })?
    };
    crate::feishu::poll_once_test(&engine, &db).await
}

#[tauri::command]
pub async fn trigger_feishu_poll(app: AppHandle) -> AppResult<usize> {
    crate::feishu::poll_once(&app).await
}

/// 飞书用户授权状态（设置页展示）：是否已授权 + 授权用户名
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuOauthStatus {
    pub authorized: bool,
    pub user_name: String,
}

#[tauri::command]
pub async fn feishu_oauth_status(db: State<'_, Db>) -> AppResult<FeishuOauthStatus> {
    // lark-cli 引擎：授权状态由 lark-cli 自管（凭证不进本库），转询其登录态
    let engine = {
        let conn = db.0.lock().unwrap();
        let get = settings_getter(&conn);
        crate::feishu::fetch_engine_from(&get)
    };
    if let Some(crate::feishu::FetchEngine::LarkCli(bin)) = engine {
        let status =
            crate::lark_cli::auth_status(&bin)
                .await
                .unwrap_or(crate::lark_cli::CliAuthStatus {
                    logged_in: false,
                    user_name: String::new(),
                });
        return Ok(FeishuOauthStatus {
            authorized: status.logged_in,
            user_name: status.user_name,
        });
    }
    let (authorized, user_name) = crate::feishu::oauth_status(&db);
    Ok(FeishuOauthStatus {
        authorized,
        user_name,
    })
}

/// 发起用户授权：内置引擎走浏览器 OAuth；lark-cli 引擎在终端里跑 `lark-cli auth login`
#[tauri::command]
pub async fn feishu_oauth_login(app: AppHandle) -> AppResult<String> {
    let engine = {
        use tauri::Manager as _;
        let db = app.state::<crate::db::Db>();
        let conn = db.0.lock().unwrap();
        let get = settings_getter(&conn);
        crate::feishu::fetch_engine_from(&get)
    };
    if let Some(crate::feishu::FetchEngine::LarkCli(_)) = engine {
        return spawn_in_terminal(
            &crate::lark_cli::lark_bin(),
            &[
                "auth".to_string(),
                "login".to_string(),
                "--domain".to_string(),
                "im".to_string(),
                "--recommend".to_string(),
            ],
        )
        .await
        .map(|term| format!("已在 {term} 中启动 lark-cli 登录，完成后回到这里点「测试」"));
    }
    crate::feishu::oauth_login(&app).await
}

#[tauri::command]
pub async fn sync_todoist(app: AppHandle) -> AppResult<String> {
    crate::todoist::sync(&app).await
}

// ---- 自动更新（tauri-plugin-updater，endpoint/公钥在 tauri.conf.json） ----

#[tauri::command]
pub async fn check_update(app: AppHandle) -> AppResult<String> {
    let updater = app
        .updater()
        .map_err(|e| AppError::External(format!("更新器初始化失败: {e}")))?;
    match updater.check().await {
        Ok(Some(update)) => Ok(update.version),
        Ok(None) => Ok(String::new()),
        Err(e) => Err(AppError::Network(format!("检查更新失败: {e}"))),
    }
}

/// 下载并安装更新，成功后重启应用（安装包由发布流水线 minisign 签名，公钥内置于配置）
#[tauri::command]
pub async fn install_update(app: AppHandle) -> AppResult<()> {
    let updater = app
        .updater()
        .map_err(|e| AppError::External(format!("更新器初始化失败: {e}")))?;
    let update = updater
        .check()
        .await
        .map_err(|e| AppError::Network(format!("检查更新失败: {e}")))?
        .ok_or_else(|| AppError::NotFound("当前已是最新版本".into()))?;
    let progress_app = app.clone();
    update
        .download_and_install(
            move |downloaded, total| {
                // 下载进度推给设置页展示（downloaded/total 为字节）
                let _ = progress_app.emit(
                    crate::events::UPDATE_PROGRESS,
                    serde_json::json!({ "downloaded": downloaded, "total": total }),
                );
            },
            || {},
        )
        .await
        .map_err(|e| AppError::External(format!("下载安装失败: {e}")))?;
    app.restart();
}

/// 启动/托盘触发更新检查：发现新版本广播给前端（未配置 updater 时静默跳过，不打扰）
pub fn spawn_update_check<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        match app.updater() {
            Ok(updater) => match updater.check().await {
                Ok(Some(update)) => {
                    log::info!(
                        "发现新版本 v{}（安装入口：托盘菜单 / 设置页）",
                        update.version
                    );
                    let _ = app.emit(events::UPDATE_AVAILABLE, update.version.clone());
                }
                Ok(None) => {}
                Err(e) => log::debug!("更新检查跳过（未配置或网络不可用）: {e}"),
            },
            Err(e) => log::debug!("更新器不可用（未配置 endpoint）: {e}"),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::windows::PendingMainReopen;
    use crate::db::tests::test_conn;
    use crate::db::Db;
    use std::sync::Mutex;
    use tauri::Manager;

    fn setup() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(Db(Mutex::new(test_conn())));
        app.manage(PendingMainReopen(std::sync::atomic::AtomicBool::new(false)));
        app
    }

    #[test]
    fn test_ai_config_without_agents_is_invalid_input() {
        let app = setup();
        let db = app.state::<Db>();
        let err = tauri::async_runtime::block_on(test_ai_config(db, None)).unwrap_err();
        assert!(
            matches!(err, AppError::Invalid(_)),
            "缺配置应归为输入错误: {err}"
        );
        assert!(err.to_string().contains("Agent"), "提示配置 Agent: {err}");
    }

    #[test]
    fn open_agent_history_rejects_unknown_agent() {
        let app = setup();
        let db = app.state::<Db>();
        let err = tauri::async_runtime::block_on(open_agent_history(db, "ghost".into(), None))
            .unwrap_err();
        assert!(
            matches!(err, AppError::Invalid(_)),
            "未知 agent 给出输入错误: {err}"
        );
    }

    #[test]
    fn shell_quote_wraps_unsafe_tokens() {
        assert_eq!(shell_quote("claude"), "claude");
        assert_eq!(shell_quote("--resume"), "--resume");
        assert_eq!(
            shell_quote("/usr/local/bin/my agent"),
            "'/usr/local/bin/my agent'"
        );
        assert_eq!(shell_quote("it's"), r#"'it'\''s'"#);
        assert_eq!(shell_quote(""), "''");
    }
}
