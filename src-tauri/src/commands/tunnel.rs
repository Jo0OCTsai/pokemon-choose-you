//! 常驻反向隧道管理（REMOTE_PK_CHANNEL_PROPOSAL §5，方案 B）。
//!
//! 应用驻留期间为开启 `remote.persistent` 的远程 agent 维持 `ssh -N -R` 长连：
//! 远程侧 127.0.0.1:隧道端口 ⇄ 本机 sshd，远程任何进程（无头 agent / tmux 常驻会话 /
//! 手动 ssh）随时可调 pk，不再依赖应用发起调用的存活窗口。
//! autossh 配方内化（应用进程即 supervisor，无需外部依赖）：
//! - `ServerAliveInterval=10` × `ServerAliveCountMax=3`：约 30 秒内检出死连接（休眠唤醒/换网自愈）；
//! - `ExitOnForwardFailure=yes`：远程端口绑定失败（被占）即退出重连，杜绝「连接活着但隧道没建」的假隧道；
//! - 指数退避重连（1s 起、30s 封顶；连接稳定满 60s 后退避复位）。
//!
//! 停止 = abort 监控任务，ssh 子进程随 `kill_on_drop` 一并终止。

use crate::ai::{self, AgentConfig, AgentRemote};
use crate::db::Db;
use crate::error::{AppError, AppResult};
use rusqlite::params;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Manager, State};

/// 隧道身份：同 host+ssh 端口+密钥+隧道端口的多个 agent 共享一条连接
/// （一键配置的提示就是「同远程多 agent 保持相同隧道端口」——这里把该约定坐实）
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct TunnelKey {
    host: String,
    ssh_port: u16,
    key: Option<String>,
    tunnel_port: u16,
}

impl TunnelKey {
    /// 从 agent 远程配置取隧道身份：未配 host 或隧道端口（含未跑一键配置）返回 None
    pub fn of(r: &AgentRemote) -> Option<Self> {
        let host = r.host.trim();
        if host.is_empty() {
            return None;
        }
        let tunnel_port = r.tunnel.filter(|t| *t != 0)?;
        Some(Self {
            host: host.to_string(),
            ssh_port: if r.port == 0 { 22 } else { r.port },
            key: r
                .key_path
                .as_deref()
                .map(str::trim)
                .filter(|k| !k.is_empty())
                .map(String::from),
            tunnel_port,
        })
    }
}

/// 面向 UI 的隧道状态。state：off（未开启/未配置）/ connecting / healthy / retrying
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelStatus {
    pub state: String,
    pub detail: String,
}

impl TunnelStatus {
    fn of(state: &str, detail: impl Into<String>) -> Self {
        Self {
            state: state.into(),
            detail: detail.into(),
        }
    }
}

/// supervise 的节奏参数（生产用默认拍档；测试注入快拍档）
#[derive(Clone, Copy)]
struct Tunings {
    /// 存活多久才判健康（立即退出的都是 bind/认证类失败）
    healthy_after: Duration,
    /// 连续失败的重连退避：起始 / 上限；连接稳定满 healthy_hold 后复位到起始
    backoff_start: Duration,
    backoff_max: Duration,
    healthy_hold: Duration,
}

const TUNINGS: Tunings = Tunings {
    healthy_after: Duration::from_secs(3),
    backoff_start: Duration::from_secs(1),
    backoff_max: Duration::from_secs(30),
    healthy_hold: Duration::from_secs(60),
};

