//! 派发命令行组装（纯函数，独立测试）：交互参数清洗、agent 命令行（POSIX /
//! PowerShell 两版）、tmux attach-or-create / 注入行与 ssh argv 形态。
use crate::ai::{self, posix_quote, quote_cd_target, AgentRemote};

/// 交互启动参数：历史参数去掉会话恢复类开关——派发开新会话，不是回放历史
/// （claude 的 --resume 不进派发命令行；--resume-id 后跟的会话 id 一并剔除；
/// pi 的 --session/--session-id 同为带值恢复旗标，值一并剔除）
pub(crate) fn interactive_args(history_args: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut skip_value = false;
    for tok in history_args.split_whitespace() {
        if skip_value {
            skip_value = false;
            continue;
        }
        match tok {
            "--resume-id" | "--session" | "--session-id" => skip_value = true,
            "--resume" | "resume" | "--resume-picker" | "-r" => {}
            _ => out.push(tok.to_string()),
        }
    }
    out
}

/// agent 命令行（本地/远端同一份）：命令 + 交互参数 + prompt 作为首条输入（整体引用）。
/// 目标是 POSIX shell（本地 macOS/Linux 终端、远端 ssh 登录 shell）
pub(crate) fn agent_line(command: &str, args: &[String], prompt: &str) -> String {
    let mut line = std::iter::once(command)
        .chain(args.iter().map(String::as_str))
        .map(posix_quote)
        .collect::<Vec<_>>()
        .join(" ");
    line.push(' ');
    line.push_str(&posix_quote(prompt));
    line
}

/// agent 命令行的 Windows 本地终端版：目标 shell 是 PowerShell（spawn_line_in_terminal
/// 的 powershell -Command 路径）——逐参经 windows_ps_quote 成单引号字面量（不可信
/// prompt 正文里能逃出 PS 字面量的唯一字符 `'` 双写转义；`"`/`%`/控制字符因整行仍过
/// cmd 开窗层与 wt 重组层而沿用全角中和，其余 PS 元字符在单引号内均为字面量，
/// 不存在逃逸路径）。行首 `&` 是 PS 调用符：语句首 token 为带引号字符串时 PS 走
/// 表达式模式、不会执行命令。PS 5.1 无 `&&`，cd 串联见 local_cd_prefix 的 `;` 分隔
pub(crate) fn agent_line_windows(command: &str, args: &[String], prompt: &str) -> String {
    let mut line = std::iter::once(command)
        .chain(args.iter().map(String::as_str))
        .map(crate::ai::windows_ps_quote)
        .collect::<Vec<_>>()
        .join(" ");
    line.push(' ');
    line.push_str(&crate::ai::windows_ps_quote(prompt));
    format!("& {line}")
}

/// 落库/提示用的命令行摘要：prompt 替换为截断版（按字符截，中文安全）
pub(crate) fn summarize_line(command: &str, args: &[String], prompt: &str) -> String {
    let head: String = prompt.chars().take(48).collect();
    let tail = if prompt.chars().count() > 48 {
        "…"
    } else {
        ""
    };
    agent_line(command, args, &format!("{head}{tail}"))
}

/// tmux 会话名：一任务一会话，attach-or-create 幂等（断开重连不丢，§5.2）
pub(crate) fn tmux_session_name(task_id: i64) -> String {
    format!("pk-{task_id}")
}

/// ssh argv 的密钥/端口/主机段（-- 之后到远端命令行之前）：
/// 与 history_invocation 同构——exec "$SHELL" -lc 让 brew/nvm 的 PATH 可见
fn push_ssh_target(remote: &AgentRemote, argv: &mut Vec<String>) {
    if let Some(key) = remote
        .key_path
        .as_deref()
        .map(str::trim)
        .filter(|k| !k.is_empty())
    {
        argv.push("-i".into());
        argv.push(key.to_string());
    }
    if remote.port != 0 && remote.port != 22 {
        argv.push("-p".into());
        argv.push(remote.port.to_string());
    }
    // -- 在 host 之前：以 - 开头的 host 不被当成 ssh 选项
    argv.push("--".into());
    argv.push(remote.host.trim().to_string());
    argv.push("exec".into());
    argv.push("\"$SHELL\"".into());
    argv.push("-lc".into());
}

