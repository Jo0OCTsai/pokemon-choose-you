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

/// 终端偏好（settings.terminal_preference）：交互派发 / 历史记录 / 飞书授权
/// 唤起哪个终端应用。各平台可选项不同，前端下拉按平台裁剪，值与此处对齐。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub(crate) enum TerminalPref {
    /// 系统内置：macOS Terminal.app；Windows PowerShell；Linux 常见终端候选列表探测
    #[default]
    Builtin,
    /// iTerm2（仅 macOS，AppleScript 新建窗口写命令行）
    ITerm2,
    /// Ghostty（macOS 经 `open -na`、Linux 直启，-e 执行命令行）
    Ghostty,
    /// Windows Terminal（wt.exe，仅 Windows）
    WindowsTerminal,
}

impl TerminalPref {
    /// 解析 settings 表存值；缺省 / 空串 / 未知值一律回落内置
    fn from_setting(v: Option<&str>) -> Self {
        match v.unwrap_or_default() {
            "iterm2" => Self::ITerm2,
            "ghostty" => Self::Ghostty,
            "windows-terminal" => Self::WindowsTerminal,
            _ => Self::Builtin,
        }
    }
}

/// 读终端偏好（settings 表直查；调用方持有连接锁时同步读取）
pub(crate) fn terminal_pref(conn: &rusqlite::Connection) -> TerminalPref {
    let v: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key='terminal_preference'",
            [],
            |r| r.get(0),
        )
        .ok();
    TerminalPref::from_setting(v.as_deref())
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
    let (agent, pref) = {
        let conn = db.0.lock().unwrap();
        let get = settings_getter(&conn);
        let agent = ai::agent_by_id(&get, &agent_id)
            .ok_or_else(|| AppError::Invalid(format!("Agent {agent_id} 不存在，请先保存配置")))?;
        (agent, terminal_pref(&conn))
    };
    open_agent_in_terminal(&agent, pref, session_id.as_deref()).await
}

async fn open_agent_in_terminal(
    agent: &AgentConfig,
    pref: TerminalPref,
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
        Some(line) => spawn_line_in_terminal(pref, &line)
            .await
            .map(|term| format!("已在 {term} 中启动「{}」", agent.name)),
        None => spawn_in_terminal(pref, &program, &args)
            .await
            .map(|term| format!("已在 {term} 中启动「{}」", agent.name)),
    }
}

/// 「cd 工作目录 && 命令」整行：目录是 agent_workdir 展开后的绝对路径，
/// 经 local_cd_prefix 跨平台拼接；命令与参数逐个按目标 shell 引用
/// （unix 终端是 POSIX shell；Windows 本地终端是 PowerShell——行首 `&` 是
/// PS 调用符，语句首 token 为带引号字符串时 PS 走表达式模式不会执行命令）
fn local_history_line(dir: &str, program: &str, args: &[String]) -> String {
    let (quote, invoke): (fn(&str) -> String, &str) = if cfg!(windows) {
        (crate::ai::windows_ps_quote, "& ")
    } else {
        (shell_quote, "")
    };
    let mut line = local_cd_prefix(dir);
    line.push_str(invoke);
    line.push_str(&quote(program));
    for a in args {
        line.push(' ');
        line.push_str(&quote(a));
    }
    line
}

/// 本地终端整行的 cd 前缀（含结尾串联符）：unix 目标是 POSIX shell，`&&` 串联、
/// 目录经 ai::quote_cd_target（保留 ~ 展开）；Windows 本地终端已换 PowerShell，
/// PS 5.1 没有 `&&` 管道链，用 `;` 语句分隔、目录为单引号字面量；
/// `-ErrorAction Stop` 把 cd 失败升级为终止错误——否则 `;` 串联下目录不存在
/// 仍会继续执行 agent（fail-open，任务落错工作目录）
pub(crate) fn local_cd_prefix(dir: &str) -> String {
    #[cfg(windows)]
    {
        format!(
            "cd {} -ErrorAction Stop ; ",
            crate::ai::windows_ps_quote(dir)
        )
    }
    #[cfg(not(windows))]
    {
        format!("cd {} && ", crate::ai::quote_cd_target(dir))
    }
}

