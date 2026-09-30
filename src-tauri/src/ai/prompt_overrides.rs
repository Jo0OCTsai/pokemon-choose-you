//! 提示词覆盖（editable-prompts）：4 个可编辑 AI 功能的目录常量表、运行时解析器
//! （读覆盖 → 可用性校验 → 回落编译默认）、保存校验、占位符单遍渲染与未知占位符
//! 扫描。settings 行经 getter 闭包注入（与 config::load_agents(get) 同一模式），
//! 纯函数不持连接不持锁；行的 upsert/DELETE 由 commands 层执行。
//! 调用侧每次现场解析、无缓存——「保存后下一次调用 100% 生效」NFR 的机制保证。
use super::prompts::{
    CAPTURE_SYSTEM_PROMPT, PET_CHAT_SYSTEM_PROMPT, TAG_HEALTH_SYSTEM_PROMPT, TOOLS_SYSTEM_PROMPT,
};
use crate::error::{AppError, AppResult};

/// 单条覆盖的长度上限（Unicode code points：Rust chars().count()，后端最终权威）
pub(crate) const PROMPT_MAX_CHARS: usize = 20_000;

/// 派发功能 id（目录第 5 项）：无存储行、不可编辑，默认文本是真实拼装的示例渲染
/// （dispatch_prompt_example，由 commands 层组装为固定值项）
pub(crate) const PROMPT_DISPATCH_ID: &str = "dispatch";

/// 提示词覆盖键前缀（settings 表）：list_all_settings 过滤与导出/导入排除共用单源谓词
pub(crate) const PROMPT_KEY_PREFIX: &str = "ai_prompt_";

/// 一个可编辑功能的目录项（编译期常量单源：存储键 / 默认文本 / 必要占位符）
pub(crate) struct PromptSpec {
    /// 功能标识（稳定唯一，前端据此映射 i18n 名称）
    pub(crate) id: &'static str,
    /// 覆盖存储键（settings 表）
    pub(crate) storage_key: Option<&'static str>,
    /// 是否开放编辑（表内恒 true；dispatch 只读项不入本表）
    pub(crate) editable: bool,
    /// 编译内置默认全文（恢复默认的基准，随应用升级演进）
    pub(crate) default_text: &'static str,
    /// 必要占位符（保存与运行时双重校验，缺失即阻断/回落；空集 = 无动态注入点）
    pub(crate) required_placeholders: &'static [&'static str],
}

const IM_CLASSIFY_SPEC: PromptSpec = PromptSpec {
    id: "im_classify",
    storage_key: Some("ai_prompt_im_classify"),
    editable: true,
    default_text: TOOLS_SYSTEM_PROMPT,
    required_placeholders: &["<AGENT_ID>"],
};

const CAPTURE_SPEC: PromptSpec = PromptSpec {
    id: "capture",
    storage_key: Some("ai_prompt_capture"),
    editable: true,
    default_text: CAPTURE_SYSTEM_PROMPT,
    required_placeholders: &["<AGENT_ID>"],
};

const PET_CHAT_SPEC: PromptSpec = PromptSpec {
    id: "pet_chat",
    storage_key: Some("ai_prompt_pet_chat"),
    editable: true,
    default_text: PET_CHAT_SYSTEM_PROMPT,
    required_placeholders: &["<CONTEXT>", "<QUESTION>"],
};

const TAG_HEALTH_SPEC: PromptSpec = PromptSpec {
    id: "tag_health",
    storage_key: Some("ai_prompt_tag_health"),
    editable: true,
    default_text: TAG_HEALTH_SYSTEM_PROMPT,
    required_placeholders: &[],
};

/// 可编辑功能目录（顺序即设置页展示序；dispatch 只读项由 commands 层追加为第 5 项）
pub(crate) const PROMPT_SPECS: &[PromptSpec] = &[
    IM_CLASSIFY_SPEC,
    CAPTURE_SPEC,
    PET_CHAT_SPEC,
    TAG_HEALTH_SPEC,
];

