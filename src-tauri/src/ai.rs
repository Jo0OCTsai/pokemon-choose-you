use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
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
/// 无头调用本地 agent 进程完成分类，替代旧的 OpenAI 兼容 HTTP 接口。
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
    /// 单次调用超时（秒）
    pub timeout_secs: u64,
    pub enabled: bool,
    /// 分类结果的回收方式：text = 解析 agent 输出的 JSON 文本（旧）；
    /// tools = agent 通过 pk CLI 把判定写回数据库，应用从库回读（新，无文本解析）
    #[serde(default)]
    pub mode: String,
    /// SSH 远程执行（None = 本地执行）
    #[serde(default)]
    pub remote: Option<AgentRemote>,
}

impl AgentConfig {
    /// tools 模式：agent 经 pk 工具提交判定，应用侧不解析其文本输出
    pub fn uses_tools(&self) -> bool {
        self.mode == "tools"
    }
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            command: String::new(),
            args: String::new(),
            history_args: String::new(),
            timeout_secs: 120,
            enabled: true,
            mode: "text".into(),
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
            let remote_line = std::iter::once(agent.command.as_str())
                .chain(args.iter().map(String::as_str))
                .filter(|a| !a.contains("{prompt}"))
                .map(posix_quote)
                .collect::<Vec<_>>()
                .join(" ");
            // 整行再整体引用：ssh 会把 argv 用空格拼接后交远端 shell 重解析，
            // 不整体引用时 -lc 只吞到第一个词（如 `claude`），其余参数全被降级成位置参数丢失
            // ——单命令侥幸无感（claude 管道 stdin 等价 -p），带 --allowedTools 等参数时必错
            argv.push(posix_quote(&remote_line));
            Invocation {
                program: ssh_bin(),
                argv,
                stdin: Some(prompt.to_string()),
                remote_host: Some(r.host.clone()),
            }
        }
    }
}

/// POSIX 单引号引用：ssh 把 argv 拼接后交远端 shell 重解析，含特殊字符的参数须整体引用
fn posix_quote(s: &str) -> String {
    let safe = !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_./=@:%+".contains(&b));
    if safe {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', r"'\''"))
    }
}