/// 在一个新的终端窗口里运行命令（各系统终端差异大，尽力而为）。
/// 终端应用按设置里的终端偏好（pref）选择，成功返回实际使用的终端程序名。
/// （派发交互通道经 ssh argv 复用）
pub(crate) async fn spawn_in_terminal(
    pref: TerminalPref,
    program: &str,
    args: &[String],
) -> AppResult<&'static str> {
    // Windows 本地终端是 PowerShell：整行按 PS 单引号字面量逐参引用，行首 `&`
    // 调用符（首 token 为带引号字符串时 PS 走表达式模式不会执行命令）；含 ssh
    // 远程参数——远端命令行内部仍按 POSIX 构造，这里只保证它作为单个参数完整
    // 抵达 ssh，`"$SHELL"` 等在 PS 单引号内是字面量；macOS/Linux 终端走 POSIX
    // 引用不变
    let (quote, invoke): (fn(&str) -> String, &str) = if cfg!(windows) {
        (crate::ai::windows_ps_quote, "& ")
    } else {
        (shell_quote, "")
    };
    let mut line = invoke.to_string();
    line.push_str(&quote(program).to_string());
    for a in args {
        line.push(' ');
        line.push_str(&quote(a));
    }
    spawn_line_in_terminal(pref, &line).await
}

/// AppleScript 字符串字面量转义：`\` 与 `"` 必须转义。SSH 远程的历史命令行带
/// `"$SHELL"`（双引号），不转义会打断 `do script "..."` 的语法，Terminal 打不开
/// 且 osascript 报 -2740（回归：远程 agent 的历史记录在 macOS 上唤不起终端）。
/// 仅 macOS 编译：唯一调用方在 cfg 门内，Linux 下无调用方会触发 dead_code。
#[cfg(target_os = "macos")]
fn applescript_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// spawn_in_terminal 的整行版本：line 原样交给目标 shell 执行，不再逐参转义
/// （用于含 && 等 shell 语法的复合命令）。等进程结束并检查退出码——
/// 只看 spawn 成功会把 osascript 的运行时语法错误静默吞掉（窗口没开却报成功）。
pub(crate) async fn spawn_line_in_terminal(
    pref: TerminalPref,
    line: &str,
) -> AppResult<&'static str> {
    #[cfg(target_os = "macos")]
    match pref {
        TerminalPref::ITerm2 => spawn_iterm2(line).await,
        TerminalPref::Ghostty => spawn_ghostty(line).await,
        // 跨平台错配（如库迁移）显式报错而不是静默回落：用户选的终端没被尊重应当可感知
        TerminalPref::WindowsTerminal => Err(AppError::Invalid(
            "终端偏好 Windows Terminal 仅 Windows 可用，请在设置里改回".into(),
        )),
        TerminalPref::Builtin => spawn_terminal_app(line).await,
    }

    #[cfg(target_os = "windows")]
    match pref {
        TerminalPref::WindowsTerminal => spawn_windows_terminal(line).await,
        TerminalPref::ITerm2 | TerminalPref::Ghostty => Err(AppError::Invalid(
            "终端偏好 iTerm2 / Ghostty 仅 macOS / Linux 可用，请在设置里改回".into(),
        )),
        TerminalPref::Builtin => spawn_powershell_window(line).await,
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    match pref {
        TerminalPref::Ghostty => spawn_ghostty(line).await,
        TerminalPref::ITerm2 | TerminalPref::WindowsTerminal => Err(AppError::Invalid(
            "终端偏好 iTerm2 / Windows Terminal 仅 macOS / Windows 可用，请在设置里改回".into(),
        )),
        TerminalPref::Builtin => spawn_builtin_linux(line).await,
    }

    #[cfg(not(any(unix, windows)))]
    {
        let _ = (pref, line);
        Err(AppError::External("当前平台不支持打开终端".into()))
    }
}

/// macOS 内置 Terminal.app：不接受命令参数，用 osascript 让它执行一条 shell 命令
#[cfg(target_os = "macos")]
async fn spawn_terminal_app(line: &str) -> AppResult<&'static str> {
    let script = format!(
        "tell application \"Terminal\" to do script \"{}\"",
        applescript_escape(line)
    );
    run_osascript(&[script]).await.map_err(|stderr| {
        AppError::External(format!(
            "macOS 终端命令执行失败：{stderr}（命令行：{line}）"
        ))
    })?;
    Ok("Terminal")
}

/// macOS iTerm2：新建默认 profile 窗口，把命令行写进当前会话（用户默认 shell 执行）。
/// 多条 `-e` 拼成一段程序，比嵌换行的单串更稳（osascript 逐行编译）
#[cfg(target_os = "macos")]
async fn spawn_iterm2(line: &str) -> AppResult<&'static str> {
    run_osascript(&iterm2_script_lines(line))
        .await
        .map_err(|stderr| {
            // 未安装 iTerm2 时 osascript 连术语字典都解析不了、TCC 授权被拒时报
            // -1743：两者裸报错都很难懂，按 stderr 形态补可操作提示
            let hint =
                if stderr.contains("-1743") || stderr.to_lowercase().contains("not authorized") {
                    "未在「系统设置 → 隐私与安全性 → 自动化」授权本应用控制 iTerm2"
                } else {
                    "未安装 iTerm2？"
                };
            AppError::External(format!(
                "唤起 iTerm2 失败（{hint}）：{stderr}（命令行：{line}）"
            ))
        })?;
    Ok("iTerm2")
}

