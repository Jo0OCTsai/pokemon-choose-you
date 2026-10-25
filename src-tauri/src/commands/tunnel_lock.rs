//! 隧道让位锁（ADR-0003 §2）：本机 `<appHome>/tunnels/<deployment-id>/` 目录锁 +
//! 持有方 PID 探活。抢不到且持有方存活 → 让位待命（不发起第二条同端口 ssh -R）；
//! 持有方已死 → 清理失效锁接管。跨平台零外部依赖（mkdir 原子性 + kill-0 语义；
//! Windows 上 EPERM 视为存活——权限拒绝大多数意味着进程存在）。
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
                    // 持有方已死：清残留接管（失败 = 并发对手先到手，让位）
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
        std::fs::read_to_string(dir.join("pid"))
            .ok()
            .and_then(|s| s.trim().parse().ok())
    }
}

impl Drop for TunnelLock {
    fn drop(&mut self) {
        // 只清自己的锁目录（PID 复用极端场景下目录内容非本进程也可接受：
        // 残留 + 死 PID 的归宿同为被接管）
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// PID 探活：经 /bin/kill -0（退出码 0 = 可发信号 = 存活；非零 = 已死；命令缺席
/// 视为存活保守让位——与 TS 侧 process.kill(pid, 0) 的 EPERM=存活 同口径）
fn holder_alive(dir: &Path) -> bool {
    let Some(pid) = TunnelLock::holder_pid(dir) else {
        // 无 pid 文件：半个锁（写入中途被杀）——视为死锁可接管
        return false;
    };
    if pid == std::process::id() {
        return true; // 自己（重启后 acquire 竞争窗口）
    }
    match std::process::Command::new("kill")
        .arg("-0")
        .arg(pid.to_string())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
    {
        Ok(code) => code.success(),
        // kill 不可用（极端精简环境）：宁可让位不误判死（双活由 ssh 端口竞争兜底）
        Err(_) => true,
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
}
