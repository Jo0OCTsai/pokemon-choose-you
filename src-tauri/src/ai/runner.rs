//! 进程执行：agent 无头调用（超时/ETXTBSY 重试/cmd 回退）与连接测试工具探针。

use crate::error::{AppError, AppResult};
use std::path::PathBuf;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

use super::config::AgentConfig;
use super::invocation::build_invocation;
#[cfg(windows)]
use super::invocation::windows_cmd_quote;

/// 单次 agent 调用的超时下限（秒）：agent CLI 启动 + 推理普遍慢于直连 API
const MIN_TIMEOUT_SECS: u64 = 10;

/// 无头调用 agent：本地执行或 SSH 远程执行（见 build_invocation 的组装规则）
pub async fn run_agent(agent: &AgentConfig, prompt: &str) -> AppResult<String> {
    run_agent_env(agent, prompt, &[]).await
}

/// run_agent 的带环境变量版：额外键值注入子进程。本地经 cmd.env；远程 ssh 会话
/// 环境不透传，改以 VAR='值' 前缀进远端命令行（远端 shim 把 PK_* 再转发回本机侧 pk）。
/// 派发场景用 PK_DISPATCH_TASK 标记任务 id，供 agent 的 Stop hook / pk dispatch 回传状态
pub async fn run_agent_env(
    agent: &AgentConfig,
    prompt: &str,
    envs: &[(&str, &str)],
) -> AppResult<String> {
    // 远端命令行要带的变量：显式 envs（如派发的 PK_DISPATCH_TASK）+ 共享日志文件
    // （PK_LOG_FILE；本地路径由 spawn_and_wait 的 cmd.env 注入，远程走命令行前缀）
    let mut line_envs: Vec<(String, String)> = envs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    if let Some(log_file) = crate::logshare::agent_log_file() {
        line_envs.push((
            "PK_LOG_FILE".into(),
            log_file.to_string_lossy().into_owned(),
        ));
    }
    let inv = build_invocation(agent, prompt, &line_envs);
    let timeout = Duration::from_secs(agent.timeout_secs.max(MIN_TIMEOUT_SECS));
    // 本地调用把随应用分发的 pk 所在目录前插进子进程 PATH：GUI 进程不继承登录 shell 的
    // PATH，agent 的 Bash 工具里裸名 pk 找不到（开发态在 target/debug，安装态在应用目录）；
    // 远程模式由远端 shim 负责可达，不注入
    let pk_dir = if inv.remote_host.is_none() {
        crate::commands::remote_pk::locate_pk().and_then(|p| p.parent().map(PathBuf::from))
    } else {
        None
    };
    let envs: Vec<(String, String)> = envs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    run_process(
        &inv.program,
        &inv.argv,
        inv.stdin.as_deref(),
        inv.cwd.as_deref(),
        pk_dir.as_deref(),
        &envs,
        timeout,
    )
    .await
    .map_err(|e| match &inv.remote_host {
        Some(host) => {
            // 127 = 远端 shell 找不到命令：非交互会话 PATH 常缺 brew/nvm，给出可操作指引
            let hint = if e.to_string().contains("退出码 127") {
                "（远端非交互 shell 的 PATH 里找不到该命令：把 brew/nvm 初始化写入远端 ~/.zshenv，或在设置中改用绝对路径）"
            } else {
                ""
            };
            AppError::External(format!("SSH 远程执行（{host}）失败: {e}{hint}"))
        }
        None => e,
    })
}

/// 启动外部进程并等待结束，返回 stdout。进程未找到给出可操作的提示；
/// Windows 上 npm 全局命令多为 .cmd 垫片，直接 spawn 会失败，回退 cmd /C 再试一次
/// （回退路径逐参做 cmd 安全引用，防 argv 内不可信正文的 cmd 元字符逃逸）。
/// pk_dir 非空时前插进子进程 PATH（见 run_agent）；cwd 非空时作为子进程工作目录；
/// envs 逐对注入子进程环境（远程 ssh 模式不透传）。
async fn run_process(
    program: &str,
    argv: &[String],
    stdin: Option<&str>,
    cwd: Option<&std::path::Path>,
    pk_dir: Option<&std::path::Path>,
    envs: &[(String, String)],
    timeout: Duration,
) -> AppResult<String> {
    match spawn_and_wait(program, argv, stdin, cwd, pk_dir, envs, timeout).await {
        Ok(out) => Ok(out),
        #[cfg(windows)]
        Err(AppError::Invalid(_)) => {
            // cmd /C 回退（npm 全局命令多为 .cmd 垫片，直接 spawn 失败）。argv 里可能
            // 含 {prompt} 替换进来的 IM 正文（不可信输入），cmd.exe 不认 POSIX 引用且
            // 有自己的元字符语义——逐参经 windows_cmd_quote 中和后整参双引号包裹，
            // 杜绝引号逃逸与 %展开（见函数注释）
            let mut cmd_argv = vec!["/C".to_string(), windows_cmd_quote(program)];
            cmd_argv.extend(argv.iter().map(|a| windows_cmd_quote(a)));
            spawn_and_wait("cmd", &cmd_argv, stdin, cwd, pk_dir, envs, timeout).await
        }
        Err(e) => Err(e),
    }
}

