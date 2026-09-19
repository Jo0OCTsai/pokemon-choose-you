//! Agent 技能的检查/安装/同步（本地 + SSH 远程）：设置页每个 agent 一组入口，
//! 与 `pk skill install` 同一套内容与目录规则（lib skills 模块）。
//! 远程 agent 的技能装在**远端机器**的 agent 全局目录——技能是给 agent 读的，
//! 必须落在 agent 实际运行的那台机器上（pk 本体经 shim 回本机执行，不受影响）。

use crate::ai::{self, AgentConfig, AgentRemote};
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::skills::{self, REMOTE_INSTALL_SENTINEL};
use std::time::Duration;
use tauri::State;
use tokio::io::AsyncWriteExt;

/// 技能状态（检查结果，camelCase 给前端）
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillStatus {
    pub agent_id: String,
    /// 技能目标类型（claude-code / opencode / kiro）
    pub kind: String,
    /// 技能目录（本地绝对路径；远程为 $HOME 相对路径）
    pub dir: String,
    /// 远程机器（None = 本机）
    pub remote_host: Option<String>,
    pub installed: bool,
    pub installed_version: Option<String>,
    /// 应用内置的技能版本
    pub bundled_version: String,
    pub up_to_date: bool,
}

/// 安装/同步结果
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillInstallResult {
    pub agent_id: String,
    pub kind: String,
    pub dir: String,
    pub remote_host: Option<String>,
    /// 安装前的旧版本（None = 首次安装）
    pub previous_version: Option<String>,
    pub version: String,
    pub updated: bool,
}

/// 从设置按 id 取 agent 配置
fn load_agent(db: &Db, agent_id: &str) -> AppResult<AgentConfig> {
    let conn = db.0.lock().unwrap();
    let get = |k: &str| crate::secrets::secret_get(&conn, k);
    ai::agent_by_id(&get, agent_id)
        .ok_or_else(|| AppError::Invalid(format!("Agent {agent_id} 不存在，请先保存配置")))
}

/// agent 的有效 SSH 目标（host 为空视为本机）
fn effective_remote(agent: &AgentConfig) -> Option<&AgentRemote> {
    agent.remote.as_ref().filter(|r| !r.host.trim().is_empty())
}

/// 从 agent 命令推断技能目标；识别不了给出可操作指引（自定义 agent 走 pk CLI）
fn skill_kind(agent: &AgentConfig) -> AppResult<String> {
    skills::kind_for_command(&agent.command)
        .map(str::to_string)
        .ok_or_else(|| {
            AppError::Invalid(format!(
            "无法识别「{}」对应的技能目录（支持 claude / opencode / kiro-cli）。自定义 agent 可在终端执行 `pk skill install <claude-code|opencode|kiro> --dir <目录>` 指定落点，或 `pk skill show` 打印全文自行粘贴",
            agent.command
        ))
        })
}

/// ssh 到远端执行一行命令（BatchMode 免密前提与无头分类一致）；
/// stdin 有内容则写入（安装脚本走这里，不经远端 shell 重解析）
pub(crate) async fn ssh_run(
    remote: &AgentRemote,
    remote_line: &str,
    stdin: Option<&str>,
) -> AppResult<String> {
    let mut argv = vec![
        "-o".to_string(),
        "BatchMode=yes".to_string(),
        "-o".to_string(),
        "ConnectTimeout=10".to_string(),
    ];
    if let Some(key) = remote
        .key_path
        .as_deref()
        .map(str::trim)
        .filter(|k| !k.is_empty())
    {
        argv.push("-i".to_string());
        argv.push(key.to_string());
    }
    if remote.port != 0 && remote.port != 22 {
        argv.push("-p".to_string());
        argv.push(remote.port.to_string());
    }
    argv.push(remote.host.trim().to_string());
    argv.push("--".to_string());
    argv.push(remote_line.to_string());
    let mut cmd = tokio::process::Command::new(ai::ssh_bin());
    cmd.args(&argv)
        .stdin(if stdin.is_some() {
            std::process::Stdio::piped()
        } else {
            std::process::Stdio::null()
        })
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::External(format!("无法启动 ssh（{e}）")))?;
    if let Some(body) = stdin {
        if let Some(mut handle) = child.stdin.take() {
            let bytes = body.as_bytes().to_vec();
            // 独立任务写 stdin：脚本未读完前管道可能占满，内联写会死锁
            tokio::spawn(async move {
                let _ = handle.write_all(&bytes).await;
                let _ = handle.shutdown().await;
            });
        }
    }
    let waited = tokio::time::timeout(Duration::from_secs(60), child.wait_with_output()).await;
    let out = match waited {
        Err(_) => {
            return Err(AppError::External(format!(
                "SSH 远程执行（{}）超时",
                remote.host
            )))
        }
        Ok(r) => r.map_err(|e| AppError::External(format!("ssh 执行失败: {e}")))?,
    };
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr);
        Err(AppError::External(format!(
            "SSH 远程执行（{}）失败: {}",
            remote.host,
            stderr.trim()
        )))
    }
}

