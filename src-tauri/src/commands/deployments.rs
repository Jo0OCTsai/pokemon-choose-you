//! 部署实体（settings 键 `dsh:deployments`）双端契约实现（ADR-0003 §1 · PROTOCOL §8）。
//!
//! 双端（本模块 / dsh-plugin remote/deployments.ts）对同一实体整读-改-整写
//! （`BEGIN IMMEDIATE` 内）；规范序 = PROTOCOL §8 字段表（map 按 id 字典序——
//! BTreeMap 天然满足；实体键 = 结构体声明序；未知键经 flatten 排尾字典序）。
//! 错误 tag 与 TS PkyError code 逐字一致（契约场景的 error 字段单源）。

use crate::ai;
use crate::error::AppResult;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 部署实体存储键（与 dsh-plugin DEPLOYMENTS_KEY 同值）
pub const DEPLOYMENTS_KEY: &str = "dsh:deployments";

/// pk 通道机器级隧道配置（ADR-0003 §2；PROTOCOL §8 pkTunnel）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PkTunnelConfig {
    /// 远端侧隧道端口（1..=65535；0 拒绝）
    pub port: u16,
    /// 常驻开关（任一宿主驻留期维持）
    pub persistent: bool,
}

/// 部署实体（PROTOCOL §8 字段表；声明序 = 规范序；provision 为 TS 权威面透传；
/// extra 捕获未知键——双端往返不丢字段）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[derive(Default)]
pub struct DeploymentEntity {
    /// 实体唯一键（新建生成；引用用 alias 不用 id）
    pub id: String,
    /// OpenSSH 别名（唯一；trim 后非空且不含空白）
    pub alias: String,
    /// 远端 node 绝对路径（拒 `~` 前缀与相对路径）
    pub node_path: String,
    /// 远端 helper 入口（provision 落定；空 = 未安装）
    pub helper_path: String,
    /// helper SHA-256（就绪判据；未就绪 = null）
    pub helper_hash: Option<String>,
    /// 远端工作目录（空 = 登录目录；同路径不变式）
    pub workdir: String,
    /// 备注
    pub note: String,
    /// draft/probing/not_ready/installing/ready/disconnected
    pub status: String,
    /// 最近错误（诊断呈现；无 = null）
    pub last_error: Option<String>,
    /// 开通向导状态机（TS 权威面，Rust 透传；未发起 = null）
    pub provision: Option<serde_json::Value>,
    /// 直连降级确认标记（仅显式确认留痕后可达 true）
    pub degraded: bool,
    /// null = 未配置（隧道不建、通道状态归零）
    pub pk_tunnel: Option<PkTunnelConfig>,
    #[serde(skip_serializing)]
    /// 未知键（双端往返保留——未来扩展字段）
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// 实体序列化：声明字段按规范序 + 未知键排尾（flatten 语义手动实现——
/// `#[serde(flatten)]` 与 `skip_serializing` 组合会让 extra 丢失，改为合并出口）
impl DeploymentEntity {
    /// 实体 → JSON Value（声明字段规范序 + 未知键排尾）
    pub fn to_value(&self) -> serde_json::Value {
        let mut obj = serde_json::to_value({
            // 借道临时结构体：跳过 extra 本体，只出声明字段

            DeploymentEntity {
                extra: BTreeMap::new(),
                ..self.clone()
            }
        })
        .unwrap_or_default();
        if let Some(map) = obj.as_object_mut() {
            for (k, v) in &self.extra {
                map.insert(k.clone(), v.clone());
            }
        }
        obj
    }
}

/// 部署模块错误（tag = TS PkyError code 逐字单源）
#[derive(Debug, thiserror::Error)]
#[error("{tag}: {message}")]
pub struct DeploymentError {
    /// 机器稳定错误 tag（TS PkyError code 逐字单源）
    pub tag: String,
    /// 人读错误信息
    pub message: String,
}

fn input_invalid(message: impl Into<String>) -> DeploymentError {
    DeploymentError {
        tag: "DEPLOYMENT_INPUT_INVALID".into(),
        message: message.into(),
    }
}

/// upsert 输入（编辑分支省略字段保持现值；pkTunnel 三态：None=保持 / Some(None)=清除 / Some(Some)=设置）
#[derive(Debug, Default, Clone)]
pub struct DeploymentUpsertInput {
    /// 实体唯一键（新建生成；引用用 alias 不用 id）
    pub id: Option<String>,
    /// OpenSSH 别名（凭据与主机身份由它承载）
    pub alias: String,
    /// 远端 node 绝对路径（拒 `~` 前缀与相对路径）
    pub node_path: Option<String>,
    /// 远端工作目录（空 = 登录目录；同路径不变式）
    pub workdir: Option<String>,
    /// 备注
    pub note: Option<String>,
    /// pkTunnel 三态（None=保持 / Some(None)=清除 / Some(Some)=设置）
    pub pk_tunnel: Option<Option<PkTunnelConfig>>,
    /// OpenSSH 别名（凭据与主机身份由它承载）
    pub confirm_alias_refs: bool,
}

/// 部署列表整读（坏 JSON 按空表；BTreeMap = id 字典序规范序）
pub fn list_deployments(conn: &Connection) -> BTreeMap<String, DeploymentEntity> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key=?1",
            [DEPLOYMENTS_KEY],
            |r| r.get(0),
        )
        .ok();
    let Some(raw) = raw else {
        return BTreeMap::new();
    };
    let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return BTreeMap::new();
    };
    let mut out = BTreeMap::new();
    for (id, v) in map {
        if let Ok(mut entity) = serde_json::from_value::<DeploymentEntity>(v.clone()) {
            // 未知键显式捕获（skip_serializing 字段不经 serde 反序列化路径）
            if let serde_json::Value::Object(fields) = &v {
                for (k, fv) in fields {
                    if !is_known_field(k) {
                        entity.extra.insert(k.clone(), fv.clone());
                    }
                }
            }
            out.insert(id, entity);
        }
    }
    out
}

