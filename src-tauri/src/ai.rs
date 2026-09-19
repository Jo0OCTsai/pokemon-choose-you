use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

/// 单次 agent 调用的超时下限（秒）：agent CLI 启动 + 推理普遍慢于直连 API
const MIN_TIMEOUT_SECS: u64 = 10;

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
        }
    }
}

/// 一个 AI agent CLI 工具的调用配置（Claude Code / OpenCode / Kiro CLI 等），
/// 无头调用本地 agent 进程完成分类。判定结果统一由 agent 经 pk CLI 写回数据库，
/// 应用从库回读，不解析 agent 的文本输出。
/// remote 配置后改为经 SSH 在远程机器执行。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentConfig {
    pub id: String,
    pub name: String,
    /// 可执行文件名或绝对路径，如 claude / opencode / kiro
    pub command: String,
    /// 附加参数（按空白切分）。{prompt} 占位符替换为提示词；未出现时提示词经标准输入传入；
    /// SSH 远程模式下占位符元素被剔除、提示词一律走标准输入
    pub args: String,
    /// 打开历史记录界面用的参数（按空白切分），如 claude 的 --resume；空则直接启动
    pub history_args: String,
    /// 工作目录（空 = ~/.choose-you，支持 ~ 前缀）：
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

/// ssh 客户端程序名：PK_SSH_BIN 可覆盖（测试注入/Windows 指向 plink 的 wrapper 等）
pub fn ssh_bin() -> String {
    std::env::var("PK_SSH_BIN").unwrap_or_else(|_| "ssh".into())
}

/// 一次无头调用的实际命令行：本地直接执行 / 远程包一层 ssh
struct Invocation {
    program: String,
    argv: Vec<String>,
    stdin: Option<String>,
    /// 出错时附加上下文（远程主机）
    remote_host: Option<String>,
    /// 本地执行的工作目录（远程分支无意义：cd 已内嵌进远端命令行）
    cwd: Option<PathBuf>,
}

