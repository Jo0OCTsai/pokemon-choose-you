//! AI 提示词设置面命令（editable-prompts）：查看目录（4 个可编辑功能 + 派发只读
//! 样例，共 5 项）与保存/恢复默认（空白 = 恢复默认）。校验单源在 ai 层
//! （validate_prompt_save），此处只做键白名单、落库（upsert/DELETE，含删除语义
//! 故不走 set_setting）与事件广播；查看与调用面共用同一解析函数，状态展示与
//! 实际生效按构造一致。
use crate::ai::{self, PromptSource};
use crate::commands::dispatch::dispatch_prompt_example;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::events;
use rusqlite::params;
use tauri::State;

/// 前端视图模型：一个功能的目录 + 当前生效状态（camelCase，契约见 AD §4.2.1）
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptSpecInfo {
    /// 功能标识（前端据此映射 i18n 名称）
    pub id: String,
    /// 覆盖存储键（dispatch 为 null）
    pub storage_key: Option<String>,
    /// 是否开放编辑（dispatch 为 false）
    pub editable: bool,
    /// 当前版本编译内置默认全文（dispatch = 示例渲染）
    pub default_text: String,
    /// 必要占位符清单
    pub required_placeholders: Vec<String>,
    /// 长度上限（code points）
    pub length_limit: usize,
    /// 已存覆盖原文（default_warned 也返回，供修复；未存为 null）
    pub override_text: Option<String>,
    /// 生效来源（与运行时解析器同一函数产出）
    pub source: PromptSource,
    /// 缺失的必要占位符（仅 default_warned 非空）
    pub missing_placeholders: Vec<String>,
    /// 是否超长（仅 default_warned 可为 true）
    pub overlong: bool,
}

/// 派发项（目录第 5 项）：无存储行、状态机不入态的固定值 + 真实拼装的示例渲染
/// （AD §4.2.3：保存派发键在 save_ai_prompt 的键白名单处被拒）
fn dispatch_info() -> PromptSpecInfo {
    PromptSpecInfo {
        id: ai::PROMPT_DISPATCH_ID.into(),
        storage_key: None,
        editable: false,
        default_text: dispatch_prompt_example(),
        required_placeholders: vec![],
        length_limit: ai::PROMPT_MAX_CHARS,
        override_text: None,
        source: PromptSource::Default,
        missing_placeholders: vec![],
        overlong: false,
    }
}

/// 可编辑项的视图模型：overrideText 回传原始行（未经解析），source/missing/overlong
/// 与运行时解析同源
fn editable_info(spec: &ai::PromptSpec, get: &dyn Fn(&str) -> Option<String>) -> PromptSpecInfo {
    let resolved = ai::resolve_override(get, spec);
    PromptSpecInfo {
        id: spec.id.into(),
        storage_key: spec.storage_key.map(Into::into),
        editable: spec.editable,
        default_text: spec.default_text.into(),
        required_placeholders: spec
            .required_placeholders
            .iter()
            .map(|p| p.to_string())
            .collect(),
        length_limit: ai::PROMPT_MAX_CHARS,
        override_text: spec.storage_key.and_then(get),
        source: resolved.source,
        missing_placeholders: resolved.missing.iter().map(|m| m.to_string()).collect(),
        overlong: resolved.overlong,
    }
}

/// 查看面唯一入口：固定 5 项（顺序即目录顺序），一个命令满足查看 NFR；
/// 不依赖 agent 配置（仅读 settings 行）
#[tauri::command]
pub fn list_ai_prompt_specs(db: State<Db>) -> AppResult<Vec<PromptSpecInfo>> {
    let conn = db.0.lock().unwrap();
    let get = |k: &str| -> Option<String> {
        conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| {
            r.get::<_, String>(0)
        })
        .ok()
    };
    let mut specs: Vec<PromptSpecInfo> = ai::PROMPT_SPECS
        .iter()
        .map(|s| editable_info(s, &get))
        .collect();
    specs.push(dispatch_info());
    Ok(specs)
}