/// Linux 竞态兜底：刚写入/关闭的脚本立即 exec 偶发 ETXTBSY（Text file busy，
/// os error 26）——写端句柄在内核侧彻底释放前，exec 拒绝映射该文件。
/// 小退避重试即可根治（窗口通常亚毫秒），同时覆盖生产路径：
/// npm 刚装完的 lark-cli、setup_remote_pk 刚写好的 shim 立刻执行是同款场景。
async fn spawn_with_etxtbusy_retry(
    cmd: &mut tokio::process::Command,
    program: &str,
) -> AppResult<tokio::process::Child> {
    const ETXTBSY: i32 = 26;
    const RETRIES: u32 = 4;
    const BACKOFF: Duration = Duration::from_millis(25);
    for attempt in 0..=RETRIES {
        match cmd.spawn() {
            Ok(child) => return Ok(child),
            Err(e) if e.raw_os_error() == Some(ETXTBSY) && attempt < RETRIES => {
                log::warn!(
                    "ai: spawn「{program}」遇 Text file busy，重试 {}/{}",
                    attempt + 1,
                    RETRIES
                );
                tokio::time::sleep(BACKOFF).await;
            }
            Err(e) => return Err(spawn_error(program, e)),
        }
    }
    unreachable!("重试循环必经 Ok/Err 出口")
}

async fn spawn_and_wait(
    program: &str,
    argv: &[String],
    stdin: Option<&str>,
    cwd: Option<&std::path::Path>,
    pk_dir: Option<&std::path::Path>,
    envs: &[(String, String)],
    timeout: Duration,
) -> AppResult<String> {
    let mut cmd = tokio::process::Command::new(program);
    // 固定工作目录（不继承 GUI 进程的 cwd，见 agent_workdir）；目录配错给出可操作报错，
    // 免得落到 spawn 的 NotFound 上被误报成「命令找不到」
    if let Some(dir) = cwd {
        if !dir.is_dir() {
            return Err(AppError::Invalid(format!(
                "Agent 工作目录不存在: {}（请在设置中改正，留空则用 ~/.choose-you/workspace）",
                dir.display()
            )));
        }
        cmd.current_dir(dir);
    }
    // PATH 补齐（见 which 模块）：node 脚本 agent（claude 等）的 shebang 依赖
    // env node，GUI 精简 PATH 下会 127；pk_dir 前插让 agent 的 Bash 工具里裸名 pk 可解析
    let mut extra_dirs = pk_dir
        .map(|d| d.to_path_buf())
        .into_iter()
        .collect::<Vec<_>>();
    extra_dirs.extend(crate::which::script_host_dirs(program));
    if let Some(path) = crate::which::augmented_path(&extra_dirs) {
        cmd.env("PATH", path);
    }
    // 注入共享日志文件路径：agent 的 Bash 工具把它继承给 pk，pk 的执行轨迹
    // 写回应用日志（诊断页可见）；远程 ssh 模式下环境不透传，等价于无日志，无副作用
    if let Some(log_file) = crate::logshare::agent_log_file() {
        cmd.env("PK_LOG_FILE", log_file);
    }
    for (k, v) in envs {
        cmd.env(k, v);
    }
    cmd.args(argv)
        .stdin(if stdin.is_some() {
            std::process::Stdio::piped()
        } else {
            std::process::Stdio::null()
        })
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let mut child = spawn_with_etxtbusy_retry(&mut cmd, program).await?;
    if let Some(prompt) = stdin {
        if let Some(mut handle) = child.stdin.take() {
            let bytes = prompt.as_bytes().to_vec();
            // 独立任务写 stdin：子进程读 prompt 期间管道可能占满，内联写会死锁
            tokio::spawn(async move {
                let _ = handle.write_all(&bytes).await;
                let _ = handle.shutdown().await;
            });
        }
    }
    let waited = tokio::time::timeout(timeout, child.wait_with_output()).await;
    match waited {
        Err(_) => Err(AppError::External(format!(
            "Agent「{program}」执行超时（{} 秒），可在设置中调大超时",
            timeout.as_secs()
        ))),
        Ok(Err(e)) => Err(AppError::External(format!(
            "Agent「{program}」执行失败: {e}"
        ))),
        Ok(Ok(out)) => {
            if out.status.success() {
                String::from_utf8(out.stdout)
                    .map_err(|e| AppError::External(format!("Agent 输出不是 UTF-8: {e}")))
            } else {
                let stderr = String::from_utf8_lossy(&out.stderr);
                Err(AppError::External(format!(
                    "Agent「{program}」退出码 {}：{}",
                    out.status.code().unwrap_or(-1),
                    trunc(stderr.trim(), 300)
                )))
            }
        }
    }
}