fn is_known_field(key: &str) -> bool {
    matches!(
        key,
        "id" | "alias"
            | "nodePath"
            | "helperPath"
            | "helperHash"
            | "workdir"
            | "note"
            | "status"
            | "lastError"
            | "provision"
            | "degraded"
            | "pkTunnel"
    )
}

/// 部署列表整写（规范序 = PROTOCOL §8：map 按 id 字典序（BTreeMap）+ 实体声明序 +
/// 未知键排尾字典序。手拼 JSON 而非走 Value——serde_json Map 无 preserve_order 时
/// 键会被字典序重排，破坏与 TS canonicalize 的字节一致性）
pub fn store_deployments(conn: &Connection, deployments: &BTreeMap<String, DeploymentEntity>) {
    let mut out = String::from("{");
    for (i, (id, entity)) in deployments.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&serde_json::to_string(id).unwrap_or_default());
        out.push(':');
        out.push_str(&serialize_entity(entity));
    }
    out.push('}');
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        rusqlite::params![DEPLOYMENTS_KEY, out],
    )
    .ok();
}

/// 实体 → JSON 文本（声明字段按声明序 + 未知键排尾；与 TS canonicalizeEntity 同算法）
fn serialize_entity(entity: &DeploymentEntity) -> String {
    let stripped = DeploymentEntity {
        extra: BTreeMap::new(),
        ..entity.clone()
    };
    let mut s = serde_json::to_string(&stripped).unwrap_or_else(|_| "{}".into());
    if !entity.extra.is_empty() {
        s.truncate(s.len().saturating_sub(1)); // 去掉收尾 '}'
        for (k, v) in &entity.extra {
            s.push(',');
            s.push_str(&serde_json::to_string(k).unwrap_or_default());
            s.push(':');
            s.push_str(&serde_json::to_string(v).unwrap_or_else(|_| "null".into()));
        }
        s.push('}');
    }
    s
}

/// 实体唯一键（新建生成；引用用 alias 不用 id）
pub fn deployment_by_id(conn: &Connection, id: &str) -> Option<DeploymentEntity> {
    list_deployments(conn).into_values().find(|d| d.id == id)
}

/// OpenSSH 别名（凭据与主机身份由它承载）
pub fn deployment_by_alias(conn: &Connection, alias: &str) -> Option<DeploymentEntity> {
    list_deployments(conn)
        .into_values()
        .find(|d| d.alias == alias)
}

