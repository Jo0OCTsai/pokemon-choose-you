//! 无头/历史调用的命令行组装：本地 spawn argv、SSH 远程包装、跨平台 shell 引用
//! 规则与工作目录处理。runner 消费 build_invocation 的产物驱动进程执行。
use std::path::PathBuf;

use super::config::AgentConfig;

/// ssh 客户端程序名：PK_SSH_BIN 可覆盖（测试注入/Windows 指向 plink 的 wrapper 等）
pub fn ssh_bin() -> String {
    std::env::var("PK_SSH_BIN").unwrap_or_else(|_| "ssh".into())
}

/// 一次无头调用的实际命令行：本地直接执行 / 远程包一层 ssh
pub(crate) struct Invocation {
    pub(crate) program: String,
    pub(crate) argv: Vec<String>,
    pub(crate) stdin: Option<String>,
    /// 出错时附加上下文（远程主机）
    pub(crate) remote_host: Option<String>,
    /// 本地执行的工作目录（远程分支无意义：cd 已内嵌进远端命令行）
    pub(crate) cwd: Option<PathBuf>,
}

/// 组装实际执行的命令行（纯函数，独立测试）。
/// - 本地：args 中的 {prompt} 替换为提示词；未出现时提示词走标准输入；
///   裸命令名先经 which::resolve 补扫 GUI 进程缺失的 PATH（macOS Dock/Finder 启动
///   看不到 Homebrew/nvm 里的 claude 等），显式路径原样透传；envs 经 cmd.env 注入子进程
/// - 远程：`ssh -o BatchMode=yes -o ConnectTimeout=10 [-i key] [-p port] host -- command args...`；
///   提示词一律走标准输入——ssh 会把 argv 拼接后交远端 shell 重解析，长提示词里的引号/换行必被打碎，
///   stdin 转发没有这个问题。args 中带 {prompt} 的元素剔除（如 `claude -p {prompt}` → `claude -p`，
///   -p 本身支持读 stdin），保证语义等价；envs 以 `VAR='值'` 前缀进远端命令行
///   （ssh 会话环境不透传，只能这样带给远端 agent；远端 shim 再把 PK_* 转发回本机侧 pk）
pub(crate) fn build_invocation(
    agent: &AgentConfig,
    prompt: &str,
    envs: &[(String, String)],
) -> Invocation {
    let args: Vec<String> = agent.args.split_whitespace().map(String::from).collect();
    let remote = agent.remote.as_ref().filter(|r| !r.host.trim().is_empty());
    match remote {
        None => {
            let via_stdin = !args.iter().any(|a| a.contains("{prompt}"));
            let argv: Vec<String> = args.iter().map(|a| a.replace("{prompt}", prompt)).collect();
            Invocation {
                program: crate::which::resolve(&agent.command),
                argv,
                stdin: via_stdin.then(|| prompt.to_string()),
                remote_host: None,
                cwd: agent_workdir(agent),
            }
        }
        Some(r) => {
            let mut argv = vec![
                "-o".to_string(),
                "BatchMode=yes".to_string(), // 免交互：密钥不通直接失败，不挂起等密码
                "-o".to_string(),
                "ConnectTimeout=10".to_string(),
            ];
            if let Some(key) = r
                .key_path
                .as_ref()
                .map(|k| k.trim())
                .filter(|k| !k.is_empty())
            {
                argv.push("-i".to_string());
                argv.push(key.to_string());
            }
            if r.port != 0 && r.port != 22 {
                argv.push("-p".to_string());
                argv.push(r.port.to_string());
            }
            if let Some(tp) = r.tunnel.filter(|t| *t != 0) {
                // 反向隧道：远程侧 127.0.0.1:<tp> ⇄ 本机 sshd，供远程 pk shim 回连（仅本连接存活）。
                // 常驻隧道开启时这里仍照带——常驻连接已占住远程端口时 ssh 仅告警不失败，
                // 而常驻隧道断线的空窗期这条按需隧道正好兜底，shim 不断流
                argv.push("-R".to_string());
                argv.push(format!("127.0.0.1:{tp}:127.0.0.1:22"));
            }
            // -- 在 host 之前：以 - 开头的 host 不被当成 ssh 选项；其后整行是远端命令
            argv.push("--".to_string());
            argv.push(r.host.trim().to_string());
            // 远端经登录 shell 执行：ssh 非交互会话只加载 .zshenv/.bashrc 之外的初始化，
            // brew/nvm 的 PATH 常在 .zprofile/.bash_profile（登录时）里，包一层 $SHELL -lc 才找得到命令
            argv.push("exec".to_string());
            argv.push("\"$SHELL\"".to_string());
            argv.push("-lc".to_string());
            let env_prefix = env_prefix_line(envs);
            let mut remote_line = std::iter::once(agent.command.as_str())
                .chain(args.iter().map(String::as_str))
                .filter(|a| !a.contains("{prompt}"))
                .map(posix_quote)
                .collect::<Vec<_>>()
                .join(" ");
            if !env_prefix.is_empty() {
                // VAR='值' 前缀贴在 agent 命令前（env 赋值只作用于这条命令）；
                // cd 之后再前缀，赋值不泄漏进远端登录 shell 的后续会话
                remote_line = format!("{env_prefix} {remote_line}");
            }
            // 工作目录是远程机器上的路径：先建目录再 cd 前缀进远端命令行
            // （本地 cwd 管不到远端；远端无 create_dir_all 兜底，见 remote_workdir_prefix）
            if !agent.workdir.trim().is_empty() {
                remote_line = format!(
                    "{}{remote_line}",
                    remote_workdir_prefix(agent.workdir.trim())
                );
            }
            // 整行再整体引用：ssh 会把 argv 用空格拼接后交远端 shell 重解析，
            // 不整体引用时 -lc 只吞到第一个词（如 `claude`），其余参数全被降级成位置参数丢失
            // ——单命令侥幸无感（claude 管道 stdin 等价 -p），带 --allowedTools 等参数时必错
            argv.push(posix_quote(&remote_line));
            Invocation {
                program: ssh_bin(),
                argv,
                stdin: Some(prompt.to_string()),
                remote_host: Some(r.host.clone()),
                cwd: None,
            }
        }
    }
}

