use crate::ai::{self, AgentConfig};
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::events;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::UpdaterExt;

// ---- 集成：AI Agent CLI / 飞书 ----

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
    // 会话 id 的注入（--resume <id> / --resume-id <id>）在 history_invocation 内按
    // agent 级历史参数适配，本地远程同一套规则（回归：旧实现看 ssh argv 首参，
    // 远程分支永远是 -o，id 从未被注入）
    let (program, args) = crate::ai::history_invocation(agent, resume_session);
    // 本地 agent 总是先 cd 到工作目录再启动：与无头调用同一套解析（留空 = ~/.choose-you，
    // 自动创建），交互会话不能落在终端默认目录；SSH 远程的 cd 由 history_invocation
    // 前缀在远端命令行里（留空 = 远端登录目录）；目录解析失败（无主目录）退回不 cd 直启
    let local = agent
        .remote
        .as_ref()
        .is_none_or(|r| r.host.trim().is_empty());
    let line = local
        .then(|| crate::ai::agent_workdir(agent))
        .flatten()
        .map(|dir| local_history_line(&dir.to_string_lossy(), &program, &args));
    match line {
        Some(line) => spawn_line_in_terminal(&line)
            .await
            .map(|term| format!("已在 {term} 中启动「{}」", agent.name)),
        None => spawn_in_terminal(&program, &args)
            .await
            .map(|term| format!("已在 {term} 中启动「{}」", agent.name)),
    }
}

/// 「cd 工作目录 && 命令」整行：目录是 agent_workdir 展开后的绝对路径，
/// 经 cd_prefix_target 跨平台引用；命令与参数逐个 shell 引用
fn local_history_line(dir: &str, program: &str, args: &[String]) -> String {
    let mut line = format!("cd {} && ", cd_prefix_target(dir));
    line.push_str(&shell_quote(program));
    for a in args {
        line.push(' ');
        line.push_str(&shell_quote(a));
    }
    line
}

/// 终端命令行里 cd 目标的跨平台引用：unix 交给 ai::quote_cd_target（保留 ~ 展开），
/// Windows 的 cmd /K 不认单引号，用双引号包路径
fn cd_prefix_target(dir: &str) -> String {
    #[cfg(windows)]
    {
        format!("\"{}\"", dir.replace('"', ""))
    }
    #[cfg(not(windows))]
    {
        crate::ai::quote_cd_target(dir)
    }
}

/// 在一个新的终端窗口里运行命令（各系统终端差异大，尽力而为）。
/// 成功返回实际使用的终端程序名。
async fn spawn_in_terminal(program: &str, args: &[String]) -> AppResult<&'static str> {
    let mut line = shell_quote(program).to_string();
    for a in args {
        line.push(' ');
        line.push_str(&shell_quote(a));
    }
    spawn_line_in_terminal(&line).await
}

/// AppleScript 字符串字面量转义：`\` 与 `"` 必须转义。SSH 远程的历史命令行带
/// `"$SHELL"`（双引号），不转义会打断 `do script "..."` 的语法，Terminal 打不开
/// 且 osascript 报 -2740（回归：远程 agent 的历史记录在 macOS 上唤不起终端）
fn applescript_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// spawn_in_terminal 的整行版本：line 原样交给目标 shell 执行，不再逐参转义
/// （用于含 && 等 shell 语法的复合命令）。等进程结束并检查退出码——
/// 只看 spawn 成功会把 osascript 的运行时语法错误静默吞掉（窗口没开却报成功）。
async fn spawn_line_in_terminal(line: &str) -> AppResult<&'static str> {
    #[cfg(target_os = "macos")]
    {
        // Terminal.app 不接受命令参数，用 osascript 让它执行一条 shell 命令
        let script = format!(
            "tell application \"Terminal\" to do script \"{}\"",
            applescript_escape(line)
        );
        let out = tokio::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
            .await
            .map_err(|e| AppError::External(format!("无法打开 macOS 终端: {e}")))?;
        if out.status.success() {
            return Ok("Terminal");
        }
        let stderr = String::from_utf8_lossy(&out.stderr);
        Err(AppError::External(format!(
            "macOS 终端命令执行失败：{}（命令行：{line}）",
            stderr.trim()
        )))
    }

    #[cfg(target_os = "windows")]
    {
        let title = "pokemon-choose-you agent";
        let out = tokio::process::Command::new("cmd")
            .args(["/C", "start", title, "cmd", "/K", line])
            .output()
            .await
            .map_err(|e| AppError::External(format!("打开终端失败: {e}")))?;
        if out.status.success() {
            return Ok("cmd");
        }
        let stderr = String::from_utf8_lossy(&out.stderr);
        Err(AppError::External(format!(
            "打开终端失败：{}（命令行：{line}）",
            stderr.trim()
        )))
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // 经 bash -lc 执行：登录 shell 才带得上 nvm/npm 全局 bin 等用户 PATH
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
        let mut last_err: Option<String> = None;
        for (term, flag) in candidates {
            let mut cmd = tokio::process::Command::new(term);
            if !flag.is_empty() {
                cmd.args(flag.split_whitespace());
            }
            cmd.args(["bash", "-lc", line]);
            match cmd.output().await {
                Ok(o) if o.status.success() => return Ok(term),
                Ok(o) => {
                    // 终端程序存在但启动失败（如 DISPLAY 缺失）：换下一个前记下报错
                    last_err = Some(format!(
                        "{term}: {}",
                        String::from_utf8_lossy(&o.stderr).trim()
                    ));
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => {
                    return Err(AppError::External(format!("启动 {term} 失败: {e}")));
                }
            }
        }
        let detail = last_err
            .map(|e| format!("（{e}）"))
            .unwrap_or_else(|| "（gnome-terminal / konsole / kitty …）".into());
        Err(AppError::External(format!(
            "未找到可用的终端模拟器{detail}，请手动打开终端运行：{line}"
        )))
    }

    #[cfg(not(any(unix, windows)))]
    {
        let _ = line;
        Err(AppError::External("当前平台不支持打开终端".into()))
    }
}