// ---- 校验（与 TS deploymentUpsert 逐条对齐；PROTOCOL §8 不变式） ----

fn validate_alias(raw: &str) -> Result<String, DeploymentError> {
    let alias = raw.trim();
    if alias.is_empty() {
        return Err(input_invalid(
            "部署别名不能为空（OpenSSH 别名，凭据由它承载）",
        ));
    }
    if alias.chars().any(char::is_whitespace) {
        return Err(input_invalid("部署别名不能包含空白字符"));
    }
    Ok(alias.to_string())
}

fn validate_remote_path(
    field: &str,
    raw: &str,
    allow_empty: bool,
) -> Result<String, DeploymentError> {
    let v = raw.trim();
    if v.is_empty() {
        if allow_empty {
            return Ok(String::new());
        }
        return Err(input_invalid(format!("部署的{field}不能为空")));
    }
    if v.starts_with('~') {
        return Err(input_invalid(format!(
            "部署的{field}不接受「~」前缀——请填展开后的绝对路径（如 /home/user/...）"
        )));
    }
    if !v.starts_with('/') {
        return Err(input_invalid(format!(
            "部署的{field}必须是远端绝对路径（以 / 开头）"
        )));
    }
    Ok(v.to_string())
}

fn validate_pk_tunnel(cfg: &PkTunnelConfig) -> Result<(), DeploymentError> {
    if cfg.port == 0 {
        return Err(input_invalid("pkTunnel 端口必须在 1..=65535"));
    }
    Ok(())
}

// ---- upsert（PROTOCOL §8 不变式全量实现） ----

/// alias 改名被 agent 绑定引用时的级联处理（未确认 → 拒绝；确认 → 同事务改写绑定）
fn apply_alias_rename(
    conn: &Connection,
    old_alias: &str,
    new_alias: &str,
    confirm: bool,
) -> Result<(), DeploymentError> {
    if old_alias == new_alias {
        return Ok(());
    }
    let get = |k: &str| -> Option<String> {
        conn.query_row("SELECT value FROM settings WHERE key=?1", [k], |r| r.get(0))
            .ok()
    };
    let mut agents = ai::load_agents(&get);
    let names: Vec<String> = agents
        .iter()
        .filter(|a| a.deployment.as_deref().map(str::trim) == Some(old_alias))
        .map(|a| {
            if a.name.trim().is_empty() {
                a.id.clone()
            } else {
                a.name.clone()
            }
        })
        .collect();
    if names.is_empty() {
        return Ok(());
    }
    if !confirm {
        return Err(DeploymentError {
            tag: "INVALID_ARGUMENT".into(),
            message: format!(
                "别名「{old_alias}」正被 {} 个 agent 绑定（{}）；改名需携带 confirmAliasRefs:true 级联更新 agent 绑定",
                names.len(),
                names.join("、")
            ),
        });
    }
    for agent in agents.iter_mut() {
        if agent.deployment.as_deref().map(str::trim) == Some(old_alias) {
            agent.deployment = Some(new_alias.to_string());
        }
    }
    let encoded = serde_json::to_string(&agents).unwrap_or_else(|_| "[]".into());
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_agents', ?1)",
        rusqlite::params![encoded],
    )
    .ok();
    Ok(())
}

/// 新建分支实体构造（UUID v4 + draft + 诊断字段归零；pkTunnel 可随建设置）
fn new_entity_from_input(
    input: &DeploymentUpsertInput,
    alias: String,
) -> Result<DeploymentEntity, DeploymentError> {
    let node_path =
        validate_remote_path("Node 路径", input.node_path.as_deref().unwrap_or(""), false)?;
    let workdir = validate_remote_path("工作目录", input.workdir.as_deref().unwrap_or(""), true)?;
    let pk_tunnel = match &input.pk_tunnel {
        None | Some(None) => None,
        Some(Some(cfg)) => {
            validate_pk_tunnel(cfg)?;
            Some(cfg.clone())
        }
    };
    Ok(DeploymentEntity {
        id: uuid::Uuid::new_v4().to_string(),
        alias,
        node_path,
        helper_path: String::new(),
        helper_hash: None,
        workdir,
        note: input.note.as_deref().unwrap_or("").trim().to_string(),
        status: "draft".into(),
        last_error: None,
        provision: None,
        degraded: false,
        pk_tunnel,
        extra: BTreeMap::new(),
    })
}