/// 调用点入口的功能标识（judge / pet / tag_health 现场解析用；
/// dispatch 无覆盖解析、不入枚举）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PromptFeature {
    ImClassify,
    Capture,
    PetChat,
    TagHealth,
}

impl PromptFeature {
    /// 该功能的目录项
    pub(crate) fn spec(self) -> &'static PromptSpec {
        match self {
            PromptFeature::ImClassify => &IM_CLASSIFY_SPEC,
            PromptFeature::Capture => &CAPTURE_SPEC,
            PromptFeature::PetChat => &PET_CHAT_SPEC,
            PromptFeature::TagHealth => &TAG_HEALTH_SPEC,
        }
    }
}

/// 生效来源三态（与 SDD 状态图一一对应；snake_case 序列化即前端契约字面量）。
/// pub：作为 Tauri 响应结构 PromptSpecInfo 字段类型的可见性下限
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PromptSource {
    /// 无行 / 空白 / 与默认逐字一致：生效文本 = 内置默认，无警示
    Default,
    /// 覆盖可用（非空白、≠默认、≤上限、必要占位符齐全）
    Custom,
    /// 行存在且非空白但不可用：文本回落默认 + 警示（携带 missing / overlong）
    DefaultWarned,
}

/// 运行时解析结果：生效文本 + 来源 + 不可用详情（仅 DefaultWarned 携带后两者）
#[derive(Debug, Clone)]
pub(crate) struct ResolvedPrompt {
    pub(crate) text: String,
    pub(crate) source: PromptSource,
    pub(crate) missing: Vec<&'static str>,
    pub(crate) overlong: bool,
}

/// 保存判定结果：删行（恢复默认语义）或落库（携带未知占位符警告）
#[derive(Debug, Clone)]
pub(crate) enum PromptSave {
    /// 空白或与默认逐字一致：DELETE 该行（防幻影自定义 / 默认演进后被旧文本钉死）
    Delete,
    /// 校验通过：upsert 覆盖行；未知占位符仅警告不阻断（运行时字面保留发给 agent）
    Store { unknown_placeholders: Vec<String> },
}

/// 调用点解析入口（judge / pet / tag_health）：委托 resolve_override，
/// 以类型安全的功能标识取目录项，杜绝调用点写错存储键
pub(crate) fn effective_system_prompt(
    get: &dyn Fn(&str) -> Option<String>,
    feature: PromptFeature,
) -> ResolvedPrompt {
    resolve_override(get, feature.spec())
}

/// 运行时解析（固定优先序，与保存规则同序）：
/// ① 无行 / 空白（set_setting 旁路产物）/ 与默认逐字一致 → Default（无警示）——
/// 逐字一致判定优先于缺占位符/超长判定（目录自检保证默认必含全部必要占位符，
/// 该变体实际不可达，顺序显式化以定分止争）；
/// ② 行存在且非空白，但不满足（≤上限 && 必要占位符全部字面包含）→ 文本回落
/// 默认并标 DefaultWarned；③ 其余 → Custom，文本 = 覆盖原文。
/// 坏覆盖永不挂判定管道：判定管道只因覆盖选择不同文本，不新增失败路径。
pub(crate) fn resolve_override(
    get: &dyn Fn(&str) -> Option<String>,
    spec: &PromptSpec,
) -> ResolvedPrompt {
    let fallback = || ResolvedPrompt {
        text: spec.default_text.to_string(),
        source: PromptSource::Default,
        missing: vec![],
        overlong: false,
    };
    let resolved = match spec.storage_key.and_then(get) {
        // 无行 / 空白（set_setting 旁路产物）/ 与默认逐字一致 → 无覆盖
        None => fallback(),
        Some(v) if v.trim().is_empty() => fallback(),
        Some(v) if v == spec.default_text => fallback(),
        Some(v) => {
            let overlong = v.chars().count() > PROMPT_MAX_CHARS;
            let missing: Vec<&'static str> = spec
                .required_placeholders
                .iter()
                .copied()
                .filter(|p| !v.contains(p))
                .collect();
            if overlong || !missing.is_empty() {
                ResolvedPrompt {
                    text: spec.default_text.to_string(),
                    source: PromptSource::DefaultWarned,
                    missing,
                    overlong,
                }
            } else {
                ResolvedPrompt {
                    text: v,
                    source: PromptSource::Custom,
                    missing: vec![],
                    overlong: false,
                }
            }
        }
    };
    // 日志纪律（隐私 NFR）：只记 feature / 来源 / 长度，不记内容
    log::debug!(
        "ai prompt: feature={} source={:?} 生效长度={}",
        spec.id,
        resolved.source,
        resolved.text.chars().count()
    );
    resolved
}