/// 常驻隧道命令行（autossh 配方，见模块注释）
fn tunnel_argv(k: &TunnelKey) -> Vec<String> {
    let mut argv = vec![
        "-N".to_string(),
        "-R".to_string(),
        format!("127.0.0.1:{}:127.0.0.1:22", k.tunnel_port),
        "-o".to_string(),
        "BatchMode=yes".to_string(),
        "-o".to_string(),
        "ServerAliveInterval=10".to_string(),
        "-o".to_string(),
        "ServerAliveCountMax=3".to_string(),
        "-o".to_string(),
        "ExitOnForwardFailure=yes".to_string(),
        "-o".to_string(),
        "ConnectTimeout=10".to_string(),
    ];
    if let Some(key) = &k.key {
        argv.push("-i".to_string());
        argv.push(key.clone());
    }
    if k.ssh_port != 22 {
        argv.push("-p".to_string());
        argv.push(k.ssh_port.to_string());
    }
    // -- 在 host 之前：以 - 开头的 host 名不被当成 ssh 选项
    argv.push("--".to_string());
    argv.push(k.host.clone());
    argv
}

struct TunnelEntry {
    handle: tauri::async_runtime::JoinHandle<()>,
    status: Arc<Mutex<TunnelStatus>>,
}

/// 常驻隧道集合（Tauri managed state）。sync 与 agent 配置对齐；
/// 停止走 handle.abort()——监控任务里的 ssh 子进程 kill_on_drop 随之终止
#[derive(Default)]
pub struct TunnelManager {
    tunnels: Mutex<HashMap<TunnelKey, TunnelEntry>>,
}

impl TunnelManager {
    /// 与期望的 agent 集合对齐：停掉不再引用的隧道，补起缺失的（已在跑的原样保留）
    pub fn sync(&self, agents: &[AgentConfig]) {
        let desired: HashMap<TunnelKey, AgentRemote> = agents
            .iter()
            .filter(|a| a.enabled)
            .filter_map(|a| {
                let r = a.remote.as_ref()?;
                r.persistent
                    .then(|| TunnelKey::of(r).map(|k| (k, r.clone())))
                    .flatten()
            })
            .collect();
        let mut tunnels = self.tunnels.lock().unwrap();
        tunnels.retain(|k, e| {
            if desired.contains_key(k) {
                true
            } else {
                e.handle.abort();
                false
            }
        });
        for k in desired.into_keys() {
            tunnels.entry(k.clone()).or_insert_with(|| spawn_tunnel(&k));
        }
    }

    /// 某远程配置的常驻隧道状态（未开启 / 未配置 / 未运行均归 off，附原因）
    pub fn status_of(&self, r: &AgentRemote) -> TunnelStatus {
        if !r.persistent {
            return TunnelStatus::of("off", "未开启常驻隧道");
        }
        let Some(key) = TunnelKey::of(r) else {
            return TunnelStatus::of("off", "未配置隧道端口（先跑「一键配置远程 pk」）");
        };
        let tunnels = self.tunnels.lock().unwrap();
        match tunnels.get(&key) {
            Some(e) => e.status.lock().unwrap().clone(),
            None => TunnelStatus::of("off", "常驻隧道未运行（保存配置或重启应用后生效）"),
        }
    }
}

fn spawn_tunnel(k: &TunnelKey) -> TunnelEntry {
    let status = Arc::new(Mutex::new(TunnelStatus::of(
        "connecting",
        "建立 ssh -R 连接",
    )));
    let task_status = Arc::clone(&status);
    let key = k.clone();
    let tunings = TUNINGS;
    let ssh_program = ai::ssh_bin();
    let handle = tauri::async_runtime::spawn(async move {
        supervise(&key, tunings, &ssh_program, task_status).await;
    });
    TunnelEntry { handle, status }
}

