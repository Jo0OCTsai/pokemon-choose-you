//! 派发路由与统一取数：agent 选择（改选 > 标签 meta > 全局默认）、生效目录、
//! 确认弹窗目标解析，以及两条通道共用的 DispatchPrep（含假名化取数）。
use super::meta::project_tag_meta;
use crate::ai::{self, AgentConfig};
use crate::commands::tasks::get_task_conn;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::{TagMeta, Task};
use rusqlite::{params, Connection};
use tauri::State;

/// 解析结果（resolve 展示与 dispatch 执行共用）
struct ResolvedRoute {
    agent: Option<AgentConfig>,
    /// pick（确认弹窗改选）/ tag（标签 meta 指定）/ default（全局默认）
    source: &'static str,
    /// 生效工作目录（meta.workdir > agent.workdir；空 = 本地 ~/.choose-you / 远端登录目录）
    workdir: String,
    /// 标签 meta 的项目补充上下文（拼进派发 prompt）
    context: Option<String>,
    project_tag: Option<String>,
}

/// 路由核心（纯查询层）：agent 取 显式改选 > 标签 meta.agentId > 全局默认
/// （ai_agent_id > 首个启用，复用收音机分类的 primary_agent 语义）；
/// meta 里指向已删除的 agent 时回落全局默认（确认弹窗展示的就是最终目标，不会被误导）
fn resolve_route(conn: &Connection, task: &Task, pick: Option<&str>) -> ResolvedRoute {
    let get = |k: &str| crate::secrets::secret_get(conn, k);
    let agents = ai::load_agents(&get);
    let project = task
        .tags
        .iter()
        .find(|t| t.dimension == "project")
        .map(|t| t.name.clone());
    let meta = project
        .as_deref()
        .and_then(|name| project_tag_meta(conn, name));
    let mut picked = pick.filter(|s| !s.trim().is_empty()).and_then(|id| {
        agents
            .iter()
            .find(|a| a.id == id)
            .map(|a| (a.clone(), "pick"))
    });
    if picked.is_none() {
        picked = meta
            .as_ref()
            .and_then(|m| m.agent_id.as_deref())
            .and_then(|id| {
                agents
                    .iter()
                    .find(|a| a.id == id)
                    .map(|a| (a.clone(), "tag"))
            });
    }
    let (agent, source) = match picked.or_else(|| ai::primary_agent(&get).map(|a| (a, "default"))) {
        Some((a, s)) => (Some(a), s),
        None => (None, "default"),
    };
    ResolvedRoute {
        workdir: effective_workdir(meta.as_ref(), agent.as_ref()),
        context: meta
            .and_then(|m| m.context)
            .filter(|c| !c.trim().is_empty()),
        agent,
        source,
        project_tag: project,
    }
}

/// 生效工作目录：标签 meta 覆盖优先（派发专用，不影响收音机分类），否则 agent 自身配置
fn effective_workdir(meta: Option<&TagMeta>, agent: Option<&AgentConfig>) -> String {
    meta.and_then(|m| m.workdir.as_deref())
        .map(str::trim)
        .filter(|w| !w.is_empty())
        .or_else(|| agent.map(|a| a.workdir.trim()).filter(|w| !w.is_empty()))
        .unwrap_or("")
        .to_string()
}

/// 确认弹窗下拉里的可改选 agent（启用的）
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchAgentOption {
    pub id: String,
    pub name: String,
    /// SSH 目标（None = 本机）
    pub ssh_host: Option<String>,
}

/// 派发目标解析结果（确认弹窗展示：agent · 机器 · 目录 · 来源）
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDispatchTarget {
    pub task_id: i64,
    pub has_project_tag: bool,
    pub project_tag: Option<String>,
    /// pick / tag / default（解析出的 agent 来自哪一层）
    pub source: String,
    pub agent_id: Option<String>,
    pub agent_name: Option<String>,
    pub ssh_host: Option<String>,
    /// 生效工作目录（空 = 本地 ~/.choose-you / 远端登录目录，前端展示缺省提示）
    pub workdir: String,
    pub context: Option<String>,
    /// 可改选的启用 agent 列表
    pub agents: Vec<DispatchAgentOption>,
}

#[tauri::command]
pub fn resolve_task_dispatch(db: State<Db>, task_id: i64) -> AppResult<TaskDispatchTarget> {
    let conn = db.0.lock().unwrap();
    resolve_target_conn(&conn, task_id)
}

fn resolve_target_conn(conn: &Connection, task_id: i64) -> AppResult<TaskDispatchTarget> {
    let task = get_task_conn(conn, task_id)?;
    let route = resolve_route(conn, &task, None);
    let get = |k: &str| crate::secrets::secret_get(conn, k);
    let agents = ai::load_agents(&get)
        .into_iter()
        .filter(|a| a.enabled)
        .map(|a| DispatchAgentOption {
            ssh_host: ssh_host_of(&a),
            id: a.id,
            name: a.name,
        })
        .collect();
    Ok(TaskDispatchTarget {
        task_id,
        has_project_tag: route.project_tag.is_some(),
        project_tag: route.project_tag,
        source: route.source.to_string(),
        ssh_host: route.agent.as_ref().and_then(ssh_host_of),
        agent_id: route.agent.as_ref().map(|a| a.id.clone()),
        agent_name: route.agent.as_ref().map(|a| a.name.clone()),
        workdir: route.workdir,
        context: route.context,
        agents,
    })
}

fn ssh_host_of(a: &AgentConfig) -> Option<String> {
    a.remote
        .as_ref()
        .filter(|r| !r.host.trim().is_empty())
        .map(|r| r.host.trim().to_string())
}

