//! 远程 pk 一键配置：agent 在远程、数据在本机的场景下，
//! 自动完成反向隧道所需的全部准备（用户只需先开启本机 sshd）。
//!
//! 应用已有「本机 → 远程」的免密 ssh（跑 agent 用），所有步骤都借它完成：
//! 生成/复用专用密钥 → 公钥装配本机 authorized_keys → 私钥推到远程 →
//! 预信任 `[127.0.0.1]:隧道端口` 的主机指纹 → 安装 shim（内嵌本机 pk 绝对路径）→
//! 保障远程登录 shell 的 PATH → 写回 agent 的隧道端口 → 真实隧道端到端验证。
//! 全程幂等，重复执行安全；任一步失败即停并报告该步的修复建议。

use crate::ai::{self, AgentConfig};
use crate::db::Db;
use crate::error::{AppError, AppResult};
use rusqlite::params;
use std::io::Write;
use std::path::PathBuf;
use tauri::{Manager, State};

/// 默认反向隧道端口（远程侧 127.0.0.1:10022 ⇄ 本机 sshd）
pub const DEFAULT_TUNNEL_PORT: u16 = 10022;

/// 一键配置的执行上下文（程序路径与目录可注入，供测试）
pub(crate) struct RemotePkSetup {
    /// ssh 客户端（跑远程命令；agent 调用同一套 PK_SSH_BIN 覆盖）
    pub ssh_program: String,
    /// ssh-keyscan（本机 sshd 预检 + 取主机指纹）
    pub keyscan_program: String,
    /// agent 的 SSH 目标（user@host）
    pub host: String,
    /// agent 的 SSH 端口
    pub ssh_port: u16,
    /// agent 的私钥路径（连远程用，None 走 ssh 默认）
    pub agent_key: Option<String>,
    /// 反向隧道端口（远程侧监听）
    pub tunnel_port: u16,
    /// 本机用户名（shim 回连 user@127.0.0.1 认证用）
    pub local_user: String,
    /// 本机 pk 的绝对路径（内嵌进 shim）
    pub pk_path: String,
    /// 专用密钥的存放目录（应用数据目录）
    pub key_dir: PathBuf,
    /// 本机用户主目录（authorized_keys 落点，可注入供测试）
    pub local_home: PathBuf,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStep {
    pub name: String,
    /// ok / skip（幂等复用）/ fail
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupReport {
    pub ok: bool,
    pub steps: Vec<SetupStep>,
    /// 端到端验证拿回的远程 pk 版本
    pub version: Option<String>,
}

/// ssh 到 agent 的远程机器执行一行命令；stdin 有内容则写入（远程 `cat >` 接收）。
/// 返回 (成功?, stdout+stderr 合并摘要)。BatchMode 免交互，连接超时 10 秒。
fn ssh_run(
    ctx: &RemotePkSetup,
    extra: &[&str],
    remote_line: &str,
    stdin: Option<&str>,
) -> (bool, String) {
    let mut cmd = std::process::Command::new(&ctx.ssh_program);
    cmd.args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"]);
    if let Some(key) = ctx.agent_key.as_deref().filter(|k| !k.trim().is_empty()) {
        cmd.args(["-i", key]);
    }
    if ctx.ssh_port != 0 && ctx.ssh_port != 22 {
        cmd.args(["-p", &ctx.ssh_port.to_string()]);
    }
    for e in extra {
        cmd.arg(e);
    }
    cmd.arg(ctx.host.trim()).arg("--").arg(remote_line);
    let child = cmd
        .stdin(if stdin.is_some() {
            std::process::Stdio::piped()
        } else {
            std::process::Stdio::null()
        })
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn();
    let mut child = match child {
        Ok(c) => c,
        Err(e) => return (false, format!("无法启动 ssh（{e}）")),
    };
    if let Some(body) = stdin {
        if let Some(mut handle) = child.stdin.take() {
            // 载荷都很小（密钥/脚本/指纹，百字节级），内联写完再等结束不会管道死锁
            let _ = handle.write_all(body.as_bytes());
        }
    }
    match child.wait_with_output() {
        Ok(out) if out.status.success() => {
            let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
            (true, text)
        }
        Ok(out) => {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            (
                false,
                if err.is_empty() {
                    format!("退出码 {}", out.status.code().unwrap_or(-1))
                } else {
                    err
                },
            )
        }
        Err(e) => (false, format!("等待 ssh 结束失败：{e}")),
    }
}

/// shim 脚本内容：命令经应用建立的反向隧道（远程 127.0.0.1:端口 ⇄ 本机 sshd）回本机执行。
/// pk 用绝对路径内嵌（本机 sshd 的非交互 PATH 通常找不到应用目录里的 pk）。
/// - 连接复用（方案 A）：ControlMaster 让首调后的每次调用免握手，ControlPersist 保活；
///   复用发生在远程侧 ssh 客户端（远程必为 unix），与本机系统无关
/// - 环境透传（方案 B 的 ④ 修复）：PK_LOG_FILE / PK_DISPATCH_TASK 在远端求值并内联进
///   回连命令，本机侧 pk 照常拿到（值内含双引号/反斜杠不支持，实际只有日志路径与任务 id）。
///   仅 unix 本机——Windows 本机 sshd 默认 shell 是 cmd，没有 env 命令，保持直呼 pk
pub(crate) fn shim_script(pk_path: &str, tunnel_port: u16, local_user: &str) -> String {
    let quoted_pk = if cfg!(windows) {
        // 本机 sshd 默认 shell 是 cmd：含空格的路径用双引号
        if pk_path.contains(' ') {
            format!("\"{pk_path}\"")
        } else {
            pk_path.to_string()
        }
    } else {
        posix_quote(pk_path)
    };
    // unix 本机：PK_* 已设置时以 env 前缀带回（值含空格安全：远端求值时已加引号）
    let (env_fwd, tail) = if cfg!(unix) {
        (
            "fwd=env\n\
             [ -n \"$PK_LOG_FILE\" ] && fwd=\"$fwd PK_LOG_FILE=\\\"$PK_LOG_FILE\\\"\"\n\
             [ -n \"$PK_DISPATCH_TASK\" ] && fwd=\"$fwd PK_DISPATCH_TASK=$PK_DISPATCH_TASK\"\n",
            format!("\"$fwd {quoted_pk}\" \"$@\""),
        )
    } else {
        ("", format!("{quoted_pk} \"$@\""))
    };
    format!(
        "#!/bin/sh\n\
         # pk 远程透传 shim（就决定是你了一键配置生成）：经应用建立的反向隧道回本机执行，数据始终留在本机。\n\
         # 连接复用：首调建 ControlMaster，后续调用毫秒级；环境透传见下方 fwd 段。\n\
         {env_fwd}\
         exec ssh -o BatchMode=yes -o ConnectTimeout=10 \\\n\
         -o ControlMaster=auto -o ControlPath=\"$HOME/.ssh/pk-shim-%C\" -o ControlPersist=10m \\\n\
         -i \"$HOME/.ssh/pk_shim\" -p {port} {user}@127.0.0.1 {tail}\n",
        port = tunnel_port,
        user = local_user,
    )
}

/// POSIX 单引号引用（shim 行内路径交给本机登录 shell 重解析）
fn posix_quote(s: &str) -> String {
    let safe = !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_./=@:%+".contains(&b));
    if safe {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', r"'\''"))
    }
}

/// ssh-keyscan 输出 → known_hosts 条目：主机名改写为 [127.0.0.1]:隧道端口
pub(crate) fn to_known_hosts_lines(keyscan: &str, tunnel_port: u16) -> String {
    let mut out = String::new();
    for line in keyscan.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        match line.split_once(' ') {
            Some((_, rest)) => out.push_str(&format!("[127.0.0.1]:{tunnel_port} {rest}\n")),
            None => out.push_str(&format!("{line}\n")),
        }
    }
    out
}

/// 专用密钥文件对（key_dir 下的固定名）
fn key_files(key_dir: &std::path::Path) -> (PathBuf, PathBuf) {
    let stem = key_dir.join("remote_pk_shim_ed25519");
    (stem.with_extension(""), stem.with_extension("pub"))
}

/// 执行一键配置序列（任一步失败即停，报告到失败步为止；不返回 Err——失败都在报告里）
pub(crate) fn run_setup(ctx: &RemotePkSetup) -> SetupReport {
    let mut steps: Vec<SetupStep> = vec![];
    fn fail(steps: &mut Vec<SetupStep>, name: &str, detail: String) {
        steps.push(SetupStep {
            name: name.into(),
            status: "fail".into(),
            detail,
        });
    }

    // 1. 本机 pk 定位（命令侧已解析路径，这里验证可用：存在、非空占位、可执行）
    let pk_file = std::path::Path::new(&ctx.pk_path);
    if !pk_file.exists() {
        fail(
            &mut steps,
            "定位 pk",
            format!("未找到本机 pk：{}（仅安装版应用支持一键配置）", ctx.pk_path),
        );
        return report_of(steps, None);
    }
    // tauri dev 会把 sidecar 占位（src-tauri/binaries/pk-<triple>，空文件）拷到
    // target/debug/pk 并盖掉 cargo 构建的真二进制——开发态一键配置前需重新构建 pk
    match pk_file.metadata() {
        Ok(m) if m.len() == 0 => {
            fail(
                &mut steps,
                "定位 pk",
                format!(
                    "{} 是空占位文件（tauri dev 的 sidecar 占位盖掉了真实二进制）。开发态请先跑 `cargo build --bin pk` 再重试；安装版应用无此问题",
                    ctx.pk_path
                ),
            );
            return report_of(steps, None);
        }
        Ok(_) => {}
        Err(e) => {
            fail(
                &mut steps,
                "定位 pk",
                format!("读取 {} 失败：{e}", ctx.pk_path),
            );
            return report_of(steps, None);
        }
    }
    #[cfg_attr(not(unix), allow(unused_mut))]
    let mut pk_detail = String::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = pk_file
            .metadata()
            .map(|m| m.permissions().mode())
            .unwrap_or(0);
        if mode & 0o111 == 0 {
            // 占位拷贝常不带执行位；顺手补上（同用户可写，一般都能成功）
            let fixed = std::fs::set_permissions(
                pk_file,
                std::fs::Permissions::from_mode((mode & 0o777) | 0o755),
            )
            .is_ok();
            pk_detail = if fixed {
                "（已自动补执行权限）".into()
            } else {
                fail(
                    &mut steps,
                    "定位 pk",
                    format!("{} 无执行权限且自动补权失败，请手动 chmod +x", ctx.pk_path),
                );
                return report_of(steps, None);
            };
        }
    }
    steps.push(SetupStep {
        name: "定位 pk".into(),
        status: "ok".into(),
        detail: format!("{}{}", ctx.pk_path, pk_detail),
    });