/// 编辑分支实体构造：实质变更回落 not_ready 并清空开通产物，alias 变更额外清空 pkTunnel
fn edited_entity_from_input(
    current: &DeploymentEntity,
    input: &DeploymentUpsertInput,
    alias: String,
) -> Result<DeploymentEntity, DeploymentError> {
    let next_node_path = match &input.node_path {
        Some(v) => validate_remote_path("Node 路径", v, false)?,
        None => current.node_path.clone(),
    };
    let next_workdir = match &input.workdir {
        Some(v) => validate_remote_path("工作目录", v, true)?,
        None => current.workdir.clone(),
    };
    let next_pk_tunnel = match &input.pk_tunnel {
        None => current.pk_tunnel.clone(),
        Some(None) => None,
        Some(Some(cfg)) => {
            validate_pk_tunnel(cfg)?;
            Some(cfg.clone())
        }
    };
    // alias 变更 = 机器身份变化（绑定级联改写在调用方事务内完成）
    let alias_changed = current.alias != alias;
    let material_changed =
        alias_changed || current.node_path != next_node_path || current.workdir != next_workdir;
    if material_changed {
        return Ok(DeploymentEntity {
            id: current.id.clone(),
            alias,
            node_path: next_node_path,
            helper_path: String::new(),
            helper_hash: None,
            workdir: next_workdir,
            note: input
                .note
                .as_deref()
                .unwrap_or(&current.note)
                .trim()
                .to_string(),
            status: "not_ready".into(),
            last_error: Some("部署配置已变更，需重跑开通向导".into()),
            provision: None,
            degraded: false,
            // alias 变更 = 机器身份变化 → pkTunnel 一并清空（PROTOCOL §8）
            pk_tunnel: if alias_changed { None } else { next_pk_tunnel },
            extra: current.extra.clone(),
        });
    }
    Ok(DeploymentEntity {
        note: input
            .note
            .as_deref()
            .unwrap_or(&current.note)
            .trim()
            .to_string(),
        pk_tunnel: next_pk_tunnel,
        ..current.clone()
    })
}

/// 部署 upsert：新建（UUID v4 + draft + 诊断字段归零）/ 编辑（实质变更回落 not_ready
/// 并清空开通产物；alias 变更额外清空 pkTunnel）；alias 唯一；路径与 pkTunnel 不变式。
pub fn deployment_upsert(
    conn: &Connection,
    input: &DeploymentUpsertInput,
) -> Result<DeploymentEntity, DeploymentError> {
    let alias = validate_alias(&input.alias)?;
    let mut deployments = list_deployments(conn);
    if let Some(owner) = deployments.values().find(|d| d.alias == alias) {
        if Some(&owner.id) != input.id.as_ref() {
            return Err(DeploymentError {
                tag: "DEPLOYMENT_ALIAS_TAKEN".into(),
                message: format!(
                    "别名「{alias}」已被另一个部署占用（id {}…，alias 唯一索引）",
                    &owner.id[..owner.id.len().min(8)]
                ),
            });
        }
    }
    let entity = match &input.id {
        None => new_entity_from_input(input, alias)?,
        Some(id) => {
            let Some(current) = deployments.get(id) else {
                return Err(DeploymentError {
                    tag: "NOT_FOUND".into(),
                    message: format!("部署 {id} 不存在（编辑需携带正确 id）"),
                });
            };
            if current.alias != alias {
                apply_alias_rename(conn, &current.alias, &alias, input.confirm_alias_refs)?;
            }
            edited_entity_from_input(current, input, alias)?
        }
    };
    deployments.insert(entity.id.clone(), entity.clone());
    store_deployments(conn, &deployments);
    Ok(entity)
}

/// 部署移除（实体状态变迁面——远端自清理编排属宿主适配层，不在此；不级联删绑定）
pub fn deployment_delete(conn: &Connection, id: &str) -> Result<bool, DeploymentError> {
    let mut deployments = list_deployments(conn);
    let existed = deployments.remove(id).is_some();
    if existed {
        store_deployments(conn, &deployments);
    }
    Ok(existed)
}

