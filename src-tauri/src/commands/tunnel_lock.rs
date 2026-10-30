//! 隧道让位锁（ADR-0003 §2）：本机 `<appHome>/tunnels/<deployment-id>/` 目录锁 +
//! 持有方 PID 探活；持有方另以 `ssh-pid` 文件记录当前 ssh 子进程（被硬杀后接管方
//! 据此清孤儿 -R 进程）。抢不到且持有方存活 → 让位待命（不发起第二条同端口 ssh -R）；
//! 持有方已死 → 清理失效锁（含孤儿 ssh）接管。跨平台零外部依赖（mkdir 原子性 +
//! kill-0 语义；Windows 上 EPERM 视为存活——权限拒绝大多数意味着进程存在）。
//! 双端同构：dsh 插件侧 tunnelSupervisor.ts 按同一目录/文件协议实现。

use std::path::{Path, PathBuf};

/// 锁句柄：Drop 时释放（目录删除）；进程被强杀时目录残留、PID 死亡即被接管
pub struct TunnelLock {
    dir: PathBuf,
}

impl TunnelLock {
    /// 尝试获取指定部署的隧道维护权（Ok(None) = 已被存活宿主持有，应让位）
    pub fn try_acquire(base: &Path, deployment_id: &str) -> std::io::Result<Option<TunnelLock>> {
        let parent = base.join("tunnels");
        // 父目录幂等创建（无锁语义）；原子性只依赖叶子目录的 create_dir
        std::fs::create_dir_all(&parent)?;
        let dir = parent.join(deployment_id);
        // mkdir 原子抢锁：EEXIST = 已有持有者（或残留）
        match std::fs::create_dir(&dir) {
            Ok(()) => {
                std::fs::write(dir.join("pid"), std::process::id().to_string())?;
                Ok(Some(TunnelLock { dir }))
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                if holder_alive(&dir) {
                    Ok(None)
                } else {
                    // 持有方已死：先清孤儿 ssh（被硬杀的宿主残留的 -R 进程会占着
                    // 远端监听端口，接管方的新连接将循环撞 ExitOnForwardFailure），
                    // 再清残留目录重试（失败 = 并发对手先到手，让位）
                    kill_orphan_ssh(&dir);
                    match std::fs::remove_dir_all(&dir) {
                        Ok(()) => Self::try_acquire(base, deployment_id),
                        Err(_) => Ok(None),
                    }
                }
            }
            Err(e) => Err(e),
        }
    }

    /// 持有方 PID（让位态的呈现面：指明当前维护者）
    pub fn holder_pid(dir: &Path) -> Option<u32> {
        read_pid_at(&dir.join("pid"))
    }

    /// 记录当前 ssh 子进程 PID（持有方每次 spawn 后写；接管死锁的一方据此清孤儿）
    pub fn record_ssh_pid(&self, pid: u32) -> std::io::Result<()> {
        std::fs::write(self.dir.join("ssh-pid"), pid.to_string())
    }
}

impl Drop for TunnelLock {
    fn drop(&mut self) {
        // 只清自己的锁目录（PID 复用极端场景下目录内容非本进程也可接受：
        // 残留 + 死 PID 的归宿同为被接管）
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// PID 文件读取（pid / ssh-pid 共用口径：缺文件、坏内容 → None）
fn read_pid_at(path: &Path) -> Option<u32> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| s.trim().parse().ok())
}

/// PID 探活：经 /bin/kill -0（退出码 0 = 可发信号 = 存活；非零 = 已死；命令缺席
/// 视为存活保守——与 TS 侧 process.kill(pid, 0) 的 EPERM=存活 同口径）
fn pid_alive(pid: u32) -> bool {
    match std::process::Command::new("kill")
        .arg("-0")
        .arg(pid.to_string())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
    {
        Ok(code) => code.success(),
        Err(_) => true,
    }
}

/// 持有方探活：无 pid 文件 = 半锁（写入中途被杀）视为死可接管；pid = 本进程恒活
fn holder_alive(dir: &Path) -> bool {
    let Some(pid) = TunnelLock::holder_pid(dir) else {
        return false;
    };
    if pid == std::process::id() {
        return true; // 自己（重启后 acquire 竞争窗口）
    }
    pid_alive(pid)
}