    // 2. 本机 sshd 可达（隧道终点；只扫端口不认证，避免依赖本机自身的免密配置）
    let keyscan = std::process::Command::new(&ctx.keyscan_program)
        .args(["-T", "5", "localhost"])
        .output();
    let host_keys = match keyscan {
        Ok(o) if o.status.success() && !o.stdout.is_empty() => {
            String::from_utf8_lossy(&o.stdout).to_string()
        }
        _ => {
            fail(
                &mut steps,
                "本机 sshd",
                "本机 22 端口无应答——请先开启 sshd（隧道终点，只需本机回环可达，防火墙无需放行）：macOS 系统设置 → 通用 → 共享 → 远程登录；Windows 安装并启动「OpenSSH SSH 服务器」；Linux `sudo systemctl enable --now sshd`".into(),
            );
            return report_of(steps, None);
        }
    };
    steps.push(SetupStep {
        name: "本机 sshd".into(),
        status: "ok".into(),
        detail: "22 端口可达（仅回环即可）".into(),
    });

    // 3. 专用密钥：已有则复用，缺则生成（幂等）
    let (key_priv, key_pub) = key_files(&ctx.key_dir);
    if key_priv.exists() && key_pub.exists() {
        steps.push(SetupStep {
            name: "专用密钥".into(),
            status: "skip".into(),
            detail: format!("复用已有密钥 {}", key_priv.display()),
        });
    } else {
        let _ = std::fs::create_dir_all(&ctx.key_dir);
        let gen = std::process::Command::new("ssh-keygen")
            .args([
                "-t",
                "ed25519",
                "-N",
                "",
                "-C",
                "pokemon-knock remote pk shim",
            ])
            .arg("-f")
            .arg(&key_priv)
            .output();
        match gen {
            Ok(o) if o.status.success() => steps.push(SetupStep {
                name: "专用密钥".into(),
                status: "ok".into(),
                detail: format!("已生成 {}", key_priv.display()),
            }),
            _ => {
                fail(
                    &mut steps,
                    "专用密钥",
                    format!(
                        "ssh-keygen 生成失败（需 OpenSSH 客户端）：{}",
                        gen.map(|o| String::from_utf8_lossy(&o.stderr).trim().to_string())
                            .unwrap_or_default()
                    ),
                );
                return report_of(steps, None);
            }
        }
    }
    let (pub_line, priv_text) = match (
        std::fs::read_to_string(&key_pub).map(|s| s.trim().to_string()),
        std::fs::read_to_string(&key_priv),
    ) {
        (Ok(p), Ok(v)) if !p.is_empty() => (p, v),
        _ => {
            fail(&mut steps, "专用密钥", "密钥文件不可读".into());
            return report_of(steps, None);
        }
    };

