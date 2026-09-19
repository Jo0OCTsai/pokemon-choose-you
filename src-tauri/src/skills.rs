//! pk 使用技能的分发与版本管理：pk CLI 的 `skill install/show` 与桌面应用的
//! 「安装/检查技能」共用同一套内容与目录规则（claude-code / opencode / kiro）。
//!
//! 技能放 agent 的**全局目录**（`~/.claude/skills/` 等）：pk 技能是个人跨项目工具，
//! 官方建议项目约定进仓库目录、个人工作流进 home 全局目录；且远程 agent 场景下
//! 技能文件要落在 agent 实际运行的那台机器上（pk 本体经 shim 回本机执行）。

/// 随包分发的 agent 技能模板（教 agent 用 pk 管待办）
pub const SKILL_MD: &str = include_str!("../skills/pokemon-choose-you.md");
/// 技能引用文件（渐进披露）：主文件保持精简，参数细节与批处理协议按需再读
pub const SKILL_REFS: &[(&str, &str)] = &[
    (
        "references/commands.md",
        include_str!("../skills/references/commands.md"),
    ),
    (
        "references/suggest-workflow.md",
        include_str!("../skills/references/suggest-workflow.md"),
    ),
];
/// 当前技能版本（与 SKILL.md frontmatter 的 version 保持一致，用于安装时的版本对比）
pub const SKILL_VERSION: &str = "2";

/// 技能在各 agent 技能目录下的文件夹名（Agent Skills 标准：与 frontmatter name 一致）
const SKILL_DIR_NAME: &str = "pokemon-choose-you";

/// 从 agent 可执行命令推断技能目标类型：basename 包含关键词即命中
/// （claude / kiro-cli / opencode；绝对路径与自定义包装脚本也能识别）
pub fn kind_for_command(command: &str) -> Option<&'static str> {
    let base = command
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(command)
        .to_lowercase();
    if base.contains("kiro") {
        Some("kiro")
    } else if base.contains("claude") {
        Some("claude-code")
    } else if base.contains("opencode") {
        Some("opencode")
    } else {
        None
    }
}

/// 技能文件所在目录（本机 $HOME 下的绝对路径）：claude-code → ~/.claude/skills；
/// opencode → ~/.config/opencode/skill；kiro → ~/.kiro/skills；
/// 其他 agent 用 --dir 显式指定
pub fn skill_dir_for(agent: &str, dir_flag: Option<&str>) -> Result<std::path::PathBuf, String> {
    if let Some(d) = dir_flag.filter(|d| !d.is_empty()) {
        return Ok(std::path::PathBuf::from(d));
    }
    let home = dirs::home_dir().ok_or_else(|| "无法定位用户主目录".to_string())?;
    let rel = skill_dir_rel(agent)?;
    Ok(home.join(rel))
}

/// 技能目录在 $HOME 下的相对路径（POSIX 斜杠形式；远程安装时交给远端 shell 展开 $HOME）
pub fn skill_dir_rel(agent: &str) -> Result<String, String> {
    match agent {
        "claude-code" | "claude" => Ok(format!(".claude/skills/{SKILL_DIR_NAME}")),
        "opencode" => Ok(format!(".config/opencode/skill/{SKILL_DIR_NAME}")),
        "kiro" | "kiro-cli" => Ok(format!(".kiro/skills/{SKILL_DIR_NAME}")),
        other => Err(format!(
            "暂不认识 agent「{other}」的技能目录：支持 claude-code / opencode / kiro，其他 agent 用 --dir <目录> 指定，或 pk skill show 自行粘贴"
        )),
    }
}

/// 读 SKILL.md frontmatter 的 version 行（无 frontmatter 或无该行则 None）
pub fn frontmatter_version(md: &str) -> Option<String> {
    let mut in_fm = false;
    for line in md.lines() {
        let t = line.trim();
        if t == "---" {
            if in_fm {
                break;
            }
            in_fm = true;
            continue;
        }
        if in_fm {
            if let Some(v) = t.strip_prefix("version:") {
                return Some(v.trim().trim_matches('"').to_string());
            }
        }
    }
    None
}

/// 本机安装状态：SKILL.md 是否存在 + 已装版本（缺 frontmatter version 视为未知版本）
pub fn local_status(dir: &std::path::Path) -> (bool, Option<String>) {
    match std::fs::read_to_string(dir.join("SKILL.md")) {
        Ok(md) => (true, frontmatter_version(&md)),
        Err(_) => (false, None),
    }
}