/// 打开历史记录界面的实际命令行（本地直启 / 远程 ssh 转发）
pub fn history_invocation(agent: &AgentConfig) -> (String, Vec<String>) {
    let args: Vec<String> = agent
        .history_args
        .split_whitespace()
        .map(String::from)
        .collect();
    match agent.remote.as_ref().filter(|r| !r.host.trim().is_empty()) {
        None => (agent.command.clone(), args),
        Some(r) => {
            let mut argv = vec![
                "-o".to_string(),
                "BatchMode=yes".to_string(),
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
            let remote_line = std::iter::once(agent.command.as_str())
                .chain(args.iter().map(String::as_str))
                .map(posix_quote)
                .collect::<Vec<_>>()
                .join(" ");
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

/// 分类时的判重上下文：现有未完成待办 + 可用分类/标签，
/// 由调用方从库里加载后拼进 prompt，AI 借此判重并为新待办决定全部属性
#[derive(Debug, Clone, Default)]
pub struct ClassifyContext {
    /// (task_id, title)
    pub open_tasks: Vec<(i64, String)>,
    pub categories: Vec<String>,
    /// (name, description)
    pub tags: Vec<(String, String)>,
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
    pub tags: Vec<String>,
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

const SYSTEM_PROMPT: &str = r#"你是待办事项提取助手。给你一组 IM 消息（含来源、发送者、内容与同会话上下文）、用户当前未完成的待办清单、可用分类和标签，找出其中隐含的待办事项、承诺、或对方希望你完成/参加的事情。
规则：
- 每条消息带「来源」标签：单聊是对方直接对你说的，语气常更直接；群聊可能是@你或不点名安排；「与机器人的私聊」是用户发给助手 bot 的，是用户给自己记的备忘/指令，同样要提取。上下文里标注为「我」的是用户自己说的话，只用于理解指代与时间，不是待办来源。
- 同会话上下文仅供参考：帮你理解对话背景（前因后果、时间指代），最终判断只针对消息本身。
- 只提取"需要用户行动"的内容（任务、承诺、会议、deadline、请求）。闲聊、通知、纯信息分享不算。
- 判重：判定待办前先对照「现有待办清单」。如果已有本质相同的未完成待办，绝不再生成新待办，改按下面 update / followUp / none 的规则处理。
- action 只能是 "todo"、"update"、"followUp"、"none" 之一：
  - todo：新的待办事项。
  - update：消息明确修改现有待办的属性（改期/改时间、调整优先级、更换标题、变更交付要求）。填 updateTaskId，且只填需要变更的字段（title/note/priority/due/tags），不变的字段留空、tags 用 [] 表示不变；需要变更标签时给出完整的新标签数组。
  - followUp：消息是现有待办的补充信息、进展汇报或确认，不改变任务本身属性。填 followUpTaskId。
  - none：只是重复提及、没有新信息。
- title 用简短的祈使句中文概括要做的事（不超过 20 字）。
- note 一句话补充上下文（谁提出的、在哪里、要什么），没有就留空。
- category 从「可用分类」里选最贴切的一个。
- priority 从 low/normal/high/urgent 里选：对方明确催促或当天到期用 urgent/high，默认 normal。
- due: 消息里有明确时间就用 YYYY-MM-DDTHH:MM 格式（参考「当前时间」换算年份），否则留空。
- tags: 从「可用标签」里选 0~3 个最贴切的标签名组成数组，没有合适的返回 []。
- followUpTaskId 只在 action="followUp" 时填写，updateTaskId 只在 action="update" 时填写，取值都必须是「现有待办清单」里出现的 id。
- reason: 一句话中文说明判定理由（如「对方明确要求周五前交付」/「与待办 No.3 本质相同」/「纯信息分享无需行动」），不超过 30 字。
- confidence: 从 high/medium/low 里选：消息直白明确用 high；依赖语境推断（指代、隐含的时间或对象）用 medium；拿不准、像又不像的用 low。
你的最终回复必须只包含一个 JSON 对象（不要解释、不要 Markdown 代码块），格式：{"results":[{"messageId":"m1","action":"todo","title":"...","note":"...","category":"...","priority":"normal","due":"...","tags":[],"followUpTaskId":null,"updateTaskId":null,"reason":"...","confidence":"high"}]}"#;

/// 组装分类请求的正文：判重上下文 + 消息列表（含来源与同会话上下文）
fn build_user_content(batch: &[AiMessage], ctx: &ClassifyContext) -> String {
    let mut s = String::new();
    s.push_str(&format!(
        "当前时间：{}\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M（%A）")
    ));
    if ctx.open_tasks.is_empty() {
        s.push_str("现有待办清单：（无）\n");
    } else {
        s.push_str("现有待办清单（id. 标题）：\n");
        for (id, title) in &ctx.open_tasks {
            s.push_str(&format!("[{id}] {title}\n"));
        }
    }
    s.push_str(&format!("可用分类：{}\n", ctx.categories.join("/")));
    if ctx.tags.is_empty() {
        s.push_str("可用标签：无\n");
    } else {
        s.push_str("可用标签（名称：描述）：\n");
        for (name, desc) in &ctx.tags {
            if desc.is_empty() {
                s.push_str(&format!("{name}\n"));
            } else {
                s.push_str(&format!("{name}：{desc}\n"));
            }
        }
    }
    s.push_str(&render_messages(batch));
    s
}

/// 消息列表渲染（两种模式的正文共用）：[id] + 来源 + 发送者 + 内容 + 同会话上下文
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

/// agent CLI 接收单段提示词：规则 + 判重上下文 + 消息
fn build_prompt(batch: &[AiMessage], ctx: &ClassifyContext) -> String {
    format!("{SYSTEM_PROMPT}\n\n{}", build_user_content(batch, ctx))
}

/// tools 模式系统提示词：判定规则与 SYSTEM_PROMPT 一致，但结果经 pk 工具写回数据库。
/// 判重上下文（待办清单/分类/标签）由 agent 自行 `pk context` 获取；
/// <AGENT_ID> 占位符替换为该 agent 的 id（pk 侧记录建议来源）。
const TOOLS_SYSTEM_PROMPT: &str = r#"你是待办事项提取助手，通过 pk 命令行工具工作。给你一组 IM 消息（含来源、发送者、内容与同会话上下文），找出其中隐含的待办事项、承诺、或对方希望你完成/参加的事情，并把判定结果用 pk 工具写回数据库。
规则：
- 每条消息带「来源」标签：单聊是对方直接对你说的，语气常更直接；群聊可能是@你或不点名安排；「与机器人的私聊」是用户发给助手 bot 的，是用户给自己记的备忘/指令，同样要提取。上下文里标注为「我」的是用户自己说的话，只用于理解指代与时间，不是待办来源。
- 同会话上下文仅供参考：帮你理解对话背景（前因后果、时间指代），最终判断只针对消息本身。
- 只提取"需要用户行动"的内容（任务、承诺、会议、deadline、请求）。闲聊、通知、纯信息分享不算。
- 判重：先执行 `pk context` 拿现有待办清单；已有本质相同的未完成待办时绝不再新建，改按 update / followUp / none 处理。
- action 只能是 "todo"、"update"、"followUp"、"none" 之一：
  - todo：新的待办事项。
  - update：消息明确修改现有待办的属性（改期/改时间、调整优先级、更换标题、变更交付要求）。填 updateTaskId，且只填需要变更的字段（title/note/priority/due/tags），不变的字段留空、tags 用 [] 表示不变；需要变更标签时给出完整的新标签数组。
  - followUp：消息是现有待办的补充信息、进展汇报或确认，不改变任务本身属性。填 followUpTaskId。
  - none：只是重复提及、没有新信息。
- title 用简短的祈使句中文概括要做的事（不超过 20 字）。
- note 一句话补充上下文（谁提出的、在哪里、要什么），没有就留空。
- category 从 pk context 的 categories 里选最贴切的一个，不要发明不存在的名字。
- priority 从 low/normal/high/urgent 里选：对方明确催促或当天到期用 urgent/high，默认 normal。
- due: 消息里有明确时间就用 YYYY-MM-DDTHH:MM 格式（对照 pk context 的 now 换算年份），否则留空。
- tags: 从 pk context 的 tags 里选 0~3 个最贴切的标签名组成数组，没有合适的用 []。
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
    ctx: &ClassifyContext,
    db: &crate::db::Db,
) -> AppResult<Vec<AiSuggestion>> {
    classify_with_session(agent, batch, ctx, db)
        .await
        .map(|(s, _)| s)
}

/// 分类一批消息并带回会话元信息（session_id）：按 agent 的 mode 分派——
/// text = 无头调用后解析 stdout JSON；tools = agent 经 pk 落库、应用回读
pub async fn classify_with_session(
    agent: &AgentConfig,
    batch: &[AiMessage],
    ctx: &ClassifyContext,
    db: &crate::db::Db,
) -> AppResult<(Vec<AiSuggestion>, Option<String>)> {
    if agent.uses_tools() {
        classify_tools_with_session(agent, batch, db).await
    } else {
        classify_text_with_session(agent, batch, ctx).await
    }
}

/// text 模式：无头调用 agent CLI，解析其输出中的 JSON 建议
async fn classify_text_with_session(
    agent: &AgentConfig,
    batch: &[AiMessage],
    ctx: &ClassifyContext,
) -> AppResult<(Vec<AiSuggestion>, Option<String>)> {
    let prompt = build_prompt(batch, ctx);
    log::debug!(
        "ai: 经 agent「{}」分类 {} 条消息，prompt: {}",
        agent.name,
        batch.len(),
        trunc(&prompt, 500)
    );
    let out = run_agent(agent, &prompt).await?;
    log::debug!("ai: agent 原始输出: {}", trunc(&out, 800));
    parse_suggestions_with_session(&out)
}

/// tools 模式：agent 通过 pk 工具把判定写回数据库，应用不解析其文本输出，
/// 跑完后从库回读该批消息的判定结果；stdout 仅提取 session_id 供遥测回链
async fn classify_tools_with_session(
    agent: &AgentConfig,
    batch: &[AiMessage],
    db: &crate::db::Db,
) -> AppResult<(Vec<AiSuggestion>, Option<String>)> {
    let prompt = build_tools_prompt(agent, batch);
    log::debug!(
        "ai: 经 agent「{}」（tools 模式）分类 {} 条消息，prompt: {}",
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
        crate::commands::radio::load_suggestions_conn(&conn, &ids)?
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

/// 无头调用 agent：本地执行或 SSH 远程执行（见 build_invocation 的组装规则）
pub async fn run_agent(agent: &AgentConfig, prompt: &str) -> AppResult<String> {
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
    run_process(
        &inv.program,
        &inv.argv,
        inv.stdin.as_deref(),
        pk_dir.as_deref(),
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
/// pk_dir 非空时前插进子进程 PATH（见 run_agent）。
async fn run_process(
    program: &str,
    argv: &[String],
    stdin: Option<&str>,
    pk_dir: Option<&std::path::Path>,
    timeout: Duration,
) -> AppResult<String> {
    match spawn_and_wait(program, argv, stdin, pk_dir, timeout).await {
        Ok(out) => Ok(out),
        #[cfg(windows)]
        Err(AppError::Invalid(_)) => {
            let mut cmd_argv = vec!["/C".to_string(), program.to_string()];
            cmd_argv.extend(argv.iter().cloned());
            spawn_and_wait("cmd", &cmd_argv, stdin, pk_dir, timeout).await
        }
        Err(e) => Err(e),
    }
}

async fn spawn_and_wait(
    program: &str,
    argv: &[String],
    stdin: Option<&str>,
    pk_dir: Option<&std::path::Path>,
    timeout: Duration,
) -> AppResult<String> {
    let mut cmd = tokio::process::Command::new(program);
    if let Some(path) = pk_dir.and_then(augmented_path) {
        cmd.env("PATH", path);
    }
    // 注入共享日志文件路径：agent 的 Bash 工具把它继承给 pk，pk 的执行轨迹
    // 写回应用日志（诊断页可见）；远程 ssh 模式下环境不透传，等价于无日志，无副作用
    if let Some(log_file) = crate::logshare::agent_log_file() {
        cmd.env("PK_LOG_FILE", log_file);
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

/// pk 目录前插到当前 PATH 前面（保留原有条目）；当前进程没有 PATH 或拼接失败时返回
/// None，保持子进程环境原样
fn augmented_path(dir: &std::path::Path) -> Option<std::ffi::OsString> {
    augment_path(dir, std::env::var_os("PATH"))
}

/// augmented_path 的纯函数版（测试用）
fn augment_path(
    dir: &std::path::Path,
    base: Option<std::ffi::OsString>,
) -> Option<std::ffi::OsString> {
    let mut dirs = vec![dir.to_path_buf()];
    dirs.extend(std::env::split_paths(&base?));
    std::env::join_paths(dirs).ok()
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

/// 解析 agent 输出：剥 ```json 包裹；前后有闲聊文字时截取首尾花括号之间的 JSON；要求 results 数组
#[cfg(test)]
fn parse_suggestions(content: &str) -> AppResult<Vec<AiSuggestion>> {
    parse_suggestions_with_session(content).map(|(s, _)| s)
}

/// 解析 agent 输出并带回会话 id（claude 信封里的 session_id，供会话回链落库）
fn parse_suggestions_with_session(content: &str) -> AppResult<(Vec<AiSuggestion>, Option<String>)> {
    let (content, session_id) = extract_payload(content);
    let content = content
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    let parsed: serde_json::Value = serde_json::from_str(content)
        .or_else(|_| {
            // agent 前后爱加解释文字：截取首个 { 到最后一个 } 之间再试一次
            let slice = match (content.find('{'), content.rfind('}')) {
                (Some(s), Some(e)) if s < e => &content[s..=e],
                _ => "",
            };
            serde_json::from_str(slice)
        })
        .map_err(|e| AppError::External(format!("AI 输出不是合法 JSON: {e}")))?;
    let results = parsed["results"].as_array().cloned().or_else(|| {
        // 兼容旧字段名 suggestions
        parsed["suggestions"].as_array().cloned()
    });
    let results = results.ok_or_else(|| AppError::External("AI 输出缺少 results 数组".into()))?;
    let suggestions = serde_json::from_value(serde_json::Value::Array(results))
        .map_err(|e| AppError::External(format!("解析建议失败: {e}")))?;
    Ok((suggestions, session_id))
}

/// 日志截断：按字符数截断（中文安全），避免长消息刷爆 512KB 轮转日志
fn trunc(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// 连接测试：text 模式让 agent 处理一条内置测试消息并验证能识别出待办；
/// tools 模式改为工具探针（跑 pk context），一次验证命令可用 + shell 白名单 + PATH + 数据库可达
pub async fn test(agent: &AgentConfig) -> AppResult<String> {
    if agent.uses_tools() {
        return test_tools(agent).await;
    }
    let ctx = ClassifyContext {
        categories: vec!["工作".into()],
        ..Default::default()
    };
    let res = classify_text_with_session(
        agent,
        &[AiMessage::simple("test", "系统", "明天上午10点开周会")],
        &ctx,
    )
    .await
    .map(|(r, _)| r);
    match res {
        Ok(r) if r.first().is_some_and(|s| s.is_todo()) => Ok(format!(
            "Agent 调用成功，并正确识别出测试待办「{}」",
            r[0].title.clone().unwrap_or_default()
        )),
        Ok(_) => Ok("Agent 调用成功，但未识别出测试待办，建议检查 agent 配置或更换模型".into()),
        Err(e) => Err(e),
    }
}

/// tools 模式连接测试：让 agent 执行 pk context 并原样返回输出
async fn test_tools(agent: &AgentConfig) -> AppResult<String> {
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
    fn tools_mode_config_and_prompt() {
        // 旧配置（无 mode 字段）按 text 解析；显式 tools 生效
        let legacy: AgentConfig = serde_json::from_str(
            r#"{"id":"ag1","name":"Claude","command":"claude","args":"","history_args":"","timeout_secs":60,"enabled":true}"#,
        )
        .unwrap();
        assert!(!legacy.uses_tools(), "旧配置缺省 text 模式");
        let tools: AgentConfig =
            serde_json::from_str(r#"{"id":"ag2","name":"C","command":"claude","mode":"tools"}"#)
                .unwrap();
        assert!(tools.uses_tools());

        let prompt = build_tools_prompt(
            &tools,
            &[AiMessage::simple("om_9", "老板", "明天 10 点开周会")],
        );
        assert!(prompt.contains("pk suggest batch"), "指示批量提交");
        assert!(prompt.contains("--agent ag2"), "带上 agent id 记录建议来源");
        assert!(prompt.contains("[om_9]"), "消息 id 在正文");
        assert!(
            !prompt.contains("现有待办清单（id. 标题）"),
            "判重上下文改由 agent 用 pk context 获取，不再内嵌正文"
        );
        assert!(
            !prompt.contains("最终回复必须只包含一个 JSON 对象"),
            "tools 模式不再要求输出 JSON 文本"
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
        let (prog, argv) = history_invocation(&b);
        assert_eq!(prog, "ssh");
        assert!(argv.contains(&"--".to_string()) && argv.contains(&"box".to_string()));
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

    // ---- build_prompt：判重上下文与消息语境必须进提示词 ----

    #[test]
    fn prompt_carries_rules_dedup_context_and_chat_meta() {
        let ctx = ClassifyContext {
            open_tasks: vec![(3, "写周报".into()), (5, "修登录 bug".into())],
            categories: vec!["工作".into(), "学习".into()],
            tags: vec![
                ("重要".into(), "核心目标相关".into()),
                ("杂".into(), String::new()),
            ],
        };
        let msg = AiMessage {
            message_id: "m1".into(),
            sender: "张三".into(),
            chat_label: "飞书·群聊「项目群」".into(),
            content: "开会".into(),
            context: vec!["09:58 张三: 明天要过进度".into()],
        };
        let s = build_prompt(&[msg], &ctx);
        assert!(s.contains("待办事项提取助手"), "规则进 prompt");
        assert!(s.contains("[3] 写周报"), "待办清单进 prompt");
        assert!(s.contains("可用分类：工作/学习"));
        assert!(s.contains("重要：核心目标相关"));
        assert!(s.contains("来源：飞书·群聊「项目群」"), "来源标签进 prompt");
        assert!(s.contains("发送者：张三"));
        assert!(s.contains("内容：开会"));
        assert!(
            s.contains("同会话上下文（仅供参考）") && s.contains("09:58 张三"),
            "上下文行进 prompt"
        );
        assert!(s.contains("当前时间："));
        assert!(s.contains("updateTaskId"), "update 动作在规则中说明");
        assert!(
            s.contains("reason") && s.contains("confidence"),
            "判定理由与置信档位在规则中说明"
        );
    }

    #[test]
    fn prompt_empty_context_degrades_gracefully() {
        let s = build_prompt(&[], &ClassifyContext::default());
        assert!(s.contains("（无）"));
        assert!(s.contains("可用标签：无"));
        // 规则文案里也提到同会话上下文，这里断言的是消息区不渲染上下文段（带全角括号标题）
        assert!(
            !s.contains("同会话上下文（仅供参考）："),
            "无上下文不渲染该段"
        );
    }

    // ---- parse_suggestions：宽容解析各种 agent 输出 ----

    #[test]
    fn parse_unwraps_claude_json_envelope() {
        let inner = r#"{"results":[{"messageId":"m1","action":"todo","title":"参加周会"}]}"#;
        let wrapped = serde_json::json!({ "type": "result", "result": inner }).to_string();
        let out = parse_suggestions(&wrapped).unwrap();
        assert!(out[0].is_todo());
    }

    /// claude 信封里的 session_id 随解析带回（会话回链落库用）
    #[test]
    fn parse_extracts_session_id_from_envelope() {
        let inner = r#"{"results":[{"messageId":"m1","action":"todo"}]}"#;
        let wrapped = serde_json::json!({ "result": inner, "session_id": "sess-abc" }).to_string();
        let (out, session) = parse_suggestions_with_session(&wrapped).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(session.as_deref(), Some("sess-abc"));
        // 无信封的普通输出没有会话 id
        let (_, none) = parse_suggestions_with_session(inner).unwrap();
        assert!(none.is_none());
    }

    #[test]
    fn parse_strips_code_fence_and_chatter() {
        let results = r#"{"results":[{"messageId":"m1","action":"none"}]}"#;
        let chatty = format!("好的，以下是我的分析：\n```json\n{results}\n```\n希望有帮助！");
        let out = parse_suggestions(&chatty).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].action, "none");
    }

    #[test]
    fn parse_errors_on_non_json() {
        let err = parse_suggestions("我觉得这不是待办").unwrap_err();
        assert!(
            err.to_string().contains("JSON"),
            "错误信息说明不是合法 JSON"
        );
    }

    #[test]
    fn parse_accepts_legacy_suggestions_key() {
        let out =
            parse_suggestions(r#"{"suggestions":[{"messageId":"m1","action":"todo"}]}"#).unwrap();
        assert!(out[0].is_todo());
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

        fn ctx() -> ClassifyContext {
            ClassifyContext {
                open_tasks: vec![(3, "写周报".into())],
                categories: vec!["工作".into()],
                tags: vec![("重要".into(), String::new())],
            }
        }

        fn run(agent: &AgentConfig) -> AppResult<Vec<AiSuggestion>> {
            // text 模式不触库，回读句柄仅为满足 classify 的签名
            let db = crate::db::Db(std::sync::Mutex::new(
                rusqlite::Connection::open_in_memory().unwrap(),
            ));
            tauri::async_runtime::block_on(classify(
                agent,
                &[AiMessage::simple("m1", "张三", "明天上午10点开周会")],
                &ctx(),
                &db,
            ))
        }

        #[test]
        fn classify_parses_todo_with_full_attributes() {
            let agent = fake_agent(
                "ok",
                "",
                r#"{"results":[{"messageId":"m1","action":"todo","title":"参加周会","note":"张三在项目群安排","category":"工作","priority":"high","due":"2026-09-13T10:00","tags":["重要"],"followUpTaskId":null,"reason":"张三明确安排了会议时间","confidence":"high"}]}"#,
            );
            let out = run(&agent).unwrap();
            assert_eq!(out.len(), 1);
            assert!(out[0].is_todo());
            assert_eq!(out[0].title.as_deref(), Some("参加周会"));
            assert_eq!(out[0].note.as_deref(), Some("张三在项目群安排"));
            assert_eq!(out[0].priority.as_deref(), Some("high"));
            assert_eq!(out[0].tags, vec!["重要".to_string()]);
            assert_eq!(out[0].due.as_deref(), Some("2026-09-13T10:00"));
            assert_eq!(
                out[0].reason.as_deref(),
                Some("张三明确安排了会议时间"),
                "判定理由随建议透传"
            );
            assert_eq!(out[0].confidence.as_deref(), Some("high"));
        }

        /// reason / confidence 缺省不报错（旧模型 / 简化输出）
        #[test]
        fn classify_tolerates_missing_reason_and_confidence() {
            let agent = fake_agent(
                "bare",
                "",
                r#"{"results":[{"messageId":"m1","action":"todo","title":"参加周会"}]}"#,
            );
            let out = run(&agent).unwrap();
            assert!(out[0].reason.is_none());
            assert!(out[0].confidence.is_none());
        }

        #[test]
        fn classify_parses_follow_up_action() {
            let agent = fake_agent(
                "follow",
                "",
                r#"{"results":[{"messageId":"m1","action":"followUp","followUpTaskId":3,"title":"周会改期"}]}"#,
            );
            let out = run(&agent).unwrap();
            assert!(out[0].is_follow_up());
            assert!(!out[0].is_todo());
            assert_eq!(out[0].follow_up_task_id, Some(3));
        }

        /// update 动作（AI 动作扩展）：解析出 updateTaskId 与部分变更字段
        #[test]
        fn classify_parses_update_action() {
            let agent = fake_agent(
                "update",
                "",
                r#"{"results":[{"messageId":"m1","action":"update","updateTaskId":3,"due":"2026-09-15T10:00","tags":["重要"]}]}"#,
            );
            let out = run(&agent).unwrap();
            assert!(out[0].is_update());
            assert!(!out[0].is_todo() && !out[0].is_follow_up());
            assert_eq!(out[0].update_task_id, Some(3));
            assert_eq!(out[0].due.as_deref(), Some("2026-09-15T10:00"));
            assert_eq!(out[0].tags, vec!["重要".to_string()]);
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
                mode: "text".into(),
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
            let _ = run(&agent);
            let stdin = std::fs::read_to_string(&marker).unwrap();
            assert!(
                stdin.contains("现有待办清单") && stdin.contains("发送者：张三"),
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
            let _ = run(&agent);
            let argv = std::fs::read_to_string(&marker).unwrap();
            assert!(
                argv.contains("待办事项提取助手"),
                "{{prompt}} 占位符替换为完整提示词: {argv}"
            );
        }

        #[test]
        fn classify_maps_nonzero_exit_to_external_error() {
            let agent = fake_agent("boom", "echo 'model exploded' >&2; exit 3", "{}");
            let err = run(&agent).unwrap_err();
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
        fn classify_times_out_slow_agent() {
            // 直接测 run_process 的超时（run_agent 有 10 秒下限，单测等不起）
            let agent = fake_agent("slow", "sleep 10", "{}");
            let started = std::time::Instant::now();
            let err = tauri::async_runtime::block_on(run_process(
                &agent.command,
                &[],
                None,
                None,
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

        /// 测试命令：能识别出待办的 agent 返回成功文案，识别不出的给出建议
        #[test]
        fn test_reports_recognized_todo() {
            let good = fake_agent(
                "test_good",
                "",
                r#"{"results":[{"messageId":"test","action":"todo","title":"参加周会"}]}"#,
            );
            let msg = tauri::async_runtime::block_on(test(&good)).unwrap();
            assert!(msg.contains("参加周会"), "成功文案带识别出的标题: {msg}");

            let blind = fake_agent(
                "test_blind",
                "",
                r#"{"results":[{"messageId":"test","action":"none"}]}"#,
            );
            let msg = tauri::async_runtime::block_on(test(&blind)).unwrap();
            assert!(msg.contains("未识别"), "未识别时给出建议: {msg}");
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
                Some(&pk_dir),
                Duration::from_secs(10),
            ))
            .unwrap();
            assert!(
                out.contains("openTasks"),
                "注入的 pk 目录应排在子进程 PATH 首位，裸名 pk 可执行: {out}"
            );
            std::fs::remove_dir_all(&dir).ok();
        }
    }

    /// PATH 前插：注入目录排最前、原有条目全保留；无 PATH 时返回 None 保持原环境
    #[cfg(unix)]
    #[test]
    fn augment_path_prepends_dir_and_keeps_entries() {
        let base = std::env::join_paths(["/usr/bin", "/bin"]).ok();
        let got = augment_path(std::path::Path::new("/opt/app"), base).unwrap();
        let parts: Vec<PathBuf> = std::env::split_paths(&got).collect();
        assert_eq!(parts[0], PathBuf::from("/opt/app"), "注入目录排最前");
        assert!(
            parts.contains(&PathBuf::from("/usr/bin")),
            "原有条目保留: {got:?}"
        );
        assert_eq!(
            augment_path(std::path::Path::new("/opt/app"), None),
            None,
            "无 PATH 时不改写环境"
        );
    }
}