/// 保存校验（后端唯一权威，判定顺序即 AD §4.2.2）：
/// 空白 → 删行；与默认逐字节一致 → 删行；超长 / 缺必要占位符 → Invalid（文案列出
/// 上限值 / 缺失占位符名）；通过 → Store + 未知占位符扫描。
/// 仅白名单 4 键的 spec 可传入（键集合校验在 commands 层，错误文案「该提示词不支持编辑」）
pub(crate) fn validate_prompt_save(spec: &PromptSpec, value: &str) -> AppResult<PromptSave> {
    if value.trim().is_empty() {
        return Ok(PromptSave::Delete);
    }
    if value == spec.default_text {
        return Ok(PromptSave::Delete);
    }
    if value.chars().count() > PROMPT_MAX_CHARS {
        return Err(AppError::Invalid(format!(
            "提示词长度超过上限（最多 {PROMPT_MAX_CHARS} 字符）"
        )));
    }
    let missing: Vec<&str> = spec
        .required_placeholders
        .iter()
        .copied()
        .filter(|p| !value.contains(p))
        .collect();
    if !missing.is_empty() {
        return Err(AppError::Invalid(format!(
            "缺少必要占位符：{}",
            missing.join("、")
        )));
    }
    Ok(PromptSave::Store {
        unknown_placeholders: scan_unknown_placeholders(value, spec.required_placeholders),
    })
}