/// agent → 远程目标解析（执行世界单源，ADR-0003 §1）：绑定空 = None（本机）；
/// 绑定别名不在注册表 = 悬空绑定拒绝（DEPLOYMENT_NOT_READY——派发/解析前置报错）；
/// 按需隧道端口取部署 pkTunnel（persistent 常驻与否都带回——常驻连接占住端口时 ssh
/// 仅告警不失败，常驻断线空窗期按需 -R 正好兜底）。
pub fn resolve_remote_target(
    conn: &Connection,
    agent: &crate::ai::AgentConfig,
) -> Result<Option<crate::ai::RemoteTarget>, DeploymentError> {
    let Some(alias) = agent
        .deployment
        .as_deref()
        .map(str::trim)
        .filter(|a| !a.is_empty())
    else {
        return Ok(None);
    };
    let Some(entity) = deployment_by_alias(conn, alias) else {
        return Err(DeploymentError {
            tag: "DEPLOYMENT_NOT_READY".into(),
            message: format!(
                "agent「{}」绑定的部署别名 {alias} 不存在——先在部署管理中添加该别名",
                if agent.name.trim().is_empty() {
                    &agent.id
                } else {
                    &agent.name
                }
            ),
        });
    };
    Ok(Some(crate::ai::RemoteTarget {
        alias: entity.alias,
        tunnel_port: entity
            .pk_tunnel
            .as_ref()
            .map(|t| t.port)
            .filter(|p| *p != 0),
    }))
}

// ---- Tauri 命令面（UI 消费；conn 级原语之上的薄壳） ----

/// 部署列表（UI 呈现序 = alias 字典序）
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentView {
    /// 实体唯一键（新建生成；引用用 alias 不用 id）
    pub id: String,
    /// OpenSSH 别名（凭据与主机身份由它承载）
    pub alias: String,
    /// 远端 node 绝对路径（拒 `~` 前缀与相对路径）
    pub node_path: String,
    /// 远端工作目录（空 = 登录目录；同路径不变式）
    pub workdir: String,
    /// 备注
    pub note: String,
    /// 生命周期状态（SDD §3.3 六态）
    pub status: String,
    /// 最近错误（诊断呈现；无 = null）
    pub last_error: Option<String>,
    /// 直连降级确认标记（仅显式确认留痕后可达 true）
    pub degraded: bool,
    /// pkTunnel 三态（None=保持 / Some(None)=清除 / Some(Some)=设置）
    pub pk_tunnel: Option<PkTunnelConfig>,
    /// helperPath 非空的简化呈现（开通向导状态归 dsh 面板）
    pub helper_installed: bool,
}

fn view_of(e: &DeploymentEntity) -> DeploymentView {
    DeploymentView {
        id: e.id.clone(),
        alias: e.alias.clone(),
        node_path: e.node_path.clone(),
        workdir: e.workdir.clone(),
        note: e.note.clone(),
        status: e.status.clone(),
        last_error: e.last_error.clone(),
        degraded: e.degraded,
        pk_tunnel: e.pk_tunnel.clone(),
        helper_installed: !e.helper_path.is_empty(),
    }
}

#[tauri::command]
/// 部署列表命令（UI 呈现序 = alias 字典序）
pub fn deployment_list(db: tauri::State<crate::db::Db>) -> AppResult<Vec<DeploymentView>> {
    let conn = db.0.lock().unwrap();
    let mut views: Vec<DeploymentView> = list_deployments(&conn).values().map(view_of).collect();
    views.sort_by(|a, b| a.alias.cmp(&b.alias));
    Ok(views)
}

#[tauri::command]
/// 部署新建/编辑命令（conn 级原语之上的薄壳）
pub fn deployment_upsert_cmd(
    db: tauri::State<crate::db::Db>,
    input: DeploymentUpsertInputJson,
) -> AppResult<DeploymentView> {
    let conn = db.0.lock().unwrap();
    let entity = deployment_upsert(&conn, &input.into_input())
        .map_err(|e| crate::error::AppError::Invalid(e.message))?;
    Ok(view_of(&entity))
}