/// iTerm2 的 AppleScript 程序（逐行，对应 osascript 的多个 -e 参数）。抽出以便单测编译
#[cfg(target_os = "macos")]
fn iterm2_script_lines(line: &str) -> Vec<String> {
    let escaped = applescript_escape(line);
    [
        "tell application \"iTerm2\"".to_string(),
        "activate".to_string(),
        "create window with default profile".to_string(),
        "tell current session of current window".to_string(),
        format!("write text \"{escaped}\""),
        "end tell".to_string(),
        "end tell".to_string(),
    ]
    .into()
}

/// osascript 运行一段 AppleScript（每个元素一个 -e）；失败带 stderr 返回，
/// 由各终端的唤起函数包上可操作的上下文
#[cfg(target_os = "macos")]
async fn run_osascript(lines: &[String]) -> Result<(), String> {
    let mut args: Vec<&std::ffi::OsStr> = Vec::new();
    for l in lines {
        args.push("-e".as_ref());
        args.push(l.as_ref());
    }
    let out = tokio::process::Command::new("osascript")
        .args(args)
        .output()
        .await
        .map_err(|e| format!("无法执行 osascript: {e}"))?;
    if out.status.success() {
        return Ok(());
    }
    Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
}

/// macOS Ghostty：单实例模型下外部唤起新窗口的可行方式是 `open -na` 新起一个
/// 实例，`--args` 原样透传，`-e` 后的参数即窗口内执行的命令（bash -lc 带用户 PATH）
#[cfg(target_os = "macos")]
async fn spawn_ghostty(line: &str) -> AppResult<&'static str> {
    let out = tokio::process::Command::new("open")
        .args(["-na", "Ghostty", "--args", "-e", "bash", "-lc", line])
        .output()
        .await
        .map_err(|e| AppError::External(format!("无法打开 Ghostty: {e}")))?;
    if out.status.success() {
        return Ok("Ghostty");
    }
    Err(AppError::External(format!(
        "打开 Ghostty 失败（未安装？）：{}（命令行：{line}）",
        String::from_utf8_lossy(&out.stderr).trim()
    )))
}

/// Windows 内置 PowerShell（PS 5.1 随系统自带）：`start` 开新窗口跑
/// `powershell -NoExit -Command`（命令跑完窗口保留，与 cmd /K 行为对齐）。
/// `-ExecutionPolicy Bypass` 仅该会话生效——npm 全局 CLI 的垫片首选 .ps1，
/// 默认 Restricted 策略下会报「禁止运行脚本」（cmd 时代跑的是 .cmd 不受限）。
/// cmd 只当开窗器（start 逐字传递尾部），跑命令的 shell 是 PowerShell——
/// 用户 profile 照常加载（PATH 等环境与手开终端一致，同 Linux 路径 bash -lc 的理由）
#[cfg(target_os = "windows")]
async fn spawn_powershell_window(line: &str) -> AppResult<&'static str> {
    let title = "pokemon-choose-you agent";
    let out = tokio::process::Command::new("cmd")
        .args([
            "/C",
            "start",
            title,
            "powershell",
            "-NoExit",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            line,
        ])
        .output()
        .await
        .map_err(|e| AppError::External(format!("打开终端失败: {e}")))?;
    if out.status.success() {
        return Ok("PowerShell");
    }
    let stderr = String::from_utf8_lossy(&out.stderr);
    Err(AppError::External(format!(
        "打开终端失败：{}（命令行：{line}）",
        stderr.trim()
    )))
}

/// wt.exe 的 `;` 是 wt 子命令分隔符（对解码后的每个 argv 元素跑 `^;|[^\\];`，
/// 引号不保护）。`\;` 可跳过扫描，且 wt 在构造动作前经 Commandline::AddArg 还原
/// 回 `;`（microsoft/terminal 自 v1.0.1401.0 行为不变），powershell -Command
/// 收到的仍是原始文本；不转义则含 `;` 的派发 prompt 会在 wt 层被截断静默执行。
/// 仅用于 wt 路径的 line 参数——其他解析器不认 `\;`，转义会污染数据。
#[cfg_attr(not(windows), allow(dead_code))]
fn wt_escape_command_delimiter(line: &str) -> String {
    line.replace(';', "\\;")
}