/// 单条隧道的保活循环：连接 → 健康判定 → 等待退出/被 abort → 退避重连。
/// 状态随时写入共享 TunnelStatus（UI 查询）；ssh stderr 尾行进详情，定位认证/端口占用。
/// ssh 程序可注入（测试用假 ssh，避免进程级环境变量的并发测试互踩）
async fn supervise(
    k: &TunnelKey,
    tunings: Tunings,
    ssh_program: &str,
    status: Arc<Mutex<TunnelStatus>>,
) {
    let mut backoff = tunings.backoff_start;
    loop {
        *status.lock().unwrap() = TunnelStatus::of("connecting", "建立 ssh -R 连接");
        let mut child = match tokio::process::Command::new(ssh_program)
            .args(tunnel_argv(k))
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                *status.lock().unwrap() = TunnelStatus::of(
                    "retrying",
                    format!("无法启动 ssh（{e}），{backoff:?} 后重试"),
                );
                tokio::time::sleep(backoff).await;
                backoff = backoff.saturating_mul(2).min(tunings.backoff_max);
                continue;
            }
        };
        // stderr 尾行追踪：ExitOnForwardFailure / 认证失败 / 网络不可达都在这里现形
        let tail = Arc::new(Mutex::new(String::new()));
        if let Some(stderr) = child.stderr.take() {
            let tail = Arc::clone(&tail);
            tokio::spawn(async move {
                use tokio::io::{AsyncBufReadExt, BufReader};
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(l)) = lines.next_line().await {
                    if !l.trim().is_empty() {
                        *tail.lock().unwrap() = l;
                    }
                }
            });
        }
        let started = Instant::now();
        // 健康判定期：期间退出 = 立即失败（bind/认证类）；撑过 = 转健康、干等退出
        let exited_early = tokio::select! {
            res = child.wait() => {
                let _ = res;
                true
            }
            _ = tokio::time::sleep(tunings.healthy_after) => false,
        };
        if !exited_early {
            *status.lock().unwrap() = TunnelStatus::of(
                "healthy",
                format!(
                    "{} ⇄ 127.0.0.1:{} 已连通（keepalive 自愈中）",
                    k.host, k.tunnel_port
                ),
            );
            let _ = child.wait().await;
        }
        if started.elapsed() >= tunings.healthy_hold {
            backoff = tunings.backoff_start;
        }
        let reason = {
            let t = tail.lock().unwrap().clone();
            if t.is_empty() {
                "连接断开（无输出）".to_string()
            } else {
                t
            }
        };
        *status.lock().unwrap() =
            TunnelStatus::of("retrying", format!("{reason}，{backoff:?} 后重试"));
        tokio::time::sleep(backoff).await;
        backoff = backoff.saturating_mul(2).min(tunings.backoff_max);
    }
}

/// 从数据库读全部 agent 配置（settings 表 ai_agents，与 agent_by_id 同源）
fn agents_from_db(conn: &rusqlite::Connection) -> Vec<AgentConfig> {
    let get = |k: &str| -> Option<String> {
        conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| {
            r.get::<_, String>(0)
        })
        .ok()
    };
    ai::load_agents(&get)
}

/// 某个 agent 的常驻隧道状态（未开启/未配置返回 off，不是错误）
#[tauri::command]
pub fn tunnel_status(
    db: State<'_, Db>,
    manager: State<'_, TunnelManager>,
    agent_id: String,
) -> AppResult<TunnelStatus> {
    let agent = {
        let conn = db.0.lock().unwrap();
        ai::agent_by_id(
            &|k| {
                conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| {
                    r.get::<_, String>(0)
                })
                .ok()
            },
            &agent_id,
        )
        .ok_or_else(|| AppError::Invalid(format!("Agent {agent_id} 不存在，请先保存配置")))?
    };
    let remote = agent
        .remote
        .filter(|r| !r.host.trim().is_empty())
        .ok_or_else(|| AppError::Invalid("该 agent 未配置 SSH 远程执行".into()))?;
    Ok(manager.status_of(&remote))
}

/// 按 ai_agents 配置对齐常驻隧道集合（agent 保存 / 一键配置成功后前端调用；
/// 应用启动时由 spawn_startup_sync 后端自发）
#[tauri::command]
pub async fn sync_tunnels(db: State<'_, Db>, manager: State<'_, TunnelManager>) -> AppResult<()> {
    let agents = {
        let conn = db.0.lock().unwrap();
        agents_from_db(&conn)
    };
    manager.sync(&agents);
    Ok(())
}