#[tauri::command]
/// 部署移除命令（未知 id → NotFound）
pub fn deployment_delete_cmd(db: tauri::State<crate::db::Db>, id: String) -> AppResult<()> {
    let conn = db.0.lock().unwrap();
    if !deployment_delete(&conn, &id).map_err(|e| crate::error::AppError::Invalid(e.message))? {
        return Err(crate::error::AppError::NotFound(format!(
            "部署 {id} 不存在"
        )));
    }
    Ok(())
}

/// upsert 命令入参（JSON 直传；pkTunnel 三态与域层一致：null=清除 / 对象=设置 / 缺省=保持）
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentUpsertInputJson {
    /// 实体唯一键（新建生成；引用用 alias 不用 id）
    pub id: Option<String>,
    /// OpenSSH 别名（凭据与主机身份由它承载）
    pub alias: String,
    /// 远端 node 绝对路径（拒 `~` 前缀与相对路径）
    pub node_path: Option<String>,
    /// 远端工作目录（空 = 登录目录；同路径不变式）
    pub workdir: Option<String>,
    /// 备注
    pub note: Option<String>,
    /// pkTunnel 三态（None=保持 / Some(None)=清除 / Some(Some)=设置）
    pub pk_tunnel: Option<Option<PkTunnelConfig>>,
    /// OpenSSH 别名（凭据与主机身份由它承载）
    pub confirm_alias_refs: bool,
}

impl DeploymentUpsertInputJson {
    fn into_input(self) -> DeploymentUpsertInput {
        DeploymentUpsertInput {
            id: self.id,
            alias: self.alias,
            node_path: self.node_path,
            workdir: self.workdir,
            note: self.note,
            pk_tunnel: self.pk_tunnel,
            confirm_alias_refs: self.confirm_alias_refs,
        }
    }
}

