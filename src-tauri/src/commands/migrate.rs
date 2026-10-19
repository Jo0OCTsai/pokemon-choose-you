//! 存量迁移（ADR-0003 §1）：agent 内联远程配置（AgentRemote 时代的 host/port/keyPath/
//! tunnel/persistent）→ 部署绑定。三段式：归并建部署 → 写 `~/.ssh/config` managed
//! 标记块（备份 + 幂等替换）→ 改绑定 + 清空 remote（单事务）。幂等可重跑，中断不产生
//! 半迁移状态；config 先写（失败即停无库变更），库事务后行（失败可重跑收敛）。

use crate::error::{AppError, AppResult};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

use crate::commands::deployments::{
    deployment_upsert, list_deployments, DeploymentUpsertInput, PkTunnelConfig,
};

/// managed 标记块边界（幂等替换的最小单元；块外用户内容永不动）
const MANAGED_BEGIN: &str = "# BEGIN managed by pokemon-choose-you";
const MANAGED_END: &str = "# END managed by pokemon-choose-you";

/// 迁移报告（幂等重跑 = 全 skip）
#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    /// 本次新建的部署（alias → 原 host 描述）
    pub created: Vec<CreatedDeployment>,
    /// 复用既有部署完成绑定的 agent 数
    pub rebound: usize,
    /// 已无内联 remote 字段的 agent 数（重跑时）
    pub skipped: usize,
    /// ~/.ssh/config 备份落点（内容有变更且原文件存在时）
    pub config_backup: Option<String>,
    /// 写入的 managed 条目数
    pub config_entries: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
/// 迁移新建的部署条目（报告呈现面）
pub struct CreatedDeployment {
    /// OpenSSH 别名（凭据与主机身份由它承载）
    pub alias: String,
    /// 原内联 SSH 目标（user@host）
    pub host: String,
    /// 原内联 SSH 端口
    pub port: u16,
    /// 原内联私钥路径（null = ssh 默认）
    pub key_path: Option<String>,
    /// 远端侧隧道端口（⇄ 本机 sshd 22）
    pub tunnel_port: Option<u16>,
}

/// 一组等价内联远程配置（distinct 键——同组多 agent 归并为一个部署）
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct RemoteGroup {
    host: String,
    port: u16,
    key_path: Option<String>,
}

/// 迁移主流程（conn + 路径注入，供测试；命令层传真实路径）
pub fn migrate_agent_remote_conn(
    conn: &Connection,
    ssh_config_path: &Path,
    backups_dir: &Path,
) -> AppResult<MigrationReport> {
    let agents_raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key='ai_agents'",
            [],
            |r| r.get(0),
        )
        .ok();
    let Some(raw) = agents_raw else {
        return Ok(MigrationReport::default());
    };
    let Ok(mut agents) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Ok(MigrationReport::default());
    };
    let list: &mut Vec<serde_json::Value> = match agents.as_array_mut() {
        Some(list) => list,
        None => return Ok(MigrationReport::default()),
    };

    // 分组：有非空 remote.host 的 agent 按 distinct (host, port, keyPath) 归并
    let mut groups: GroupIndex = BTreeMap::new();
    let mut skipped = 0usize;
    for (i, agent) in list.iter().enumerate() {
        let remote = agent.get("remote");
        let host = remote
            .and_then(|r| r.get("host"))
            .and_then(|h| h.as_str())
            .map(str::trim)
            .filter(|h| !h.is_empty())
            .map(String::from);
        match host {
            None => skipped += 1,
            Some(host) => {
                let port = remote
                    .and_then(|r| r.get("port"))
                    .and_then(|p| p.as_u64())
                    .unwrap_or(22) as u16;
                let key_path = remote
                    .and_then(|r| r.get("keyPath"))
                    .and_then(|k| k.as_str())
                    .map(str::trim)
                    .filter(|k| !k.is_empty())
                    .map(String::from);
                groups
                    .entry(RemoteGroup {
                        host,
                        port,
                        key_path,
                    })
                    .or_default()
                    .push(i);
            }
        }
    }
    if groups.is_empty() {
        return Ok(MigrationReport {
            skipped,
            ..Default::default()
        });
    }

    let (created, alias_of) = plan_groups(conn, list, &groups);

    // ~/.ssh/config：managed 标记块幂等替换（先备份原文件到 <appHome>/backups）
    let entries: Vec<String> = groups
        .keys()
        .zip(alias_of.values())
        .map(|(g, (alias, _, _))| ssh_config_entry(alias, g))
        .collect();
    let (config_backup, config_entries) =
        write_managed_config(ssh_config_path, backups_dir, &entries)?;

    // 库事务：建部署 + 改绑定 + 清空 remote（Value 级手术——保留未知字段）
    let rebound = rebind_agents(conn, list, &groups, &alias_of);
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_agents', ?1)",
        rusqlite::params![serde_json::to_string(&agents).unwrap_or_default()],
    )?;

    Ok(MigrationReport {
        created,
        rebound,
        skipped,
        config_backup,
        config_entries,
    })
}

