//! agent 调用配置：AgentConfig / RemoteTarget 的结构与从 settings 的解析加载。
use serde::{Deserialize, Serialize};

/// 解析后的远程执行目标（ADR-0003：执行世界单源 = agent 部署绑定）。alias 模式——
/// 凭据与端口由 `~/.ssh/config` 承载，应用侧不再携带显式连接参数。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteTarget {
    /// OpenSSH 别名（部署实体的 alias）
    pub alias: String,
    /// 按需反向隧道端口（部署 pkTunnel.port；None = 本次调用不带 -R）
    pub tunnel_port: Option<u16>,
}

/// 一个 AI agent CLI 工具的调用配置（Claude Code / OpenCode / pi 等），
/// 无头调用本地 agent 进程完成分类。判定结果统一由 agent 经 pk CLI 写回数据库，
/// 应用从库回读，不解析 agent 的文本输出。
/// 部署绑定（alias）非空 = 经 `ssh <alias>` 远程执行（ADR-0003 §1）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentConfig {
    pub id: String,
    pub name: String,
    /// 可执行文件名或绝对路径，如 claude / opencode / pi / dsh
    pub command: String,
    /// 附加参数（按空白切分）。{prompt} 占位符替换为提示词；未出现时提示词经标准输入传入；
    /// SSH 远程模式下占位符元素被剔除、提示词一律走标准输入
    pub args: String,
    /// 打开历史记录界面用的参数（按空白切分），如 claude 的 --resume；空则直接启动
    pub history_args: String,
    /// 工作目录（空 = ~/.choose-you/workspace，支持 ~ 前缀）：
    /// agent 及其工具的相对路径基准；远程模式下是远程机器上的路径
    pub workdir: String,
    /// pk 技能根目录覆盖（空 = 按 command 推断的 agent 全局根目录，支持 ~ 前缀）：
    /// 技能落 <根>/pokemon-choose-you；自定义 agent 或非标准落点时指定；
    /// 远程模式下是远程机器上的路径
    #[serde(default)]
    pub skill_dir: Option<String>,
    /// 单次调用超时（秒）
    pub timeout_secs: u64,
    pub enabled: bool,
    /// 绑定的远程部署 alias（执行世界单源——ADR-0003 §1；与 TS
    /// AgentConfig.deployment 一一对应，级联改写经类型化往返不丢字段）
    #[serde(default)]
    pub deployment: Option<String>,
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
            skill_dir: None,
            timeout_secs: 120,
            enabled: true,
            deployment: None,
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
    fn load_agents_parses_deployment_and_ignores_legacy_remote() {
        // deployment 绑定解析（ADR-0003 执行世界单源）；旧 remote 键容忍丢弃
        let raw = r#"[{"id":"r1","name":"x","command":"claude","deployment":"gpu-1","remote":{"host":"dev@box","port":2222,"keyPath":"/home/me/.ssh/id"}}]"#;
        let get = getter(&[("ai_agents", raw)]);
        let agents = load_agents(&get);
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].deployment.as_deref(), Some("gpu-1"));
        // 无绑定照常（本机执行）
        let raw3 = r#"[{"id":"r3","name":"本地","command":"claude"}]"#;
        let get3 = getter(&[("ai_agents", raw3)]);
        assert!(load_agents(&get3)[0].deployment.is_none());
    }

    #[test]
    fn load_agents_parses_skill_dir() {
        let raw = r#"[{"id":"c1","name":"自定义","command":"my-agent","skillDir":"~/my-skills"}]"#;
        let get = getter(&[("ai_agents", raw)]);
        assert_eq!(
            load_agents(&get)[0].skill_dir.as_deref(),
            Some("~/my-skills")
        );
        let raw2 = r#"[{"id":"c2","name":"老配置","command":"claude"}]"#;
        let get2 = getter(&[("ai_agents", raw2)]);
        assert!(load_agents(&get2)[0].skill_dir.is_none(), "缺省无覆盖");
    }
}
