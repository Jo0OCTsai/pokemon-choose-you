//! project 标签的派发元数据（tags.meta）：设置 IPC、归一与按名读取。
use crate::ai;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::TagMeta;
use rusqlite::{params, Connection};
use tauri::State;

/// 设置 project 标签的派发元数据（meta=None 清除）。仅项目维度可配——路由锚点是项目；
/// agentId 保存时校验存在，派发时才不踩空。全空值归一为 NULL（清空输入框即清除配置）。
#[tauri::command]
pub fn set_tag_meta<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    id: i64,
    meta: Option<TagMeta>,
) -> AppResult<()> {
    {
        let conn = db.0.lock().unwrap();
        let dim: String = conn
            .query_row(
                "SELECT d.key FROM tags t JOIN tag_dimensions d ON d.id = t.dimension_id
                 WHERE t.id=?1",
                params![id],
                |r| r.get(0),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound(format!("标签 {id} 不存在"))
                }
                other => AppError::Db(other),
            })?;
        if dim != "project" {
            return Err(AppError::Invalid(
                "只有「项目」维度的标签支持派发设置（路由锚点是项目单选维度）".into(),
            ));
        }
        let normalized = meta
            .map(normalize_meta)
            .filter(|m| *m != TagMeta::default());
        if let Some(agent_id) = normalized.as_ref().and_then(|m| m.agent_id.as_deref()) {
            let get = |k: &str| crate::secrets::secret_get(&conn, k);
            if ai::agent_by_id(&get, agent_id).is_none() {
                return Err(AppError::Invalid(format!(
                    "Agent「{agent_id}」不存在，请先在 设置 → 集成 添加，或改选其他 agent"
                )));
            }
        }
        let encoded = normalized
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| AppError::Db(rusqlite::Error::ToSqlConversionFailure(Box::new(e))))?;
        conn.execute("UPDATE tags SET meta=?2 WHERE id=?1", params![id, encoded])?;
    }
    crate::events::broadcast(&app, crate::events::TAGS_CHANGED);
    Ok(())
}

/// 元数据归一：trim、空串 → None
pub(crate) fn normalize_meta(m: TagMeta) -> TagMeta {
    let opt = |s: Option<String>| s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    TagMeta {
        workdir: opt(m.workdir),
        agent_id: opt(m.agent_id),
        context: opt(m.context),
    }
}

/// 按名字取 project 维度标签的 meta（task.tags 只有名字引用，无 id）
pub(crate) fn project_tag_meta(conn: &Connection, name: &str) -> Option<TagMeta> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT t.meta FROM tags t JOIN tag_dimensions d ON d.id = t.dimension_id
             WHERE d.key='project' AND t.name=?1",
            params![name],
            |r| r.get(0),
        )
        .ok()
        .flatten();
    crate::commands::tags::parse_tag_meta(raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::dispatch::testsupport::*;
    use crate::commands::tags::create_tag_conn;
    use tauri::Manager;

    #[test]
    fn set_tag_meta_only_for_project_and_validates_agent() {
        let app = setup();
        let project_id = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            create_tag_conn(&conn, "PokemonApp", "", "project", "manual")
                .unwrap()
                .id
        };
        let topic_id = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            create_tag_conn(&conn, "杂项", "", "topic", "manual")
                .unwrap()
                .id
        };
        seed_agents(
            &app.state::<Db>().0.lock().unwrap(),
            &[agent_json("ag-1", "Claude", "claude", true, "~/lab")],
        );

        // 非 project 维度拒绝
        let err = set_tag_meta(
            app.handle().clone(),
            app.state::<Db>(),
            topic_id,
            Some(TagMeta {
                workdir: Some("~/p".into()),
                ..Default::default()
            }),
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)), "{err}");

        // 指向不存在的 agent 拒绝
        let err = set_tag_meta(
            app.handle().clone(),
            app.state::<Db>(),
            project_id,
            Some(TagMeta {
                agent_id: Some("ghost".into()),
                ..Default::default()
            }),
        )
        .unwrap_err();
        assert!(err.to_string().contains("不存在"), "{err}");

        // 合法保存 → 归一（trim）→ list_tags 可读回
        set_tag_meta(
            app.handle().clone(),
            app.state::<Db>(),
            project_id,
            Some(TagMeta {
                workdir: Some("  ~/projects/app  ".into()),
                agent_id: Some("ag-1".into()),
                context: Some("  ".into()),
            }),
        )
        .unwrap();
        let tags =
            crate::commands::tags::list_tags_conn(&app.state::<Db>().0.lock().unwrap()).unwrap();
        let got = tags.iter().find(|t| t.id == project_id).unwrap();
        assert_eq!(
            got.meta,
            Some(TagMeta {
                workdir: Some("~/projects/app".into()),
                agent_id: Some("ag-1".into()),
                context: None,
            }),
            "trim 归一、空上下文剔除"
        );

        // 全空值清除（NULL），meta=None 也清除
        set_tag_meta(
            app.handle().clone(),
            app.state::<Db>(),
            project_id,
            Some(TagMeta::default()),
        )
        .unwrap();
        let tags =
            crate::commands::tags::list_tags_conn(&app.state::<Db>().0.lock().unwrap()).unwrap();
        assert!(tags
            .iter()
            .find(|t| t.id == project_id)
            .unwrap()
            .meta
            .is_none());

        let err = set_tag_meta(app.handle().clone(), app.state::<Db>(), 999, None).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "{err}");
    }
}