/// 本机安装/同步：写主文件 + references/，返回（旧版本, SKILL.md 路径）。
/// 同版本重装幂等，跨版本即升级（版本对比交给调用方展示）
pub fn local_install(dir: &std::path::Path) -> Result<(Option<String>, String), String> {
    let previous = std::fs::read_to_string(dir.join("SKILL.md"))
        .ok()
        .and_then(|md| frontmatter_version(&md));
    for (rel, content) in std::iter::once(("SKILL.md", SKILL_MD)).chain(SKILL_REFS.iter().copied())
    {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建技能目录失败: {e}"))?;
        }
        std::fs::write(&path, content).map_err(|e| format!("写入 {rel} 失败: {e}"))?;
    }
    Ok((
        previous,
        dir.join("SKILL.md").to_string_lossy().into_owned(),
    ))
}

/// 远端单行命令：读取远端已装 SKILL.md（stdout 带回内容，本地解析版本）。
/// 未安装时 cat 失败被吞（`|| true`），ssh 退出码只反映连接问题
pub fn remote_status_line(agent: &str) -> Result<String, String> {
    let rel = skill_dir_rel(agent)?;
    Ok(format!("cat \"$HOME/{rel}/SKILL.md\" 2>/dev/null || true"))
}

/// 远端安装脚本（经 stdin 交给远端 sh -s）：逐文件 heredoc 落盘。
/// set -e 任一步失败即非零退出，ssh 退出码如实反映
pub fn remote_install_script(agent: &str) -> Result<String, String> {
    let rel = skill_dir_rel(agent)?;
    // heredoc 定界符带固定盐：技能正文是我们自己的 Markdown，不会撞行
    const DELIM: &str = "PK_SKILL_HEREDOC_END_7Q4X";
    let mut script = format!("set -e\numask 022\ndir=\"$HOME/{rel}\"\nmkdir -p \"$dir\"\n");
    for (rel_path, content) in
        std::iter::once(("SKILL.md", SKILL_MD)).chain(SKILL_REFS.iter().copied())
    {
        if content.lines().any(|l| l.trim() == DELIM) {
            return Err(format!(
                "技能文件 {rel_path} 含 heredoc 定界行，改用 pk skill show 手动同步"
            ));
        }
        // heredoc 正文须以换行收尾（定界符独占一行）；内容自带结尾换行时不再补，
        // 保证远端落盘与 local_install 的直写逐字节一致
        let body = if content.ends_with('\n') {
            content.to_string()
        } else {
            format!("{content}\n")
        };
        script.push_str(&format!(
            "mkdir -p \"$dir/{}\"\ncat > \"$dir/{}\" <<'{DELIM}'\n{body}{DELIM}\n",
            parent_dir_of(rel_path),
            rel_path
        ));
    }
    // 末尾回显带前缀的哨兵：远端登录 shell 的 profile 输出可能污染 stdout，
    // 按 `PK_SKILL_INSTALLED <version>` 定位真实安装结果
    script.push_str(&format!("echo \"PK_SKILL_INSTALLED {SKILL_VERSION}\"\n"));
    Ok(script)
}

/// 远端安装脚本的哨兵前缀（stdout 中定位安装结果）
pub const REMOTE_INSTALL_SENTINEL: &str = "PK_SKILL_INSTALLED";