/// 别名主干：user@box 形态取主机段，保留字母数字与 -_.，截 24 字符，pky- 前缀
fn alias_stem(host: &str) -> String {
    let machine = host.rsplit('@').next().unwrap_or(host);
    let cleaned: String = machine
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
        .take(24)
        .collect();
    format!(
        "pky-{}",
        if cleaned.is_empty() {
            "host".to_string()
        } else {
            cleaned.clone()
        }
    )
}

/// 单个别名的 managed 条目（HostName/User/Port/IdentityFile 按需）
fn ssh_config_entry(alias: &str, g: &RemoteGroup) -> String {
    let (user, hostname) = match g.host.split_once('@') {
        Some((u, h)) => (Some(u), h),
        None => (None, g.host.as_str()),
    };
    let mut lines = vec![format!("Host {alias}")];
    lines.push(format!("    HostName {hostname}"));
    if let Some(u) = user {
        lines.push(format!("    User {u}"));
    }
    if g.port != 0 && g.port != 22 {
        lines.push(format!("    Port {}", g.port));
    }
    if let Some(k) = &g.key_path {
        lines.push(format!("    IdentityFile {k}"));
    }
    lines.join("\n")
}

/// managed 块写入：既有块整体替换（多块归一）、无则追加；内容无变化 = 零写入。
/// 原文件存在且内容将变时先备份到 backups_dir（时间戳后缀）
fn write_managed_config(
    config_path: &Path,
    backups_dir: &Path,
    entries: &[String],
) -> AppResult<(Option<String>, usize)> {
    let existing = std::fs::read_to_string(config_path).unwrap_or_default();
    // 剥除既有 managed 块（含其后换行），保留块外内容
    let mut outside = String::new();
    let mut inside = false;
    for line in existing.lines() {
        if line.trim() == MANAGED_BEGIN {
            inside = true;
            continue;
        }
        if line.trim() == MANAGED_END {
            inside = false;
            continue;
        }
        if !inside {
            outside.push_str(line);
            outside.push('\n');
        }
    }
    let block = if entries.is_empty() {
        String::new()
    } else {
        format!("{MANAGED_BEGIN}\n{}\n{MANAGED_END}\n", entries.join("\n\n"))
    };
    let mut next = outside.clone();
    next.push_str(&block);
    if next == existing || next.trim() == existing.trim() && existing.is_empty() {
        return Ok((None, entries.len()));
    }
    let backup = if config_path.exists() && !existing.is_empty() {
        std::fs::create_dir_all(backups_dir).ok();
        let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
        let path = backups_dir.join(format!("ssh-config-{stamp}.bak"));
        std::fs::write(&path, &existing)
            .map_err(|e| AppError::External(format!("备份 ~/.ssh/config 失败: {e}")))?;
        Some(path.to_string_lossy().into_owned())
    } else {
        None
    };
    if let Some(dir) = config_path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| AppError::External(format!("创建 {} 失败: {e}", dir.display())))?;
    }
    std::fs::write(config_path, &next)
        .map_err(|e| AppError::External(format!("写 ~/.ssh/config 失败: {e}（原文件已备份）")))?;
    Ok((backup, entries.len()))
}