/// 检查一个 agent 的技能安装状态（本机直读；远程 cat 远端 SKILL.md 后本地解析版本）
#[tauri::command]
pub async fn agent_skill_status(
    db: State<'_, Db>,
    agent_id: String,
) -> AppResult<AgentSkillStatus> {
    let agent = load_agent(&db, &agent_id)?;
    let kind = skill_kind(&agent)?;
    let bundled = skills::SKILL_VERSION.to_string();
    match effective_remote(&agent) {
        None => {
            let dir = skills::skill_dir_for(&kind, None).map_err(AppError::Invalid)?;
            let (installed, installed_version) = skills::local_status(&dir);
            Ok(AgentSkillStatus {
                agent_id,
                kind,
                dir: dir.to_string_lossy().into_owned(),
                remote_host: None,
                installed,
                installed_version: installed_version.clone(),
                up_to_date: installed && installed_version.as_deref() == Some(&bundled),
                bundled_version: bundled,
            })
        }
        Some(remote) => {
            let line = skills::remote_status_line(&kind).map_err(AppError::Invalid)?;
            let wrapped = format!("exec \"$SHELL\" -lc {}", ai::posix_quote(&line));
            let out = ssh_run(remote, &wrapped, None).await?;
            let installed_version = skills::frontmatter_version(out.trim());
            let installed = installed_version.is_some() || out.trim_start().starts_with("---");
            let dir = format!(
                "$HOME/{}",
                skills::skill_dir_rel(&kind).map_err(AppError::Invalid)?
            );
            Ok(AgentSkillStatus {
                agent_id,
                kind,
                dir,
                remote_host: Some(remote.host.clone()),
                installed,
                installed_version: installed_version.clone(),
                up_to_date: installed && installed_version.as_deref() == Some(&bundled),
                bundled_version: bundled,
            })
        }
    }
}