/// Windows Terminal（wt.exe）：new-tab 里跑 PowerShell，与内置路径同一套 PS 引用
/// 语义（行格式按目标 shell = PowerShell 构造，两个 Windows 终端选项共用）。
/// wt.exe 是 0 字节 reparse 别名——子进程工作目录与其不同盘会静默失败（退出码
/// 0xC1），固定 SystemRoot 作 cwd 规避；直接 spawn 而非经 start，退出码才可判
#[cfg(target_os = "windows")]
async fn spawn_windows_terminal(line: &str) -> AppResult<&'static str> {
    let title = "pokemon-choose-you agent";
    let out = tokio::process::Command::new("wt.exe")
        .args([
            "new-tab",
            "--title",
            title,
            "powershell",
            "-NoExit",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &wt_escape_command_delimiter(line),
        ])
        .current_dir(std::env::var("SystemRoot").unwrap_or_else(|_| ".".into()))
        .output()
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::External(
                    "未找到 Windows Terminal（wt.exe），请安装或把终端偏好切回「系统内置」".into(),
                )
            } else {
                AppError::External(format!("打开 Windows Terminal 失败: {e}"))
            }
        })?;
    if out.status.success() {
        return Ok("Windows Terminal");
    }
    let stderr = String::from_utf8_lossy(&out.stderr);
    Err(AppError::External(format!(
        "打开 Windows Terminal 失败：{}（命令行：{line}）",
        stderr.trim()
    )))
}

/// Linux 内置（自动探测）：常见终端候选列表逐个尝试，先启动成功者胜出
#[cfg(all(unix, not(target_os = "macos")))]
async fn spawn_builtin_linux(line: &str) -> AppResult<&'static str> {
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

/// Linux Ghostty：直启新窗口，`-e` 后的参数即窗口内执行的命令。
/// 用 spawn 而非 output 等退出：gtk 单实例模型下首次启动的 ghostty 自身成为
/// 常驻服务进程，等它退出 = 等用户关窗口，派发返回与会话落库都会被拖住
#[cfg(all(unix, not(target_os = "macos")))]
async fn spawn_ghostty(line: &str) -> AppResult<&'static str> {
    tokio::process::Command::new("ghostty")
        .args(["-e", "bash", "-lc", line])
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::External("未找到 Ghostty，请安装或把终端偏好切回「系统内置」".into())
            } else {
                AppError::External(format!("无法打开 Ghostty: {e}"))
            }
        })?;
    Ok("Ghostty")
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
pub async fn feishu_oauth_login(db: State<'_, Db>) -> AppResult<String> {
    let pref = {
        let conn = db.0.lock().unwrap();
        terminal_pref(&conn)
    };
    let bin = crate::lark_cli::lark_bin();
    // 含空格/特殊字符的 bin 路径须引用（终端整行经目标 shell 重解析；
    // Windows 目标 shell 是 PowerShell：行首 `&` 调用符——首 token 为带引号
    // 字符串时 PS 走表达式模式不会执行命令；PS 5.1 无 && 串联，用 ; 分隔语句）
    let (quoted_bin, seq, invoke): (String, &str, &str) = if cfg!(windows) {
        (crate::ai::windows_ps_quote(&bin), " ; ", "& ")
    } else {
        (shell_quote(&bin), " && ", "")
    };
    // 首次使用 lark-cli 需先 config init（浏览器里创建自建应用），之后才是用户授权
    let line = if crate::lark_cli::config_ready(&bin).await {
        format!("{invoke}{quoted_bin} auth login --domain im --recommend")
    } else {
        format!(
            "{invoke}{quoted_bin} config init --new{seq}{invoke}{quoted_bin} auth login --domain im --recommend"
        )
    };
    spawn_line_in_terminal(pref, &line)
        .await
        .map(|term| format!("已在 {term} 中启动 lark-cli 登录，完成后回到这里点「测试」"))
}

// ---- 飞书会话过滤偏好（feishu-chat-filter；契约 = specs/feishu-chat-filter/architecture.md §4）----

/// 单会话过滤视图：快照观测事实 × 偏好合并；effective / source 读取时现算，不落库。
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuChatFilterView {
    pub chat_id: String,
    pub chat_name: String,
    /// group / p2p / bot（与 chat_messages.chat_type 同词表）
    pub chat_type: String,
    /// muted / unmuted / unknown（unknown = 上轮该会话所在批次查询失败）
    pub mute_outcome: String,
    /// follow / always_filter / always_pull（follow = 无行，已解析为显式三态）
    pub preference: String,
    /// pull / filter
    pub effective: String,
    /// manual / follow / followDegraded（降级直出独立来源值，前端零合并）
    pub source: String,
    /// 快照时间 RFC3339（与信封 snapshotAt 同源 = settings.feishu_snapshot_at；沉睡行空串）
    pub updated_at: String,
}