    // 4. 公钥装配本机 authorized_keys（幂等：已含则跳过）
    let ssh_dir = ctx.local_home.join(".ssh");
    let ak = ssh_dir.join("authorized_keys");
    let existing = std::fs::read_to_string(&ak).unwrap_or_default();
    if existing.lines().any(|l| l.trim() == pub_line) {
        steps.push(SetupStep {
            name: "本机公钥装配".into(),
            status: "skip".into(),
            detail: "authorized_keys 已含该公钥".into(),
        });
    } else {
        let _ = std::fs::create_dir_all(&ssh_dir);
        let mut file = match std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&ak)
        {
            Ok(f) => f,
            Err(e) => {
                fail(
                    &mut steps,
                    "本机公钥装配",
                    format!("写 {} 失败：{e}", ak.display()),
                );
                return report_of(steps, None);
            }
        };
        if writeln!(file, "{pub_line}").is_err() {
            fail(
                &mut steps,
                "本机公钥装配",
                format!("写 {} 失败", ak.display()),
            );
            return report_of(steps, None);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&ssh_dir, std::fs::Permissions::from_mode(0o700));
            let _ = std::fs::set_permissions(&ak, std::fs::Permissions::from_mode(0o600));
        }
        // Windows OpenSSH 对 authorized_keys 的 ACL 极严（仅当前用户可读），尽力修复
        #[cfg(windows)]
        {
            let user = ctx.local_user.clone();
            let _ = std::process::Command::new("icacls")
                .arg(&ak)
                .args(["/inheritance:r", "/grant"])
                .arg(format!("{user}:(F)"))
                .output();
        }
        steps.push(SetupStep {
            name: "本机公钥装配".into(),
            status: "ok".into(),
            detail: format!("已追加到 {}", ak.display()),
        });
    }

    // 5. 私钥推到远程（经应用既有的免密 ssh；载荷走 stdin 不经远端 shell 重解析）
    let push_key_line = "umask 077 && mkdir -p \"$HOME/.ssh\" && cat > \"$HOME/.ssh/pk_shim\" && chmod 600 \"$HOME/.ssh/pk_shim\"";
    let (ok, err) = ssh_run(ctx, &[], push_key_line, Some(&priv_text));
    if !ok {
        fail(
            &mut steps,
            "推送私钥",
            format!("经 ssh 写远程 ~/.ssh/pk_shim 失败：{err}（确认 agent 的 SSH 配置可免密登录）"),
        );
        return report_of(steps, None);
    }
    steps.push(SetupStep {
        name: "推送私钥".into(),
        status: "ok".into(),
        detail: "远程 ~/.ssh/pk_shim（600）".into(),
    });

    // 6. 预信任主机指纹：把本机 sshd 的 host key 以 [127.0.0.1]:隧道端口 写进远程 known_hosts
    //    （shim 走 BatchMode，首次连接的交互式指纹确认会直接失败，必须预先信任；
    //     先 -R 清旧条目，防本机重装系统后指纹变化卡死）
    let kh_entries = to_known_hosts_lines(&host_keys, ctx.tunnel_port);
    let kh_line = format!(
        "mkdir -p \"$HOME/.ssh\" && touch \"$HOME/.ssh/known_hosts\" && chmod 600 \"$HOME/.ssh/known_hosts\"; \
         ssh-keygen -R \"[127.0.0.1]:{p}\" -f \"$HOME/.ssh/known_hosts\" 2>/dev/null; \
         cat >> \"$HOME/.ssh/known_hosts\"",
        p = ctx.tunnel_port
    );
    let (ok, err) = ssh_run(ctx, &[], &kh_line, Some(&kh_entries));
    if !ok {
        fail(
            &mut steps,
            "预信任主机指纹",
            format!("写远程 known_hosts 失败：{err}"),
        );
        return report_of(steps, None);
    }
    steps.push(SetupStep {
        name: "预信任主机指纹".into(),
        status: "ok".into(),
        detail: format!("[127.0.0.1]:{}（隧道终点的本机 sshd）", ctx.tunnel_port),
    });

    // 7. 安装 shim 到远程 ~/.local/bin（内嵌本机 pk 绝对路径与隧道端口）
    let script = shim_script(&ctx.pk_path, ctx.tunnel_port, &ctx.local_user);
    let shim_line = "umask 022 && mkdir -p \"$HOME/.local/bin\" && cat > \"$HOME/.local/bin/pk\" && chmod 755 \"$HOME/.local/bin/pk\"";
    let (ok, err) = ssh_run(ctx, &[], shim_line, Some(&script));
    if !ok {
        fail(
            &mut steps,
            "安装 shim",
            format!("写远程 ~/.local/bin/pk 失败：{err}"),
        );
        return report_of(steps, None);
    }
    steps.push(SetupStep {
        name: "安装 shim".into(),
        status: "ok".into(),
        detail: "远程 ~/.local/bin/pk（若同一远程配多个 agent，请保持相同隧道端口）".into(),
    });

    // 8. 远程登录 shell 的 PATH 能找到 pk；不能则补 ~/.profile/~/.zprofile/~/.bash_profile 再验
    let check_path = "exec \"$SHELL\" -lc 'command -v pk'";
    let (found, _) = ssh_run(ctx, &[], check_path, None);
    if found {
        steps.push(SetupStep {
            name: "远程 PATH".into(),
            status: "ok".into(),
            detail: "登录 shell 已能找到 pk".into(),
        });
    } else {
        let ensure = "for f in .profile .zprofile .bash_profile; do grep -qs '.local/bin' \"$HOME/$f\" 2>/dev/null || printf '\\nexport PATH=\"$HOME/.local/bin:$PATH\"\\n' >> \"$HOME/$f\"; done; exec \"$SHELL\" -lc 'command -v pk'";
        let (ok2, out2) = ssh_run(ctx, &[], ensure, None);
        if ok2 && !out2.is_empty() {
            steps.push(SetupStep {
                name: "远程 PATH".into(),
                status: "ok".into(),
                detail: format!("已补 PATH（{}）", out2.trim()),
            });
        } else {
            fail(
                &mut steps,
                "远程 PATH",
                "已尝试补 PATH 但登录 shell 仍找不到 pk，请在远程手动确认 ~/.local/bin 可用".into(),
            );
            return report_of(steps, None);
        }
    }

    // 9. 端到端验证：真实开一条带 -R 的 ssh 连接执行 pk --version——
    //    执行期间隧道存活，shim 真回连一次本机 sshd，验证整条链
    let fwd = format!("127.0.0.1:{}:127.0.0.1:22", ctx.tunnel_port);
    let (ok, out) = ssh_run(
        ctx,
        &["-R", &fwd],
        "exec \"$SHELL\" -lc 'pk --version'",
        None,
    );
    let version = out.trim().to_string();
    if ok && !version.is_empty() {
        steps.push(SetupStep {
            name: "端到端验证".into(),
            status: "ok".into(),
            detail: format!("远程经隧道回本机执行成功（pk {version}）"),
        });
        let mut r = report_of(steps, Some(version));
        r.ok = true;
        return r;
    }
    let hint = if out.contains("refused") {
        "隧道端口未通（本步自动建立临时隧道，失败多为 sshd 仅监听 IPv6 或被安全软件拦截）"
    } else if out.to_lowercase().contains("permission denied") && !out.contains("(publickey") {
        // 回连与认证都已成功，是本机登录 shell 执行 pk 失败（空占位 / 缺执行位 / 磁盘 noexec）
        "回连已通但本机无法执行 pk：空占位文件请先 `cargo build --bin pk`（开发态）或重装应用；缺执行位请 chmod +x；排除后重跑本配置"
    } else if out.contains("denied") {
        "认证被拒：重跑一次本配置（公钥装配与私钥推送需同时生效），或检查本机 authorized_keys"
    } else {
        "看 detail 中的 ssh 报错定位"
    };
    steps.push(SetupStep {
        name: "端到端验证".into(),
        status: "fail".into(),
        detail: format!("远程 pk --version 未返回版本：{out}（{hint}）"),
    });
    report_of(steps, None)
}