/// 远端命令行的环境变量前缀（`VAR='值' VAR2='值2' `，空 envs 返回空串）。
/// 键只认 `[A-Za-z_][A-Za-z0-9_]*`（注入面收敛到应用自身的常量键），
/// 值经 posix_quote 由远端登录 shell 还原
fn env_prefix_line(envs: &[(String, String)]) -> String {
    envs.iter()
        .filter(|(k, _)| {
            !k.is_empty()
                && k.chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
                && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        })
        .map(|(k, v)| format!("{k}={}", posix_quote(v)))
        .collect::<Vec<_>>()
        .join(" ")
}

/// agent 进程的工作目录：显式配置优先（~ 前缀展开为主目录），缺省用归一化根下的
/// workspace/ 子目录——data/、logs/ 这些通用名不落在 agent 可写范围内，agent 自建
/// 同名目录也不会踩到机器状态。
/// GUI 进程的 cwd 不可控——Dock/Finder 启动时是 /，开发态是 src-tauri——
/// 必须显式指定，agent 的相对路径操作（读写文件、git 等）才不会落在随机位置
pub(crate) fn agent_workdir(agent: &AgentConfig) -> Option<PathBuf> {
    let configured = agent.workdir.trim();
    if configured.is_empty() {
        let dir = crate::db::app_home().map(|h| h.join(crate::db::WORKSPACE_SUBDIR));
        if let Some(d) = &dir {
            std::fs::create_dir_all(d).ok();
        }
        return dir;
    }
    if let Some(rest) = configured.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return Some(home.join(rest));
        }
    }
    Some(PathBuf::from(configured))
}

/// cd 目标的 shell 引用：保留前导 ~ 不加引号（要留给 shell 展开），其余走 posix_quote。
/// 单独的 ~ 也保持裸写——posix_quote 会把它包进引号，变成字面量后 cd 失效。
pub(crate) fn quote_cd_target(dir: &str) -> String {
    if dir == "~" {
        "~".to_string()
    } else if let Some(rest) = dir.strip_prefix("~/") {
        format!("~/{}", posix_quote(rest))
    } else {
        posix_quote(dir)
    }
}

/// 远端命令行的工作目录前缀（含结尾 " && "）：先 mkdir -p 再 cd。远端没有本地
/// agent_workdir 的 create_dir_all 兜底，目录不存在时 cd 失败 && 短路会让整条
/// 远端命令瞬间退出——无头派发表现为空输出，历史/交互派发表现为终端一闪而过
/// （回归：远程 agent 历史记录打不开）。mkdir 失败（路径被文件占用/无权限）时
/// 与原 cd 失败同构：短路不执行 agent
pub(crate) fn remote_workdir_prefix(dir: &str) -> String {
    let t = quote_cd_target(dir);
    format!("mkdir -p {t} && cd {t} && ")
}

/// POSIX 单引号引用：ssh 把 argv 拼接后交远端 shell 重解析，含特殊字符的参数须整体引用
/// （commands/skills 的远程技能检查/安装同用）
pub(crate) fn posix_quote(s: &str) -> String {
    let safe = !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_./=@:%+".contains(&b));
    if safe {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', r"'\''"))
    }
}