/// 摘要行与筛选 chip 的计数
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterCounts {
    pub total: u32,
    pub pulling: u32,
    pub filtered: u32,
    pub manual: u32,
}

/// 最近一轮拉取快照 + 偏好合并后的过滤总览。
/// snapshotAt = None 表示从未成功拉取；Some 但 chats 为空 = 零会话账号（两种空态的区分依据）。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuChatFilterOverview {
    pub chats: Vec<FeishuChatFilterView>,
    pub counts: FilterCounts,
    pub snapshot_at: Option<String>,
}

/// 过滤总览（纯本地 SQLite 读，不触发任何飞书 API——快照数据源是轮询副产物）
#[tauri::command]
pub fn get_feishu_chat_filter_overview(db: State<'_, Db>) -> AppResult<FeishuChatFilterOverview> {
    let conn = db.0.lock().unwrap();
    let snapshot_at: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key='feishu_snapshot_at'",
            [],
            |r| r.get(0),
        )
        .ok();
    let mut stmt = conn.prepare(
        "SELECT c.chat_id, c.chat_name, c.chat_type, c.mute_outcome, p.preference
         FROM feishu_chats c LEFT JOIN chat_filter_prefs p ON p.chat_id = c.chat_id
         ORDER BY c.chat_id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, Option<String>>(4)?,
        ))
    })?;
    let mut chats = vec![];
    let mut counts = FilterCounts {
        total: 0,
        pulling: 0,
        filtered: 0,
        manual: 0,
    };
    for row in rows {
        let (chat_id, chat_name, chat_type, mute_outcome, pref_raw) = row?;
        let outcome = crate::feishu::MuteOutcome::parse(&mute_outcome);
        let pref = pref_raw
            .as_deref()
            .and_then(crate::feishu::FilterPref::parse)
            .unwrap_or(crate::feishu::FilterPref::Follow);
        let (effect, source) = crate::feishu::filter_decision(pref, outcome);
        if effect == crate::feishu::FilterEffect::Pull {
            counts.pulling += 1;
        } else {
            counts.filtered += 1;
        }
        if source == crate::feishu::FilterSource::Manual {
            counts.manual += 1;
        }
        counts.total += 1;
        chats.push(FeishuChatFilterView {
            chat_id,
            chat_name,
            chat_type,
            mute_outcome: outcome.as_str().to_string(),
            preference: pref.as_str().to_string(),
            effective: effect.as_str().to_string(),
            source: source.as_str().to_string(),
            updated_at: snapshot_at.clone().unwrap_or_default(),
        });
    }
    Ok(FeishuChatFilterOverview {
        chats,
        counts,
        snapshot_at,
    })
}