fn report_of(steps: Vec<SetupStep>, version: Option<String>) -> SetupReport {
    SetupReport {
        ok: false,
        steps,
        version,
    }
}

/// 定位随应用分发的 pk。优先 exe 同目录（安装态）；开发态该位置可能是 tauri 拷贝的
/// 0 字节 sidecar 占位（build.rs 重拷时机取决于启动方式，VS Code 直启 cargo 产物时不刷新），
/// 回退到 prepare-pk-cli 的产物 binaries/pk-<host-triple>。空文件一律视为占位跳过。
pub(crate) fn locate_pk() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let mut candidates: Vec<PathBuf> = vec![];
    if let Some(dir) = exe.parent() {
        for n in ["pk", "pk.exe"] {
            candidates.push(dir.join(n));
        }
        // 开发态布局：<repo>/src-tauri/target/<profile>/ → 上两级是 src-tauri
        if let Some(src_tauri) = dir.parent().and_then(|t| t.parent()) {
            candidates.push(
                src_tauri
                    .join("binaries")
                    .join(format!("pk-{}", host_triple())),
            );
        }
    }
    candidates
        .into_iter()
        .find(|p| p.exists() && p.metadata().map(|m| m.len() > 0).unwrap_or(false))
}

/// 宿主三元组（与 rustc/prepare-pk-cli 的命名一致），开发态 sidecar 回退用
fn host_triple() -> String {
    let os = match std::env::consts::OS {
        "macos" => "apple-darwin",
        "windows" => "pc-windows-msvc",
        _ => "unknown-linux-gnu",
    };
    format!("{}-{os}", std::env::consts::ARCH)
}

