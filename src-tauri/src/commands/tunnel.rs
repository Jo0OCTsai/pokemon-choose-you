//! 常驻反向隧道管理（REMOTE_PK_CHANNEL_PROPOSAL §5 方案 B · ADR-0003 部署驱动）。
//!
//! 应用驻留期间为 `pkTunnel.persistent` 开启的部署维持 `ssh -N -R` 长连：
//! 远程侧 127.0.0.1:隧道端口 ⇄ 本机 sshd，远程任何进程（无头 agent / tmux 常驻会话 /
//! 手动 ssh）随时可调 pk，不再依赖应用发起调用的存活窗口。
//! 隧道配置是部署实体的机器级字段（ADR-0003 §2）——sync 与部署注册表对齐；
//! 目标以 OpenSSH 别名发起（凭据与端口由 ~/.ssh/config 承载）。
//! autossh 配方内化（应用进程即 supervisor，无需外部依赖）：
//! - `ServerAliveInterval=10` × `ServerAliveCountMax=3`：约 30 秒内检出死连接（休眠唤醒/换网自愈）；
//! - `ExitOnForwardFailure=yes`：远程端口绑定失败（被占）即退出重连，杜绝「连接活着但隧道没建」的假隧道；
//! - 指数退避重连（1s 起、30s 封顶；连接稳定满 60s 后退避复位）。
//!
//! 停止 = abort 监控任务，ssh 子进程随 `kill_on_drop` 一并终止。
//!
//! 双宿主让位（ADR-0003 §2）：维护权经 `<appHome>/tunnels/<部署id>` 目录锁协调——
//! 抢不到且持有方存活 → 让位待命（yielded，周期重查）；持有方退出自动接管；
//! dsh 插件侧 tunnelSupervisor.ts 同构协议。

use crate::commands::deployments::{list_deployments, DeploymentEntity};
use crate::commands::tunnel_lock::TunnelLock;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Manager, State};

/// 隧道身份：一部署一隧道（pkTunnel 是机器级单例配置——ADR-0003 §2）
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct TunnelKey {
    /// 实体唯一键（新建生成；引用用 alias 不用 id）
    pub deployment_id: String,
    /// OpenSSH 别名（凭据与主机身份由它承载）
    pub alias: String,
    /// 远端侧隧道端口（⇄ 本机 sshd 22）
    pub tunnel_port: u16,
}

impl TunnelKey {
    /// 从部署实体取隧道身份：未开常驻或端口无效返回 None
    pub fn of(e: &DeploymentEntity) -> Option<Self> {
        let t = e.pk_tunnel.as_ref()?;
        if !t.persistent || t.port == 0 || e.alias.trim().is_empty() {
            return None;
        }
        Some(Self {
            deployment_id: e.id.clone(),
            alias: e.alias.trim().to_string(),
            tunnel_port: t.port,
        })
    }
}

