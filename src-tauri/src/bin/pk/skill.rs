//! skill 子命令：技能目录展示与安装。
use crate::cli::{parse_args, usage_err, CliError};
use pokemon_choose_you_lib::skills::{
    local_install, skill_dir_for, SKILL_MD, SKILL_REFS, SKILL_VERSION,
};
use serde_json::json;

/// 安装/展示 agent 技能。install 写入主文件 + references/ 引用文件；
/// show 拼接全部内容直接打印（不走 JSON，重定向给任意 agent 即完整技能）。
/// 目录规则与写盘逻辑在 lib 的 skills 模块（与桌面应用「安装/检查技能」共用）
pub(crate) fn run_skill(rest: &[String]) -> Result<serde_json::Value, CliError> {
    let sub = rest.first().map(String::as_str).unwrap_or("");
    let p = parse_args(&rest[1.min(rest.len())..]);
    let dir_flag = p.flag("dir").map(str::to_string);
    match sub {
        "show" => {
            print!("{SKILL_MD}");
            for (rel, content) in SKILL_REFS {
                print!("\n\n---\n\n# 附：{rel}\n\n{content}");
            }
            std::process::exit(0);
        }
        "install" => {
            let agent = p.positional(0, "agent 名（claude-code / opencode / pi）")?;
            let dir = skill_dir_for(&agent, dir_flag.as_deref()).map_err(|m| CliError(m, 2))?;
            let (previous, path) = local_install(&dir).map_err(|m| CliError(m, 1))?;
            Ok(json!({
                "installed": true,
                "version": SKILL_VERSION,
                "previousVersion": previous,
                "updated": previous.as_deref().is_some_and(|v| v != SKILL_VERSION),
                "agent": agent,
                "path": path,
            }))
        }
        _ => Err(usage_err("skill 子命令支持 install / show，用法见 pk help")),
    }
}