/// 终端里跑的 ssh（交互式，不设 BatchMode：密钥未就绪允许在终端里输密码）：
/// 远端登录 shell 里 tmux attach-or-create，-c 指定工作目录（空则远端登录目录）。
/// 会话历史回连远程交互派发共用此 argv
pub(crate) fn tmux_attach_argv(remote: &AgentRemote, session: &str, workdir: &str) -> Vec<String> {
    let mut argv = vec![
        "-tt".to_string(),
        "-o".to_string(),
        "ConnectTimeout=10".to_string(),
    ];
    push_ssh_target(remote, &mut argv);
    let mut line = format!("tmux new -A -s {}", posix_quote(session));
    if !workdir.trim().is_empty() {
        // 目录不存在时 tmux -c 起不来会话（注入侧等 10s 超时）：先 mkdir -p 再
        // attach-or-create，幂等，会话已存在时只是空跑一次 mkdir
        line = format!(
            "mkdir -p {} && {line} -c {}",
            quote_cd_target(workdir.trim()),
            quote_cd_target(workdir.trim())
        );
    }
    argv.push(posix_quote(&line));
    argv
}

/// 降级路径（远端无 tmux）：直接 ssh -tt 启动 agent；会话不持久，断开即结束
pub(crate) fn direct_ssh_argv(remote: &AgentRemote, workdir: &str, line: &str) -> Vec<String> {
    let mut argv = vec![
        "-tt".to_string(),
        "-o".to_string(),
        "ConnectTimeout=10".to_string(),
    ];
    push_ssh_target(remote, &mut argv);
    let mut remote_line = line.to_string();
    if !workdir.trim().is_empty() {
        remote_line = format!("{}{remote_line}", ai::remote_workdir_prefix(workdir.trim()));
    }
    argv.push(posix_quote(&remote_line));
    argv
}