/// 派发前的统一取数（两条通道共用）：任务 + project 校验 + 路由 + 最新跟进 + 上一轮会话 id
pub(crate) struct DispatchPrep {
    pub(crate) task: Task,
    pub(crate) notes: Vec<String>,
    pub(crate) agent: AgentConfig,
    pub(crate) workdir: String,
    pub(crate) context: Option<String>,
    /// tasks.dispatched_session（claude 续接用）
    pub(crate) prev_session: Option<String>,
}

pub(crate) fn prepare_dispatch(
    db: &Db,
    task_id: i64,
    agent_id: Option<&str>,
) -> AppResult<DispatchPrep> {
    let conn = db.0.lock().unwrap();
    let task = get_task_conn(&conn, task_id)?;
    if !task.tags.iter().any(|t| t.dimension == "project") {
        return Err(AppError::Invalid(
            "先给待办挂上「项目」维度的标签再派发（图鉴机以项目标签路由 agent 与工作目录）".into(),
        ));
    }
    let route = resolve_route(&conn, &task, agent_id);
    let agent = route.agent.clone().ok_or_else(|| {
        AppError::Invalid("没有可用的 Agent：请先在 设置 → 集成 添加并启用".into())
    })?;
    let mut stmt =
        conn.prepare("SELECT content FROM task_notes WHERE task_id=?1 ORDER BY id DESC LIMIT 3")?;
    let mut notes: Vec<String> = stmt
        .query_map(params![task_id], |r| r.get::<_, String>(0))?
        .collect::<Result<_, _>>()?;
    notes.reverse();
    // 送 agent 的待办正文先过假名化（与收音机判定同一套规则）：标题/跟进/项目备注
    // 常来自飞书消息原文，真名不随派发 prompt 出机（交互/无头两条通道共用本取数）
    let rules = crate::anonymize::AnonRules::build(&conn);
    let scrubbed_title = rules.scrub_titles(&task.title);
    let scrubbed_note = task.note.as_deref().map(|n| rules.scrub_titles(n));
    for n in notes.iter_mut() {
        *n = rules.scrub_titles(n);
    }
    let context = route.context.as_deref().map(|c| rules.scrub_titles(c));
    Ok(DispatchPrep {
        prev_session: task
            .dispatched_session
            .clone()
            .filter(|s| !s.trim().is_empty()),
        task: Task {
            title: scrubbed_title,
            note: scrubbed_note,
            ..task
        },
        notes,
        agent,
        workdir: route.workdir,
        context,
    })
}

pub(crate) fn setting_of(db: &Db, key: &str) -> Option<String> {
    let conn = db.0.lock().unwrap();
    conn.query_row(
        "SELECT value FROM settings WHERE key=?1",
        params![key],
        |r| r.get::<_, String>(0),
    )
    .ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::dispatch::dispatch_task;
    use crate::commands::dispatch::testsupport::*;
    use tauri::Manager;

    #[test]
    fn resolve_prefers_tag_meta_then_global_default() {
        let app = setup();
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            seed_agents(
                &conn,
                &[
                    agent_json("ag-1", "本地 Claude", "claude", true, "~/lab"),
                    agent_json("ag-2", "远程 Claude", "claude", true, ""),
                    agent_json("ag-3", "停用", "claude", false, ""),
                ],
            );
            let meta = TagMeta {
                workdir: Some("~/projects/app".into()),
                agent_id: Some("ag-2".into()),
                context: Some("Tauri + Vue".into()),
            };
            seed_task(&conn, Some(("PokemonApp", Some(&meta))));
        }

        // 标签 meta 指定的 agent 与 workdir 覆盖
        let target = resolve_task_dispatch(app.state::<Db>(), 1).unwrap();
        assert_eq!(target.agent_id.as_deref(), Some("ag-2"));
        assert_eq!(target.source, "tag");
        assert_eq!(target.workdir, "~/projects/app");
        assert_eq!(target.context.as_deref(), Some("Tauri + Vue"));
        assert!(target.has_project_tag);
        assert_eq!(target.project_tag.as_deref(), Some("PokemonApp"));
        // 可改选列表只含启用的
        assert_eq!(
            target
                .agents
                .iter()
                .map(|a| a.id.as_str())
                .collect::<Vec<_>>(),
            vec!["ag-1", "ag-2"]
        );

        // meta 指向已删除的 agent → 回落全局默认（首个启用）+ agent 自身 workdir
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "UPDATE tags SET meta='{\"agentId\":\"ghost\",\"workdir\":\"~/projects/app\"}' WHERE name='PokemonApp'",
                [],
            )
            .unwrap();
        }
        let target = resolve_task_dispatch(app.state::<Db>(), 1).unwrap();
        assert_eq!(target.agent_id.as_deref(), Some("ag-1"));
        assert_eq!(target.source, "default");
        assert_eq!(
            target.workdir, "~/projects/app",
            "meta.workdir 不随 agent 回落丢"
        );
    }

    #[test]
    fn resolve_without_project_tag_or_agents() {
        let app = setup();
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            seed_task(&conn, None); // 无 project 标签
        }
        let target = resolve_task_dispatch(app.state::<Db>(), 1).unwrap();
        assert!(!target.has_project_tag);
        assert!(target.agent_id.is_none());
        assert!(target.agents.is_empty());
        assert_eq!(target.workdir, "");

        // 无 project 标签的任务派发被拒（派发前置校验，不进终端唤起）
        let err = tauri::async_runtime::block_on(dispatch_task(
            app.handle().clone(),
            app.state::<Db>(),
            1,
            None,
            None,
        ))
        .unwrap_err();
        assert!(err.to_string().contains("项目"), "{err}");

        let err = resolve_task_dispatch(app.state::<Db>(), 999).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "{err}");
    }
}
