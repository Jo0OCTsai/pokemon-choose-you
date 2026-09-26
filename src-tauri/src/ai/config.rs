//! agent 调用配置：AgentConfig / AgentRemote 的结构与从 settings 的解析加载。
use serde::{Deserialize, Serialize};

/// SSH 远程执行配置：agent CLI 装在远程机器（工作站/服务器）上时，
/// 本地经 `ssh host -- command` 无头调用，提示词走 stdin。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentRemote {
    /// ssh 目标（user@host）
    pub host: String,
    /// ssh 端口
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    /// 私钥路径（空则走 ssh 默认 ~/.ssh/id_*）
    pub key_path: Option<String>,
    /// 反向隧道端口：随这条 ssh 连接把远程侧 127.0.0.1:<port> 转发回本机 sshd，
    /// 供远程主机上的 pk 透传 shim 回连执行（agent 在远程、数据在本机的场景）。
    /// None = 不建隧道（远程 shim 需能直连本机）。
    #[serde(default)]
    pub tunnel: Option<u16>,
    /// 常驻反向隧道：开启后应用驻留期间由隧道管理器维持 ssh -N -R 长连
    /// （keepalive + 退避重连），远程任何进程（无头 agent / tmux / 手动 ssh）
    /// 随时可调 pk，不再依赖应用发起调用的存活窗口。见 REMOTE_PK_CHANNEL_PROPOSAL §5。
    #[serde(default)]
    pub persistent: bool,
}

fn default_ssh_port() -> u16 {
    22
}

impl Default for AgentRemote {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: default_ssh_port(),
            key_path: None,
            tunnel: None,
            persistent: false,
        }
    }
}

/// 一个 AI agent CLI 工具的调用配置（Claude Code / OpenCode / pi 等），
/// 无头调用本地 agent 进程完成分类。判定结果统一由 agent 经 pk CLI 写回数据库，
/// 应用从库回读，不解析 agent 的文本输出。
/// remote 配置后改为经 SSH 在远程机器执行。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentConfig {
    pub id: String,
    pub name: String,
    /// 可执行文件名或绝对路径，如 claude / opencode / pi
    pub command: String,
    /// 附加参数（按空白切分）。{prompt} 占位符替换为提示词；未出现时提示词经标准输入传入；
    /// SSH 远程模式下占位符元素被剔除、提示词一律走标准输入
    pub args: String,
    /// 打开历史记录界面用的参数（按空白切分），如 claude 的 --resume；空则直接启动
    pub history_args: String,
    /// 工作目录（空 = ~/.choose-you/workspace，支持 ~ 前缀）：
    /// agent 及其工具的相对路径基准；远程模式下是远程机器上的路径
    pub workdir: String,
    /// 单次调用超时（秒）
    pub timeout_secs: u64,
    pub enabled: bool,
    /// SSH 远程执行（None = 本地执行）
    #[serde(default)]
    pub remote: Option<AgentRemote>,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            command: String::new(),
            args: String::new(),
            history_args: String::new(),
            workdir: String::new(),
            timeout_secs: 120,
            enabled: true,
            remote: None,
        }
    }
}

/// 从 settings 读取 agent 列表（ai_agents 键，JSON 数组）；坏数据按未配置处理
pub fn load_agents(get: &dyn Fn(&str) -> Option<String>) -> Vec<AgentConfig> {
    let raw = get("ai_agents").unwrap_or_default();
    let list: Vec<AgentConfig> = serde_json::from_str(&raw).unwrap_or_default();
    list.into_iter()
        .filter(|a| !a.command.trim().is_empty())
        .collect()
}

/// 收音机分类使用的 agent：优先 ai_agent_id 指定的启用项，否则第一个启用项
pub fn primary_agent(get: &dyn Fn(&str) -> Option<String>) -> Option<AgentConfig> {
    let agents = load_agents(get);
    let preferred = get("ai_agent_id").unwrap_or_default();
    agents
        .iter()
        .find(|a| a.enabled && a.id == preferred)
        .cloned()
        .or_else(|| agents.iter().find(|a| a.enabled).cloned())
}