/// 一键配置远程 pk：前置只需本机开启 sshd，其余（密钥/公钥/私钥/指纹/shim/PATH/验证）
/// 全部自动完成并逐步报告。成功后把隧道端口写回该 agent 的 SSH 配置。
#[tauri::command]
pub async fn setup_remote_pk<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<'_, Db>,
    agent_id: String,
    port: Option<u16>,
) -> AppResult<SetupReport> {
    let (agent, key_dir) = {
        let conn = db.0.lock().unwrap();
        let get = |k: &str| -> Option<String> {
            conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| {
                r.get::<_, String>(0)
            })
            .ok()
        };
        let agent = ai::agent_by_id(&get, &agent_id)
            .ok_or_else(|| AppError::Invalid(format!("Agent {agent_id} 不存在，请先保存配置")))?;
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| AppError::External(format!("定位应用数据目录失败: {e}")))?;
        (agent, dir)
    };
    let remote = agent
        .remote
        .as_ref()
        .filter(|r| !r.host.trim().is_empty())
        .ok_or_else(|| {
            AppError::Invalid("该 agent 未配置 SSH 远程执行（先填主机并保存）".into())
        })?;
    let tunnel_port = port
        .or(remote.tunnel)
        .filter(|p| *p != 0)
        .unwrap_or(DEFAULT_TUNNEL_PORT);
    let local_user =
        std::env::var(if cfg!(windows) { "USERNAME" } else { "USER" }).unwrap_or_default();
    let pk_path = locate_pk().ok_or_else(|| {
        AppError::NotFound("未找到随应用分发的 pk（一键配置需安装版应用）".into())
    })?;
    let ctx = RemotePkSetup {
        ssh_program: ai::ssh_bin(),
        keyscan_program: "ssh-keyscan".into(),
        host: remote.host.clone(),
        ssh_port: remote.port,
        agent_key: remote.key_path.clone(),
        tunnel_port,
        local_user,
        pk_path: pk_path.to_string_lossy().into_owned(),
        key_dir,
        local_home: dirs::home_dir().unwrap_or_default(),
    };
    let report = tauri::async_runtime::spawn_blocking(move || run_setup(&ctx))
        .await
        .map_err(|e| AppError::External(format!("配置任务执行失败: {e}")))?;

    // 成功才写回隧道端口（失败不动配置，便于改端口重试）
    if report.ok {
        let conn = db.0.lock().unwrap();
        let raw: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key='ai_agents'",
                [],
                |r| r.get(0),
            )
            .ok();
        let mut agents: Vec<AgentConfig> =
            serde_json::from_str(&raw.unwrap_or_default()).unwrap_or_default();
        if let Some(a) = agents.iter_mut().find(|a| a.id == agent_id) {
            let mut r = a.remote.clone().unwrap_or_default();
            r.tunnel = Some(tunnel_port);
            a.remote = Some(r);
            let encoded = serde_json::to_string(&agents)
                .map_err(|e| AppError::External(format!("序列化 agent 配置失败: {e}")))?;
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_agents', ?1)",
                params![encoded],
            )?;
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shim_script_embeds_tunnel_and_absolute_pk() {
        let s = shim_script("/opt/apps/pokemon knock/pk", 10022, "joeca");
        assert!(s.starts_with("#!/bin/sh"), "{s}");
        assert!(s.contains("-p 10022"), "{s}");
        assert!(s.contains("joeca@127.0.0.1"), "{s}");
        // 含空格路径被引用，避免本机 shell 拆词（unix 下以 $fwd 前缀内嵌）
        assert!(
            s.contains("'/opt/apps/pokemon knock/pk'")
                || s.contains("\"/opt/apps/pokemon knock/pk\""),
            "{s}"
        );
        assert!(s.contains("pk_shim"), "使用专用私钥: {s}");
        assert!(s.contains("\"$@\""), "透传全部参数: {s}");
        // 方案 A：连接复用三件套（远程侧 ssh 客户端生效，与本机系统无关）
        assert!(s.contains("ControlMaster=auto"), "{s}");
        assert!(s.contains("ControlPath=\"$HOME/.ssh/pk-shim-%C\""), "{s}");
        assert!(s.contains("ControlPersist=10m"), "{s}");
        // 方案 B ④：PK_* 在远端求值并带回本机侧 pk（值加引号，路径含空格安全）
        #[cfg(unix)]
        {
            assert!(s.contains("[ -n \"$PK_LOG_FILE\" ]"), "{s}");
            assert!(
                s.contains("fwd=\"$fwd PK_LOG_FILE=\\\"$PK_LOG_FILE\\\"\""),
                "{s}"
            );
            assert!(s.contains("[ -n \"$PK_DISPATCH_TASK\" ]"), "{s}");
            assert!(s.contains("\"$fwd '/opt/apps/pokemon knock/pk'\""), "{s}");
        }
        let simple = shim_script("/usr/local/bin/pk", 10022, "u");
        #[cfg(unix)]
        assert!(
            simple.contains("\"$fwd /usr/local/bin/pk\" \"$@\""),
            "unix 本机走 env 前缀: {simple}"
        );
        #[cfg(windows)]
        assert!(
            simple.contains(" /usr/local/bin/pk \"$@\""),
            "Windows 本机直呼 pk: {simple}"
        );
    }

    #[test]
    fn known_hosts_lines_rewrite_host_to_tunnel_endpoint() {
        let scan = "# localhost:22 SSH-2.0-OpenSSH_9\nlocalhost ssh-ed25519 AAAAC3NzaTEST key-comment\nlocalhost ssh-rsa AAAAB3TEST2\n";
        let out = to_known_hosts_lines(scan, 10022);
        assert!(
            out.contains("[127.0.0.1]:10022 ssh-ed25519 AAAAC3NzaTEST key-comment\n"),
            "{out}"
        );
        assert!(
            out.contains("[127.0.0.1]:10022 ssh-rsa AAAAB3TEST2\n"),
            "{out}"
        );
        assert!(!out.contains('#'), "注释行剔除: {out}");
    }

    /// 假 ssh：按远程命令内容分发应答，并把每次调用记录到日志文件（端到端跑通序列）
    fn fake_bins(dir: &std::path::Path) -> (String, String) {
        use std::os::unix::fs::PermissionsExt;
        let log = dir.join("ssh-calls.log");
        let ssh = dir.join("fake-ssh.sh");
        let script = format!(
            "#!/bin/sh\n\
             printf '%s\\n' \"$*\" >> {log}\n\
             for last; do :; done\n\
             case \"$last\" in\n\
               *'command -v pk'*) echo /home/u/.local/bin/pk; exit 0;;\n\
               *'pk --version'*) if echo \"$*\" | grep -q ' -R '; then echo 1.0.0; exit 0; else echo no-tunnel; exit 1; fi;;\n\
               *'cat >'*) cat > /dev/null; exit 0;;\n\
               *known_hosts*) cat > /dev/null; exit 0;;\n\
             esac\n\
             exit 0\n",
            log = log.to_string_lossy(),
        );
        std::fs::write(&ssh, script).unwrap();
        std::fs::set_permissions(&ssh, std::fs::Permissions::from_mode(0o755)).unwrap();

        let keyscan = dir.join("fake-keyscan.sh");
        std::fs::write(
            &keyscan,
            "#!/bin/sh\necho 'localhost ssh-ed25519 AAAAC3NzaFAKE pk-test'\n",
        )
        .unwrap();
        std::fs::set_permissions(&keyscan, std::fs::Permissions::from_mode(0o755)).unwrap();
        (
            ssh.to_string_lossy().into_owned(),
            keyscan.to_string_lossy().into_owned(),
        )
    }

    fn ctx_with(
        dir: &std::path::Path,
        home: &std::path::Path,
        ssh: &str,
        keyscan: &str,
    ) -> RemotePkSetup {
        std::fs::write(dir.join("pk"), "#!/bin/sh\n").unwrap();
        RemotePkSetup {
            ssh_program: ssh.into(),
            keyscan_program: keyscan.into(),
            host: "user@box".into(),
            ssh_port: 22,
            agent_key: None,
            tunnel_port: 10022,
            local_user: "joeca".into(),
            pk_path: dir.join("pk").to_string_lossy().into_owned(),
            key_dir: dir.join("keys"),
            local_home: home.to_path_buf(),
        }
    }

    #[test]
    fn run_setup_end_to_end_with_fake_ssh() {
        let dir = std::env::temp_dir().join(format!("pk-setup-e2e-{}", std::process::id()));
        let home = dir.join("home");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&home).unwrap();
        let (ssh, keyscan) = fake_bins(&dir);
        let ctx = ctx_with(&dir, &home, &ssh, &keyscan);

        let report = run_setup(&ctx);
        assert!(report.ok, "报告: {report:?}");
        assert_eq!(report.version.as_deref(), Some("1.0.0"));
        assert!(
            report.steps.iter().all(|s| s.status != "fail"),
            "无失败步: {:?}",
            report.steps
        );
        // 非执行位的 pk 被自动补权（ctx_with 写出的是 644）
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.join("pk"))
                .unwrap()
                .permissions()
                .mode();
            assert_ne!(mode & 0o111, 0, "自动补了执行位");
            let locate = report.steps.iter().find(|s| s.name == "定位 pk").unwrap();
            assert!(
                locate.detail.contains("自动补执行权限"),
                "{}",
                locate.detail
            );
        }
        // 公钥已装配本机 authorized_keys，内容与生成的公钥一致
        let ak = home.join(".ssh/authorized_keys");
        let ak_text = std::fs::read_to_string(&ak).unwrap();
        let pub_text =
            std::fs::read_to_string(dir.join("keys/remote_pk_shim_ed25519.pub")).unwrap();
        assert!(
            ak_text.contains(pub_text.trim()),
            "公钥进 authorized_keys: {ak_text}"
        );
        // 幂等：重跑全部 skip/ok 且 authorized_keys 不重复追加
        let report2 = run_setup(&ctx);
        assert!(report2.ok, "重跑报告: {report2:?}");
        assert!(
            report2.steps.iter().any(|s| s.status == "skip"),
            "已有件复用: {:?}",
            report2.steps
        );
        let ak_text2 = std::fs::read_to_string(&ak).unwrap();
        assert_eq!(ak_text2.matches(&pub_text.trim()).count(), 1, "不重复追加");
        // ssh 调用覆盖关键远程动作（推私钥/指纹/shim/PATH 检查/带 -R 的验证）
        let calls = std::fs::read_to_string(dir.join("ssh-calls.log")).unwrap();
        for frag in [
            ".ssh/pk_shim",
            "known_hosts",
            ".local/bin/pk",
            "command -v pk",
            "-R 127.0.0.1:10022:127.0.0.1:22",
            "pk --version",
        ] {
            assert!(calls.contains(frag), "ssh 调用缺「{frag}」: {calls}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_setup_rejects_empty_placeholder_pk() {
        let dir = std::env::temp_dir().join(format!("pk-setup-empty-{}", std::process::id()));
        let home = dir.join("home");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&home).unwrap();
        let (ssh, keyscan) = fake_bins(&dir);
        let ctx = ctx_with(&dir, &home, &ssh, &keyscan);
        // tauri dev 的 sidecar 占位：0 字节且无执行位，盖掉真实二进制
        std::fs::write(dir.join("pk"), "").unwrap();

        let report = run_setup(&ctx);
        assert!(!report.ok);
        let locate = report.steps.iter().find(|s| s.name == "定位 pk").unwrap();
        assert_eq!(locate.status, "fail");
        assert!(
            locate.detail.contains("cargo build --bin pk"),
            "给开发态重建指引: {}",
            locate.detail
        );
        assert!(
            !report.steps.iter().any(|s| s.name == "本机 sshd"),
            "空占位直接停在第 1 步: {:?}",
            report.steps
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_setup_stops_when_local_sshd_down() {
        let dir = std::env::temp_dir().join(format!("pk-setup-nossh-{}", std::process::id()));
        let home = dir.join("home");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&home).unwrap();
        // keyscan 直接失败 → 第 2 步停，后续步骤不执行
        let bad_scan = dir.join("bad-keyscan.sh");
        std::fs::write(&bad_scan, "#!/bin/sh\nexit 1\n").unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&bad_scan, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let (ssh, _) = fake_bins(&dir);
        let bad_scan: String = bad_scan.to_string_lossy().into_owned();
        let ctx = ctx_with(&dir, &home, &ssh, &bad_scan);

        let report = run_setup(&ctx);
        assert!(!report.ok);
        let sshd = report.steps.iter().find(|s| s.name == "本机 sshd").unwrap();
        assert_eq!(sshd.status, "fail");
        assert!(
            sshd.detail.contains("远程登录"),
            "给平台开启指引: {}",
            sshd.detail
        );
        assert!(
            !report.steps.iter().any(|s| s.name == "推送私钥"),
            "失败后不再继续: {:?}",
            report.steps
        );
        // 幂等细节：authorized_keys 未被触碰
        assert!(!home.join(".ssh/authorized_keys").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