/// 注入行（应用另起 BatchMode ssh 执行）：先等 tmux 会话就绪——终端侧的 ssh 可能还在
/// 连接或等密码（上限 50 × 0.2s = 10 秒）；就绪后把派发命令行字面敲进会话并回车
/// （send-keys -l 按字面注入，防远端 shell 转义）
pub(crate) fn tmux_inject_line(session: &str, line: &str) -> String {
    let s = posix_quote(session);
    format!(
        "i=0; until tmux has-session -t {s} 2>/dev/null; do i=$((i+1)); [ $i -ge 50 ] && exit 1; sleep 0.2; done; \
         tmux send-keys -t {s} -l {}; tmux send-keys -t {s} Enter",
        posix_quote(line)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interactive_args_strip_resume_flags() {
        assert_eq!(
            interactive_args("--resume"),
            Vec::<String>::new(),
            "claude 的 --resume 剔除（派发开新会话）"
        );
        assert_eq!(
            interactive_args("--model opus --resume-id x"),
            vec!["--model".to_string(), "opus".to_string()],
            "其他开关原样保留"
        );
        assert_eq!(
            interactive_args("-r --session 9f2a --session-id b3c"),
            Vec::<String>::new(),
            "pi 的 -r 与 --session/--session-id（连带值）剔除"
        );
        assert!(interactive_args("").is_empty());
    }

    #[test]
    fn agent_line_quotes_prompt_and_args() {
        let line = agent_line(
            "claude",
            &["--model".into(), "opus".into()],
            "处理这条待办：'引用' 与\n换行",
        );
        assert_eq!(
            line,
            "claude --model opus '处理这条待办：'\\''引用'\\'' 与\n换行'"
        );
        // 摘要只保留 prompt 前 48 字符 + 省略号，完整正文不进库
        let long_prompt: String = "字".repeat(100);
        let summary = summarize_line("claude", &[], &long_prompt);
        assert!(summary.contains('…') && !summary.contains(&long_prompt));
    }

    /// Windows 终端行（目标 shell = PowerShell）的单引号字面量安全性：不可信
    /// prompt 正文里能逃出 PS 字面量的唯一字符 `'` 双写转义后引号永远成对闭合；
    /// `"`/`%` 因整行仍过 cmd 开窗层（start）与 wt 重组层而维持全角中和（M1
    /// 回归迁移），`$()`/反引号在单引号内是字面量、原样保留
    #[test]
    fn agent_line_windows_quotes_as_ps_literals() {
        let line = agent_line_windows(
            "claude.ps1",
            &["--model".into(), "opus".into()],
            "任务：a' & calc\n$(calc) %PATH% \"x\" `b`",
        );
        assert_eq!(
            line, "& 'claude.ps1' '--model' 'opus' '任务：a'' & calc $(calc) ％PATH％ ＂x＂ `b`'",
            "行首 & 调用符、逐参单引号、' 双写、换行压平、cmd 危险字符仍中和"
        );
        assert_eq!(line.matches('\'').count() % 2, 0, "单引号成对闭合: {line}");
        assert!(!line.contains('\n'), "换行被压平: {line}");
    }

    #[test]
    fn tmux_argv_and_inject_line_shapes() {
        let remote = AgentRemote {
            host: "dev@buildbox".into(),
            port: 2222,
            key_path: Some("~/.ssh/id_ed25519".into()),
            tunnel: None,
            persistent: false,
        };
        // attach：-tt + 登录 shell + attach-or-create，带 -c 工作目录
        let argv = tmux_attach_argv(&remote, "pk-5", "~/lab repo");
        assert_eq!(argv[0], "-tt");
        assert!(
            !argv.contains(&"BatchMode=yes".to_string()),
            "交互式不设免密闸"
        );
        assert!(
            argv.iter().skip_while(|a| *a != "--").any(|a| a == "exec"),
            "远端命令包登录 shell"
        );
        let last = argv.last().unwrap();
        assert!(last.contains("tmux new -A -s pk-5"), "幂等 attach: {last}");
        assert!(
            last.contains("~/'\\''lab repo'\\''"),
            "含空格目录经引用进 -c: {last}"
        );
        // 目录不存在时 tmux -c 起不来会话：先 mkdir -p 再 tmux（幂等，attach 已存在会话时无害）
        assert!(
            last.contains("mkdir -p ~/'\\''lab repo'\\'' && tmux new -A -s pk-5"),
            "attach 前先建目录: {last}"
        );
        // 工作目录为空时不带 -c（远端登录目录）
        assert!(
            !tmux_attach_argv(&remote, "pk-5", "")
                .last()
                .unwrap()
                .contains(" -c "),
            "空目录省略 -c"
        );
        // 降级：mkdir + cd 前缀 + agent 行，整行引用交给远端登录 shell
        let argv = direct_ssh_argv(&remote, "~/lab", "claude-x '处理待办'");
        let last = argv.last().unwrap();
        assert!(
            last.contains("mkdir -p ~/lab && cd ~/lab && claude-x"),
            "{last}"
        );
        assert!(
            last.starts_with('\''),
            "整行整体引用（-lc 只吞一个词的回归）: {last}"
        );
        // 注入：等待循环 + 字面 send-keys + 回车
        let inject = tmux_inject_line("pk-5", "claude '处理待办'");
        assert!(
            inject.contains("until tmux has-session -t pk-5"),
            "{inject}"
        );
        assert!(inject.contains("[ $i -ge 50 ] && exit 1"), "{inject}");
        assert!(
            inject.contains("tmux send-keys -t pk-5 -l 'claude '\\''处理待办'\\'''"),
            "命令行按字面注入: {inject}"
        );
        assert!(inject.ends_with("tmux send-keys -t pk-5 Enter"), "{inject}");
    }
}