/// 死锁接管时顺带清孤儿 ssh（与 TS 侧 killOrphanSsh 同协议）：读 ssh-pid → 探活 →
/// `ps` 命令行核对（含 ssh 与 -R，防 PID 复用误杀无关进程）→ SIGTERM；核对不成立
/// / 进程已死 / ps 缺席都跳过——清不掉不阻塞接管（远端端口冲突由 ExitOnForwardFailure 兜底）
fn kill_orphan_ssh(dir: &Path) {
    let Some(pid) = read_pid_at(&dir.join("ssh-pid")) else {
        return;
    };
    if !pid_alive(pid) {
        return;
    }
    // -ww：非 tty 下 ps 按 80 列截断命令行，长路径会把 -R 截出视野
    let looks_like_tunnel = std::process::Command::new("ps")
        .args(["-ww", "-p", &pid.to_string(), "-o", "command="])
        .output()
        .map(|o| {
            o.status.success() && {
                let cmd = String::from_utf8_lossy(&o.stdout);
                cmd.contains("ssh") && cmd.contains("-R")
            }
        })
        .unwrap_or(false);
    if looks_like_tunnel {
        let _ = std::process::Command::new("kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "pky-lock-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .subsec_nanos()
        ));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn acquire_yields_to_live_holder_and_reclaims_dead() {
        let base = base();
        // 首个获取成功
        let a = TunnelLock::try_acquire(&base, "d1").unwrap();
        assert!(a.is_some());
        // 自己持有 → 自己存活 → 第二次获取让位（None，不发 ssh）
        assert!(TunnelLock::try_acquire(&base, "d1").unwrap().is_none());
        // 释放（Drop）后可再次获取
        drop(a);
        assert!(TunnelLock::try_acquire(&base, "d1").unwrap().is_some());

        // 死锁接管：伪造持有者 PID = 极大值（几乎必不存在）→ 探活失败 → 接管
        let dir = base.join("tunnels").join("d2");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("pid"), "2147480000").unwrap();
        let reclaimed = TunnelLock::try_acquire(&base, "d2").unwrap();
        assert!(reclaimed.is_some(), "死锁被接管");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn different_deployments_do_not_contend() {
        let base = base();
        let a = TunnelLock::try_acquire(&base, "d1").unwrap().unwrap();
        let b = TunnelLock::try_acquire(&base, "d2").unwrap().unwrap();
        drop((a, b));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn record_ssh_pid_writes_into_lock_dir_and_clears_on_drop() {
        let base = base();
        let lock = TunnelLock::try_acquire(&base, "d1").unwrap().unwrap();
        lock.record_ssh_pid(424242).unwrap();
        assert_eq!(
            std::fs::read_to_string(base.join("tunnels").join("d1").join("ssh-pid"))
                .unwrap()
                .trim(),
            "424242"
        );
        drop(lock);
        assert!(!base.join("tunnels").join("d1").exists());
        let _ = std::fs::remove_dir_all(&base);
    }

    /// 假孤儿 ssh：脚本名含 ssh、参数带 -R（对齐 kill_orphan_ssh 的 ps 命令行核对
    /// 口径），长眠等 SIGTERM
    #[cfg(unix)]
    fn fake_orphan_ssh(dir: &std::path::Path) -> std::process::Child {
        use std::os::unix::fs::PermissionsExt;
        let script = dir.join("fake-ssh-orphan.sh");
        std::fs::write(&script, "#!/bin/sh\nsleep 30\n").unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::process::Command::new(&script)
            .arg("-R")
            .arg("127.0.0.1:10022:127.0.0.1:22")
            .spawn()
            .unwrap()
    }

    /// 轮询等待子进程退出（SIGTERM 送达有窗口，固定睡眠易脆）
    #[cfg(unix)]
    fn wait_exited(child: &mut std::process::Child) -> bool {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            if child.try_wait().unwrap().is_some() {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        child.try_wait().unwrap().is_some()
    }

    #[cfg(unix)]
    #[test]
    fn dead_lock_takeover_kills_orphan_tunnel_ssh() {
        let base = base();
        let mut orphan = fake_orphan_ssh(&base);
        let dir = base.join("tunnels").join("d9");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("pid"), "2147480000").unwrap();
        std::fs::write(dir.join("ssh-pid"), orphan.id().to_string()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(150)); // 等 ps 命令行可见
        let lock = TunnelLock::try_acquire(&base, "d9").unwrap();
        assert!(lock.is_some(), "死锁被接管");
        assert!(wait_exited(&mut orphan), "孤儿 ssh 被 SIGTERM 清掉");
        drop(lock);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[cfg(unix)]
    #[test]
    fn takeover_spares_unrelated_pid_reuse() {
        let base = base();
        let mut innocent = std::process::Command::new("sleep")
            .arg("30")
            .spawn()
            .unwrap();
        let dir = base.join("tunnels").join("d10");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("pid"), "2147480000").unwrap();
        std::fs::write(dir.join("ssh-pid"), innocent.id().to_string()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(150));
        let lock = TunnelLock::try_acquire(&base, "d10").unwrap();
        assert!(lock.is_some(), "锁被接管");
        // 命令行不像隧道 ssh（sleep 30）→ 不杀
        std::thread::sleep(std::time::Duration::from_millis(300));
        assert!(innocent.try_wait().unwrap().is_none(), "无关进程不得被误杀");
        let _ = innocent.kill();
        let _ = innocent.wait();
        drop(lock);
        let _ = std::fs::remove_dir_all(&base);
    }
}