/// Windows cmd.exe 场景的中和映射：`"` 会关闭 cmd 的引用态、`%` 会被环境变量展开、
/// 控制字符会打断命令行——这三类没有可靠的转义方案，替换为全角同形字（对送 LLM 的
/// 提示词只是轻微形变，不损语义）。其余元字符（& | < > ^ ( ) !）在双引号内对 cmd
/// 均为字面量，交给外层双引号包裹防护（见 windows_cmd_quote）。
/// 仅 Windows 消费（无头 cmd /C 回退），其他平台保留编译与测试
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn windows_neutralize(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '"' => '＂',
            '%' => '％',
            '\n' | '\r' | '\t' => ' ',
            _ => c,
        })
        .collect()
}

/// Windows cmd.exe 的参数引用（安全侧，用于无头调用的 cmd /C 回退——npm 全局
/// 命令多为 .cmd 垫片）：先经 windows_neutralize 消灭无法转义的字符，再无条件
/// 双引号包裹——引号内 cmd 元字符均为字面量，不存在逃逸路径。注意与直接 spawn
/// 的 argv 传递互斥使用：CreateProcess 不重解析参数，直接 spawn 时动原文反而
/// 破坏数据。交互终端已换 PowerShell（见 windows_ps_quote），此函数仅剩
/// cfg(windows) 的无头回退消费，其他平台保留编译与测试
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn windows_cmd_quote(s: &str) -> String {
    format!("\"{}\"", windows_neutralize(s))
}

/// PowerShell 单引号字符串字面量的引用（Windows 本地交互终端的目标 shell，
/// 见 integrations::spawn_powershell_window）：先沿用 windows_neutralize 消灭
/// `"`/`%`/控制字符——整行仍要过 `cmd /C start` 开窗器，cmd 在自身解析阶段
/// 不认识 PS 规则（`"` 翻转引用态、`%` 环境展开），这三类必须维持 cmd 时代的
/// 中和；wt.exe 路径同样因 wt 重组命令行不转义内嵌引号而依赖此中和。之后按
/// PS 单引号字面量包裹，唯一特殊字符 `'` 双写 `''` 转义（`$`/`` ` ``/`&` 等
/// 在单引号内对 PS 均为字面量，不构成逃逸）。
///
/// 隐式不变量：cmd 层对 `& | ^ < > ( )` 的防护来自 Rust 把整行作为单个 argv
/// 元素编码时的成对双引号（EscapeArg 在含空白时包裹）——现有调用方产出的行
/// 必然含空白（参数间空格、cd 前缀），若未来出现「无空白整行且含 cmd 元字符」
/// 的构造须重新评估。
pub(crate) fn windows_ps_quote(s: &str) -> String {
    format!("'{}'", windows_neutralize(s).replace('\'', "''"))
}

/// 把会话 id 适配进历史参数（agent 级参数，本地远程共用）：
/// - `--resume` / `resume`（claude 语法）：id 插到该参数后 —— `claude --resume <id>`
/// - pi：`-r`/`--resume` 是会话选择器（不带 id 形态），换成 `--session <id>`；
///   已配 `--session`/`--session-id` 时 id 直接插到其后
/// - 无可识别的恢复参数：不注入（如 opencode 历史参数为空，直接启动）
fn adapt_history_args(args: &mut Vec<String>, session: &str, kind: Option<&str>) {
    if kind == Some("pi") {
        if let Some(i) = args
            .iter()
            .position(|a| a == "-r" || a == "--resume" || a == "--session" || a == "--session-id")
        {
            // 选择器旗标换成 --session（按 id 打开会话）；本就带 id 位的旗标保持
            if args[i] == "-r" || args[i] == "--resume" {
                args[i] = "--session".into();
            }
            // 紧跟其后插入而非追加到末尾：用户在历史参数后还配了别的开关时，
            // id 混进末尾会被当成无名参数丢掉
            args.insert(i + 1, session.to_string());
        }
        return;
    }
    if let Some(i) = args.iter().position(|a| a == "--resume" || a == "resume") {
        // 紧跟其后插入而非追加到末尾：用户在历史参数后还配了别的开关时，
        // id 混进末尾会被当成无名参数丢掉
        args.insert(i + 1, session.to_string());
    }
}