/// `~/.ssh/config` 的 Host 条目（部署别名下拉的数据源；跳过通配 `*`/`?` 模式与
/// Negation；Include 不递归——别名下拉够用，完整解析留给 ssh 自身）
#[tauri::command]
pub fn ssh_alias_options() -> Vec<String> {
    let Some(home) = dirs::home_dir() else {
        return vec![];
    };
    let text = std::fs::read_to_string(home.join(".ssh").join("config")).unwrap_or_default();
    let mut out: Vec<String> = vec![];
    for line in text.lines() {
        let line = line.trim();
        let Some(rest) = line
            .strip_prefix("Host ")
            .or_else(|| line.strip_prefix("host "))
        else {
            continue;
        };
        for token in rest.split_whitespace() {
            if !token.contains('*') && !token.contains('!') && !token.contains('?') {
                out.push(token.to_string());
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

/// 悬空绑定查询（agent 绑定的别名不在注册表——设置页呈现与迁移后校验面）
#[tauri::command]
pub fn dangling_deployment_refs(db: tauri::State<crate::db::Db>) -> Vec<DanglingRef> {
    let conn = db.0.lock().unwrap();
    let aliases: std::collections::HashSet<String> = list_deployments(&conn)
        .values()
        .map(|d| d.alias.clone())
        .collect();
    let get = |k: &str| -> Option<String> {
        conn.query_row("SELECT value FROM settings WHERE key=?1", [k], |r| r.get(0))
            .ok()
    };
    ai::load_agents(&get)
        .into_iter()
        .filter_map(|a| {
            let ref_alias = a
                .deployment
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())?;
            (!aliases.contains(ref_alias)).then_some(DanglingRef {
                agent_id: a.id,
                agent_name: a.name,
                alias: ref_alias.to_string(),
            })
        })
        .collect()
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
/// 悬空绑定（agent 绑定的别名不在注册表——设置页呈现面）
pub struct DanglingRef {
    /// 实体唯一键（新建生成；引用用 alias 不用 id）
    pub agent_id: String,
    /// agent 显示名
    pub agent_name: String,
    /// OpenSSH 别名（凭据与主机身份由它承载）
    pub alias: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);")
            .unwrap();
        conn
    }

    #[test]
    fn upsert_create_edit_and_invariants() {
        let conn = conn();
        let created = deployment_upsert(
            &conn,
            &DeploymentUpsertInput {
                alias: "gpu-1".into(),
                node_path: Some("/usr/bin/node".into()),
                workdir: Some("/home/u/work".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(created.status, "draft");
        assert!(created.pk_tunnel.is_none());

        // pkTunnel 设置与清除（三态：保持/清除/设置）
        let set = deployment_upsert(
            &conn,
            &DeploymentUpsertInput {
                id: Some(created.id.clone()),
                alias: "gpu-1".into(),
                pk_tunnel: Some(Some(PkTunnelConfig {
                    port: 10022,
                    persistent: true,
                })),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            set.pk_tunnel,
            Some(PkTunnelConfig {
                port: 10022,
                persistent: true
            })
        );
        let cleared = deployment_upsert(
            &conn,
            &DeploymentUpsertInput {
                id: Some(created.id.clone()),
                alias: "gpu-1".into(),
                pk_tunnel: Some(None),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(cleared.pk_tunnel.is_none());

        // 路径不变式与错误 tag
        let err = deployment_upsert(
            &conn,
            &DeploymentUpsertInput {
                alias: "gpu-2".into(),
                node_path: Some("~/node".into()),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert_eq!(err.tag, "DEPLOYMENT_INPUT_INVALID");
        let err = deployment_upsert(
            &conn,
            &DeploymentUpsertInput {
                alias: "gpu-1".into(),
                node_path: Some("/usr/bin/node".into()),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert_eq!(err.tag, "DEPLOYMENT_ALIAS_TAKEN");
        let err = deployment_upsert(
            &conn,
            &DeploymentUpsertInput {
                id: Some("nope".into()),
                alias: "gpu-9".into(),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert_eq!(err.tag, "NOT_FOUND");
    }

    #[test]
    fn alias_change_clears_pk_tunnel_but_path_change_keeps() {
        let conn = conn();
        let created = deployment_upsert(
            &conn,
            &DeploymentUpsertInput {
                alias: "gpu-1".into(),
                node_path: Some("/usr/bin/node".into()),
                pk_tunnel: Some(Some(PkTunnelConfig {
                    port: 10022,
                    persistent: false,
                })),
                ..Default::default()
            },
        )
        .unwrap();
        // nodePath 变更：开通产物回落、pkTunnel 保留
        let edited = deployment_upsert(
            &conn,
            &DeploymentUpsertInput {
                id: Some(created.id.clone()),
                alias: "gpu-1".into(),
                node_path: Some("/opt/node/bin/node".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(edited.status, "not_ready");
        assert_eq!(
            edited.pk_tunnel,
            Some(PkTunnelConfig {
                port: 10022,
                persistent: false
            })
        );
        // alias 变更：pkTunnel 一并清空
        let renamed = deployment_upsert(
            &conn,
            &DeploymentUpsertInput {
                id: Some(created.id.clone()),
                alias: "gpu-2".into(),
                confirm_alias_refs: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(renamed.alias, "gpu-2");
        assert!(renamed.pk_tunnel.is_none());
    }

    #[test]
    fn unknown_fields_roundtrip_in_canonical_order() {
        let conn = conn();
        // 种子：规范序 + 未知键（模拟未来 TS 扩展字段）
        let seeded = r#"{"dep-1":{"id":"dep-1","alias":"gpu-1","nodePath":"/usr/bin/node","helperPath":"","helperHash":null,"workdir":"","note":"","status":"draft","lastError":null,"provision":null,"degraded":false,"pkTunnel":null,"futureField":{"x":1}}}"#;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('dsh:deployments', ?1)",
            rusqlite::params![seeded],
        )
        .unwrap();
        let edited = deployment_upsert(
            &conn,
            &DeploymentUpsertInput {
                id: Some("dep-1".into()),
                alias: "gpu-1".into(),
                note: Some("n".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            edited.extra.get("futureField"),
            Some(&serde_json::json!({"x": 1}))
        );
        let stored: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key='dsh:deployments'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            stored.starts_with(r#"{"dep-1":{"id":"dep-1""#),
            "map 按 id 字典序 + 实体规范序: {stored}"
        );
        assert!(
            stored.ends_with(r#","futureField":{"x":1}}}"#),
            "未知键排尾: {stored}"
        );
    }
}