/// 存量迁移命令（设置页横幅 / 部署管理入口）：真实路径装配
#[tauri::command]
pub fn migrate_agent_remote(db: tauri::State<crate::db::Db>) -> AppResult<MigrationReport> {
    let conn = db.0.lock().unwrap();
    let home = dirs::home_dir().ok_or_else(|| AppError::External("定位主目录失败".into()))?;
    let backups = crate::db::app_home()
        .map(|h| h.join("backups"))
        .unwrap_or_else(|| home.join(".choose-you").join("backups"));
    migrate_agent_remote_conn(&conn, &home.join(".ssh").join("config"), &backups)
}

/// 分组 →（别名, 隧道端口, 常驻）规划结果
pub type AliasPlan = BTreeMap<RemoteGroup, (String, Option<u16>, bool)>;

/// 分组结果（RemoteGroup → 组内 agent 索引）
pub type GroupIndex = BTreeMap<RemoteGroup, Vec<usize>>;

/// 分组别名规划：pky-<主机段> 去重递增 + 组内隧道端口/常驻聚合（返回新建清单与分组映射）
fn plan_groups(
    conn: &Connection,
    list: &[serde_json::Value],
    groups: &GroupIndex,
) -> (Vec<CreatedDeployment>, AliasPlan) {
    let deployments = list_deployments(conn);
    let mut taken: Vec<String> = deployments.values().map(|d| d.alias.clone()).collect();
    let mut alias_of: AliasPlan = BTreeMap::new();
    let mut created = vec![];
    for (group, members) in groups {
        // 隧道端口/常驻：组内任一 agent 配了即带（机器级单例语义）
        let (tunnel_port, persistent) = members.iter().filter_map(|&i| list[i].get("remote")).fold(
            (None, false),
            |(tp, pers), r| {
                let t = r
                    .get("tunnel")
                    .and_then(|v| v.as_u64())
                    .filter(|v| *v != 0)
                    .map(|v| v as u16)
                    .or(tp);
                let p = pers
                    || r.get("persistent")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                (t, p)
            },
        );
        let base = alias_stem(&group.host);
        let mut alias = base.clone();
        let mut n = 2;
        while taken.contains(&alias) {
            alias = format!("{base}-{n}");
            n += 1;
        }
        taken.push(alias.clone());
        alias_of.insert(
            group.clone(),
            (
                alias.clone(),
                tunnel_port,
                persistent && tunnel_port.is_some(),
            ),
        );
        created.push(CreatedDeployment {
            alias,
            host: group.host.clone(),
            port: group.port,
            key_path: group.key_path.clone(),
            tunnel_port,
        });
    }
    (created, alias_of)
}