fn spawn_error(program: &str, e: std::io::Error) -> AppError {
    if e.kind() == std::io::ErrorKind::NotFound {
        AppError::Invalid(format!(
            "找不到命令「{program}」：请先安装该 agent CLI；若已安装仍报此错，GUI 应用可能看不到终端的 PATH，请在设置里填写绝对路径"
        ))
    } else {
        AppError::External(format!("启动「{program}」失败: {e}"))
    }
}

/// agent 的输出风格各异：`claude --output-format json` 会把回答再包一层 {"result":"..."}，
/// 先解出内层文本再走常规解析
pub(crate) fn extract_payload(content: &str) -> (String, Option<String>) {
    let trimmed = content.trim();
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(inner) = v.get("result").and_then(|r| r.as_str()) {
            let session = v
                .get("session_id")
                .and_then(|s| s.as_str())
                .map(String::from);
            return (inner.to_string(), session);
        }
    }
    (trimmed.to_string(), None)
}

/// 日志截断：按字符数截断（中文安全），避免长消息刷爆 512KB 轮转日志
pub(crate) fn trunc(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// 连接测试：工具探针——让 agent 执行 pk context 并原样返回输出，
/// 一次验证命令可用 + shell 白名单 + PATH + 数据库可达
pub async fn test(agent: &AgentConfig) -> AppResult<String> {
    let out = run_agent(
        agent,
        "执行命令 pk context，并把它的标准输出原样返回，不要添加任何解释。",
    )
    .await?;
    let (content, _) = extract_payload(&out);
    if content.contains("openTasks") {
        Ok("Agent 调用成功，pk 工具链已连通（context 正常返回）".into())
    } else {
        // 带上 agent 的实际回复片段：被工具白名单拦下 / pk 不在 PATH / 模型自说自话，一眼可辨
        Err(AppError::External(format!(
            "Agent 调用成功但未返回 pk context 输出——请确认 agent 无头模式允许执行 pk 命令（工具白名单，如 claude 附加参数 --allowedTools Bash(pk:*)，注意参数按空白切分、不要加引号；本机 pk 目录已自动注入 agent 的 PATH，若 agent 仍找不到 pk，开发态多为占位未构建，先跑 cargo build --bin pk）。agent 回复片段：{}",
            trunc(content.trim(), 200)
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::ai::AgentRemote;

    #[test]
    fn spawn_respects_and_validates_workdir() {
        use std::os::unix::fs::PermissionsExt;

        let dir = std::env::temp_dir().join(format!("pk-cwd-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // macOS 的 /var 是 /private/var 的符号链接，pwd 输出真实路径，统一 canonicalize 再比
        let dir = dir.canonicalize().unwrap();
        let script = dir.join("pwd-agent.sh");
        std::fs::write(&script, "#!/bin/sh\npwd\n").unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();

        // 子进程确实运行在指定 cwd
        let out = tauri::async_runtime::block_on(run_process(
            script.to_string_lossy().as_ref(),
            &[],
            None,
            Some(dir.as_path()),
            None,
            &[],
            Duration::from_secs(10),
        ))
        .unwrap();
        assert_eq!(
            std::path::Path::new(out.trim()),
            dir.as_path(),
            "agent 应运行在配置的工作目录"
        );

        // 目录不存在给出可操作报错，而不是误报命令找不到
        let missing = dir.join("no-such-subdir");
        let err = tauri::async_runtime::block_on(run_process(
            script.to_string_lossy().as_ref(),
            &[],
            None,
            Some(missing.as_path()),
            None,
            &[],
            Duration::from_secs(10),
        ))
        .unwrap_err();
        assert!(
            err.to_string().contains("工作目录不存在"),
            "目录配错时报工作目录: {err}"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// ETXTBSY 竞态根治（CI ubuntu 偶发 Text file busy）：写端 fd 压住脚本制造
    /// 稳定 ETXTBSY，60ms 后异步释放——必须落在重试窗口（4×25ms）内成功 exec
    #[cfg(unix)]
    #[test]
    fn spawn_retries_etxtbusy() {
        use std::os::unix::fs::PermissionsExt;

        tauri::async_runtime::block_on(async {
            let dir = std::env::temp_dir().join(format!("pk-etxtbusy-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            // macOS 的 /var 是 /private/var 符号链接，pwd 输出真实路径，统一 canonicalize 再比
            let dir = dir.canonicalize().unwrap();
            let script = dir.join("hold-agent.sh");
            std::fs::write(&script, "#!/bin/sh\npwd\n").unwrap();
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();

            // 写端句柄不关 → exec 持续报 ETXTBSY；60ms 后释放（早于末次重试 75ms，
            // 晚于前三次 0/25/50ms，任何调度漂移下都至少压住一次重试）
            let hold = std::fs::OpenOptions::new()
                .write(true)
                .open(&script)
                .unwrap();
            let release = tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(60)).await;
                drop(hold);
            });
            let out = run_process(
                script.to_string_lossy().as_ref(),
                &[],
                None,
                Some(dir.as_path()),
                None,
                &[],
                Duration::from_secs(10),
            )
            .await
            .unwrap();
            release.await.unwrap();
            assert_eq!(
                std::path::Path::new(out.trim()),
                dir.as_path(),
                "重试窗口内应成功执行: {out}"
            );

            std::fs::remove_dir_all(&dir).ok();
        });
    }

    // ---- extract_payload：claude JSON 信封解包（tools 模式仅提取 session_id） ----

    /// claude 信封（--output-format json）解出内层 result；session_id 随信封带回（遥测回链用）
    #[test]
    fn extract_payload_unwraps_envelope_and_session_id() {
        let inner = r#"{"results":[{"messageId":"m1","action":"todo"}]}"#;
        let wrapped = serde_json::json!({ "result": inner, "session_id": "sess-abc" }).to_string();
        let (content, session) = extract_payload(&wrapped);
        assert_eq!(content, inner);
        assert_eq!(session.as_deref(), Some("sess-abc"));
        // 无信封的普通输出原样返回、无会话 id
        let (plain, none) = extract_payload(inner);
        assert_eq!(plain, inner);
        assert!(none.is_none());
    }

    // ---- 进程调用链（unix 下用 /bin/sh 脚本模拟 agent） ----

    #[cfg(unix)]
    mod process_tests {
        use super::*;
        use crate::ai::build_tools_prompt;
        use crate::ai::AiMessage;
        use std::io::Write as _;

        /// 写一个临时 agent 脚本：extra_shell 在输出 payload 前执行（sleep / 记录 stdin / 退出非零…）
        fn fake_agent(name: &str, extra_shell: &str, payload: &str) -> AgentConfig {
            let dir = std::env::temp_dir().join(format!("pk-agent-test-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let script = dir.join(format!("{name}.sh"));
            let mut f = std::fs::File::create(&script).unwrap();
            writeln!(f, "#!/bin/sh\n{extra_shell}\nprintf '%s' '{payload}'").unwrap();
            drop(f);
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            AgentConfig {
                id: name.into(),
                name: name.into(),
                command: script.to_string_lossy().into_owned(),
                ..Default::default()
            }
        }

        /// 用分类提示词跑一次 agent（验证提示词经 stdin/argv 送达）
        fn run_classify_prompt(agent: &AgentConfig) {
            let prompt = build_tools_prompt(
                agent,
                &[AiMessage::simple("m1", "张三", "明天上午10点开周会")],
            );
            let _ = tauri::async_runtime::block_on(run_agent(agent, &prompt));
        }

        /// SSH 远程执行：经假 ssh 程序（PK_SSH_BIN 注入）组装 BatchMode/--、提示词走 stdin、
        /// stdout 的 JSON 照常解析
        #[test]
        fn remote_agent_runs_via_ssh_with_stdin_prompt() {
            let dir = std::env::temp_dir().join(format!("pk-agent-test-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let ssh = dir.join("fake-ssh.sh");
            let marker = dir.join("ssh-argv.txt");
            let stdin_marker = dir.join("ssh-stdin.txt");
            let script = format!(
                "#!/bin/sh\nprintf '%s\\n' \"$@\" > {argv}\ncat > {stdin}\nprintf '%s' '{payload}'\n",
                argv = marker.to_string_lossy(),
                stdin = stdin_marker.to_string_lossy(),
                payload = r#"{"results":[{"messageId":"m1","action":"todo","title":"远程待办"}]}"#,
            );
            std::fs::write(&ssh, script).unwrap();
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&ssh, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            // PK_SSH_BIN 指向假 ssh（build_invocation 读取；进程内全局，本测试独占语义清晰）
            std::env::set_var("PK_SSH_BIN", &ssh);

            let agent = AgentConfig {
                id: "r".into(),
                name: "远程".into(),
                command: "claude".into(),
                args: "-p {prompt}".into(),
                history_args: String::new(),
                timeout_secs: 30,
                enabled: true,
                workdir: String::new(),
                remote: Some(AgentRemote {
                    host: "dev@box".into(),
                    ..Default::default()
                }),
            };
            let out = tauri::async_runtime::block_on(run_agent(&agent, "明天交周报")).unwrap();
            std::env::remove_var("PK_SSH_BIN");

            let argv = std::fs::read_to_string(&marker).unwrap();
            assert!(argv.contains("dev@box"), "目标主机进 argv: {argv}");
            assert!(argv.contains("--"), "命令分隔符进 argv: {argv}");
            assert!(argv.contains("BatchMode=yes"), "免交互开关: {argv}");
            let lines: Vec<&str> = argv.lines().collect();
            assert_eq!(
                &lines[lines.len() - 4..],
                &["exec", "\"$SHELL\"", "-lc", "'claude -p'"],
                "远端命令包登录 shell，占位符元素剔除后以 command -p 结尾: {argv}"
            );
            assert!(!argv.contains("明天交周报"), "提示词绝不进 argv");
            let stdin_sent = std::fs::read_to_string(&stdin_marker).unwrap();
            assert!(
                stdin_sent.contains("明天交周报"),
                "提示词经 stdin 转发: {stdin_sent}"
            );
            assert!(out.contains("远程待办"), "stdout 照常解析: {out}");
        }

        /// args 无 {prompt} 占位符时提示词必须经 stdin 送达（脚本把 stdin 存文件验证）
        #[test]
        fn prompt_is_delivered_via_stdin_without_placeholder() {
            let dir = std::env::temp_dir().join(format!("pk-agent-test-{}", std::process::id()));
            let marker = dir.join("stdin.txt");
            let script = format!("cat > {}", marker.to_string_lossy());
            let agent = fake_agent("stdin", &script, "{}");
            run_classify_prompt(&agent);
            let stdin = std::fs::read_to_string(&marker).unwrap();
            assert!(
                stdin.contains("待办事项提取助手") && stdin.contains("发送者：张三"),
                "完整提示词经 stdin 传给 agent: {stdin}"
            );
        }

        /// args 带 {prompt} 占位符时提示词进 argv（脚本把 $1 存文件验证）
        #[test]
        fn prompt_placeholder_goes_into_argv() {
            let dir = std::env::temp_dir().join(format!("pk-agent-test-{}", std::process::id()));
            let marker = dir.join("argv.txt");
            let script = format!("printf '%s' \"$1\" > {}", marker.to_string_lossy());
            let mut agent = fake_agent("argv", &script, "{}");
            agent.args = "{prompt}".into();
            run_classify_prompt(&agent);
            let argv = std::fs::read_to_string(&marker).unwrap();
            assert!(
                argv.contains("待办事项提取助手"),
                "{{prompt}} 占位符替换为完整提示词: {argv}"
            );
        }

        #[test]
        fn run_agent_maps_nonzero_exit_to_external_error() {
            let agent = fake_agent("boom", "echo 'model exploded' >&2; exit 3", "{}");
            let err = tauri::async_runtime::block_on(run_agent(&agent, "hi")).unwrap_err();
            assert!(
                matches!(err, AppError::External(_)),
                "非零退出码归 external: {err}"
            );
            assert!(
                err.to_string().contains("model exploded"),
                "stderr 片段带进错误信息: {err}"
            );
        }

        #[test]
        fn run_process_times_out_slow_agent() {
            // 直接测 run_process 的超时（run_agent 有 10 秒下限，单测等不起）
            let agent = fake_agent("slow", "sleep 10", "{}");
            let started = std::time::Instant::now();
            let err = tauri::async_runtime::block_on(run_process(
                &agent.command,
                &[],
                None,
                None,
                None,
                &[],
                Duration::from_secs(1),
            ))
            .unwrap_err();
            assert!(err.to_string().contains("超时"), "超时给出可读信息: {err}");
            assert!(
                started.elapsed().as_secs() < 8,
                "超时及时返回而不是等进程结束"
            );
        }

        #[test]
        fn run_agent_reports_missing_command_with_hint() {
            let agent = AgentConfig {
                command: "definitely-not-on-path-xyz".into(),
                ..Default::default()
            };
            let err = tauri::async_runtime::block_on(run_agent(&agent, "hi")).unwrap_err();
            assert!(
                matches!(err, AppError::Invalid(_)),
                "找不到命令归为输入错误并给安装提示: {err}"
            );
            assert!(err.to_string().contains("安装"));
        }

        /// 连接测试（工具探针）：agent 能跑 pk context 并带回输出即连通；
        /// 自说自话不带 openTasks 的报可操作错误
        #[test]
        fn test_probe_verifies_pk_toolchain() {
            let ok = fake_agent("test_ok", "", r#"{"openTasks":[]}"#);
            let msg = tauri::async_runtime::block_on(test(&ok)).unwrap();
            assert!(msg.contains("pk 工具链已连通"), "{msg}");

            let blind = fake_agent("test_blind", "", "我不方便执行命令");
            let err = tauri::async_runtime::block_on(test(&blind)).unwrap_err();
            assert!(
                err.to_string().contains("pk context"),
                "错误指向 agent 权限/工具链: {err}"
            );
        }

        /// 本地调用注入 pk 目录：agent 子进程里裸名 pk 可解析（GUI 进程 PATH 缺失的回归）
        #[test]
        fn local_agent_sees_injected_pk_dir_on_path() {
            let dir = std::env::temp_dir().join(format!("pk-path-test-{}", std::process::id()));
            let pk_dir = dir.join("bundled");
            std::fs::create_dir_all(&pk_dir).unwrap();
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::write(pk_dir.join("pk"), "#!/bin/sh\nprintf 'openTasks:[]'").unwrap();
                std::fs::set_permissions(pk_dir.join("pk"), std::fs::Permissions::from_mode(0o755))
                    .unwrap();
            }
            // 假 agent 即一段 shell：直接跑裸名 pk，PATH 未注入时必然 command not found
            let agent = dir.join("agent.sh");
            std::fs::write(&agent, "#!/bin/sh\npk context\n").unwrap();
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&agent, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            let out = tauri::async_runtime::block_on(run_process(
                agent.to_string_lossy().as_ref(),
                &[],
                None,
                None,
                Some(&pk_dir),
                &[],
                Duration::from_secs(10),
            ))
            .unwrap();
            assert!(
                out.contains("openTasks"),
                "注入的 pk 目录应排在子进程 PATH 首位，裸名 pk 可执行: {out}"
            );
            std::fs::remove_dir_all(&dir).ok();
        }

        /// envs 逐对注入子进程环境（派发的 PK_DISPATCH_TASK 回传标记走这里）
        #[test]
        fn run_process_injects_env_pairs() {
            let agent = fake_agent("env", "printf '%s' \"$PK_DISPATCH_TASK\"; exit 0", "unused");
            let out = tauri::async_runtime::block_on(run_agent_env(
                &agent,
                "hi",
                &[("PK_DISPATCH_TASK", "42")],
            ))
            .unwrap();
            assert_eq!(out.trim(), "42", "环境变量注入子进程: {out}");
        }
    }
}