/// 应用启动时按存量配置拉起常驻隧道（无配置时为空集，静默）
pub fn spawn_startup_sync(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let agents = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            agents_from_db(&conn)
        };
        if let Some(manager) = app.try_state::<TunnelManager>() {
            manager.sync(&agents);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn remote(persistent: bool) -> AgentRemote {
        AgentRemote {
            host: "dev@box".into(),
            port: 2222,
            key_path: Some("~/.ssh/id_ed25519".into()),
            tunnel: Some(10022),
            persistent,
        }
    }

    #[test]
    fn tunnel_argv_carrys_autossh_recipe() {
        let argv = tunnel_argv(&TunnelKey::of(&remote(true)).unwrap());
        // 反向转发目标：远程回环的隧道端口 ⇄ 本机 sshd 22
        let i = argv.iter().position(|x| x == "-R").unwrap();
        assert_eq!(argv[i + 1], "127.0.0.1:10022:127.0.0.1:22");
        // autossh 配方三件套
        assert!(argv
            .windows(2)
            .any(|w| w == ["-o", "ServerAliveInterval=10"]));
        assert!(argv
            .windows(2)
            .any(|w| w == ["-o", "ServerAliveCountMax=3"]));
        assert!(argv
            .windows(2)
            .any(|w| w == ["-o", "ExitOnForwardFailure=yes"]));
        // 密钥与非默认端口进 argv，-- 之后是主机，-N 不执行远端命令
        assert!(argv.windows(2).any(|w| w == ["-i", "~/.ssh/id_ed25519"]));
        assert!(argv.windows(2).any(|w| w == ["-p", "2222"]));
        let host_pos = argv.iter().position(|x| x == "dev@box").unwrap();
        assert_eq!(argv[host_pos - 1], "--", "host 之前有 -- 保护");
        assert_eq!(argv.last().unwrap(), "dev@box");
        assert!(argv.contains(&"-N".to_string()));
        // 默认端口 22 不带 -p
        let plain = AgentRemote {
            port: 22,
            key_path: None,
            ..remote(true)
        };
        assert!(!tunnel_argv(&TunnelKey::of(&plain).unwrap()).contains(&"-p".to_string()));
    }

    #[test]
    fn tunnel_key_filters_incomplete_config() {
        // 未配 host / 未配隧道端口（没跑一键配置）都构不成隧道身份
        assert!(TunnelKey::of(&AgentRemote {
            host: "  ".into(),
            tunnel: Some(10022),
            ..Default::default()
        })
        .is_none());
        assert!(TunnelKey::of(&AgentRemote {
            host: "box".into(),
            tunnel: None,
            ..Default::default()
        })
        .is_none());
        // 端口 0 归一为 22；host 去空白；密钥空串归 None（同一远程不同写法可共享隧道）
        let k = TunnelKey::of(&AgentRemote {
            host: " box ".into(),
            port: 0,
            key_path: Some("  ".into()),
            tunnel: Some(10022),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(k.host, "box");
        assert_eq!(k.ssh_port, 22);
        assert_eq!(k.key, None);
    }

    #[test]
    fn status_of_reports_off_variants() {
        let m = TunnelManager::default();
        // 未开启 / 配了开关但没隧道端口 / 开了但未运行（如配置刚保存未同步）
        assert_eq!(m.status_of(&remote(false)).state, "off");
        let no_tunnel = AgentRemote {
            tunnel: None,
            persistent: true,
            ..remote(true)
        };
        assert!(m.status_of(&no_tunnel).detail.contains("一键配置"));
        assert_eq!(
            m.status_of(&remote(true)).detail,
            "常驻隧道未运行（保存配置或重启应用后生效）"
        );
    }

    #[test]
    fn sync_stops_removed_and_ignores_disabled() {
        let m = TunnelManager::default();
        let agent = |enabled: bool, persistent: bool| AgentConfig {
            command: "claude".into(),
            enabled,
            remote: Some(remote(persistent)),
            ..Default::default()
        };
        // 未开常驻 / agent 被停用都不产生隧道
        m.sync(&[agent(true, false)]);
        assert!(m.tunnels.lock().unwrap().is_empty());
        m.sync(&[agent(false, true)]);
        assert!(m.tunnels.lock().unwrap().is_empty());
        // 开启且启用 → 起一条；从期望集移除后 sync 停掉，状态随之归 off
        m.sync(&[agent(true, true)]);
        assert_eq!(m.tunnels.lock().unwrap().len(), 1);
        assert_eq!(m.status_of(&remote(true)).state, "connecting");
        m.sync(&[]);
        assert!(m.tunnels.lock().unwrap().is_empty());
        assert_eq!(m.status_of(&remote(true)).state, "off");
    }

    fn quick_tunings() -> Tunings {
        Tunings {
            healthy_after: Duration::from_millis(150),
            backoff_start: Duration::from_millis(40),
            backoff_max: Duration::from_millis(200),
            healthy_hold: Duration::from_millis(500),
        }
    }

    /// 假 ssh 程序：按内容模拟「长连」（sleep）与「秒退带 stderr」两种隧道端行为
    fn fake_ssh(dir: &std::path::Path, mode: &str) -> String {
        use std::os::unix::fs::PermissionsExt;
        let p = dir.join(format!("fake-ssh-{mode}.sh"));
        let body = match mode {
            "live" => "#!/bin/sh\nsleep 30\n",
            _ => "#!/bin/sh\necho 'remote port forwarding failed for listen port 10022' >&2\nexit 255\n",
        };
        std::fs::write(&p, body).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        p.to_string_lossy().into_owned()
    }

    /// 轮询共享状态直到谓词成立（并行测试的 CPU 争用会拉慢子进程时序，固定睡眠易脆）；
    /// 超时返回最后快照，由调用方断言失败信息
    async fn wait_for(
        status: &Mutex<TunnelStatus>,
        pred: impl Fn(&TunnelStatus) -> bool,
    ) -> TunnelStatus {
        for _ in 0..100 {
            let snap = status.lock().unwrap().clone();
            if pred(&snap) {
                return snap;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        status.lock().unwrap().clone()
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn supervise_marks_healthy_then_reports_exit() {
        let dir = std::env::temp_dir().join(format!("pk-tunnel-live-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let status = Arc::new(Mutex::new(TunnelStatus::default()));
        let s = Arc::clone(&status);
        let key = TunnelKey::of(&remote(true)).unwrap();
        let ssh = fake_ssh(&dir, "live");
        let task = tokio::spawn(async move {
            supervise(&key, quick_tunings(), &ssh, s).await;
        });
        let snap = wait_for(&status, |s| s.state == "healthy").await;
        assert_eq!(snap.state, "healthy", "长连假 ssh 应判健康: {snap:?}");
        assert!(snap.detail.contains("dev@box"), "详情带主机: {snap:?}");
        // abort（manager 停隧道的同一路径）后任务结束；kill_on_drop 负责 ssh 子进程
        task.abort();
        let _ = task.await;
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn supervise_retries_with_stderr_tail() {
        let dir = std::env::temp_dir().join(format!("pk-tunnel-die-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let status = Arc::new(Mutex::new(TunnelStatus::default()));
        let s = Arc::clone(&status);
        let key = TunnelKey::of(&remote(true)).unwrap();
        let ssh = fake_ssh(&dir, "die");
        let task = tokio::spawn(async move {
            supervise(&key, quick_tunings(), &ssh, s).await;
        });
        // 首连秒退 → retrying 且 stderr 尾行进详情（stderr 读取任务是异步的，允许晚一个周期）
        let snap = wait_for(&status, |s| {
            s.state == "retrying" && s.detail.contains("remote port forwarding")
        })
        .await;
        assert_eq!(snap.state, "retrying", "秒退假 ssh 应处重试态: {snap:?}");
        assert!(
            snap.detail.contains("remote port forwarding failed"),
            "stderr 尾行进详情: {snap:?}"
        );
        assert!(snap.detail.contains("后重试"), "带退避提示: {snap:?}");
        task.abort();
        let _ = task.await;
        let _ = std::fs::remove_dir_all(&dir);
    }
}