/// 安装/同步一个 agent 的技能到当前内置版本（本机直写；远程脚本经 stdin 落远端目录）。
/// 幂等：同版本重装无变化，跨版本即升级（previousVersion 供前端提示）
#[tauri::command]
pub async fn agent_skill_install(
    db: State<'_, Db>,
    agent_id: String,
) -> AppResult<AgentSkillInstallResult> {
    let agent = load_agent(&db, &agent_id)?;
    let kind = skill_kind(&agent)?;
    let version = skills::SKILL_VERSION.to_string();
    match effective_remote(&agent) {
        None => {
            let dir = skills::skill_dir_for(&kind, None).map_err(AppError::Invalid)?;
            let (previous, path) = skills::local_install(&dir).map_err(AppError::External)?;
            let updated = previous.as_deref().is_none_or(|v| v != version);
            Ok(AgentSkillInstallResult {
                agent_id,
                kind,
                dir: path,
                remote_host: None,
                updated,
                previous_version: previous,
                version,
            })
        }
        Some(remote) => {
            // 先查旧版本（供「升级/首装」提示），再送安装脚本
            let status_line = skills::remote_status_line(&kind).map_err(AppError::Invalid)?;
            let out = ssh_run(
                remote,
                &format!("exec \"$SHELL\" -lc {}", ai::posix_quote(&status_line)),
                None,
            )
            .await?;
            let previous = skills::frontmatter_version(out.trim());
            let script = skills::remote_install_script(&kind).map_err(AppError::Invalid)?;
            let result = ssh_run(remote, "exec \"$SHELL\" -lc 'sh -s'", Some(&script)).await?;
            // 哨兵校验：远端脚本全部落盘成功才会回显（profile 输出可能混入，按整行匹配）
            let expected = format!("{REMOTE_INSTALL_SENTINEL} {version}");
            if !result.lines().any(|l| l.trim() == expected) {
                return Err(AppError::External(format!(
                    "远程技能写入未确认（期望回显 {expected}，实际输出：{}）",
                    result.trim()
                )));
            }
            let dir = format!(
                "$HOME/{}",
                skills::skill_dir_rel(&kind).map_err(AppError::Invalid)?
            );
            let updated = previous.as_deref() != Some(version.as_str());
            Ok(AgentSkillInstallResult {
                agent_id,
                kind,
                dir,
                remote_host: Some(remote.host.clone()),
                updated,
                previous_version: previous,
                version,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::windows::PendingMainReopen;
    use crate::db::tests::test_conn;
    use std::sync::Mutex;
    use tauri::Manager;

    fn setup() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(Db(Mutex::new(test_conn())));
        app.manage(PendingMainReopen(std::sync::atomic::AtomicBool::new(false)));
        app
    }

    fn seed_agent(conn: &rusqlite::Connection, id: &str, command: &str, host: Option<&str>) {
        let agent = AgentConfig {
            id: id.into(),
            name: id.into(),
            command: command.into(),
            remote: host.map(|h| AgentRemote {
                host: h.into(),
                ..Default::default()
            }),
            ..Default::default()
        };
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('ai_agents', ?1)",
            rusqlite::params![serde_json::to_string(&[agent]).unwrap()],
        )
        .unwrap();
    }

    /// 未知 agent / 不存在的 agent 给出可操作错误；kind 推断覆盖三家与自定义
    #[test]
    fn skill_kind_infers_or_rejects() {
        assert_eq!(
            skill_kind(&AgentConfig {
                command: "claude".into(),
                ..Default::default()
            })
            .unwrap(),
            "claude-code"
        );
        assert_eq!(
            skill_kind(&AgentConfig {
                command: "kiro-cli".into(),
                ..Default::default()
            })
            .unwrap(),
            "kiro"
        );
        let err = skill_kind(&AgentConfig {
            command: "my-agent".into(),
            ..Default::default()
        })
        .unwrap_err();
        assert!(
            err.to_string().contains("pk skill"),
            "给手动同步指引: {err}"
        );
    }

    /// 本机检查/安装往返：经 IPC 命令层跑通（装的是 --dir 之外的正式目录，
    /// 与 pk skill install 同一落点，测试后清理）
    #[test]
    fn status_and_install_roundtrip_via_command() {
        let app = setup();
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            seed_agent(&conn, "a1", "claude", None);
        }
        let before = {
            let db = app.state::<Db>();
            tauri::async_runtime::block_on(agent_skill_status(db, "a1".into())).unwrap()
        };
        assert_eq!(before.kind, "claude-code");
        assert_eq!(before.remote_host, None);
        assert_eq!(before.bundled_version, skills::SKILL_VERSION);

        let result = {
            let db = app.state::<Db>();
            tauri::async_runtime::block_on(agent_skill_install(db, "a1".into())).unwrap()
        };
        assert_eq!(result.version, skills::SKILL_VERSION);
        assert!(result.dir.contains(".claude/skills/pokemon-choose-you"));

        let after = {
            let db = app.state::<Db>();
            tauri::async_runtime::block_on(agent_skill_status(db, "a1".into())).unwrap()
        };
        assert!(after.installed, "装完应能查到");
        assert!(after.up_to_date, "版本与内置一致");
        // 清理测试写入的正式目录，不留脏文件
        let _ = std::fs::remove_dir_all(
            dirs::home_dir()
                .unwrap()
                .join(".claude/skills/pokemon-choose-you"),
        );
    }

    /// 不存在的 agent 报输入错误
    #[test]
    fn unknown_agent_rejected() {
        let app = setup();
        let err = {
            let db = app.state::<Db>();
            tauri::async_runtime::block_on(agent_skill_status(db, "ghost".into())).unwrap_err()
        };
        assert!(matches!(err, AppError::Invalid(_)), "{err}");
    }
}