/// 相对路径的父目录（references/x.md → references；SKILL.md → .）
fn parent_dir_of(rel: &str) -> &str {
    match rel.rsplit_once('/') {
        Some((dir, _)) => dir,
        None => ".",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_for_command_matches_basenames() {
        assert_eq!(kind_for_command("claude"), Some("claude-code"));
        assert_eq!(
            kind_for_command("/opt/homebrew/bin/claude"),
            Some("claude-code")
        );
        assert_eq!(kind_for_command("kiro-cli"), Some("kiro"));
        assert_eq!(kind_for_command("opencode"), Some("opencode"));
        assert_eq!(kind_for_command("my-agent"), None, "未知命令无技能目标");
    }

    #[test]
    fn skill_dirs_cover_three_agents() {
        let home = dirs::home_dir().unwrap();
        assert_eq!(
            skill_dir_for("claude-code", None).unwrap(),
            home.join(".claude/skills/pokemon-choose-you")
        );
        assert_eq!(
            skill_dir_for("kiro", None).unwrap(),
            home.join(".kiro/skills/pokemon-choose-you")
        );
        assert_eq!(
            skill_dir_for("opencode", None).unwrap(),
            home.join(".config/opencode/skill/pokemon-choose-you")
        );
        assert_eq!(
            skill_dir_for("unknown", Some("/tmp/x")).unwrap(),
            std::path::PathBuf::from("/tmp/x"),
            "--dir 显式指定优先"
        );
        assert!(skill_dir_for("unknown", None).is_err());
        // 远端相对路径与本地目录尾部一致
        assert_eq!(
            skill_dir_rel("kiro").unwrap(),
            ".kiro/skills/pokemon-choose-you"
        );
    }

    #[test]
    fn remote_scripts_quote_and_version() {
        let status = remote_status_line("claude-code").unwrap();
        assert!(
            status.contains("\"$HOME/.claude/skills/pokemon-choose-you/SKILL.md\""),
            "{status}"
        );
        let install = remote_install_script("kiro").unwrap();
        assert!(install.starts_with("set -e"), "任一步失败即退出: {install}");
        assert!(install.contains("dir=\"$HOME/.kiro/skills/pokemon-choose-you\""));
        assert!(install.contains("<<'PK_SKILL_HEREDOC_END_7Q4X'"));
        assert!(
            install.contains("references/commands.md"),
            "引用文件逐个落盘"
        );
        assert!(
            install
                .trim_end()
                .ends_with("echo \"PK_SKILL_INSTALLED 2\""),
            "回显哨兵与版本: {install}"
        );
    }

    /// 本地安装→状态读取往返：装的是同一份内容，版本取 frontmatter
    #[test]
    fn local_install_then_status_roundtrip() {
        let dir = std::env::temp_dir().join(format!("pk-skill-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let (previous, path) = local_install(&dir).unwrap();
        assert!(previous.is_none(), "首装无旧版本");
        assert!(path.contains("SKILL.md"));
        let (installed, version) = local_status(&dir);
        assert!(installed);
        assert_eq!(version.as_deref(), Some(SKILL_VERSION));
        let written = std::fs::read_to_string(dir.join("references/commands.md")).unwrap();
        assert_eq!(written, SKILL_REFS[0].1, "引用文件内容一致");
        // 重装幂等：旧版本即当前版本
        let (prev2, _) = local_install(&dir).unwrap();
        assert_eq!(prev2.as_deref(), Some(SKILL_VERSION));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn frontmatter_version_parses_or_missing() {
        assert_eq!(
            frontmatter_version("---\nname: x\nversion: \"3\"\n---\nbody"),
            Some("3".into())
        );
        assert_eq!(frontmatter_version("no frontmatter"), None);
    }

    /// 远端安装脚本端到端：整段脚本经 stdin 交给 `sh -s` 执行（HOME 指向临时目录），
    /// 与 ssh 管道执行同构——heredoc 逐文件落盘、末行回显哨兵、内容与内置一致
    #[test]
    #[cfg(unix)]
    fn remote_install_script_runs_via_sh_stdin() {
        let home = std::env::temp_dir().join(format!("pk-skill-sh-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).unwrap();
        let script = remote_install_script("kiro").unwrap();

        use std::io::Write;
        let mut child = std::process::Command::new("sh")
            .arg("-s")
            .env("HOME", &home)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(script.as_bytes())
            .unwrap();
        let out = child.wait_with_output().unwrap();
        assert!(
            out.status.success(),
            "脚本执行失败: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        let stdout = String::from_utf8_lossy(&out.stdout);
        assert!(
            stdout
                .lines()
                .any(|l| l.trim() == format!("{REMOTE_INSTALL_SENTINEL} {SKILL_VERSION}")),
            "末行回显哨兵: {stdout}"
        );
        let installed =
            std::fs::read_to_string(home.join(".kiro/skills/pokemon-choose-you/SKILL.md")).unwrap();
        assert_eq!(installed, SKILL_MD, "落盘内容与内置一致");
        assert!(home
            .join(".kiro/skills/pokemon-choose-you/references/commands.md")
            .is_file());
        let _ = std::fs::remove_dir_all(&home);
    }
}