/// 单遍扫描模板渲染：匹配到 token 输出替换值并整体跳过，替换值永不被二次扫描
/// （format! 语义）。与 build_* 的 String::replace 整串替换是有意的不对称：
/// pet_chat 为新占位符协议按单遍设计，im_classify/capture 沿用现状边界行为。
pub(crate) fn render_template(template: &str, subs: &[(&str, &str)]) -> String {
    let bytes = template.as_bytes();
    let mut out = String::with_capacity(template.len());
    let mut i = 0usize;
    while i < bytes.len() {
        // token 均以 '<' 开头（ASCII），只在命中处整体跳过——替换值不进扫描
        if bytes[i] == b'<' {
            if let Some((token, value)) = subs.iter().find(|(t, _)| template[i..].starts_with(*t)) {
                out.push_str(value);
                i += token.len();
                continue;
            }
        }
        let ch = template[i..].chars().next().expect("i 在 char 边界上");
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

/// 扫描未知占位符：匹配 `<[A-Z][A-Z0-9_]*>` 样式且不在已知集合（= 必要占位符集合）；
/// 小写 / 混合大小写 token 不告警（运行时按普通文本字面保留）。手写单遍匹配，
/// 不引入 regex 依赖；重复 token 去重保序。仅后端实现——前端只展示返回的警告清单
pub(crate) fn scan_unknown_placeholders(text: &str, known: &[&str]) -> Vec<String> {
    let bytes = text.as_bytes();
    let mut out: Vec<String> = vec![];
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'<' {
            // `<[A-Z][A-Z0-9_]*>` 手写单遍匹配（不引入 regex）
            let mut j = i + 1;
            if j < bytes.len() && bytes[j].is_ascii_uppercase() {
                j += 1;
                while j < bytes.len()
                    && (bytes[j].is_ascii_uppercase()
                        || bytes[j].is_ascii_digit()
                        || bytes[j] == b'_')
                {
                    j += 1;
                }
                if j < bytes.len() && bytes[j] == b'>' {
                    let token = &text[i..=j];
                    if !known.contains(&token) && !out.iter().any(|t| t == token) {
                        out.push(token.to_string());
                    }
                    i = j + 1;
                    continue;
                }
            }
        }
        i += text[i..]
            .chars()
            .next()
            .expect("i 在 char 边界上")
            .len_utf8();
    }
    out
}

/// key 是否为提示词覆盖键（前缀谓词，list_all_settings / export / import 共用）
pub(crate) fn is_prompt_override_key(key: &str) -> bool {
    key.starts_with(PROMPT_KEY_PREFIX)
}

/// 按存储键取可编辑目录项（save_ai_prompt 键白名单；dispatch 无键、未知键均 None）
pub(crate) fn editable_spec_by_key(key: &str) -> Option<&'static PromptSpec> {
    PROMPT_SPECS
        .iter()
        .find(|s| s.storage_key == Some(key) && s.editable)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造持有数据的设置读取闭包（避免借用临时数组，与 config.rs 测试同款）
    fn getter(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: std::collections::HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k| map.get(k).cloned()
    }

    // ---- resolve 矩阵（六分支 + 优先序锚点） ----

    /// 无行 / 空白行（set_setting 旁路产物）/ 与默认逐字一致 → Default 无警示
    #[test]
    fn resolve_defaults_for_missing_blank_or_equal_row() {
        let spec = PromptFeature::PetChat.spec();
        let none = getter(&[]);
        let r = resolve_override(&none, spec);
        assert_eq!(r.source, PromptSource::Default);
        assert_eq!(r.text, spec.default_text);
        assert!(r.missing.is_empty() && !r.overlong);

        let blank = getter(&[("ai_prompt_pet_chat", "   \n\t ")]);
        let r = resolve_override(&blank, spec);
        assert_eq!(
            r.source,
            PromptSource::Default,
            "空白行按无覆盖处理（无警示）"
        );
        assert_eq!(r.text, spec.default_text);

        let equal = getter(&[("ai_prompt_pet_chat", spec.default_text)]);
        let r = resolve_override(&equal, spec);
        assert_eq!(r.source, PromptSource::Default, "与默认逐字一致视为无覆盖");
        assert_eq!(r.text, spec.default_text);
    }

    /// 缺占位符 → DefaultWarned：文本回落默认，missing 列出缺失项
    #[test]
    fn resolve_warns_when_placeholder_missing() {
        let spec = PromptFeature::PetChat.spec();
        let bad = PET_CHAT_SYSTEM_PROMPT.replace("<CONTEXT>", "");
        let get = getter(&[("ai_prompt_pet_chat", bad.as_str())]);
        let r = resolve_override(&get, spec);
        assert_eq!(r.source, PromptSource::DefaultWarned);
        assert_eq!(r.text, spec.default_text, "生效文本回落内置默认");
        assert_eq!(r.missing, vec!["<CONTEXT>"]);
        assert!(!r.overlong);
    }

    /// 超长（> 20000 code points）→ DefaultWarned：overlong 标注，占位符齐全不再列 missing
    #[test]
    fn resolve_warns_when_overlong() {
        let spec = PromptFeature::PetChat.spec();
        let long = format!("{PET_CHAT_SYSTEM_PROMPT}{}", "长".repeat(PROMPT_MAX_CHARS));
        assert!(long.chars().count() > PROMPT_MAX_CHARS);
        let get = getter(&[("ai_prompt_pet_chat", long.as_str())]);
        let r = resolve_override(&get, spec);
        assert_eq!(r.source, PromptSource::DefaultWarned);
        assert_eq!(r.text, spec.default_text);
        assert!(r.overlong);
        assert!(r.missing.is_empty(), "占位符齐全，只报超长");
    }

    /// 合法覆盖 → Custom：文本 = 覆盖原文
    #[test]
    fn resolve_custom_when_override_valid() {
        let spec = PromptFeature::PetChat.spec();
        let custom = format!("{PET_CHAT_SYSTEM_PROMPT}\n补充：语气更皮一点。");
        let get = getter(&[("ai_prompt_pet_chat", custom.as_str())]);
        let r = resolve_override(&get, spec);
        assert_eq!(r.source, PromptSource::Custom);
        assert_eq!(r.text, custom);
        assert!(r.missing.is_empty() && !r.overlong);
    }

    /// 优先序锚定：「与默认逐字一致但默认自身缺占位符」的合成变体恒归 Default，
    /// 不因其他条件进 Warned 分支（目录自检保证真实默认必含占位符，此变体实际不可达）
    #[test]
    fn resolve_equal_to_default_takes_priority_over_warned() {
        let spec = PromptSpec {
            id: "synthetic",
            storage_key: Some("ai_prompt_synthetic"),
            editable: true,
            default_text: "默认不含占位符",
            required_placeholders: &["<AGENT_ID>"],
        };
        let get = getter(&[("ai_prompt_synthetic", "默认不含占位符")]);
        let r = resolve_override(&get, &spec);
        assert_eq!(r.source, PromptSource::Default);
        assert!(r.missing.is_empty() && !r.overlong);
    }

    // ---- save 校验矩阵 ----

    /// 空白 / 与默认逐字一致 → Delete（删行 = 恢复默认语义）
    #[test]
    fn save_blank_or_equal_deletes() {
        let spec = PromptFeature::PetChat.spec();
        assert!(matches!(
            validate_prompt_save(spec, "  \n "),
            Ok(PromptSave::Delete)
        ));
        assert!(matches!(
            validate_prompt_save(spec, spec.default_text),
            Ok(PromptSave::Delete)
        ));
    }

    /// 超长 → Invalid 且文案含上限值
    #[test]
    fn save_rejects_overlong_with_limit_hint() {
        let spec = PromptFeature::PetChat.spec();
        let long = format!("{PET_CHAT_SYSTEM_PROMPT}{}", "长".repeat(PROMPT_MAX_CHARS));
        let err = validate_prompt_save(spec, &long).unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)), "{err}");
        assert!(err.to_string().contains("20000"), "提示上限值: {err}");
    }

    /// 缺必要占位符 → Invalid 且文案列出缺失占位符名
    #[test]
    fn save_rejects_missing_placeholders_listing_names() {
        let spec = PromptFeature::PetChat.spec();
        let bad = PET_CHAT_SYSTEM_PROMPT
            .replace("<CONTEXT>", "上下文")
            .replace("<QUESTION>", "问题");
        let err = validate_prompt_save(spec, &bad).unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)), "{err}");
        assert!(err.to_string().contains("<CONTEXT>"), "列出缺失名: {err}");
        assert!(err.to_string().contains("<QUESTION>"), "列出缺失名: {err}");
    }

    /// 合法 + 未知占位符：放行并警告——`<UPPER_SNAKE>` 样式才告警且去重，
    /// 小写 / 混合大小写 token 不告警，已知占位符不告警
    #[test]
    fn save_accepts_and_warns_unknown_placeholders() {
        let spec = PromptFeature::PetChat.spec();
        let value = format!(
            "{PET_CHAT_SYSTEM_PROMPT}\n额外规则 <FOO> 与 <FOO> 重复，\
             小写 <foo> 与混合 <Foo> 不告警，已知 <CONTEXT> 不告警。"
        );
        let saved = validate_prompt_save(spec, &value).unwrap();
        match saved {
            PromptSave::Store {
                unknown_placeholders,
            } => assert_eq!(unknown_placeholders, vec!["<FOO>".to_string()]),
            other => panic!("合法覆盖应放行: {other:?}"),
        }
    }

    // ---- render_template ----

    /// 单遍不重扫：替换值里含另一 token 字面量不被二次替换（format! 语义）
    #[test]
    fn render_template_single_pass_no_rescan() {
        let out = render_template(
            "A <CONTEXT> B",
            &[("<CONTEXT>", "<QUESTION>值"), ("<QUESTION>", "真值")],
        );
        assert_eq!(out, "A <QUESTION>值 B", "替换值中的 token 字面保留");
    }

    /// 多次出现全部替换、中文安全、未知 token 字面保留（与 format! 对拍）
    #[test]
    fn render_template_replaces_all_and_keeps_unknown() {
        let out = render_template(
            "前<CONTEXT>中<QUESTION>后<CONTEXT>尾<FOO>",
            &[("<CONTEXT>", "上下文"), ("<QUESTION>", "问题")],
        );
        assert_eq!(out, "前上下文中问题后上下文尾<FOO>");
        assert_eq!(
            out,
            format!("前{}中{}后{}尾<FOO>", "上下文", "问题", "上下文")
        );
    }

    // ---- token 扫描边界 ----

    /// 样式边界：数字开头 / 单字符 / 换行截断 / 空串均不算占位符
    #[test]
    fn scan_unknown_placeholder_style_edges() {
        let known = &["<CONTEXT>"];
        assert_eq!(
            scan_unknown_placeholders("a <FOO> b <FOO>", known),
            vec!["<FOO>".to_string()],
            "去重保序"
        );
        assert!(scan_unknown_placeholders("<3D> <_X> <> <F oo <", known).is_empty());
        assert!(
            scan_unknown_placeholders("<FOO", known).is_empty(),
            "未闭合不匹配"
        );
        assert_eq!(
            scan_unknown_placeholders("<<FOO>", known),
            vec!["<FOO>".to_string()],
            "前缀杂讯不吞掉后续 token"
        );
    }

    // ---- 目录自检 ----

    /// 每个可编辑 spec 默认文本包含其全部必要占位符；4 键唯一且可编辑；
    /// 上限常量与目录一致（lengthLimit 由该常量派生）
    #[test]
    fn catalog_specs_are_self_consistent() {
        assert_eq!(PROMPT_SPECS.len(), 4);
        let mut keys = std::collections::HashSet::new();
        let mut ids = std::collections::HashSet::new();
        for s in PROMPT_SPECS {
            assert!(s.editable, "目录内全部可编辑: {}", s.id);
            let key = s.storage_key.expect("目录项必有存储键");
            assert!(keys.insert(key), "存储键唯一: {key}");
            assert!(ids.insert(s.id), "功能 id 唯一: {}", s.id);
            for p in s.required_placeholders {
                assert!(
                    s.default_text.contains(p),
                    "{} 的默认文本缺必要占位符 {p}",
                    s.id
                );
            }
        }
        assert_eq!(PROMPT_MAX_CHARS, 20_000, "上限常量 = 契约值");
    }

    /// 键前缀谓词与白名单查找
    #[test]
    fn key_predicate_and_lookup() {
        assert!(is_prompt_override_key("ai_prompt_pet_chat"));
        assert!(is_prompt_override_key("ai_prompt_"));
        assert!(!is_prompt_override_key("language"));
        assert!(!is_prompt_override_key("ai_promptx"), "前缀须带下划线结尾");
        for s in PROMPT_SPECS {
            let key = s.storage_key.unwrap();
            assert_eq!(editable_spec_by_key(key).map(|s| s.id), Some(s.id));
        }
        assert!(
            editable_spec_by_key("ai_prompt_dispatch").is_none(),
            "dispatch 无键"
        );
        assert!(editable_spec_by_key("nope").is_none());
    }

    /// source 三态的序列化字面量（前端契约 default / custom / default_warned）
    #[test]
    fn prompt_source_serializes_snake_case() {
        assert_eq!(
            serde_json::to_string(&PromptSource::DefaultWarned).unwrap(),
            r#""default_warned""#
        );
        assert_eq!(
            serde_json::to_string(&PromptSource::Custom).unwrap(),
            r#""custom""#
        );
        assert_eq!(
            serde_json::to_string(&PromptSource::Default).unwrap(),
            r#""default""#
        );
    }
}