/// save_ai_prompt 的成功响应：保存后的完整最新状态（前端直接替换面板数据、零推导）
/// + 未知占位符警告清单（非阻断）
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePromptResult {
    /// 保存后的完整最新状态（与 list 同一视图模型）
    pub spec: PromptSpecInfo,
    /// 未知占位符警告清单（非阻断；运行时字面保留发给 agent）
    pub unknown_placeholders: Vec<String>,
}

/// 保存与恢复默认的统一入口（恢复默认 = 保存空白）：键白名单 → ai 层校验 →
/// DELETE/upsert 落库 → 广播 SETTINGS_CHANGED → 回读最新状态。
/// 不经 set_setting（其只 upsert 无删除语义）
#[tauri::command]
pub fn save_ai_prompt<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    key: String,
    value: String,
) -> AppResult<SavePromptResult> {
    // 键白名单：dispatch（无键）与未知键一律拒绝，含任意键写入面收敛
    let spec = ai::editable_spec_by_key(&key)
        .ok_or_else(|| AppError::Invalid("该提示词不支持编辑".into()))?;
    let action = ai::validate_prompt_save(spec, &value)?;
    let unknown_placeholders = match action {
        ai::PromptSave::Delete => {
            {
                let conn = db.0.lock().unwrap();
                conn.execute("DELETE FROM settings WHERE key=?1", params![key])?;
            }
            log::info!("ai prompt: 删除覆盖 {}（恢复默认）", spec.id);
            vec![]
        }
        ai::PromptSave::Store {
            unknown_placeholders,
        } => {
            {
                let conn = db.0.lock().unwrap();
                // 与 set_setting 同式 upsert（此处直执：本命令含删除语义，不走 set_setting）
                conn.execute(
                    "INSERT INTO settings (key, value) VALUES (?1, ?2)
                     ON CONFLICT(key) DO UPDATE SET value=?2",
                    params![key, value],
                )?;
            }
            log::info!(
                "ai prompt: 保存覆盖 {}（{} 字符）",
                spec.id,
                value.chars().count()
            );
            unknown_placeholders
        }
    };
    events::broadcast(&app, events::SETTINGS_CHANGED);
    // 回读保存后的最新状态（与查看面同一解析函数，前端零推导）
    let spec_info = {
        let conn = db.0.lock().unwrap();
        let get = |k: &str| -> Option<String> {
            conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| {
                r.get::<_, String>(0)
            })
            .ok()
        };
        editable_info(spec, &get)
    };
    Ok(SavePromptResult {
        spec: spec_info,
        unknown_placeholders,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::test_conn;
    use crate::db::Db;
    use std::sync::Mutex;
    use tauri::Manager;

    fn setup() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(Db(Mutex::new(test_conn())));
        app
    }

    /// 模拟 set_setting 旁路直插一行（绕过 save 校验，构造 default_warned 等状态）
    fn seed_row(app: &tauri::App<tauri::test::MockRuntime>, key: &str, value: &str) {
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )
        .unwrap();
    }

    fn row_value(app: &tauri::App<tauri::test::MockRuntime>, key: &str) -> Option<String> {
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        conn.query_row(
            "SELECT value FROM settings WHERE key=?1",
            params![key],
            |r| r.get::<_, String>(0),
        )
        .ok()
    }

    fn pet_default() -> String {
        ai::PromptFeature::PetChat.spec().default_text.to_string()
    }

    /// list：固定 5 项目录序；无覆盖时全 default；dispatch 项只读固定值 + 示例渲染；
    /// 可编辑项带默认文本、占位符与上限
    #[test]
    fn list_specs_defaults_and_dispatch_entry() {
        let app = setup();
        let specs = {
            let db = app.state::<Db>();
            list_ai_prompt_specs(db).unwrap()
        };
        let ids: Vec<&str> = specs.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(
            ids,
            vec![
                "im_classify",
                "capture",
                "pet_chat",
                "tag_health",
                "dispatch"
            ]
        );
        assert!(specs.iter().all(|s| {
            s.source == PromptSource::Default
                && s.override_text.is_none()
                && !s.overlong
                && s.missing_placeholders.is_empty()
        }));
        let d = &specs[4];
        assert_eq!(d.storage_key, None);
        assert!(!d.editable);
        assert!(d.required_placeholders.is_empty());
        assert!(
            d.default_text.contains("===== 待办数据开始 ====="),
            "示例渲染"
        );
        assert!(d.default_text.contains("标题：示例：整理周会纪要"));

        let pet = &specs[2];
        assert_eq!(pet.storage_key.as_deref(), Some("ai_prompt_pet_chat"));
        assert!(pet.editable);
        assert_eq!(pet.length_limit, 20_000);
        assert_eq!(
            pet.required_placeholders,
            vec!["<CONTEXT>".to_string(), "<QUESTION>".to_string()]
        );
        assert!(pet.default_text.contains("<QUESTION>"));
    }

    /// list 三态：custom 生效文本在 defaultText 对照恒在；default_warned 的
    /// overrideText 原文回传 + missing 标注
    #[test]
    fn list_specs_reports_custom_and_warned_states() {
        let app = setup();
        seed_row(
            &app,
            "ai_prompt_pet_chat",
            &format!("{PET}\n补充规则。", PET = pet_default()),
        );
        seed_row(&app, "ai_prompt_im_classify", "我的分类规则，无占位符");
        let specs = {
            let db = app.state::<Db>();
            list_ai_prompt_specs(db).unwrap()
        };
        let pet = &specs[2];
        assert_eq!(pet.source, PromptSource::Custom);
        assert!(pet.override_text.as_deref().unwrap().contains("补充规则"));
        assert!(pet.default_text.contains("词汇表"), "默认对照恒在载荷中");

        let im = &specs[0];
        assert_eq!(im.source, PromptSource::DefaultWarned);
        assert_eq!(im.missing_placeholders, vec!["<AGENT_ID>".to_string()]);
        assert_eq!(
            im.override_text.as_deref(),
            Some("我的分类规则，无占位符"),
            "坏覆盖原文回传供修复"
        );
        assert!(
            im.default_text.contains("pk suggest batch"),
            "生效文本=默认"
        );
    }

    /// save：合法覆盖 upsert 落库 + 返回最新状态（source=custom）与未知占位符警告
    #[test]
    fn save_stores_override_and_returns_fresh_spec() {
        let app = setup();
        let value = format!("{}\n额外 <FOO>", pet_default());
        let r = {
            let db = app.state::<Db>();
            save_ai_prompt(
                app.handle().clone(),
                db,
                "ai_prompt_pet_chat".into(),
                value.clone(),
            )
        }
        .unwrap();
        assert_eq!(r.spec.source, PromptSource::Custom);
        assert_eq!(r.spec.override_text.as_deref(), Some(value.as_str()));
        assert_eq!(r.unknown_placeholders, vec!["<FOO>".to_string()]);
        assert_eq!(
            row_value(&app, "ai_prompt_pet_chat").as_deref(),
            Some(value.as_str())
        );

        // 再保存一次不同值 → upsert 覆盖（不是追加第二行）
        let v2 = format!("{}\n改过的规则", pet_default());
        {
            let db = app.state::<Db>();
            save_ai_prompt(
                app.handle().clone(),
                db,
                "ai_prompt_pet_chat".into(),
                v2.clone(),
            )
        }
        .unwrap();
        assert_eq!(
            row_value(&app, "ai_prompt_pet_chat").as_deref(),
            Some(v2.as_str())
        );
    }

    /// save：空白 / 与默认逐字一致 → 删行（等同恢复默认），响应 source=default
    #[test]
    fn save_blank_or_equal_deletes_row() {
        let app = setup();
        seed_row(&app, "ai_prompt_tag_health", "旧覆盖");
        for value in [
            "  ".to_string(),
            ai::PromptFeature::TagHealth.spec().default_text.to_string(),
        ] {
            let r = {
                let db = app.state::<Db>();
                save_ai_prompt(
                    app.handle().clone(),
                    db,
                    "ai_prompt_tag_health".into(),
                    value,
                )
            }
            .unwrap();
            assert_eq!(r.spec.source, PromptSource::Default);
            assert_eq!(r.spec.override_text, None);
            assert_eq!(row_value(&app, "ai_prompt_tag_health"), None, "行已删除");
        }
    }

    /// save 错误分支：不可编辑键（dispatch / 未知）→ 「该提示词不支持编辑」；
    /// 超长 → Invalid 含上限值；缺占位符 → Invalid 列出占位符名
    #[test]
    fn save_rejects_bad_key_overlong_and_missing_placeholders() {
        let app = setup();
        for key in ["dispatch", "ai_prompt_dispatch", "language"] {
            let err = {
                let db = app.state::<Db>();
                save_ai_prompt(app.handle().clone(), db, key.into(), "x".into())
            }
            .unwrap_err();
            assert!(err.to_string().contains("不支持编辑"), "{key}: {err}");
        }
        let long = format!("{}\n{}", pet_default(), "长".repeat(ai::PROMPT_MAX_CHARS));
        let err = {
            let db = app.state::<Db>();
            save_ai_prompt(app.handle().clone(), db, "ai_prompt_pet_chat".into(), long)
        }
        .unwrap_err();
        assert!(err.to_string().contains("20000"), "{err}");
        assert!(
            row_value(&app, "ai_prompt_pet_chat").is_none(),
            "阻断不落库"
        );

        let err = {
            let db = app.state::<Db>();
            save_ai_prompt(
                app.handle().clone(),
                db,
                "ai_prompt_pet_chat".into(),
                "没有占位符的自定义".into(),
            )
        }
        .unwrap_err();
        assert!(err.to_string().contains("<CONTEXT>"), "{err}");
    }

    /// save 成功后广播 settings-changed（与 set_setting 一致；既有消费者重拉
    /// list_all_settings 已被过滤，无明文面）
    #[test]
    fn save_broadcasts_settings_changed() {
        use std::sync::mpsc;
        use tauri::Listener;
        let app = setup();
        let (tx, rx) = mpsc::channel::<String>();
        let t1 = tx.clone();
        app.listen(events::SETTINGS_CHANGED, move |_| {
            t1.send("hit".into()).unwrap();
        });
        drop(tx);
        {
            let db = app.state::<Db>();
            save_ai_prompt(
                app.handle().clone(),
                db,
                "ai_prompt_pet_chat".into(),
                format!("{}\n规则", pet_default()),
            )
        }
        .unwrap();
        assert_eq!(rx.recv().unwrap(), "hit");
    }

    /// 序列化契约：PromptSpecInfo / SavePromptResult 的 camelCase 字段名与前端
    /// types.ts 对齐
    #[test]
    fn spec_info_json_contract() {
        let info = PromptSpecInfo {
            id: "pet_chat".into(),
            storage_key: Some("ai_prompt_pet_chat".into()),
            editable: true,
            default_text: "d".into(),
            required_placeholders: vec!["<CONTEXT>".into()],
            length_limit: 20_000,
            override_text: Some("o".into()),
            source: PromptSource::DefaultWarned,
            missing_placeholders: vec!["<CONTEXT>".into()],
            overlong: false,
        };
        let v = serde_json::to_value(&info).unwrap();
        let mut keys: Vec<String> = v.as_object().unwrap().keys().map(String::clone).collect();
        keys.sort();
        assert_eq!(
            keys,
            vec![
                "defaultText",
                "editable",
                "id",
                "lengthLimit",
                "missingPlaceholders",
                "overlong",
                "overrideText",
                "requiredPlaceholders",
                "source",
                "storageKey",
            ]
        );
        assert_eq!(v["source"], "default_warned");
        let r = serde_json::to_value(SavePromptResult {
            spec: info,
            unknown_placeholders: vec!["<FOO>".into()],
        })
        .unwrap();
        let mut rk: Vec<String> = r.as_object().unwrap().keys().map(String::clone).collect();
        rk.sort();
        assert_eq!(rk, vec!["spec", "unknownPlaceholders"]);
    }
}
