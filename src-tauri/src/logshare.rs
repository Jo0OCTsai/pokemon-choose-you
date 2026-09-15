//! 应用与 pk CLI 的日志共享。pk 由 agent（claude 等）拉起、与应用不在同一进程，
//! 其执行轨迹默认只进 agent 的上下文；应用在拉起 agent 时注入 `PK_LOG_FILE` 环境变量
//! （agent 的 Bash 工具会把它继承给 pk），pk 把一行式轨迹追加进同一日志文件，
//! 诊断页的日志视图即可看到 agent 的每次 pk 调用（与 tauri-plugin-log 的
//! `[日期][时间][target][级别] 消息` 行格式一致，见 commands::diagnostics 的解析）。

use std::path::PathBuf;
use std::sync::OnceLock;

static LOG_FILE: OnceLock<Option<PathBuf>> = OnceLock::new();

/// 应用启动时登记插件当前写入的日志文件。tauri-plugin-log 的 LogDir 目标落盘为
/// `{app_log_dir}/{package_name}.log`（与 list_log_entries 扫描的目录一致）。
/// 目录拿不到（极端环境）记 None，pk 日志随之停用，不影响主流程。
pub fn init(dir: Option<std::path::PathBuf>, app_name: &str) {
    let _ = LOG_FILE.set(dir.map(|d| d.join(format!("{app_name}.log"))));
}

/// 拉起 agent 子进程时读取，注入 PK_LOG_FILE；未登记（测试环境 / 目录缺失）返回 None
pub fn agent_log_file() -> Option<&'static PathBuf> {
    LOG_FILE.get().and_then(|o| o.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_then_agent_log_file_resolves_path() {
        init(
            Some(std::path::PathBuf::from("/tmp/logs")),
            "pokemon-choose-you",
        );
        assert_eq!(
            agent_log_file().map(|p| p.to_string_lossy().into_owned()),
            Some("/tmp/logs/pokemon-choose-you.log".to_string())
        );
        // 二次 init 不覆盖（OnceLock 语义）：后续调用仍返回首个值
        init(None, "other");
        assert!(agent_log_file().is_some());
    }
}