/// 组装实际执行的命令行（纯函数，独立测试）。
/// - 本地：args 中的 {prompt} 替换为提示词；未出现时提示词走标准输入；
///   裸命令名先经 which::resolve 补扫 GUI 进程缺失的 PATH（macOS Dock/Finder 启动
///   看不到 Homebrew/nvm 里的 claude 等），显式路径原样透传
/// - 远程：`ssh -o BatchMode=yes -o ConnectTimeout=10 [-i key] [-p port] host -- command args...`；
///   提示词一律走标准输入——ssh 会把 argv 拼接后交远端 shell 重解析，长提示词里的引号/换行必被打碎，
///   stdin 转发没有这个问题。args 中带 {prompt} 的元素剔除（如 `claude -p {prompt}` → `claude -p`，
///   -p 本身支持读 stdin），保证语义等价。
fn build_invocation(agent: &AgentConfig, prompt: &str) -> Invocation {
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
                // 反向隧道：远程侧 127.0.0.1:<tp> ⇄ 本机 sshd，供远程 pk shim 回连（仅本连接存活）
                argv.push("-R".to_string());
                argv.push(format!("127.0.0.1:{tp}:127.0.0.1:22"));
            }
            argv.push(r.host.trim().to_string());
            argv.push("--".to_string());
            // 远端经登录 shell 执行：ssh 非交互会话只加载 .zshenv/.bashrc 之外的初始化，
            // brew/nvm 的 PATH 常在 .zprofile/.bash_profile（登录时）里，包一层 $SHELL -lc 才找得到命令
            argv.push("exec".to_string());
            argv.push("\"$SHELL\"".to_string());
            argv.push("-lc".to_string());
            let mut remote_line = std::iter::once(agent.command.as_str())
                .chain(args.iter().map(String::as_str))
                .filter(|a| !a.contains("{prompt}"))
                .map(posix_quote)
                .collect::<Vec<_>>()
                .join(" ");
            // 工作目录是远程机器上的路径：cd 前缀进远端命令行（本地 cwd 管不到远端）
            if !agent.workdir.trim().is_empty() {
                remote_line = format!(
                    "cd {} && {}",
                    quote_cd_target(agent.workdir.trim()),
                    remote_line
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

/// agent 缺省工作目录名（主目录下）：应用专属工作区，agent 的产物集中在这里，
/// 不混入数据库所在的应用数据目录
const DEFAULT_WORKDIR: &str = ".choose-you";

/// agent 进程的工作目录：显式配置优先（~ 前缀展开为主目录），缺省用 ~/.choose-you。
/// GUI 进程的 cwd 不可控——Dock/Finder 启动时是 /，开发态是 src-tauri——
/// 必须显式指定，agent 的相对路径操作（读写文件、git 等）才不会落在随机位置
pub(crate) fn agent_workdir(agent: &AgentConfig) -> Option<PathBuf> {
    let configured = agent.workdir.trim();
    if configured.is_empty() {
        let dir = dirs::home_dir().map(|h| h.join(DEFAULT_WORKDIR));
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

/// 把会话 id 适配进历史参数（agent 级参数，本地远程共用）：
/// - `--resume` / `resume`（claude 语法）：id 插到该参数后 —— `claude --resume <id>`
/// - `--resume-picker`（kiro 语法）：换成按 id 恢复 —— `kiro-cli chat --resume-id <id>`
/// - 无可识别的恢复参数：不注入（如 opencode 历史参数为空，直接启动）
fn adapt_history_args(args: &mut Vec<String>, session: &str) {
    if let Some(i) = args.iter().position(|a| a == "--resume" || a == "resume") {
        // 紧跟其后插入而非追加到末尾：用户在历史参数后还配了别的开关时，
        // id 混进末尾会被当成无名参数丢掉
        args.insert(i + 1, session.to_string());
        return;
    }
    if let Some(i) = args.iter().position(|a| a == "--resume-picker") {
        args[i] = "--resume-id".into();
        args.insert(i + 1, session.to_string());
    }
}

/// 打开历史记录界面的实际命令行（本地直启 / 远程 ssh 转发）。
/// resume_session 存在时注入到历史参数里（见 adapt_history_args），直接回放该会话转录。
pub fn history_invocation(
    agent: &AgentConfig,
    resume_session: Option<&str>,
) -> (String, Vec<String>) {
    let mut args: Vec<String> = agent
        .history_args
        .split_whitespace()
        .map(String::from)
        .collect();
    if let Some(sess) = resume_session.filter(|s| !s.trim().is_empty()) {
        adapt_history_args(&mut args, sess.trim());
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
            argv.push(r.host.trim().to_string());
            argv.push("--".to_string());
            argv.push("exec".to_string());
            argv.push("\"$SHELL\"".to_string());
            argv.push("-lc".to_string());
            let mut remote_line = std::iter::once(agent.command.as_str())
                .chain(args.iter().map(String::as_str))
                .map(posix_quote)
                .collect::<Vec<_>>()
                .join(" ");
            // 同 build_invocation：远端命令行前缀 cd 切到配置的工作目录
            if !agent.workdir.trim().is_empty() {
                remote_line = format!(
                    "cd {} && {}",
                    quote_cd_target(agent.workdir.trim()),
                    remote_line
                );
            }
            // 同 build_invocation：整行整体引用，防 -lc 只吞第一个词（如 `claude --resume` 丢成裸 `claude`）
            argv.push(posix_quote(&remote_line));
            (ssh_bin(), argv)
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

/// AI 建议的标签：名字 + 归属维度 + 是否词表外新建。
/// 反序列化兼容旧协议的纯字符串（按 topic 维度、非新建解析），
/// 保证存量 chat_messages.suggested_tags 与旧 agent 输出仍可读
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
pub struct ProposedTag {
    pub name: String,
    #[serde(default)]
    pub dimension: String,
    #[serde(rename = "isNew", default)]
    pub is_new: bool,
}

impl<'de> Deserialize<'de> for ProposedTag {
    fn deserialize<D>(d: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        use serde::de::Error;
        let v = serde_json::Value::deserialize(d)?;
        match v {
            serde_json::Value::String(s) => Ok(ProposedTag {
                name: s,
                dimension: "topic".into(),
                is_new: false,
            }),
            serde_json::Value::Object(m) => {
                let dimension = m
                    .get("dimension")
                    .and_then(|x| x.as_str())
                    .unwrap_or("topic")
                    .trim()
                    .to_string();
                Ok(ProposedTag {
                    name: m
                        .get("name")
                        .and_then(|x| x.as_str())
                        .unwrap_or_default()
                        .trim()
                        .to_string(),
                    dimension: if dimension.is_empty() {
                        "topic".into()
                    } else {
                        dimension
                    },
                    is_new: m
                        .get("isNew")
                        .or_else(|| m.get("is_new"))
                        .and_then(|x| x.as_bool())
                        .unwrap_or(false),
                })
            }
            other => Err(D::Error::custom(format!(
                "标签条目应为字符串或 {{name,dimension,isNew}} 对象: {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AiSuggestion {
    #[serde(rename = "messageId")]
    pub message_id: String,
    /// todo / update / followUp / none（缺省按 none 处理）
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    /// low / normal / high / urgent
    #[serde(default)]
    pub priority: Option<String>,
    /// ISO 时间或自然语言也被接受，直接透传给用户确认
    #[serde(default)]
    pub due: Option<String>,
    #[serde(default)]
    pub tags: Vec<ProposedTag>,
    /// action=followUp 时指向现有待办 id
    #[serde(default, rename = "followUpTaskId")]
    pub follow_up_task_id: Option<i64>,
    /// action=update 时指向要更新的待办 id
    #[serde(default, rename = "updateTaskId")]
    pub update_task_id: Option<i64>,
    /// 一句话判定理由（为什么是待办 / 为什么判重 / 为什么不算），随建议展示并落反馈库
    #[serde(default)]
    pub reason: Option<String>,
    /// high / medium / low：对判定的把握，低置信建议让用户多看一眼
    #[serde(default)]
    pub confidence: Option<String>,
}

impl AiSuggestion {
    pub fn is_todo(&self) -> bool {
        self.action == "todo"
    }
    pub fn is_follow_up(&self) -> bool {
        self.action == "followUp" && self.follow_up_task_id.is_some()
    }
    /// update 建议：明确指向一个现有待办
    pub fn is_update(&self) -> bool {
        self.action == "update" && self.update_task_id.is_some()
    }
}

/// 送 AI 判定的一条消息：除内容外还携带来源语境（私聊/群聊/机器人、发送者）
/// 与同会话近期上下文，模型据此理解指代、判断"谁要谁做什么"
#[derive(Debug, Clone)]
pub struct AiMessage {
    pub message_id: String,
    /// 发送者显示名
    pub sender: String,
    /// 来源标签，如 "飞书·群聊「项目群」" / "飞书·机器人私聊"
    pub chat_label: String,
    pub content: String,
    /// 同会话上下文（已格式化的 "HH:MM 发送者: 内容" 行，按时间升序）
    pub context: Vec<String>,
}

impl AiMessage {
    /// 不带上下文的便捷构造（连接测试等场景）
    pub fn simple(message_id: &str, sender: &str, content: &str) -> Self {
        Self {
            message_id: message_id.into(),
            sender: sender.into(),
            chat_label: String::new(),
            content: content.into(),
            context: vec![],
        }
    }
}

/// 消息列表渲染（分类提示词的正文）：[id] + 来源 + 发送者 + 内容 + 同会话上下文
fn render_messages(batch: &[AiMessage]) -> String {
    let mut s = String::from("消息：\n");
    for m in batch {
        s.push_str(&format!("[{}] 来源：{}\n", m.message_id, m.chat_label));
        s.push_str(&format!("发送者：{}\n", m.sender));
        s.push_str(&format!("内容：{}\n", m.content));
        if !m.context.is_empty() {
            s.push_str("同会话上下文（仅供参考）：\n");
            for line in &m.context {
                s.push_str(&format!("  {line}\n"));
            }
        }
    }
    s
}

/// tools 模式系统提示词：判定规则与 SYSTEM_PROMPT 一致，但结果经 pk 工具写回数据库。
/// 判重上下文（待办清单/分类/标签）由 agent 自行 `pk context` 获取；
/// <AGENT_ID> 占位符替换为该 agent 的 id（pk 侧记录建议来源）。
const TOOLS_SYSTEM_PROMPT: &str = r#"你是待办事项提取助手，通过 pk 命令行工具工作。给你一组 IM 消息（含来源、发送者、内容与同会话上下文），找出其中隐含的、需要用户本人行动的待办事项、承诺、或对方希望你完成/参加的事情，并把判定结果用 pk 工具写回数据库。
规则：
- 每条消息带「来源」标签：单聊是对方直接对你说的，语气常更直接；「与机器人的私聊」是用户发给助手 bot 的，是用户给自己记的备忘/指令，同样要提取。上下文里标注为「我」的是用户自己说的话，只用于理解指代与时间，不是待办来源。
- 群聊必须先判断任务归属，只提取明确指派给用户的：内容 @我、点名让用户做、或回复/接着用户的话头向用户提出请求。消息把任务指派给别人的（@他人、点名让他人做、说某事由某人负责/跟进）是别人的任务，内容再像待办也判 none（reason 注明是 @谁/谁 的任务）；不点名且从上下文判断不出是安排给用户的，同样判 none。宁漏勿滥：判 none 的消息用户在收音机里仍能看到、可手动捕捉，误报则会污染待办清单。
- 同会话上下文仅供参考：帮你理解对话背景（前因后果、时间指代），最终判断只针对消息本身。
- 只提取"需要用户行动"的内容（任务、承诺、会议、deadline、请求）。闲聊、通知、纯信息分享不算。
- 判重（两步）：① 先执行 `pk context` 拿现有待办清单，已有本质相同的未完成待办时绝不再新建，改按 update / followUp / none 处理；② 本批消息互相判重——多条消息指向同一件事时，只对信息最明确最完整的一条生成 todo，其余判 none（reason 注明「与消息 [那条id] 同一件事」）。
- action 只能是 "todo"、"update"、"followUp"、"none" 之一：
  - todo：新的待办事项。
  - update：消息明确修改现有待办的属性（改期/改时间、调整优先级、更换标题、变更交付要求）。填 updateTaskId，且只填需要变更的字段（title/note/priority/due/tags），不变的字段留空、tags 用 [] 表示不变；需要变更标签时给出完整的新标签数组。
  - followUp：消息是现有待办的补充信息、进展汇报或确认，不改变任务本身属性。填 followUpTaskId。
  - none：只是重复提及、没有新信息，或任务不属于用户。
- title 用简短的祈使句中文概括要做的事（不超过 20 字）。
- note 一句话补充上下文（谁提出的、在哪里、要什么），没有就留空。
- category 从 pk context 的 categories 里选最贴切的一个，不要发明不存在的名字。
- priority 从 low/normal/high/urgent 里选：对方明确催促或当天到期用 urgent/high，默认 normal。
- due: 消息里有明确时间就用 YYYY-MM-DDTHH:MM 格式（对照 pk context 的 now 换算年份），否则留空。
- tags: 按维度选 0~3 个最贴切的标签，格式 [{"name":"标签名","dimension":"维度key","isNew":false}]，没有合适的用 []。「项目」维度至多 1 个；优先复用 pk context 的 tags（含 dimension）里已有的。
- 新标签：仅当某维度确实没有贴切选项、且消息里有明确依据（明确出现的项目名/人名/群名）时才提议新标签（isNew=true 并归入该维度，名字用原文里的称呼）；模糊语境一律复用现有标签或留空，禁止为凑数造词。pk context 的 dimensions 里 remaining<=0 的维度禁止新建。归属「项目」维度时优先参考消息来源（群聊名常含项目名）。
- pk context 的 tagFeedback 列出用户多次移除过的标签：没有新的明确依据不要再建议。
- followUpTaskId 只在 action="followUp" 时填写，updateTaskId 只在 action="update" 时填写，取值都必须是 pk context 的 openTasks 里出现的 id。
- reason: 一句话中文说明判定理由（如「对方明确要求周五前交付」/「与待办 No.3 本质相同」/「纯信息分享无需行动」），不超过 30 字。
- confidence: 从 high/medium/low 里选：消息直白明确用 high；依赖语境推断（指代、隐含的时间或对象）用 medium；拿不准、像又不像的用 low。
执行流程（务必遵守）：
1. 先执行 `pk context` 获取当前时间、现有待办清单、可用分类与标签。
2. 逐条判定正文中的消息（方括号 [ ] 里是消息 id）。
3. 把全部判定整理成 {"results":[...]}（字段 messageId/action/title/note/category/priority/due/tags/followUpTaskId/updateTaskId/reason/confidence），一次性提交：
   pk suggest batch --agent <AGENT_ID> <<'JSON'
   {"results":[ ... ]}
   JSON
4. 输出含 "submitted" 即成功，回复一行总结即可。校验失败会报明第几条、什么问题——修正后整批重试，已提示「已人工确认」的消息剔除即可。
禁止：不要用 pk task create 直接建任务（分类结果的出口是 pk suggest，用户需要确认后生效）；不要输出 JSON 建议文本；不要编造消息 id 或待办 id。"#;

/// tools 模式提示词：规则 + 消息列表（无判重上下文，agent 自行 pk context）
fn build_tools_prompt(agent: &AgentConfig, batch: &[AiMessage]) -> String {
    format!("{TOOLS_SYSTEM_PROMPT}\n\n{}", render_messages(batch)).replace("<AGENT_ID>", &agent.id)
}

/// 分类一批消息（便捷入口）
pub async fn classify(
    agent: &AgentConfig,
    batch: &[AiMessage],
    db: &crate::db::Db,
) -> AppResult<Vec<AiSuggestion>> {
    classify_with_session(agent, batch, db)
        .await
        .map(|(s, _)| s)
}

/// 分类一批消息并带回会话元信息（session_id）：agent 经 pk CLI 把判定写回数据库，
/// 应用不解析其文本输出，跑完后从库回读该批消息的判定结果；
/// stdout 仅提取 session_id 供遥测回链
pub async fn classify_with_session(
    agent: &AgentConfig,
    batch: &[AiMessage],
    db: &crate::db::Db,
) -> AppResult<(Vec<AiSuggestion>, Option<String>)> {
    let prompt = build_tools_prompt(agent, batch);
    log::debug!(
        "ai: 经 agent「{}」分类 {} 条消息，prompt: {}",
        agent.name,
        batch.len(),
        trunc(&prompt, 500)
    );
    let out = run_agent(agent, &prompt).await?;
    log::debug!("ai: agent 原始输出: {}", trunc(&out, 800));
    let (_, session_id) = extract_payload(&out);
    let ids: Vec<String> = batch.iter().map(|m| m.message_id.clone()).collect();
    // agent 进程已结束才拿锁，回读期间不跨 await 持锁
    let suggestions = {
        let conn = db.0.lock().unwrap();
        let mut loaded = crate::commands::radio::load_suggestions_conn(&conn, &ids)?;
        let demoted = dedup_batch_todos(&mut loaded);
        for s in loaded.iter().filter(|s| demoted.contains(&s.message_id)) {
            // agent 已把重复 todo 写进建议列：清掉建议载荷并置 none，
            // 收音机里不再出现第二张建议卡
            let _ = conn.execute(
                "UPDATE chat_messages SET ai_status='none', suggested_title=NULL, suggested_note=NULL,
                        suggested_category=NULL, suggested_due=NULL, suggested_priority=NULL,
                        suggested_tags='[]', suggested_reason=?2
                 WHERE message_id=?1",
                rusqlite::params![s.message_id, s.reason],
            );
        }
        if !demoted.is_empty() {
            log::info!("ai: 批内判重兜底，降级 {} 条重复待办", demoted.len());
        }
        loaded
    };
    // agent 退出 0 但一条都没落库（pk 不在 PATH / 工具白名单没放行等）→ 判失败，
    // 让调用方按错误路径标记，避免整批被静默标 none；部分遗漏由调用方按 none 兜底
    let missed = suggestions.iter().filter(|s| s.action == "pending").count();
    if missed == batch.len() {
        return Err(AppError::External(format!(
            "agent「{}」执行完成但没有任何判定落库（{} 条全部遗漏）——请确认其无头模式允许执行 pk 命令（工具白名单，本机 pk 目录已随调用注入 PATH）；可用「测试」按钮跑一次工具探针",
            agent.name, missed
        )));
    }
    Ok((suggestions, session_id))
}

/// 批内判重兜底：prompt 已要求模型对同一批消息互相判重，这里防漏判——
/// 规范化标题（trim/折叠空白/小写）相同的多个 todo 只留最先出现的一条，
/// 其余降级 none 并让 reason 指向保留的那条消息。返回被降级的消息 id。
fn dedup_batch_todos(suggestions: &mut [AiSuggestion]) -> Vec<String> {
    let mut first_seen: HashMap<String, String> = HashMap::new();
    let mut demoted = vec![];
    for s in suggestions.iter_mut() {
        if !s.is_todo() {
            continue;
        }
        let key: String = s
            .title
            .as_deref()
            .unwrap_or_default()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        if key.is_empty() {
            continue;
        }
        match first_seen.get(&key) {
            Some(kept_id) => {
                s.action = "none".into();
                s.title = None;
                s.category = None;
                s.due = None;
                s.priority = None;
                s.note = None;
                s.tags.clear();
                s.follow_up_task_id = None;
                s.update_task_id = None;
                s.reason = Some(format!("与消息 {kept_id} 的待办重复"));
                demoted.push(s.message_id.clone());
            }
            None => {
                first_seen.insert(key, s.message_id.clone());
            }
        }
    }
    demoted
}

/// 无头调用 agent：本地执行或 SSH 远程执行（见 build_invocation 的组装规则）
pub async fn run_agent(agent: &AgentConfig, prompt: &str) -> AppResult<String> {
    run_agent_env(agent, prompt, &[]).await
}

/// run_agent 的带环境变量版：额外键值注入子进程（远程 ssh 模式下环境不透传，等价于无注入）。
/// 派发场景用 PK_DISPATCH_TASK 标记任务 id，供 agent 的 Stop hook / pk dispatch 回传状态
pub async fn run_agent_env(
    agent: &AgentConfig,
    prompt: &str,
    envs: &[(&str, &str)],
) -> AppResult<String> {
    let inv = build_invocation(agent, prompt);
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
/// Windows 上 npm 全局命令多为 .cmd 垫片，直接 spawn 会失败，回退 cmd /C 再试一次。
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
            let mut cmd_argv = vec!["/C".to_string(), program.to_string()];
            cmd_argv.extend(argv.iter().cloned());
            spawn_and_wait("cmd", &cmd_argv, stdin, cwd, pk_dir, envs, timeout).await
        }
        Err(e) => Err(e),
    }
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
                "Agent 工作目录不存在: {}（请在设置中改正，留空则用 ~/.choose-you）",
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
    let mut child = cmd.spawn().map_err(|e| spawn_error(program, e))?;
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
fn extract_payload(content: &str) -> (String, Option<String>) {
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
fn trunc(s: &str, n: usize) -> String {
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

    // ---- tools 模式：配置兼容性与提示词 ----

    #[test]
    fn tools_prompt_carries_batch_submit_rules() {
        // 旧配置里残留的 mode 字段（对接方式已下线）被忽略，其余字段照常解析
        let legacy: AgentConfig = serde_json::from_str(
            r#"{"id":"ag1","name":"Claude","command":"claude","args":"","historyArgs":"","timeoutSecs":60,"enabled":true,"mode":"text"}"#,
        )
        .unwrap();
        assert_eq!(legacy.timeout_secs, 60, "旧配置字段照常读取");

        let agent = AgentConfig {
            id: "ag2".into(),
            ..Default::default()
        };
        let prompt = build_tools_prompt(
            &agent,
            &[AiMessage::simple("om_9", "老板", "明天 10 点开周会")],
        );
        assert!(prompt.contains("pk suggest batch"), "指示批量提交");
        assert!(prompt.contains("--agent ag2"), "带上 agent id 记录建议来源");
        assert!(prompt.contains("[om_9]"), "消息 id 在正文");
        assert!(
            !prompt.contains("现有待办清单（id. 标题）"),
            "判重上下文由 agent 用 pk context 获取，不内嵌正文"
        );
        assert!(
            !prompt.contains("最终回复必须只包含一个 JSON 对象"),
            "不要求输出 JSON 文本"
        );
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
        let inv = build_invocation(&a, "x");
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
        assert!(!build_invocation(&b, "x").argv.contains(&"-R".to_string()));
    }

    #[test]
    fn invocation_local_modes() {
        // {prompt} 占位符 → 提示词进 argv
        let mut a = AgentConfig {
            args: "-p {prompt}".into(),
            ..Default::default()
        };
        let inv = build_invocation(&a, "你好");
        assert_eq!(inv.program, "");
        assert_eq!(inv.argv, vec!["-p".to_string(), "你好".to_string()]);
        assert!(inv.stdin.is_none(), "占位符模式不走 stdin");
        assert!(inv.remote_host.is_none());

        // 无占位符 → 提示词走 stdin
        a.args = "-p".into();
        let inv = build_invocation(&a, "你好");
        assert_eq!(inv.argv, vec!["-p".to_string()]);
        assert_eq!(inv.stdin.as_deref(), Some("你好"));

        // remote 配了但 host 为空 → 仍走本地
        a.remote = Some(crate::ai::AgentRemote::default());
        let inv = build_invocation(&a, "你好");
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
        let inv = build_invocation(&a, "x");
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
        let inv = build_invocation(&r, "x");
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
            }),
            ..Default::default()
        };
        let inv = build_invocation(&a, "明天 5pm 交周报");
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
                "dev@buildbox",
                "--",
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
        let inv = build_invocation(&b, "x");
        assert_eq!(
            inv.argv,
            vec![
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=10",
                "box",
                "--",
                "exec",
                "\"$SHELL\"",
                "-lc",
                "'opencode run'",
            ]
        );
        // 历史入口也走 ssh
        let (prog, argv) = history_invocation(&b, None);
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
            build_invocation(&a, "x").cwd.as_deref(),
            Some(std::path::Path::new("/tmp/lab"))
        );

        let home = dirs::home_dir().expect("测试环境应有主目录");
        let a = AgentConfig {
            workdir: "~/proj".into(),
            ..Default::default()
        };
        assert_eq!(build_invocation(&a, "x").cwd, Some(home.join("proj")));

        // 未配置 → ~/.choose-you（应用专属工作区），不继承 GUI 进程的 cwd
        assert_eq!(
            build_invocation(&AgentConfig::default(), "x").cwd,
            Some(home.join(".choose-you"))
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
        let inv = build_invocation(&a, "x");
        let line = inv.argv.last().unwrap();
        assert!(
            line.contains("cd ~/lab && claude -p"),
            "远端命令行先 cd 到配置目录（~ 保留给远端 shell 展开），got {line}"
        );
        assert!(inv.cwd.is_none(), "远程分支不设本地 cwd");

        // 历史入口同样带 cd 前缀
        let (_, argv) = history_invocation(&a, None);
        assert!(
            argv.last().unwrap().contains("cd ~/lab && claude"),
            "历史会话也在配置目录里打开"
        );

        // cd 目标的引用规则：含空格/单引号的部分安全引用，前导 ~ 裸放
        assert_eq!(quote_cd_target("~"), "~");
        assert_eq!(quote_cd_target("~/a b"), "~/'a b'");
        assert_eq!(quote_cd_target("/it's"), "'/it'\\''s'");
    }

    /// 会话 id 注入历史参数：claude 的 --resume 后插 id；kiro 的 --resume-picker
    /// 换成 --resume-id；无恢复参数的历史不注入；本地远程行为一致
    #[test]
    fn history_invocation_injects_session_for_resume_flags() {
        // claude：--resume <id>，本地直接拼 args
        let claude = AgentConfig {
            command: "claude".into(),
            history_args: "--resume".into(),
            ..Default::default()
        };
        let (_, args) = history_invocation(&claude, Some("sess-9"));
        assert_eq!(args, vec!["--resume".to_string(), "sess-9".to_string()]);

        // kiro：--resume-picker 换成 --resume-id <id>（chat 子命令保留在前）
        let kiro = AgentConfig {
            command: "kiro-cli".into(),
            history_args: "chat --resume-picker".into(),
            ..Default::default()
        };
        let (_, args) = history_invocation(&kiro, Some("sess-9"));
        assert_eq!(
            args,
            vec![
                "chat".to_string(),
                "--resume-id".to_string(),
                "sess-9".to_string()
            ]
        );

        // 无恢复参数（opencode 等空历史）：不注入
        let plain = AgentConfig {
            command: "opencode".into(),
            history_args: String::new(),
            ..Default::default()
        };
        let (_, args) = history_invocation(&plain, Some("sess-9"));
        assert!(args.is_empty());

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
        let (_, argv) = history_invocation(&remote, Some("sess-9"));
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
        adapt_history_args(&mut mixed, "s1");
        assert_eq!(
            mixed,
            vec!["--resume", "s1", "--model", "opus"]
                .into_iter()
                .map(String::from)
                .collect::<Vec<_>>()
        );
    }

    #[cfg(unix)]
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

    /// 维度化标签协议：对象形式带 dimension/isNew；dimension 缺省归 topic；
    /// 纯字符串为旧协议（库里的存量建议仍可读）
    #[test]
    fn proposed_tag_deserializes_object_and_string_forms() {
        let tags: Vec<ProposedTag> = serde_json::from_str(
            r#"[
                {"name":"PokemonApp","dimension":"project","isNew":true},
                {"name":"重要"},
                "杂"
            ]"#,
        )
        .unwrap();
        assert_eq!(
            tags,
            vec![
                ProposedTag {
                    name: "PokemonApp".into(),
                    dimension: "project".into(),
                    is_new: true
                },
                ProposedTag {
                    name: "重要".into(),
                    dimension: "topic".into(),
                    is_new: false
                },
                ProposedTag {
                    name: "杂".into(),
                    dimension: "topic".into(),
                    is_new: false
                },
            ]
        );
    }

    // ---- dedup_batch_todos：批内判重兜底 ----

    fn todo_suggestion(id: &str, title: &str) -> AiSuggestion {
        AiSuggestion {
            message_id: id.into(),
            action: "todo".into(),
            title: Some(title.into()),
            ..Default::default()
        }
    }

    #[test]
    fn dedup_batch_todos_demotes_same_title_and_keeps_first() {
        let mut list = vec![
            todo_suggestion("m1", "发周报"),
            todo_suggestion("m2", " 发周报 "), // 仅空白差异：重复
            todo_suggestion("m3", "发周报给老板"), // 标题不同：保留
            AiSuggestion {
                message_id: "m4".into(),
                action: "none".into(),
                ..Default::default()
            },
        ];
        let demoted = dedup_batch_todos(&mut list);
        assert_eq!(demoted, vec!["m2".to_string()], "只降级重复的那条");
        assert!(list[0].is_todo(), "最先出现的保留");
        assert_eq!(list[1].action, "none", "重复条降级 none");
        assert_eq!(list[1].title, None, "降级后清掉建议载荷");
        assert!(
            list[1].reason.as_deref().unwrap().contains("m1"),
            "reason 指向保留的消息: {:?}",
            list[1].reason
        );
        assert!(list[2].is_todo(), "标题不同的不受影响");
    }

    #[test]
    fn dedup_batch_todos_normalizes_case_and_whitespace() {
        let mut list = vec![
            todo_suggestion("a1", "Send Report"),
            todo_suggestion("a2", "send   report"),
        ];
        let demoted = dedup_batch_todos(&mut list);
        assert_eq!(demoted.len(), 1, "大小写与空白折叠后视为同一待办");
        assert_eq!(list[1].action, "none");
    }

    #[test]
    fn dedup_batch_todos_keeps_empty_titles() {
        // 无标题的 todo（异常输出）不动，交给后续流程兜底
        let mut list = vec![
            AiSuggestion {
                message_id: "e1".into(),
                action: "todo".into(),
                ..Default::default()
            },
            todo_suggestion("e2", "发周报"),
        ];
        assert!(dedup_batch_todos(&mut list).is_empty());
        assert!(list.iter().all(|s| s.is_todo()));
    }

    // ---- 提示词规则完整性 ----

    #[test]
    fn tools_prompt_carries_group_ownership_and_batch_dedup_rules() {
        let p = TOOLS_SYSTEM_PROMPT;
        assert!(p.contains("群聊必须先判断任务归属"), "缺群聊归属规则");
        assert!(p.contains("是别人的任务"), "缺指派他人判 none 规则");
        assert!(p.contains("宁漏勿滥"), "缺收窄倾向说明");
        assert!(p.contains("本批消息互相判重"), "缺批内判重规则");
    }

    // ---- 进程调用链（unix 下用 /bin/sh 脚本模拟 agent） ----

    #[cfg(unix)]
    mod process_tests {
        use super::*;
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