/// 单会话合并视图（set 的返回值）：快照行存在 → 用该轮 outcome 推导；
/// 沉睡行（快照无该行）→ muteOutcome=unknown、名称/类型/updatedAt 空串、按纯偏好推导（manual 恒定）
fn feishu_chat_filter_merged_view(
    conn: &rusqlite::Connection,
    chat_id: &str,
    pref: crate::feishu::FilterPref,
) -> AppResult<FeishuChatFilterView> {
    let snapshot: Option<(String, String, String)> = conn
        .query_row(
            "SELECT chat_name, chat_type, mute_outcome FROM feishu_chats WHERE chat_id=?1",
            rusqlite::params![chat_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok();
    let (chat_name, chat_type, outcome, updated_at) = match snapshot {
        // 快照行存在：updatedAt 与信封 snapshotAt 同源填充（该行属于本轮快照）
        Some((name, ctype, outcome)) => {
            let at: Option<String> = conn
                .query_row(
                    "SELECT value FROM settings WHERE key='feishu_snapshot_at'",
                    [],
                    |r| r.get(0),
                )
                .ok();
            (
                name,
                ctype,
                crate::feishu::MuteOutcome::parse(&outcome),
                at.unwrap_or_default(),
            )
        }
        // 沉睡行：无所属快照轮次，名称/类型/updatedAt 空串、outcome=unknown（按纯偏好推导）
        None => (
            String::new(),
            String::new(),
            crate::feishu::MuteOutcome::Unknown,
            String::new(),
        ),
    };
    let (effect, source) = crate::feishu::filter_decision(pref, outcome);
    Ok(FeishuChatFilterView {
        chat_id: chat_id.to_string(),
        chat_name,
        chat_type,
        mute_outcome: outcome.as_str().to_string(),
        preference: pref.as_str().to_string(),
        effective: effect.as_str().to_string(),
        source: source.as_str().to_string(),
        updated_at,
    })
}

/// 设置单会话三态过滤偏好；follow = 删除偏好行（回到跟随免打扰）。
/// 不校验会话是否在快照中（孤儿沉睡偏好，SDD 规则）、不校验 feishu_enabled（本地数据，
/// 停用期设置无害）。成功后广播 feishu-chat-filter-changed（两窗口重拉）。
#[tauri::command]
pub fn set_feishu_chat_filter<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<'_, Db>,
    chat_id: String,
    preference: String,
) -> AppResult<FeishuChatFilterView> {
    // chatId 非空且 ≤64 字符：飞书 chat_id 形如 oc_ 前缀约 20-30 字符，64 上限宽松；
    // 拦截空串/超长防永久沉睡的垃圾行
    if chat_id.trim().is_empty() || chat_id.chars().count() > 64 {
        return Err(AppError::Invalid("chatId 必须非空且不超过 64 字符".into()));
    }
    let pref = crate::feishu::FilterPref::parse(&preference).ok_or_else(|| {
        AppError::Invalid(format!(
            "preference 必须是 follow / always_filter / always_pull：{preference}"
        ))
    })?;
    let view = {
        let conn = db.0.lock().unwrap();
        match pref {
            crate::feishu::FilterPref::Follow => {
                conn.execute(
                    "DELETE FROM chat_filter_prefs WHERE chat_id=?1",
                    rusqlite::params![chat_id],
                )?;
            }
            crate::feishu::FilterPref::AlwaysFilter | crate::feishu::FilterPref::AlwaysPull => {
                conn.execute(
                    "INSERT INTO chat_filter_prefs (chat_id, preference, updated_at)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(chat_id) DO UPDATE SET preference=?2, updated_at=?3",
                    rusqlite::params![chat_id, pref.as_str(), crate::db::now()],
                )?;
            }
        }
        feishu_chat_filter_merged_view(&conn, &chat_id, pref)?
    };
    events::broadcast(&app, events::FEISHU_CHAT_FILTER_CHANGED);
    Ok(view)
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
    fn terminal_pref_parses_setting_values() {
        use TerminalPref::{Builtin, Ghostty, ITerm2, WindowsTerminal};
        // 未设置 / 空串 / 缺省值 / 未知值一律回落内置（旧库无此键是常态）
        assert_eq!(TerminalPref::from_setting(None), Builtin);
        assert_eq!(TerminalPref::from_setting(Some("")), Builtin);
        assert_eq!(TerminalPref::from_setting(Some("default")), Builtin);
        assert_eq!(TerminalPref::from_setting(Some("bogus")), Builtin);
        assert_eq!(TerminalPref::from_setting(Some("iterm2")), ITerm2);
        assert_eq!(TerminalPref::from_setting(Some("ghostty")), Ghostty);
        assert_eq!(
            TerminalPref::from_setting(Some("windows-terminal")),
            WindowsTerminal
        );
    }

    #[test]
    fn terminal_pref_reads_db() {
        let conn = test_conn();
        assert_eq!(terminal_pref(&conn), TerminalPref::Builtin, "未设置 = 内置");
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('terminal_preference', 'ghostty')",
            [],
        )
        .unwrap();
        assert_eq!(terminal_pref(&conn), TerminalPref::Ghostty);
    }

    /// wt 转义不变式：每个 `;` 前恰好插一个 `\`、既有反斜杠不动——
    /// wt 的 AddArg 会逐个删掉 `;` 前那一个 `\`，多插或少插都会污染原始数据
    #[test]
    fn wt_escape_only_shields_semicolons() {
        assert_eq!(
            wt_escape_command_delimiter("claude -p 'a;b'"),
            "claude -p 'a\\;b'"
        );
        // 既有反斜杠 + 分号（原文 a\;b;;）：转义成 a\\;b\;\;，反扫描不分裂且可无损还原
        assert_eq!(wt_escape_command_delimiter("a\\;b;;"), "a\\\\;b\\;\\;");
        assert_eq!(wt_escape_command_delimiter(";x"), "\\;x");
        assert_eq!(wt_escape_command_delimiter("no semi"), "no semi");
    }

    /// iTerm2 脚本与 Terminal do script 同一转义规则（applescript_escape）；
    /// 装了 iTerm2 的机器上再验证整段程序语法合法（osacompile 解析它的术语
    /// 字典依赖 app 在场，未安装时该断言跳过——转义检查不受影响）
    #[test]
    #[cfg(target_os = "macos")]
    fn iterm2_script_escapes_and_compiles() {
        let lines = iterm2_script_lines("ssh box -- exec \"$SHELL\" -lc 'claude --resume'");
        let write = lines
            .iter()
            .find(|l| l.starts_with("write text"))
            .expect("脚本应包含 write text");
        assert!(write.contains("\\\"$SHELL\\\""), "双引号须转义: {write}");
        let installed = std::path::Path::new("/Applications/iTerm.app").exists()
            || std::env::var("HOME").is_ok_and(|h| {
                std::path::Path::new(&h)
                    .join("Applications/iTerm.app")
                    .exists()
            });
        if !installed {
            eprintln!("iTerm2 未安装，跳过 osacompile 编译断言");
            return;
        }
        let mut args: Vec<&std::ffi::OsStr> = vec!["-o".as_ref(), "/dev/null".as_ref()];
        for l in &lines {
            args.push("-e".as_ref());
            args.push(l.as_ref());
        }
        let compile = std::process::Command::new("osacompile")
            .args(args)
            .output()
            .expect("osacompile 应可用");
        assert!(
            compile.status.success(),
            "iTerm2 脚本应编译通过: {}",
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
            line.starts_with(&local_cd_prefix(&dir)),
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
        assert!(line.starts_with(&local_cd_prefix(dir.to_string_lossy().as_ref())));
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

    // ---- 飞书会话过滤（feishu-chat-filter，AD §8 测试 3）----

    fn seed_filter_snapshot(app: &tauri::App<tauri::test::MockRuntime>) {
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO feishu_chats (chat_id, chat_name, chat_type, mute_outcome) VALUES
             ('oc_group','项目群','group','unmuted'),
             ('oc_noisy','灌水群','group','muted'),
             ('oc_flaky','失败批群','group','unknown')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO chat_filter_prefs (chat_id, preference, updated_at)
             VALUES ('oc_noisy','always_filter','2026-09-22T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('feishu_snapshot_at','2026-09-23T08:00:00+00:00')",
            [],
        )
        .unwrap();
    }

    /// 总览：camelCase 视图、三态解析、effective/source 派生（含 followDegraded）、counts 汇总
    #[test]
    fn feishu_chat_filter_overview_merges_and_counts() {
        let app = setup();
        seed_filter_snapshot(&app);
        let db = app.state::<Db>();
        let overview = get_feishu_chat_filter_overview(db).unwrap();
        // 序列化键为 camelCase（前端契约）
        let v = serde_json::to_value(&overview).unwrap();
        assert_eq!(v["snapshotAt"], "2026-09-23T08:00:00+00:00");
        assert_eq!(
            v["counts"],
            serde_json::json!({"total": 3, "pulling": 2, "filtered": 1, "manual": 1})
        );
        let chats = v["chats"].as_array().unwrap();
        assert_eq!(chats.len(), 3);
        // 按 chat_id 排序：oc_flaky < oc_group < oc_noisy
        assert_eq!(chats[0]["chatId"], "oc_flaky");
        assert_eq!(chats[0]["chatName"], "失败批群");
        assert_eq!(chats[0]["muteOutcome"], "unknown");
        assert_eq!(chats[0]["preference"], "follow");
        assert_eq!(chats[0]["effective"], "pull");
        assert_eq!(
            chats[0]["source"], "followDegraded",
            "批次失败降级直出独立来源值，前端零合并"
        );
        assert_eq!(chats[0]["updatedAt"], "2026-09-23T08:00:00+00:00");
        assert_eq!(chats[1]["chatId"], "oc_group");
        assert_eq!(chats[1]["source"], "follow");
        assert_eq!(chats[1]["effective"], "pull");
        assert_eq!(chats[2]["chatId"], "oc_noisy");
        assert_eq!(chats[2]["muteOutcome"], "muted");
        assert_eq!(chats[2]["preference"], "always_filter");
        assert_eq!(chats[2]["effective"], "filter");
        assert_eq!(chats[2]["source"], "manual");
    }

    /// 两种空态可区分：无键 = 从未成功拉取（snapshotAt=null）；有键空表 = 零会话账号
    #[test]
    fn feishu_chat_filter_overview_empty_states_distinguishable() {
        let app = setup();
        let db = app.state::<Db>();
        let o = get_feishu_chat_filter_overview(db).unwrap();
        assert!(o.chats.is_empty());
        assert!(o.snapshot_at.is_none(), "从未成功拉取");
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('feishu_snapshot_at','2026-09-23T08:00:00+00:00')",
                [],
            )
            .unwrap();
        }
        let db = app.state::<Db>();
        let o = get_feishu_chat_filter_overview(db).unwrap();
        assert!(o.chats.is_empty());
        assert_eq!(
            o.snapshot_at.as_deref(),
            Some("2026-09-23T08:00:00+00:00"),
            "零会话账号：有键 ∧ 空表"
        );
    }

    /// set 三态：follow=删行、覆盖态=UPSERT 单行、返回该行合并视图、沉睡行视图、入参校验
    #[test]
    fn set_feishu_chat_filter_three_states_and_validation() {
        let app = setup();
        seed_filter_snapshot(&app);
        // 改设 always_pull：muted × 手动拉取 → 返回 manual 视图（updatedAt 与信封同源）
        {
            let db = app.state::<Db>();
            let v = set_feishu_chat_filter(
                app.handle().clone(),
                db,
                "oc_noisy".into(),
                "always_pull".into(),
            )
            .unwrap();
            assert_eq!(v.chat_id, "oc_noisy");
            assert_eq!(v.chat_name, "灌水群");
            assert_eq!(v.preference, "always_pull");
            assert_eq!(v.effective, "pull");
            assert_eq!(v.source, "manual");
            assert_eq!(v.mute_outcome, "muted");
            assert_eq!(v.updated_at, "2026-09-23T08:00:00+00:00");
        }
        // 再改 always_filter：UPSERT 覆盖为单行
        {
            let db = app.state::<Db>();
            let v = set_feishu_chat_filter(
                app.handle().clone(),
                db,
                "oc_noisy".into(),
                "always_filter".into(),
            )
            .unwrap();
            assert_eq!(v.effective, "filter");
        }
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let (n, pref): (i64, String) = conn
                .query_row(
                    "SELECT COUNT(*), MAX(preference) FROM chat_filter_prefs WHERE chat_id='oc_noisy'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!((n, pref.as_str()), (1, "always_filter"), "覆盖写不叠行");
        }
        // follow：删行回到跟随（muted → 过滤、来源 follow）
        {
            let db = app.state::<Db>();
            let v = set_feishu_chat_filter(
                app.handle().clone(),
                db,
                "oc_noisy".into(),
                "follow".into(),
            )
            .unwrap();
            assert_eq!(v.preference, "follow");
            assert_eq!(v.source, "follow");
            assert_eq!(v.effective, "filter");
        }
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let n: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM chat_filter_prefs WHERE chat_id='oc_noisy'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 0, "follow 删除偏好行");
        }
        // 沉睡行（快照无该行）：被接受，muteOutcome=unknown、名称/类型/updatedAt 空串、manual 恒定
        {
            let db = app.state::<Db>();
            let v = set_feishu_chat_filter(
                app.handle().clone(),
                db,
                "oc_ghost".into(),
                "always_filter".into(),
            )
            .unwrap();
            assert_eq!(v.mute_outcome, "unknown");
            assert_eq!(v.chat_name, "");
            assert_eq!(v.chat_type, "");
            assert_eq!(v.updated_at, "");
            assert_eq!(v.effective, "filter");
            assert_eq!(v.source, "manual");
        }
        // 校验：非法 preference / 空 chatId / 超长 chatId → AppError::Invalid
        {
            let db = app.state::<Db>();
            let err =
                set_feishu_chat_filter(app.handle().clone(), db, "oc_x".into(), "nope".into())
                    .unwrap_err();
            assert!(matches!(err, AppError::Invalid(_)), "{err}");
        }
        {
            let db = app.state::<Db>();
            let err = set_feishu_chat_filter(app.handle().clone(), db, "".into(), "follow".into())
                .unwrap_err();
            assert!(matches!(err, AppError::Invalid(_)), "{err}");
        }
        {
            let db = app.state::<Db>();
            let long = "x".repeat(65);
            let err = set_feishu_chat_filter(app.handle().clone(), db, long, "follow".into())
                .unwrap_err();
            assert!(matches!(err, AppError::Invalid(_)), "{err}");
        }
        // 恰好 64 字符可接受
        {
            let db = app.state::<Db>();
            let ok64 = "o".repeat(64);
            set_feishu_chat_filter(app.handle().clone(), db, ok64, "follow".into()).unwrap();
        }
    }

    /// set 成功后恰广播一次 feishu-chat-filter-changed（跨窗口重拉通道）；失败不广播
    #[test]
    fn set_feishu_chat_filter_broadcasts_once() {
        use std::sync::mpsc;
        use tauri::Listener;

        let app = setup();
        let (tx, rx) = mpsc::channel::<String>();
        let t1 = tx.clone();
        app.handle()
            .listen(crate::events::FEISHU_CHAT_FILTER_CHANGED, move |_| {
                t1.send("hit".into()).unwrap();
            });
        drop(tx);

        let db = app.state::<Db>();
        set_feishu_chat_filter(
            app.handle().clone(),
            db,
            "oc_a".into(),
            "always_pull".into(),
        )
        .unwrap();
        let db = app.state::<Db>();
        let _ = set_feishu_chat_filter(app.handle().clone(), db, "oc_a".into(), "bogus".into());

        let mut got = vec![];
        while let Ok(m) = rx.try_recv() {
            got.push(m);
        }
        assert_eq!(got, vec!["hit".to_string()], "成功一次广播、失败不广播");
    }
}