pub fn agent_by_id(get: &dyn Fn(&str) -> Option<String>, id: &str) -> Option<AgentConfig> {
    load_agents(get).into_iter().find(|a| a.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造持有数据的设置读取闭包（避免借用临时数组）
    fn getter(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: std::collections::HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k| map.get(k).cloned()
    }

    fn agents_json(agents: &[(&str, &str, &str, bool)]) -> String {
        serde_json::to_string(
            &agents
                .iter()
                .map(|(id, name, command, enabled)| AgentConfig {
                    id: id.to_string(),
                    name: name.to_string(),
                    command: command.to_string(),
                    enabled: *enabled,
                    ..Default::default()
                })
                .collect::<Vec<_>>(),
        )
        .unwrap()
    }

    // ---- 配置加载与主 agent 选择 ----

    #[test]
    fn load_agents_parses_list_and_skips_empty_commands() {
        let raw = agents_json(&[
            ("a1", "Claude Code", "claude", true),
            ("a2", "坏的", "", true),
        ]);
        let get = getter(&[("ai_agents", raw.as_str())]);
        let agents = load_agents(&get);
        assert_eq!(agents.len(), 1, "空命令的条目丢弃");
        assert_eq!(agents[0].command, "claude");
        assert_eq!(agents[0].timeout_secs, 120, "缺省超时 120 秒");
    }

    #[test]
    fn load_agents_tolerates_invalid_json() {
        let get = getter(&[("ai_agents", "not-json")]);
        assert!(load_agents(&get).is_empty(), "坏数据按未配置处理");
    }

    #[test]
    fn primary_agent_prefers_configured_id_then_first_enabled() {
        let raw = agents_json(&[
            ("a1", "A", "cmd-a", true),
            ("a2", "B", "cmd-b", true),
            ("a3", "C", "cmd-c", false),
        ]);
        // 指定 a2 → 用 a2
        let get = getter(&[("ai_agents", raw.as_str()), ("ai_agent_id", "a2")]);
        assert_eq!(primary_agent(&get).unwrap().id, "a2");
        // 未指定 → 第一个启用的
        let get = getter(&[("ai_agents", raw.as_str())]);
        assert_eq!(primary_agent(&get).unwrap().id, "a1");
        // 指向已停用条目 → 回落第一个启用的
        let get = getter(&[("ai_agents", raw.as_str()), ("ai_agent_id", "a3")]);
        assert_eq!(primary_agent(&get).unwrap().id, "a1");
        // 只有停用的 → 无可用 agent
        let only_disabled = agents_json(&[("a3", "C", "cmd-c", false)]);
        let get = getter(&[("ai_agents", only_disabled.as_str())]);
        assert!(primary_agent(&get).is_none());
    }

    #[test]
    fn agent_by_id_finds_agent() {
        let raw = agents_json(&[("a1", "A", "cmd-a", false)]);
        let get = getter(&[("ai_agents", raw.as_str())]);
        assert!(
            agent_by_id(&get, "a1").is_some(),
            "停用的也能按 id 取（测试/历史入口用）"
        );
        assert!(agent_by_id(&get, "nope").is_none());
    }

    /// ai_agents JSON 带 remote（camelCase）往返；缺省无 remote 也兼容
    #[test]
    fn load_agents_parses_remote_config() {
        let raw = r#"[{"id":"r1","name":"远程 Claude","command":"claude","args":"-p {prompt}",
                      "historyArgs":"","timeoutSecs":180,"enabled":true,
                      "remote":{"host":"dev@box","port":2222,"keyPath":"/home/me/.ssh/id"}}]"#;
        let get = getter(&[("ai_agents", raw)]);
        let agents = load_agents(&get);
        assert_eq!(agents.len(), 1);
        let r = agents[0].remote.as_ref().unwrap();
        assert_eq!(r.host, "dev@box");
        assert_eq!(r.port, 2222);
        assert_eq!(r.key_path.as_deref(), Some("/home/me/.ssh/id"));
        // port 缺省回落 22
        let raw2 = r#"[{"id":"r2","name":"x","command":"claude","remote":{"host":"box"}}]"#;
        let get2 = getter(&[("ai_agents", raw2)]);
        assert_eq!(load_agents(&get2)[0].remote.as_ref().unwrap().port, 22);
        // 老配置（无 remote）照常
        let raw3 = r#"[{"id":"r3","name":"本地","command":"claude"}]"#;
        let get3 = getter(&[("ai_agents", raw3)]);
        assert!(load_agents(&get3)[0].remote.is_none());
    }
}