/// POSIX 风格的 shell 引用：含特殊字符时包单引号，内部单引号转义。
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
pub async fn test_feishu_config() -> AppResult<String> {
    crate::feishu::poll_once_test(&crate::lark_cli::lark_bin()).await
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
pub async fn feishu_oauth_status() -> AppResult<FeishuOauthStatus> {
    // 授权状态由 lark-cli 自管（凭证不进本库），转询其登录态
    let status = crate::lark_cli::auth_status(&crate::lark_cli::lark_bin())
        .await
        .unwrap_or(crate::lark_cli::CliAuthStatus {
            logged_in: false,
            user_name: String::new(),
        });
    Ok(FeishuOauthStatus {
        authorized: status.logged_in,
        user_name: status.user_name,
    })
}

/// 发起用户授权：在系统终端里跑 `lark-cli config init && auth login`（浏览器完成授权）
#[tauri::command]
pub async fn feishu_oauth_login() -> AppResult<String> {
    let bin = crate::lark_cli::lark_bin();
    // 首次使用 lark-cli 需先 config init（浏览器里创建自建应用），之后才是用户授权
    let line = if crate::lark_cli::config_ready(&bin).await {
        format!("{bin} auth login --domain im --recommend")
    } else {
        format!("{bin} config init --new && {bin} auth login --domain im --recommend")
    };
    spawn_line_in_terminal(&line)
        .await
        .map(|term| format!("已在 {term} 中启动 lark-cli 登录，完成后回到这里点「测试」"))
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

    /// 回归：SSH 远程历史命令行含 "$SHELL"（双引号），不转义会打断 AppleScript
    /// 字符串字面量，osascript 报 -2740、Terminal 打不开且旧实现静默吞错
    #[test]
    #[cfg(target_os = "macos")]
    fn applescript_escape_shields_quotes_and_backslashes() {
        // 无特殊字符：原样
        assert_eq!(applescript_escape("claude --resume"), "claude --resume");
        // 远程历史行的典型形态：exec "$SHELL" 的双引号被转义
        let escaped = applescript_escape("ssh box -- exec \"$SHELL\" -lc 'claude --resume'");
        assert!(
            escaped.contains("\\\"$SHELL\\\""),
            "双引号转义为 \\\": {escaped}"
        );
        assert!(!escaped.contains("\"$SHELL\""), "不再有裸双引号: {escaped}");
        // 反斜杠翻倍（AppleScript 的转义符本身先要转义）
        assert_eq!(applescript_escape("a\\b"), "a\\\\b");
        // 转义后整段能作为 AppleScript 字符串编译（语法层面合法）
        let script = format!("tell application \"Terminal\" to do script \"{escaped}\"");
        let compile = std::process::Command::new("osacompile")
            .arg("-o")
            .arg("/dev/null")
            .arg("-e")
            .arg(&script)
            .output()
            .expect("osacompile 应可用");
        assert!(
            compile.status.success(),
            "转义后的 AppleScript 应编译通过: {}",
            String::from_utf8_lossy(&compile.stderr)
        );
    }

    #[test]
    fn history_line_cds_into_default_workdir() {
        // 留空的工作目录 = ~/.choose-you：历史记录终端会话与无头调用同一基准
        let agent = AgentConfig {
            command: "claude".into(),
            history_args: "--resume".into(),
            ..Default::default()
        };
        let dir = crate::ai::agent_workdir(&agent)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let line = local_history_line(&dir, "claude", &["--resume".to_string()]);
        assert!(
            line.starts_with(&format!("cd {} && ", cd_prefix_target(&dir))),
            "应先 cd 进默认工作目录: {line}"
        );
        assert!(
            line.contains(".choose-you"),
            "默认目录是 ~/.choose-you: {line}"
        );
        assert!(
            line.ends_with("claude --resume"),
            "命令与参数在 cd 之后: {line}"
        );
    }

    #[test]
    fn history_line_expands_tilde_workdir() {
        let agent = AgentConfig {
            workdir: "~/proj".into(),
            ..Default::default()
        };
        let home = dirs::home_dir().unwrap();
        let dir = crate::ai::agent_workdir(&agent).unwrap();
        assert_eq!(dir, home.join("proj"), "~ 前缀展开为主目录下的路径");
        let line = local_history_line(dir.to_string_lossy().as_ref(), "claude", &[]);
        assert!(line.starts_with(&format!("cd {}", cd_prefix_target(&dir.to_string_lossy()))));
    }

    #[test]
    #[cfg(unix)]
    fn history_line_quotes_program_and_args() {
        let dir = "/tmp/has space";
        let line = local_history_line(dir, "/usr/local/bin/my agent", &["--resume".to_string()]);
        assert!(
            line.contains("cd '/tmp/has space' && '/usr/local/bin/my agent' --resume"),
            "目录与命令分别引用: {line}"
        );
    }
}
