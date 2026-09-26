//! 判定提示词：IM 分类与快速捕捉的系统提示词、消息列表渲染与归属标注。
use super::config::AgentConfig;
use super::types::AiMessage;

/// 归属标注：渲染层确定性判定的「这条消息是否提及了用户」，模型只做语义解释。
/// at_me：""（无）/ "at"（mention 结构命中，显式 @）/ "name"（手打文本命中称呼）。
/// same_name_risk：通讯录缓存里存在与用户称呼同名的其他成员，提示模型谨慎。
pub fn mention_note(at_me: &str, _anon_content: &str, same_name_risk: bool) -> String {
    let base = match at_me {
        "at" => "提及：@我（显式）".to_string(),
        // 名字匹配是本地文本替换，可能有误差，交给模型结合语境判断
        "name" => "提及：疑似@我（本地名字匹配，可能有误差）".to_string(),
        _ => return String::new(),
    };
    if same_name_risk {
        format!("{base}；注意：群内存在同名成员，请结合上下文谨慎判断归属")
    } else {
        base
    }
}

/// 消息列表渲染（分类提示词的正文）：[id] + 来源 + 发送者 + 归属标注 + 内容 + 同会话上下文
fn render_messages(batch: &[AiMessage]) -> String {
    let mut s = String::from("消息：\n");
    for m in batch {
        s.push_str(&format!("[{}] 来源：{}\n", m.message_id, m.chat_label));
        s.push_str(&format!("发送者：{}\n", m.sender));
        if !m.mention_note.is_empty() {
            s.push_str(&format!("{}\n", m.mention_note));
        }
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
- 人名与群名已代号化：消息内容、发送者、来源标签与上下文里的真实姓名、群聊名都已替换成稳定代号（人如 成员_a1b2、群如 群_c3d4），同一代号始终是同一人/同一会话；「我」/「@我」指用户本人。不要猜测或还原真实姓名，生成 title/note/reason 时沿用原文代号；确需以群聊语境命名新标签时直接使用群代号（保存前会自动还原成真实群名）。
- 群聊归属按标注判断：带「提及：@我（显式）」的消息明确提及了用户，默认视为可能指派给用户——除非内容明确把任务交给别人（让某代号去做、说某事由某代号负责/跟进），否则按 todo/update/followUp 正常判定；带「提及：疑似@我（本地名字匹配，可能有误差）」的，结合内容与上下文判断是否在向用户布置任务/提出请求；两种标注都出现「群内存在同名成员」警示时需更谨慎，拿不准判 none 并降低置信度。无提及标注、且上下文判断不出指派给用户的群聊消息判 none（reason 注明是给哪个代号的）。宁漏勿滥：判 none 的消息用户在收音机里仍能看到、可手动捕捉，误报则会污染待办清单。
- 同会话上下文仅供参考：帮你理解对话背景（前因后果、时间指代），最终判断只针对消息本身。
- 只提取"需要用户行动"的内容（任务、承诺、会议、deadline、请求）。闲聊、通知、纯信息分享不算。
- 判重（两步）：① 先执行 `pk context` 拿现有待办清单，已有本质相同的未完成待办时绝不再新建，改按 update / followUp / none 处理；② 本批消息互相判重——多条消息指向同一件事时，只对信息最明确最完整的一条生成 todo，其余判 none（reason 注明「与消息 [那条id] 同一件事」）。
- action 只能是 "todo"、"update"、"followUp"、"none" 之一：
  - todo：新的待办事项。
  - update：消息明确修改现有待办的属性（改期/改时间、调整优先级、更换标题、变更交付要求）。填 updateTaskId，且只填需要变更的字段（title/note/priority/due/tags），不变的字段整个省略、tags 用 [] 表示不变；需要变更标签时给出完整的新标签数组。
  - followUp：消息是现有待办的补充信息、进展汇报或确认，不改变任务本身属性。填 followUpTaskId。
  - none：只是重复提及、没有新信息，或任务不属于用户。
- title 用简短的祈使句中文概括要做的事（不超过 20 字）。
- note 一句话补充上下文（谁提出的、在哪里、要什么），没有就省略。
- category 从 pk context 的 categories 里选最贴切的一个，不要发明不存在的名字。
- priority 从 low/normal/high/urgent 里选：对方明确催促或当天到期用 urgent/high，默认 normal。
- due: 消息里有明确时间就用 YYYY-MM-DDTHH:MM 格式（对照 pk context 的 now 换算年份），否则省略。
- tags: 按维度选 0~3 个最贴切的标签，格式 [{"name":"标签名","dimension":"维度key","isNew":false}]，没有合适的用 []。「项目」维度至多 1 个；优先复用 pk context 的 tags（含 dimension）里已有的。
- 新标签：仅当某维度确实没有贴切选项、且消息里有明确依据（明确出现的项目名/人名）时才提议新标签（isNew=true 并归入该维度，名字用原文里的称呼）；模糊语境一律复用现有标签或省略，禁止为凑数造词。pk context 的 dimensions 里 remaining<=0 的维度禁止新建。归属「项目」维度时优先参考消息来源：群聊代号是稳定的会话语境，同一代号下的消息多属同一项目，可直接用群代号命名（保存前自动还原为真实群名）。
- pk context 的 tagFeedback 列出用户多次移除过的标签：没有新的明确依据不要再建议。
- followUpTaskId 只在 action="followUp" 时填写，updateTaskId 只在 action="update" 时填写，取值都必须是 pk context 的 openTasks 里出现的 id；不适用的字段整个省略，任何字段都不要填空字符串 ""（会导致整批解析失败）。
- reason: 一句话中文说明判定理由，归属类判定注明依据（如「显式@我且要求周五前交付」/「任务给成员_a1b2非用户」/「与待办 No.3 本质相同」/「纯信息分享无需行动」），不超过 30 字。
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
pub(crate) fn build_tools_prompt(agent: &AgentConfig, batch: &[AiMessage]) -> String {
    format!("{TOOLS_SYSTEM_PROMPT}\n\n{}", render_messages(batch)).replace("<AGENT_ID>", &agent.id)
}

/// 快速捕捉提示词：输入是用户在收音机手动敲的一条自然语言待办，判定结构化属性。
/// 与 IM 分类共用字段协议与 pk 出口，但语义不同——用户自己记的待办不存在
/// 「是不是给我的任务」的归属判断，默认 action=todo，重点在抽字段与判重。
const CAPTURE_SYSTEM_PROMPT: &str = r#"你是待办事项录入助手，通过 pk 命令行工具工作。用户在应用里手动输入了一条自然语言快速捕捉（自己要做的待办），把它的结构化属性判定出来，并用 pk 工具写回数据库。
规则：
- 输入一定是用户要为自己创建的待办：默认 action="todo"，不要判断任务归属，不要因为内容像闲聊而判 none。
- 人名已代号化：输入里的真实姓名已替换成稳定代号（如 成员_a1b2），生成 title/note 时沿用代号，不要还原或猜测真实姓名。
- 判重：先执行 `pk context` 拿现有待办清单，openTasks 里已有本质相同的未完成待办时不再新建——输入是对它的属性变更（改期/改优先级等）用 update，是补充信息/进展用 followUp，纯重复提及用 none（reason 注明与哪个待办重复）。
- title 用简短的祈使句中文概括要做的事（不超过 20 字），时间、分类等已被抽走的修饰不要保留。
- note 一句话保留原文里有用的上下文（对象、地点、要求），没有就省略。
- category 从 pk context 的 categories 里选最贴切的一个，不要发明不存在的名字。
- priority 从 low/normal/high/urgent 里选：用户语气紧急或当天到期用 urgent/high，默认 normal。
- due: 用户表达了时间就解析成 YYYY-MM-DDTHH:MM 格式（相对时间对照 pk context 的 now 换算：只说时间没说日期默认今天、已过则顺延明天；只说日期没说时间用 09:00），没表达就省略，禁止编造。
- tags: 按维度选 0~3 个最贴切的标签，格式 [{"name":"标签名","dimension":"维度key","isNew":false}]，没有合适的用 []。「项目」维度至多 1 个；优先复用 pk context 的 tags（含 dimension）里已有的。
- 新标签：仅当某维度确实没有贴切选项、且输入里有明确依据（明确出现的项目名/人名）时才提议新标签（isNew=true 并归入该维度，名字用原文里的称呼）；模糊语境一律复用现有标签或省略。pk context 的 dimensions 里 remaining<=0 的维度禁止新建。
- pk context 的 tagFeedback 列出用户多次移除过的标签：没有新的明确依据不要再建议。
- updateTaskId 只在 action="update" 时填写，followUpTaskId 只在 action="followUp" 时填写，取值都必须是 pk context 的 openTasks 里出现的 id；不适用的字段整个省略，任何字段都不要填空字符串 ""（会导致整批解析失败）。
- reason: 一句话中文说明判定依据（如「用户输入，含明确截止时间」/「与待办 No.3 本质相同」），不超过 30 字。
- confidence: 从 high/medium/low 里选：输入直白、无需推断用 high；需要解析相对时间或推断标签用 medium；输入含糊、靠猜的用 low。
执行流程（务必遵守）：
1. 先执行 `pk context` 获取当前时间、现有待办清单、可用分类与标签。
2. 判定正文中的这条捕捉（方括号 [ ] 里是消息 id）。
3. 把判定整理成 {"results":[...]}（字段 messageId/action/title/note/category/priority/due/tags/followUpTaskId/updateTaskId/reason/confidence），一次性提交：
   pk suggest batch --agent <AGENT_ID> <<'JSON'
   {"results":[ ... ]}
   JSON
4. 输出含 "submitted" 即成功，回复一行总结即可。校验失败会报明问题——修正后重试。
禁止：不要用 pk task create 直接建任务（录入结果的出口是 pk suggest，用户确认后生效）；不要输出 JSON 建议文本；不要编造消息 id 或待办 id。"#;

/// 快速捕捉提示词：规则 + 单条输入（sender 恒为用户本人，无同会话上下文）
pub(crate) fn build_capture_prompt(agent: &AgentConfig, input: &AiMessage) -> String {
    format!(
        "{CAPTURE_SYSTEM_PROMPT}\n\n{}",
        render_messages(std::slice::from_ref(input))
    )
    .replace("<AGENT_ID>", &agent.id)
}

#[cfg(test)]
mod tests {
    use super::*;

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

    // ---- 提示词规则完整性 ----

    #[test]
    fn tools_prompt_carries_group_ownership_and_batch_dedup_rules() {
        let p = TOOLS_SYSTEM_PROMPT;
        assert!(p.contains("群聊归属按标注判断"), "缺群聊归属规则");
        assert!(p.contains("人名与群名已代号化"), "缺假名化总则");
        assert!(p.contains("群_c3d4"), "缺群代号说明");
        assert!(
            p.contains("提及：@我（显式）") && p.contains("疑似@我"),
            "缺归属标注的两级判定规则"
        );
        assert!(p.contains("宁漏勿滥"), "缺收窄倾向说明");
        assert!(p.contains("本批消息互相判重"), "缺批内判重规则");
    }

    /// 归属标注行按 at_me 分级生成，同名风险只叠加在已有提及之上
    #[test]
    fn mention_note_levels_and_same_name_warning() {
        assert_eq!(mention_note("", "（疑似@我）无关", false), "");
        assert_eq!(mention_note("at", "", false), "提及：@我（显式）");
        assert_eq!(
            mention_note("name", "", false),
            "提及：疑似@我（本地名字匹配，可能有误差）"
        );
        let warned = mention_note("name", "", true);
        assert!(warned.contains("群内存在同名成员"), "{warned}");
    }

    /// render_messages：归属标注插在发送者与内容之间，匿名文本不回填真名
    #[test]
    fn render_messages_includes_mention_note() {
        let m = AiMessage {
            message_id: "om_1".into(),
            sender: "成员_00aa".into(),
            chat_label: "飞书·群聊「项目群」".into(),
            content: "@我 周会改到周四10点".into(),
            context: vec![],
            mention_note: mention_note("at", "", false),
        };
        let out = render_messages(std::slice::from_ref(&m));
        assert!(
            out.contains("提及：@我（显式）\n内容："),
            "标注行位于发送者与内容之间: {out}"
        );
    }
}