/// 打开历史记录界面的实际命令行（本地直启 / 远程 ssh 转发）。
/// resume_session 存在时注入到历史参数里（见 adapt_history_args），直接回放该会话转录。
/// workdir 为显式目录覆盖（项目派发的标签 meta 工作目录）：非空时压过 agent 自身配置，
/// 使历史会话落在与派发一致的目录；为空/空白时回退 agent 自身解析。
pub fn history_invocation(
    agent: &AgentConfig,
    resume_session: Option<&str>,
    workdir: Option<&str>,
) -> (String, Vec<String>) {
    let mut args: Vec<String> = agent
        .history_args
        .split_whitespace()
        .map(String::from)
        .collect();
    if let Some(sess) = resume_session.filter(|s| !s.trim().is_empty()) {
        let kind = crate::skills::kind_for_command(&agent.command);
        adapt_history_args(&mut args, sess.trim(), kind);
    }
    match agent.remote.as_ref().filter(|r| !r.host.trim().is_empty()) {
        None => (agent.command.clone(), args),
        Some(r) => {
            // 交互式历史会话：不设 BatchMode（密钥未就绪时允许在终端里输密码，
            // 而不是无提示地瞬间失败）；-tt 强制分配远端伪终端，agent 的 TUI 才能交互
            let mut argv = vec![
                "-tt".to_string(),
                "-o".to_string(),
                "ConnectTimeout=10".to_string(),
            ];
            if let Some(key) = r
                .key_path
                .as_ref()
                .map(|k| k.trim())
                .filter(|k| !k.is_empty())
            {
                argv.push("-i".to_string());
                argv.push(key.to_string());
            }
            if r.port != 0 && r.port != 22 {
                argv.push("-p".to_string());
                argv.push(r.port.to_string());
            }
            // -- 在 host 之前：以 - 开头的 host 不被当成 ssh 选项；其后整行是远端命令
            argv.push("--".to_string());
            argv.push(r.host.trim().to_string());
            argv.push("exec".to_string());
            argv.push("\"$SHELL\"".to_string());
            argv.push("-lc".to_string());
            let mut remote_line = std::iter::once(agent.command.as_str())
                .chain(args.iter().map(String::as_str))
                .map(posix_quote)
                .collect::<Vec<_>>()
                .join(" ");
            // 同 build_invocation：远端命令行前缀先建目录再 cd 切到生效工作目录
            // （显式覆盖优先）
            let dir = workdir
                .map(str::trim)
                .filter(|w| !w.is_empty())
                .unwrap_or(agent.workdir.trim());
            if !dir.is_empty() {
                remote_line = format!("{}{remote_line}", remote_workdir_prefix(dir));
            }
            // 同 build_invocation：整行整体引用，防 -lc 只吞第一个词（如 `claude --resume` 丢成裸 `claude`）
            argv.push(posix_quote(&remote_line));
            (ssh_bin(), argv)
        }
    }
}

