//! 派发预检：远端一条 ssh 拿 tmux / 目录 / claude 信任状态；
//! 本地信任判定与派发目录解析。
use crate::ai::{quote_cd_target, AgentConfig};
use std::path::PathBuf;

/// 预检输出分段哨兵：splitn 只按前两次切，后续正文（claude.json）再出现也不受影响
const PROBE_SEP: &str = "PK_PROBE_SEP";

/// 远端预检脚本（经 `exec "$SHELL" -lc` 执行）：tmux 有无 · 派发目录的归一化绝对路径
/// （cd 失败回落登录目录，与 tmux -c / cd 前缀的实际落点一致）· claude ~/.claude.json
/// 内容（信任判定本地解析，不依赖远端 node/python）。三段用哨兵分隔
pub(crate) fn tmux_probe_line(workdir: &str) -> String {
    let dir_part = if workdir.trim().is_empty() {
        "d=$HOME".to_string()
    } else {
        // 与派发落点同构（先建目录再 cd）：目录尚未创建时也解析出真实派发目录，
        // claude 信任判定的 key 不因目录缺失回落 $HOME 而错位
        let t = quote_cd_target(workdir.trim());
        format!("d=$(mkdir -p {t} 2>/dev/null && cd {t} && pwd) || d=''")
    };
    format!(
        "command -v tmux || true; printf '{PROBE_SEP}'; {dir_part}; [ -n \"$d\" ] || d=$HOME; \
         printf '%s' \"$d\"; printf '{PROBE_SEP}'; cat ~/.claude.json 2>/dev/null || true"
    )
}

/// 预检输出解析：段缺失按「无」处理（远端没装过 claude 时 json 段为空）
pub(crate) struct RemoteProbe {
    pub(crate) has_tmux: bool,
    /// 派发目录的远端绝对路径（信任判定的 key；解析失败为 None）
    pub(crate) dir: Option<String>,
    /// 远端 ~/.claude.json 原文
    pub(crate) claude_json: Option<String>,
}

pub(crate) fn parse_remote_probe(out: &str) -> RemoteProbe {
    let mut parts = out.splitn(3, PROBE_SEP);
    let tmux = parts.next().unwrap_or("").trim().to_string();
    let dir = parts
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from);
    let claude_json = parts
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from);
    RemoteProbe {
        has_tmux: !tmux.is_empty(),
        dir,
        claude_json,
    }
}

/// claude 目录信任判定（~/.claude.json 的 projects[dir].hasTrustDialogAccepted）：
/// Some(true/false) = 明确判定；None = 无法判定（文件缺失 / JSON 损坏 / 目录无条目）。
/// 仅 claude-code 交互首启会因未信任停在确认框（-p 无头模式不弹），其他 agent 无此机制
fn claude_dir_trusted(claude_json: &str, dir: &str) -> Option<bool> {
    let v: serde_json::Value = serde_json::from_str(claude_json.trim()).ok()?;
    v.get("projects")?
        .get(dir)?
        .get("hasTrustDialogAccepted")?
        .as_bool()
}

/// 未信任提示（交互通道派发 note）：claude 首次在目录启动会停在「是否信任此文件夹」
/// 确认框，prompt 在确认前不会发送——用户看到的就是「终端开了却一直无响应」。
/// 已信任 / 无法判定 / 非 claude-code 一律不提示（宁可漏报不误报）
pub(crate) fn trust_warn_note(
    kind: Option<&str>,
    claude_json: Option<&str>,
    dir: Option<&str>,
    scope: &str,
) -> Option<String> {
    if kind != Some("claude-code") {
        return None;
    }
    let (json, dir) = (claude_json?, dir?);
    (claude_dir_trusted(json, dir) == Some(false)).then(|| {
        format!(
            "Claude Code 尚未信任{scope}目录 {dir}：启动后会停在「是否信任此文件夹」确认框，\
             请在终端里按 Enter 确认后任务才会开始"
        )
    })
}

/// 本地派发的信任预检：目录是解析后的绝对路径（canonicalize 对齐 claude 记录的
/// 物理路径，macOS 的 /tmp 等符号链接目录才对得上）；~/.claude.json 缺失或无法
/// 判定不提示（宁可漏报不误报）
pub(crate) fn local_trust_note(
    kind: Option<&str>,
    dir: Option<&std::path::Path>,
) -> Option<String> {
    let dir = dir?;
    let json = std::fs::read_to_string(dirs::home_dir()?.join(".claude.json")).ok()?;
    let abs = dir
        .canonicalize()
        .unwrap_or_else(|_| dir.to_path_buf())
        .to_string_lossy()
        .into_owned();
    trust_warn_note(kind, Some(&json), Some(&abs), "工作")
}