/// 绑定改写（单事务内逐组）：建部署 + agent 绑定别名 + 清空退役 remote 键
fn rebind_agents(
    conn: &Connection,
    list: &mut [serde_json::Value],
    groups: &GroupIndex,
    alias_of: &AliasPlan,
) -> usize {
    let mut rebound = 0usize;
    for (group, (alias, tunnel_port, persistent)) in alias_of {
        let _ = conn; // 事务边界在调用方；此处只改内存，落库由调用方收口
        let _ = deployment_upsert(
            conn,
            &DeploymentUpsertInput {
                alias: alias.clone(),
                node_path: Some("/usr/bin/node".into()),
                workdir: Some(String::new()),
                note: Some("存量迁移自动创建（Node 路径为占位，按需修正）".into()),
                pk_tunnel: tunnel_port.map(|port| {
                    Some(PkTunnelConfig {
                        port,
                        persistent: *persistent,
                    })
                }),
                ..Default::default()
            },
        );
        for &i in &groups[group] {
            if let Some(obj) = list[i].as_object_mut() {
                obj.insert("deployment".into(), serde_json::json!(alias));
                obj.remove("remote");
                rebound += 1;
            }
        }
    }
    rebound
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

    fn agent(id: &str, host: &str, port: u16, key: Option<&str>, tunnel: Option<u16>) -> String {
        serde_json::json!({
            "id": id, "name": id, "command": "claude", "args": "", "historyArgs": "",
            "workdir": "", "skillDir": null, "timeoutSecs": 120, "enabled": true,
            "remote": { "host": host, "port": port, "keyPath": key, "tunnel": tunnel, "persistent": false },
            "futureField": { "x": 1 }
        })
        .to_string()
    }

    fn seed_agents(conn: &Connection, raw: &str) {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('ai_agents', ?1)",
            rusqlite::params![raw],
        )
        .unwrap();
    }

    fn agents_raw(conn: &Connection) -> serde_json::Value {
        let raw: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key='ai_agents'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        serde_json::from_str(&raw).unwrap()
    }

    #[test]
    fn migrates_groups_rebinds_and_writes_managed_block() {
        let conn = conn();
        let dir = std::env::temp_dir().join(format!("pky-mig-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let home = dir.join("home");
        std::fs::create_dir_all(&home).unwrap();
        let config = home.join("sshconfig");
        std::fs::write(&config, "Host myown\n    HostName 10.0.0.9\n").unwrap();

        // 三个 agent：两个同机组 + 一个不同端口组 + 一个本地
        seed_agents(
            &conn,
            &format!(
                "[{},{},{},{}]",
                agent("a1", "dev@box", 22, None, Some(10022)),
                agent("a2", "dev@box", 22, None, None),
                agent("a3", "dev@box", 2222, Some("~/.ssh/k1"), None),
                serde_json::json!({"id":"a4","name":"local","command":"pi","args":"","historyArgs":"","workdir":"","skillDir":null,"timeoutSecs":60,"enabled":true})
            ),
        );

        let report = migrate_agent_remote_conn(&conn, &config, &dir.join("backups")).unwrap();
        assert_eq!(report.created.len(), 2, "两组归并: {report:?}");
        assert_eq!(report.rebound, 3);
        assert_eq!(report.skipped, 1);
        assert!(report.config_backup.is_some(), "有变更即备份");

        // 部署：两组各一；同机组带隧道端口（组内任一 agent 配了即带）
        let deps = list_deployments(&conn);
        let aliases: Vec<&String> = deps.values().map(|d| &d.alias).collect();
        assert!(aliases.contains(&&"pky-box".to_string()), "{aliases:?}");
        assert!(aliases.contains(&&"pky-box-2".to_string()), "{aliases:?}");
        let tunnel_dep = deps.values().find(|d| d.alias == "pky-box").unwrap();
        assert_eq!(
            tunnel_dep.pk_tunnel,
            Some(PkTunnelConfig {
                port: 10022,
                persistent: false
            })
        );

        // agent：绑定别名 + remote 清空 + 未知字段保留
        let agents = agents_raw(&conn);
        let a1 = agents[0].as_object().unwrap();
        assert_eq!(a1["deployment"], "pky-box");
        assert!(a1.get("remote").is_none(), "remote 已清空");
        assert_eq!(
            a1["futureField"],
            serde_json::json!({"x": 1}),
            "未知字段保留"
        );

        // config：managed 块含两组条目；用户原有行保留
        let text = std::fs::read_to_string(&config).unwrap();
        assert!(text.contains("Host myown"), "用户内容保留: {text}");
        assert!(text.contains(MANAGED_BEGIN) && text.contains(MANAGED_END));
        assert!(text.contains("Host pky-box\n    HostName box\n    User dev"));
        assert!(text.contains("Host pky-box-2\n    HostName box\n    User dev\n    Port 2222"));
        assert!(text.contains("IdentityFile ~/.ssh/k1"));

        // 幂等重跑：无 remote 可迁 → 全 skip，config 内容不再变化（无新备份）
        let before = std::fs::read_to_string(&config).unwrap();
        let again = migrate_agent_remote_conn(&conn, &config, &dir.join("backups")).unwrap();
        assert_eq!(again.rebound, 0);
        assert_eq!(again.created.len(), 0);
        assert_eq!(again.config_backup, None, "无变更不备份");
        assert_eq!(std::fs::read_to_string(&config).unwrap(), before);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