/// 会话记录的工作目录快照：与 build_invocation 的实际落点同构——
/// 远程保留配置串原样（`~` 只有远端能展开；空 = 远端登录目录）；
/// 本地解析成绝对路径（覆盖目录展开 `~`，缺省回落 agent_workdir 语义）
pub fn session_workdir_snapshot(agent: &AgentConfig, effective: &str) -> String {
    let e = effective.trim();
    if agent
        .remote
        .as_ref()
        .is_some_and(|r| !r.host.trim().is_empty())
    {
        return e.to_string();
    }
    let resolved = if e.is_empty() {
        agent_workdir(agent)
    } else if let Some(rest) = e.strip_prefix("~/") {
        dirs::home_dir().map(|h| h.join(rest))
    } else {
        Some(PathBuf::from(e))
    };
    resolved
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::ai::AgentRemote;

    /// 工作目录快照与 build_invocation 落点同构：远程原样保留（~ 留给远端展开、
    /// 空串 = 登录目录）；本地展开 ~/ 与缺省 workspace
    #[test]
    fn session_workdir_snapshot_matches_invocation_cwd() {
        let home = dirs::home_dir().unwrap();
        // 远程：配置串原样
        let remote = AgentConfig {
            command: "claude".into(),
            workdir: "~/.choose-you/workspace".into(),
            remote: Some(AgentRemote {
                host: "vscode@localhost".into(),
                ..Default::default()
            }),
            ..Default::default()
        };
        assert_eq!(
            session_workdir_snapshot(&remote, &remote.workdir),
            "~/.choose-you/workspace",
            "远程保留原串（~ 由远端展开）"
        );
        assert_eq!(
            session_workdir_snapshot(&remote, ""),
            "",
            "远程空 = 登录目录"
        );
        // 本地：~/ 展开
        let local = AgentConfig {
            command: "claude".into(),
            workdir: "~/proj".into(),
            ..Default::default()
        };
        assert_eq!(
            session_workdir_snapshot(&local, "~/proj"),
            home.join("proj").to_string_lossy(),
            "本地 ~ 展开"
        );
        // 本地缺省 = agent_workdir 兜底（~/.choose-you/workspace）
        let bare = AgentConfig {
            command: "claude".into(),
            ..Default::default()
        };
        assert_eq!(
            session_workdir_snapshot(&bare, ""),
            agent_workdir(&bare).unwrap().to_string_lossy(),
            "本地空 = 默认 workspace"
        );
    }

    /// Windows cmd 引用：`"`（关引用）与 `%`（环境展开）无转义方案，必须中和为全角；
    /// 其余元字符交由整参双引号包裹防护（M1 cmd /C 回退路径的回归用例）
    #[test]
    fn windows_cmd_quote_neutralizes_unescapable_chars() {
        let q = windows_cmd_quote("a\" & calc & del /f & %PATH%^|<x>!v!");
        assert!(q.starts_with('"') && q.ends_with('"'), "整参包裹: {q}");
        assert!(!q.contains("\"&"), "闭引号逃逸形态消灭: {q}");
        assert!(!q.contains('%'), "% 展开消灭: {q}");
        assert!(q.contains('＂'), "双引号→全角保留可读: {q}");
        // 换行/制表压平为空格（cmd 命令行不接受多行）
        assert!(!windows_cmd_quote("a\nb\tc").contains('\n'));
    }

    /// PowerShell 单引号引用（Windows 交互终端路径）：`'` 双写转义、引号永远
    /// 成对闭合；`"`/`%` 沿用 cmd 中和（整行过 cmd /C start 开窗层与 wt 重组层），
    /// `$()`/反引号在单引号内是字面量、原样保留，换行/制表压平
    #[test]
    fn windows_ps_quote_only_escapes_single_quotes() {
        let q = windows_ps_quote("a' & calc; $(calc) %PATH% \"x\" `b`");
        assert_eq!(
            q, "'a'' & calc; $(calc) ％PATH％ ＂x＂ `b`'",
            "整参单引号、' 双写、cmd 危险字符仍中和"
        );
        assert_eq!(q.matches('\'').count() % 2, 0, "单引号成对闭合: {q}");
        assert!(!windows_ps_quote("a\nb\tc").contains('\n'));
        assert_eq!(windows_ps_quote(""), "''", "空参为空字符串字面量");
    }

    // ---- build_invocation：本地 / SSH 远程两路的命令行组装 ----

    #[test]
    fn invocation_remote_tunnel_forwards_local_sshd() {
        let a = AgentConfig {
            command: "claude".into(),
            args: "-p".into(),
            remote: Some(AgentRemote {
                host: "box".into(),
                tunnel: Some(10022),
                ..Default::default()
            }),
            ..Default::default()
        };
        let inv = build_invocation(&a, "x", &[]);
        let i = inv
            .argv
            .iter()
            .position(|x| x == "-R")
            .expect("带隧道端口时应加 -R");
        assert_eq!(inv.argv[i + 1], "127.0.0.1:10022:127.0.0.1:22");

        // 未配隧道（旧配置缺省）不加 -R
        let b = AgentConfig {
            command: "claude".into(),
            args: "-p".into(),
            remote: Some(AgentRemote {
                host: "box".into(),
                ..Default::default()
            }),
            ..Default::default()
        };
        assert!(!build_invocation(&b, "x", &[])
            .argv
            .contains(&"-R".to_string()));
    }

    #[test]
    fn invocation_remote_env_prefix_carries_vars() {
        // ssh 会话环境不透传：envs 以 VAR='值' 前缀进远端命令行（cd 之后、agent 命令之前），
        // 值经 posix_quote，远端登录 shell 求值后进入 agent 环境，由 shim 转发回本机侧 pk
        let a = AgentConfig {
            command: "claude".into(),
            args: "-p".into(),
            workdir: "~/lab".into(),
            remote: Some(AgentRemote {
                host: "box".into(),
                ..Default::default()
            }),
            ..Default::default()
        };
        let envs = vec![
            ("PK_DISPATCH_TASK".to_string(), "42".to_string()),
            (
                "PK_LOG_FILE".to_string(),
                "/tmp/app support/x.log".to_string(),
            ),
            ("BAD-KEY".to_string(), "应被丢弃".to_string()),
        ];
        let inv = build_invocation(&a, "x", &envs);
        let line = inv.argv.last().unwrap();
        // 整行被再引用过：还原内层单引号后断言
        let normalized = line.replace("'\\''", "'");
        assert!(
            normalized.starts_with("'mkdir -p ~/lab && cd ~/lab && PK_DISPATCH_TASK=42 "),
            "前缀在建目录与 cd 后、agent 命令前: {line}"
        );
        assert!(
            normalized.contains("PK_LOG_FILE='/tmp/app support/x.log'"),
            "含空格路径整体引用: {line}"
        );
        assert!(
            normalized.contains(" claude -p'"),
            "前缀后接 agent 命令: {line}"
        );
        assert!(
            !line.contains("BAD-KEY"),
            "非环境变量键名的条目被丢弃: {line}"
        );

        // 无 envs：远端命令行仅目录前缀 + agent 命令（回归）
        assert_eq!(
            build_invocation(&a, "x", &[]).argv.last().unwrap(),
            "'mkdir -p ~/lab && cd ~/lab && claude -p'"
        );

        // 本地分支不吃命令行前缀（由 spawn_and_wait 的 cmd.env 注入）
        let mut local = a.clone();
        local.remote = None;
        let li = build_invocation(&local, "x", &envs);
        assert!(li.argv.iter().all(|x| !x.contains("PK_DISPATCH_TASK")));
    }

    #[test]
    fn invocation_local_modes() {
        // {prompt} 占位符 → 提示词进 argv
        let mut a = AgentConfig {
            args: "-p {prompt}".into(),
            ..Default::default()
        };
        let inv = build_invocation(&a, "你好", &[]);
        assert_eq!(inv.program, "");
        assert_eq!(inv.argv, vec!["-p".to_string(), "你好".to_string()]);
        assert!(inv.stdin.is_none(), "占位符模式不走 stdin");
        assert!(inv.remote_host.is_none());

        // 无占位符 → 提示词走 stdin
        a.args = "-p".into();
        let inv = build_invocation(&a, "你好", &[]);
        assert_eq!(inv.argv, vec!["-p".to_string()]);
        assert_eq!(inv.stdin.as_deref(), Some("你好"));

        // remote 配了但 host 为空 → 仍走本地
        a.remote = Some(crate::ai::AgentRemote::default());
        let inv = build_invocation(&a, "你好", &[]);
        assert!(inv.remote_host.is_none(), "空 host 视为未配置");
    }

    /// 回归：GUI 进程不继承终端 PATH，本地分支的裸命令名要解析成绝对路径；
    /// 远程分支保持用户配置原样（由远端登录 shell 自行解析）。
    #[cfg(unix)]
    #[test]
    fn invocation_local_resolves_bare_command() {
        let a = AgentConfig {
            command: "sh".into(),
            args: "-p".into(),
            ..Default::default()
        };
        let inv = build_invocation(&a, "x", &[]);
        assert!(
            std::path::Path::new(&inv.program).is_absolute(),
            "PATH 中的裸命令应解析为绝对路径，got {}",
            inv.program
        );

        let r = AgentConfig {
            command: "claude".into(),
            args: "-p".into(),
            remote: Some(crate::ai::AgentRemote {
                host: "box".into(),
                ..Default::default()
            }),
            ..Default::default()
        };
        let inv = build_invocation(&r, "x", &[]);
        assert!(!inv.program.contains("claude"), "远程分支的程序是 ssh");
        assert!(
            inv.argv.iter().any(|x| x.contains("claude")),
            "远端命令行保留用户配置的命令名"
        );
    }

    #[test]
    fn invocation_remote_wraps_ssh() {
        let a = AgentConfig {
            command: "claude".into(),
            args: "-p {prompt}".into(),
            remote: Some(AgentRemote {
                host: "dev@buildbox".into(),
                port: 2222,
                key_path: Some("~/.ssh/id_ed25519".into()),
                tunnel: None,
                persistent: false,
            }),
            ..Default::default()
        };
        let inv = build_invocation(&a, "明天 5pm 交周报", &[]);
        assert_eq!(inv.program, "ssh");
        assert_eq!(
            inv.argv,
            vec![
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=10",
                "-i",
                "~/.ssh/id_ed25519",
                "-p",
                "2222",
                "--",
                "dev@buildbox",
                "exec",
                "\"$SHELL\"",
                "-lc",
                "'claude -p'",
            ]
        );
        // {prompt} 元素被剔除（-p 保留，读 stdin），提示词永远走 stdin
        assert!(!inv.argv.iter().any(|x| x.contains("交周报")));
        assert_eq!(inv.stdin.as_deref(), Some("明天 5pm 交周报"));
        assert_eq!(inv.remote_host.as_deref(), Some("dev@buildbox"));

        // 默认端口 22 不加 -p；无密钥不加 -i
        let b = AgentConfig {
            command: "opencode".into(),
            args: "run {prompt}".into(),
            remote: Some(AgentRemote {
                host: "box".into(),
                ..Default::default()
            }),
            ..Default::default()
        };
        let inv = build_invocation(&b, "x", &[]);
        assert_eq!(
            inv.argv,
            vec![
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=10",
                "--",
                "box",
                "exec",
                "\"$SHELL\"",
                "-lc",
                "'opencode run'",
            ]
        );
        // 历史入口也走 ssh
        let (prog, argv) = history_invocation(&b, None, None);
        assert_eq!(prog, "ssh");
        assert!(argv.contains(&"--".to_string()) && argv.contains(&"box".to_string()));
        // 交互式历史不设 BatchMode（允许终端里输密码），但保留连接超时
        assert!(!argv.contains(&"BatchMode=yes".to_string()));
        assert!(argv.contains(&"ConnectTimeout=10".to_string()));
        assert!(
            argv.contains(&"-tt".to_string()),
            "强制分配远端伪终端: {argv:?}"
        );
    }

    // ---- 工作目录：显式配置优先，缺省固定为主目录，远程 cd 前缀 ----

    #[test]
    fn invocation_local_workdir() {
        // 显式配置 → cwd 用配置值；~ 前缀展开为本机主目录
        let a = AgentConfig {
            workdir: "/tmp/lab".into(),
            ..Default::default()
        };
        assert_eq!(
            build_invocation(&a, "x", &[]).cwd.as_deref(),
            Some(std::path::Path::new("/tmp/lab"))
        );

        let home = dirs::home_dir().expect("测试环境应有主目录");
        let a = AgentConfig {
            workdir: "~/proj".into(),
            ..Default::default()
        };
        assert_eq!(build_invocation(&a, "x", &[]).cwd, Some(home.join("proj")));

        // 未配置 → ~/.choose-you/workspace（应用专属工作区），不继承 GUI 进程的 cwd
        assert_eq!(
            build_invocation(&AgentConfig::default(), "x", &[]).cwd,
            Some(home.join(".choose-you/workspace"))
        );
    }

    #[test]
    fn invocation_remote_workdir_prefixes_cd() {
        let a = AgentConfig {
            command: "claude".into(),
            args: "-p {prompt}".into(),
            workdir: "~/lab".into(),
            remote: Some(AgentRemote {
                host: "box".into(),
                ..Default::default()
            }),
            ..Default::default()
        };
        let inv = build_invocation(&a, "x", &[]);
        let line = inv.argv.last().unwrap();
        assert!(
            line.contains("cd ~/lab && claude -p"),
            "远端命令行先 cd 到配置目录（~ 保留给远端 shell 展开），got {line}"
        );
        assert!(inv.cwd.is_none(), "远程分支不设本地 cwd");

        // 历史入口同样带 cd 前缀
        let (_, argv) = history_invocation(&a, None, None);
        assert!(
            argv.last().unwrap().contains("cd ~/lab && claude"),
            "历史会话也在配置目录里打开"
        );

        // cd 目标的引用规则：含空格/单引号的部分安全引用，前导 ~ 裸放
        assert_eq!(quote_cd_target("~"), "~");
        assert_eq!(quote_cd_target("~/a b"), "~/'a b'");
        assert_eq!(quote_cd_target("/it's"), "'/it'\\''s'");
    }

    /// 回归：远程工作目录在远端从未被创建（本地默认目录有 create_dir_all 兜底，
    /// 远程没有），cd 失败 && 短路让整条远端命令瞬间退出——历史记录表现为终端
    /// 一闪而过、无头派发表现为空输出。远端命令行必须先 mkdir -p 再 cd
    #[test]
    fn remote_workdir_is_created_before_cd() {
        let remote = AgentRemote {
            host: "box".into(),
            ..Default::default()
        };
        let a = AgentConfig {
            command: "claude".into(),
            args: "-p {prompt}".into(),
            workdir: "~/.choose-you/workspace".into(),
            remote: Some(remote.clone()),
            ..Default::default()
        };
        let inv = build_invocation(&a, "x", &[]);
        assert!(
            inv.argv.last().unwrap().contains(
                "mkdir -p ~/.choose-you/workspace && cd ~/.choose-you/workspace && claude"
            ),
            "无头远端先建目录再 cd: {:?}",
            inv.argv.last().unwrap()
        );

        // 历史入口（报错现场：cd 失败终端 120ms 即关）同样先建目录
        let b = AgentConfig {
            command: "claude".into(),
            history_args: "--resume".into(),
            workdir: "~/.choose-you/workspace".into(),
            remote: Some(remote),
            ..Default::default()
        };
        let (_, argv) = history_invocation(&b, None, None);
        assert!(
            argv.last().unwrap().contains(
                "mkdir -p ~/.choose-you/workspace && cd ~/.choose-you/workspace && claude --resume"
            ),
            "历史会话同样先建目录: {:?}",
            argv.last().unwrap()
        );
    }

    /// 会话 id 注入历史参数：claude 的 --resume 后插 id；无恢复参数的历史不注入；本地远程行为一致
    #[test]
    fn history_invocation_injects_session_for_resume_flags() {
        // claude：--resume <id>，本地直接拼 args
        let claude = AgentConfig {
            command: "claude".into(),
            history_args: "--resume".into(),
            ..Default::default()
        };
        let (_, args) = history_invocation(&claude, Some("sess-9"), None);
        assert_eq!(args, vec!["--resume".to_string(), "sess-9".to_string()]);

        // 无恢复参数（opencode 等空历史）：不注入
        let plain = AgentConfig {
            command: "opencode".into(),
            history_args: String::new(),
            ..Default::default()
        };
        let (_, args) = history_invocation(&plain, Some("sess-9"), None);
        assert!(args.is_empty());

        // pi：-r 是会话选择器（不带 id），按 id 恢复须换成 --session <id>
        let pi = AgentConfig {
            command: "pi".into(),
            history_args: "-r".into(),
            ..Default::default()
        };
        let (_, args) = history_invocation(&pi, Some("sess-9"), None);
        assert_eq!(args, vec!["--session".to_string(), "sess-9".to_string()]);
        // pi 已配 --session（自带 id 位）：id 原位插到其后，不重复换旗标
        let pi2 = AgentConfig {
            command: "pi".into(),
            history_args: "--session".into(),
            ..Default::default()
        };
        let (_, args) = history_invocation(&pi2, Some("sess-9"), None);
        assert_eq!(args, vec!["--session".to_string(), "sess-9".to_string()]);

        // 远程：id 进远端命令行而不是 ssh 的选项区（回归：旧实现误判 ssh argv 首参）
        let remote = AgentConfig {
            command: "claude".into(),
            history_args: "--resume".into(),
            workdir: "~/lab".into(),
            remote: Some(AgentRemote {
                host: "box".into(),
                ..Default::default()
            }),
            ..Default::default()
        };
        let (_, argv) = history_invocation(&remote, Some("sess-9"), None);
        let line = argv.last().unwrap();
        assert!(
            line.contains("claude --resume sess-9"),
            "id 紧跟 --resume 进远端命令行: {line}"
        );

        // id 插在恢复参数后、而不是参数串末尾（历史参数还带别的开关时）
        let mut mixed = vec![
            "--resume".to_string(),
            "--model".to_string(),
            "opus".to_string(),
        ];
        adapt_history_args(&mut mixed, "s1", Some("claude-code"));
        assert_eq!(
            mixed,
            vec!["--resume", "s1", "--model", "opus"]
                .into_iter()
                .map(String::from)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn history_invocation_workdir_override_wins_for_remote() {
        // 项目派发的历史快捷方式：标签 meta 目录压过 agent 自身配置，
        // 历史会话落在与派发一致的目录（回归：旧实现只看 agent.workdir）
        let remote = AgentConfig {
            command: "claude".into(),
            history_args: "--resume".into(),
            workdir: "~/lab".into(),
            remote: Some(AgentRemote {
                host: "box".into(),
                ..Default::default()
            }),
            ..Default::default()
        };
        let (_, argv) = history_invocation(&remote, None, Some("~/projects/my-repo"));
        let line = argv.last().unwrap();
        assert!(
            line.contains("cd ~/projects/my-repo && claude"),
            "显式覆盖进远端 cd 前缀: {line}"
        );
        assert!(!line.contains("~/lab"), "agent 自身目录被压过: {line}");

        // 覆盖为空白 → 回退 agent 自身配置（与后端 effective_workdir 的「留空即缺省」同口径）
        let (_, argv) = history_invocation(&remote, None, Some("   "));
        assert!(
            argv.last().unwrap().contains("cd ~/lab"),
            "空白覆盖回退 agent 目录: {:?}",
            argv.last().unwrap()
        );

        // 两处都没有 → 不 cd（远端登录目录）
        let bare = AgentConfig {
            command: "claude".into(),
            workdir: "".into(),
            remote: Some(AgentRemote {
                host: "box".into(),
                ..Default::default()
            }),
            ..Default::default()
        };
        let (_, argv) = history_invocation(&bare, None, None);
        assert!(
            !argv.last().unwrap().contains("cd "),
            "无目录时远端落登录目录: {:?}",
            argv.last().unwrap()
        );
    }
}