/// 本地派发工作目录：meta 覆盖优先（只展开 ~，不自动创建——目录配错应报错而不是
/// 静默建目录）；无覆盖时沿用 agent_workdir 语义（留空 = ~/.choose-you/workspace，自动创建）
pub(crate) fn local_dispatch_dir(agent: &AgentConfig, override_dir: &str) -> Option<PathBuf> {
    let configured = override_dir.trim();
    if configured.is_empty() {
        return crate::ai::agent_workdir(agent);
    }
    if let Some(rest) = configured.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return Some(home.join(rest));
        }
    }
    Some(PathBuf::from(configured))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 本地派发目录：meta 覆盖只展开 ~、不自动创建；无覆盖沿用 agent 语义
    #[test]
    fn local_dispatch_dir_override_vs_agent_default() {
        let agent = AgentConfig {
            workdir: "~/agent-lab".into(),
            ..Default::default()
        };
        let home = dirs::home_dir().unwrap();
        assert_eq!(
            local_dispatch_dir(&agent, "~/projects/app"),
            Some(home.join("projects/app"))
        );
        assert_eq!(
            local_dispatch_dir(&agent, ""),
            Some(home.join("agent-lab")),
            "无覆盖时用 agent 自身配置"
        );
        assert_eq!(
            local_dispatch_dir(&agent, "/abs/path"),
            Some(PathBuf::from("/abs/path"))
        );
    }

    #[test]
    fn claude_dir_trusted_reads_projects_flag() {
        let json = r#"{"projects":{
            "/home/vscode":{"hasTrustDialogAccepted":true},
            "/w/other":{"hasTrustDialogAccepted":false},
            "/w/no-flag":{},"/w/null":null}}"#;
        assert_eq!(claude_dir_trusted(json, "/home/vscode"), Some(true));
        assert_eq!(claude_dir_trusted(json, "/w/other"), Some(false));
        assert_eq!(
            claude_dir_trusted(json, "/w/no-flag"),
            None,
            "条目无该键 = 无法判定"
        );
        assert_eq!(claude_dir_trusted(json, "/w/absent"), None, "目录无条目");
        assert_eq!(claude_dir_trusted("not json", "/x"), None);
        assert_eq!(claude_dir_trusted("", "/x"), None);
        assert_eq!(claude_dir_trusted("{\"projects\":{}}", "/x"), None);
    }

    #[test]
    fn tmux_probe_line_shapes_and_parse_roundtrip() {
        // 空 workdir → 直接取远端登录目录
        assert!(tmux_probe_line("").contains("d=$HOME"));
        // ~/ 前缀保留给远端 shell 展开；含空格的目录段安全引用；与派发落点一致先建目录
        // （mkdir + cd），信任判定的 key 才不会因目录缺失回落 $HOME 错位
        let line = tmux_probe_line("~/my repo");
        assert!(
            line.contains("mkdir -p ~/'my repo' 2>/dev/null && cd ~/'my repo'"),
            "~ 展开 + 空格引用 + 先建目录: {line}"
        );
        // 解析：tmux 段空 = 无 tmux；目录段原样；json 段完整
        let p = parse_remote_probe(&format!(
            "\n{PROBE_SEP}/home/vscode{PROBE_SEP}{{\"projects\":{{}}}}"
        ));
        assert!(!p.has_tmux);
        assert_eq!(p.dir.as_deref(), Some("/home/vscode"));
        assert_eq!(p.claude_json.as_deref(), Some("{\"projects\":{}}"));
        // 有 tmux、无 json（远端没装过 claude）也能解
        let p = parse_remote_probe(&format!("/usr/bin/tmux\n{PROBE_SEP}/d{PROBE_SEP}"));
        assert!(p.has_tmux);
        assert_eq!(p.dir.as_deref(), Some("/d"));
        assert!(p.claude_json.is_none());
        // json 正文里出现哨兵不受影响（splitn 只切前两刀）
        let p = parse_remote_probe(&format!(
            "/usr/bin/tmux\n{PROBE_SEP}/d{PROBE_SEP}{{\"x\":\"a{PROBE_SEP}b\"}}"
        ));
        assert!(p.claude_json.as_deref().unwrap().ends_with('}'));
    }

    #[test]
    fn trust_warn_note_only_for_untrusted_claude_code() {
        let json = r#"{"projects":{"/d":{"hasTrustDialogAccepted":false}}}"#;
        // 明确未信任才提示；文案带目录与操作指引
        let note = trust_warn_note(Some("claude-code"), Some(json), Some("/d"), "远端");
        assert_eq!(
            note.as_deref(),
            Some("Claude Code 尚未信任远端目录 /d：启动后会停在「是否信任此文件夹」确认框，请在终端里按 Enter 确认后任务才会开始")
        );
        // 已信任 / 无法判定（json 缺失、目录缺条目）→ 不提示（宁可漏报不误报）
        let trusted = r#"{"projects":{"/d":{"hasTrustDialogAccepted":true}}}"#;
        assert_eq!(
            trust_warn_note(Some("claude-code"), Some(trusted), Some("/d"), "工作"),
            None
        );
        assert_eq!(
            trust_warn_note(Some("claude-code"), None, Some("/d"), "工作"),
            None
        );
        assert_eq!(
            trust_warn_note(Some("claude-code"), Some(json), None, "工作"),
            None
        );
        // 非 claude-code（无此信任机制）不提示
        assert_eq!(
            trust_warn_note(Some("pi"), Some(json), Some("/d"), "工作"),
            None
        );
        assert_eq!(trust_warn_note(None, Some(json), Some("/d"), "工作"), None);
    }
}