/// 面向 UI 的隧道状态。state：off（未开启/未配置）/ connecting / healthy / retrying /
/// yielded（让位待命——另一存活宿主持有维护权，可区分于故障重连）
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelStatus {
    /// off / connecting / healthy / retrying / yielded
    pub state: String,
    /// 状态详情（含 ssh 报错尾行/让位持有者）
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

/// 常驻隧道命令行（autossh 配方，见模块注释；alias 模式——无 -i/-p）
fn tunnel_argv(k: &TunnelKey) -> Vec<String> {
    vec![
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
        // -- 在 host 之前：以 - 开头的别名不被当成 ssh 选项
        "--".to_string(),
        k.alias.clone(),
    ]
}

struct TunnelEntry {
    handle: tauri::async_runtime::JoinHandle<()>,
    status: Arc<Mutex<TunnelStatus>>,
}

/// 常驻隧道集合（Tauri managed state，键 = 部署 id）。sync 与部署注册表对齐；
/// 停止走 handle.abort()——监控任务里的 ssh 子进程 kill_on_drop 随之终止
#[derive(Default)]
pub struct TunnelManager {
    tunnels: Mutex<HashMap<String, TunnelEntry>>,
    /// 让位锁根目录（缺省 <appHome>；测试注入临时目录）
    lock_base: Option<PathBuf>,
}

impl TunnelManager {
    /// 测试注入锁根目录
    #[cfg(test)]
    pub fn with_lock_base(base: PathBuf) -> Self {
        Self {
            tunnels: Mutex::new(HashMap::new()),
            lock_base: Some(base),
        }
    }

    fn lock_base(&self) -> PathBuf {
        self.lock_base.clone().unwrap_or_else(|| {
            crate::db::app_home().unwrap_or_else(|| PathBuf::from(".choose-you"))
        })
    }

    /// 与期望的部署集合对齐：停掉不再开启常驻的隧道，补起缺失的（已在跑的原样保留）
    pub fn sync(&self, deployments: &[DeploymentEntity]) {
        let desired: HashMap<String, TunnelKey> = deployments
            .iter()
            .filter_map(|e| TunnelKey::of(e).map(|k| (e.id.clone(), k)))
            .collect();
        let mut tunnels = self.tunnels.lock().unwrap();
        tunnels.retain(|id, e| {
            if desired.contains_key(id) {
                true
            } else {
                e.handle.abort();
                false
            }
        });
        let lock_base = self.lock_base();
        for (id, k) in desired {
            tunnels
                .entry(id)
                .or_insert_with(|| spawn_tunnel(&k, lock_base.clone()));
        }
    }

    /// 某部署的常驻隧道状态（未开启 / 未配置 / 未运行均归 off，附原因）
    pub fn status_of(&self, entity: &DeploymentEntity) -> TunnelStatus {
        match entity.pk_tunnel.as_ref() {
            None => return TunnelStatus::of("off", "未配置 pk 通道（先跑「开通 pk 通道」）"),
            Some(t) if !t.persistent => return TunnelStatus::of("off", "未开启常驻隧道"),
            Some(t) if t.port == 0 => {
                return TunnelStatus::of("off", "隧道端口无效（先跑「开通 pk 通道」）")
            }
            _ => {}
        }
        let tunnels = self.tunnels.lock().unwrap();
        match tunnels.get(&entity.id) {
            Some(e) => e.status.lock().unwrap().clone(),
            None => TunnelStatus::of("off", "常驻隧道未运行（保存部署或重启应用后生效）"),
        }
    }
}

fn spawn_tunnel(k: &TunnelKey, lock_base: PathBuf) -> TunnelEntry {
    let status = Arc::new(Mutex::new(TunnelStatus::of(
        "connecting",
        "建立 ssh -R 连接",
    )));
    let task_status = Arc::clone(&status);
    let key = k.clone();
    let tunings = TUNINGS;
    let ssh_program = crate::ai::ssh_bin();
    let handle = tauri::async_runtime::spawn(async move {
        supervise(&key, tunings, &ssh_program, lock_base, task_status).await;
    });
    TunnelEntry { handle, status }
}

/// 单条隧道的保活循环：先让位锁（抢不到 → yielded 周期重查），持锁期间
/// 连接 → 健康判定 → 等待退出/被 abort → 退避重连；锁随作用域 Drop 释放。
/// 状态随时写入共享 TunnelStatus（UI 查询）；ssh stderr 尾行进详情，定位认证/端口占用。
/// ssh 程序与锁根目录可注入（测试用假 ssh + 临时目录）
async fn supervise(
    k: &TunnelKey,
    tunings: Tunings,
    ssh_program: &str,
    lock_base: PathBuf,
    status: Arc<Mutex<TunnelStatus>>,
) {
    let mut backoff = tunings.backoff_start;
    loop {
        let lock = match TunnelLock::try_acquire(&lock_base, &k.deployment_id) {
            Ok(Some(lock)) => lock,
            Ok(None) => {
                // 让位待命：持有方存活（detail 指明维护者 PID），周期重查直到可接管
                let holder =
                    TunnelLock::holder_pid(&lock_base.join("tunnels").join(&k.deployment_id));
                *status.lock().unwrap() = TunnelStatus::of(
                    "yielded",
                    format!(
                        "另一宿主（PID {}）正在维持本部署隧道，让位待命中",
                        holder.map(|p| p.to_string()).unwrap_or_else(|| "?".into())
                    ),
                );
                tokio::time::sleep(Duration::from_secs(10)).await;
                continue;
            }
            Err(e) => {
                *status.lock().unwrap() = TunnelStatus::of(
                    "retrying",
                    format!("获取隧道锁失败（{e}），{backoff:?} 后重试"),
                );
                tokio::time::sleep(backoff).await;
                backoff = backoff.saturating_mul(2).min(tunings.backoff_max);
                continue;
            }
        };
        supervise_while_holding(k, tunings, ssh_program, &lock, &status).await;
        // 锁释放（Drop）后立即回到外层重抢——本宿主退出 suppress 场景由 abort 收口
    }
}

/// 持锁保活内循环：ssh 连接的建/守/退避重连（锁在本函数作用域存活）
async fn supervise_while_holding(
    k: &TunnelKey,
    tunings: Tunings,
    ssh_program: &str,
    _lock: &TunnelLock,
    status: &Arc<Mutex<TunnelStatus>>,
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
                    k.alias, k.tunnel_port
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

/// 从数据库读全部部署（settings 键 dsh:deployments）
fn deployments_from_db(conn: &rusqlite::Connection) -> Vec<DeploymentEntity> {
    list_deployments(conn).into_values().collect()
}

/// 某个部署的常驻隧道状态（未开启/未配置返回 off，不是错误）
#[tauri::command]
pub fn tunnel_status(
    db: State<'_, Db>,
    manager: State<'_, TunnelManager>,
    deployment_id: String,
) -> AppResult<TunnelStatus> {
    let entity = {
        let conn = db.0.lock().unwrap();
        list_deployments(&conn)
            .into_values()
            .find(|e| e.id == deployment_id)
            .ok_or_else(|| AppError::Invalid(format!("部署 {deployment_id} 不存在")))?
    };
    Ok(manager.status_of(&entity))
}

/// 按部署注册表对齐常驻隧道集合（部署保存 / pk 通道开通成功后前端调用；
/// 应用启动时由 spawn_startup_sync 后端自发）
#[tauri::command]
pub async fn sync_tunnels(db: State<'_, Db>, manager: State<'_, TunnelManager>) -> AppResult<()> {
    let deployments = {
        let conn = db.0.lock().unwrap();
        deployments_from_db(&conn)
    };
    manager.sync(&deployments);
    Ok(())
}

/// 应用启动时按存量配置拉起常驻隧道（无配置时为空集，静默）
pub fn spawn_startup_sync(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let deployments = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            deployments_from_db(&conn)
        };
        if let Some(manager) = app.try_state::<TunnelManager>() {
            manager.sync(&deployments);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::deployments::PkTunnelConfig;

    fn entity(id: &str, alias: &str, port: u16, persistent: bool) -> DeploymentEntity {
        DeploymentEntity {
            id: id.into(),
            alias: alias.into(),
            pk_tunnel: (port != 0).then_some(PkTunnelConfig { port, persistent }),
            ..Default::default()
        }
    }

    #[test]
    fn tunnel_argv_carrys_autossh_recipe_alias_mode() {
        let argv = tunnel_argv(&TunnelKey::of(&entity("d1", "gpu-1", 10022, true)).unwrap());
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
        // alias 模式（ADR-0003）：不带 -i/-p，-- 之后是别名，-N 不执行远端命令
        assert!(!argv.contains(&"-i".to_string()));
        assert!(!argv.contains(&"-p".to_string()));
        let alias_pos = argv.iter().position(|x| x == "gpu-1").unwrap();
        assert_eq!(argv[alias_pos - 1], "--", "别名之前有 -- 保护");
        assert_eq!(argv.last().unwrap(), "gpu-1");
        assert!(argv.contains(&"-N".to_string()));
    }

    #[test]
    fn tunnel_key_filters_incomplete_config() {
        // 未配 pkTunnel / 未开常驻 / 端口无效都构不成隧道身份
        assert!(TunnelKey::of(&entity("d1", "gpu-1", 0, true)).is_none());
        assert!(TunnelKey::of(&entity("d1", "gpu-1", 10022, false)).is_none());
        assert!(TunnelKey::of(&entity("d1", "  ", 10022, true)).is_none());
        let k = TunnelKey::of(&entity("d1", " gpu-1 ", 10022, true)).unwrap();
        assert_eq!(k.alias, "gpu-1");
        assert_eq!(k.tunnel_port, 10022);
    }

    #[test]
    fn status_of_reports_off_variants() {
        let m = TunnelManager::default();
        // 未配置 / 开了常驻但端口无效 / 开了但未运行（如配置刚保存未同步）
        assert_eq!(m.status_of(&entity("d1", "gpu-1", 0, false)).state, "off");
        let persistent = entity("d1", "gpu-1", 10022, true);
        assert_eq!(
            m.status_of(&persistent).detail,
            "常驻隧道未运行（保存部署或重启应用后生效）"
        );
    }

    #[test]
    fn sync_stops_removed_and_ignores_non_persistent() {
        let m = TunnelManager::default();
        // 未开常驻不产生隧道
        m.sync(&[entity("d1", "gpu-1", 10022, false)]);
        assert!(m.tunnels.lock().unwrap().is_empty());
        // 开启 → 起一条；从期望集移除后 sync 停掉，状态随之归 off
        let on = entity("d1", "gpu-1", 10022, true);
        m.sync(std::slice::from_ref(&on));
        assert_eq!(m.tunnels.lock().unwrap().len(), 1);
        assert_eq!(m.status_of(&on).state, "connecting");
        m.sync(&[]);
        assert!(m.tunnels.lock().unwrap().is_empty());
        assert_eq!(m.status_of(&on).state, "off");
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
        let key = TunnelKey::of(&entity("d1", "gpu-1", 10022, true)).unwrap();
        let ssh = fake_ssh(&dir, "live");
        let lock_base = dir.join("locks");
        let task = tokio::spawn(async move {
            supervise(&key, quick_tunings(), &ssh, lock_base, s).await;
        });
        let snap = wait_for(&status, |s| s.state == "healthy").await;
        assert_eq!(snap.state, "healthy", "长连假 ssh 应判健康: {snap:?}");
        assert!(snap.detail.contains("gpu-1"), "详情带别名: {snap:?}");
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
        let key = TunnelKey::of(&entity("d1", "gpu-1", 10022, true)).unwrap();
        let ssh = fake_ssh(&dir, "die");
        let lock_base = dir.join("locks");
        let task = tokio::spawn(async move {
            supervise(&key, quick_tunings(), &ssh, lock_base, s).await;
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
