//! remote 子命令与 __ssh_entry：远程 pk 透传 shim 生成、forced command 严格解析。
use crate::cli::{parse_args, usage_err, CliError};
use serde_json::json;

/// forced command 允许透传的环境变量白名单（与 remote_pk 一键配置生成的 shim
/// 透传集合一致）。白名单外一律拒绝——这是「远端只能调 pk」约束的一部分
const SSH_ENTRY_ENV_ALLOWLIST: &[&str] = &["PK_LOG_FILE", "PK_DISPATCH_TASK"];

/// authorized_keys forced command 的执行入口：解析 SSH_ORIGINAL_COMMAND，
/// 严格限定「[env] [白名单 PK_变量=值]* <本程序绝对路径> [pk 参数...]」，
/// 校验通过后以 argv 直启自身（不经 shell），其余任何形态一律拒绝退出。
/// 背景：远程机器上的 shim 私钥（~/.ssh/pk_shim）一旦泄露，持钥者可向本机
/// sshd 发任意命令串；该入口把可执行面收敛到 pk 自身——私钥失陷也开不了 shell。
pub(crate) fn ssh_entry() -> ! {
    let orig = std::env::var("SSH_ORIGINAL_COMMAND").unwrap_or_default();
    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("{{\"error\": \"ssh_entry: 无法定位自身路径: {e}\"}}");
            std::process::exit(78);
        }
    };
    let (envs, args) = match parse_forced_command(&orig, &exe) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("{{\"error\": \"ssh_entry: 拒绝执行（{e}）\"}}");
            std::process::exit(78);
        }
    };
    let mut cmd = std::process::Command::new(&exe);
    cmd.args(&args);
    for (k, v) in envs {
        cmd.env(k, v);
    }
    let code = match cmd.status() {
        Ok(s) => s.code().unwrap_or(1),
        Err(e) => {
            eprintln!("{{\"error\": \"ssh_entry: 重启自身失败: {e}\"}}");
            1
        }
    };
    std::process::exit(code)
}

/// forced command 解析结果：(透传环境变量, pk 参数)
type ForcedCommand = (Vec<(String, String)>, Vec<String>);

/// SSH_ORIGINAL_COMMAND 的严格语法解析（纯函数，独立测试）。返回 (透传环境, pk 参数)。
pub(crate) fn parse_forced_command(
    orig: &str,
    self_exe: &std::path::Path,
) -> Result<ForcedCommand, String> {
    let tokens = shlex_split(orig)?;
    let mut i = 0;
    if tokens.first().map(String::as_str) == Some("env") {
        i += 1;
    }
    let mut envs = vec![];
    while let Some(tok) = tokens.get(i) {
        let Some((name, value)) = tok.split_once('=') else {
            break;
        };
        if !SSH_ENTRY_ENV_ALLOWLIST.contains(&name) {
            return Err(format!("环境变量 {name} 不在透传白名单"));
        }
        envs.push((name.to_string(), value.to_string()));
        i += 1;
    }
    let program = tokens
        .get(i)
        .ok_or_else(|| "缺少 pk 程序路径".to_string())?;
    if !same_program(program, self_exe) {
        return Err("命令程序不是本 pk".to_string());
    }
    Ok((envs, tokens[i + 1..].to_vec()))
}

/// 词法切分（POSIX sh 子集：裸词 / 单引号 / 双引号 / 反斜杠转义；不做任何展开）。
/// 只需覆盖本应用两端（shim 生成侧与本入口）的产出形态，不识别的形态宁可报错也不猜
pub(crate) fn shlex_split(s: &str) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut has_cur = false;
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            ' ' | '\t' | '\n' | '\r' => {
                if has_cur {
                    out.push(std::mem::take(&mut cur));
                    has_cur = false;
                }
            }
            '\'' => {
                has_cur = true;
                loop {
                    match chars.next() {
                        Some('\'') => break,
                        Some(ch) => cur.push(ch),
                        None => return Err("未闭合的单引号".into()),
                    }
                }
            }
            '"' => {
                has_cur = true;
                loop {
                    match chars.next() {
                        Some('"') => break,
                        Some('\\') => match chars.next() {
                            Some(e @ ('"' | '\\' | '$' | '`')) => cur.push(e),
                            Some(other) => {
                                cur.push('\\');
                                cur.push(other);
                            }
                            None => return Err("双引号内反斜杠悬空".into()),
                        },
                        Some(ch) => cur.push(ch),
                        None => return Err("未闭合的双引号".into()),
                    }
                }
            }
            '\\' => match chars.next() {
                Some(ch) => {
                    cur.push(ch);
                    has_cur = true;
                }
                None => return Err("悬空反斜杠".into()),
            },
            _ => {
                cur.push(c);
                has_cur = true;
            }
        }
    }
    if has_cur {
        out.push(cur);
    }
    Ok(out)
}

/// 程序路径等价判定：canonicalize 消解符号链接后比较（Windows 大小写不敏感）
fn same_program(a: &str, b: &std::path::Path) -> bool {
    let pa = std::fs::canonicalize(a).unwrap_or_else(|_| std::path::PathBuf::from(a));
    let pb = std::fs::canonicalize(b).unwrap_or_else(|_| b.to_path_buf());
    if cfg!(windows) {
        pa.to_string_lossy().to_lowercase() == pb.to_string_lossy().to_lowercase()
    } else {
        pa == pb
    }
}

/// remote 子命令：生成远程主机上的 pk 透传 shim。
/// 场景：agent CLI 跑在远程机器、待办库在本机——远程放一个同名 `pk` 包装脚本，
/// 命令经 ssh 转发回本机执行（应用侧的 SSH 远程 agent 场景）。
/// 默认把脚本打到 stdout（可重定向），--write 直接落盘并输出 JSON 确认。
pub(crate) fn run_remote(rest: &[String]) -> Result<serde_json::Value, CliError> {
    let sub = rest
        .first()
        .map(String::as_str)
        .ok_or_else(|| usage_err("缺少 remote 子命令（目前支持 shim）"))?;
    if sub != "shim" {
        return Err(usage_err("remote 子命令目前只支持 shim"));
    }
    let p = parse_args(&rest[1..]);
    let host = p
        .flag("host")
        .filter(|h| !h.is_empty())
        .ok_or_else(|| {
            usage_err("remote shim 需要 --host <本机地址>（远程机器可达的地址，如 user@192.168.1.10 或 Tailscale 主机名）")
        })?;
    let port = match p.flag("port") {
        Some(v) if !v.is_empty() => Some(
            v.parse::<u16>()
                .map_err(|_| usage_err("--port 必须是端口号数字"))?,
        ),
        _ => None,
    };
    let key = p.flag("key").filter(|k| !k.is_empty());
    // host/key 引用后再进脚本：脚本经 /bin/sh 执行，含空格/特殊字符的值不引用会被拆词
    let mut fwd = String::from("ssh -o BatchMode=yes -o ConnectTimeout=10");
    // 连接复用：首调建 ControlMaster，后续调用毫秒级（脚本运行在远程 unix，与本机系统无关）
    fwd.push_str(
        " -o ControlMaster=auto -o ControlPath=\"$HOME/.ssh/pk-ctl-%C\" -o ControlPersist=10m",
    );
    if let Some(k) = key {
        fwd.push_str(&format!(" -i {}", sh_quote(k)));
    }
    if let Some(pn) = port {
        fwd.push_str(&format!(" -p {pn}"));
    }
    fwd.push_str(&format!(" {}", sh_quote(host)));
    // unix 本机加 PK_* 透传段（cmd.exe 没有 env 命令，Windows 本机保持直呼）；
    // 值在远程侧求值并内联进回连命令，本机侧 pk 照常拿到
    let (env_fwd, cmd) = if cfg!(unix) {
        (
            "fwd=env\n\
             [ -n \"$PK_LOG_FILE\" ] && fwd=\"$fwd PK_LOG_FILE=\\\"$PK_LOG_FILE\\\"\"\n\
             [ -n \"$PK_DISPATCH_TASK\" ] && fwd=\"$fwd PK_DISPATCH_TASK=$PK_DISPATCH_TASK\"\n",
            "\"$fwd pk\" \"$@\"",
        )
    } else {
        ("", "pk \"$@\"")
    };
    let script = format!(
        "#!/bin/sh\n# pk 远程透传 shim（pokemon-choose-you）：把 pk 命令经 ssh 转发回本机执行，数据始终留在本机。\n# 部署：放到远程主机的 PATH 里并 chmod +x，如 ~/bin/pk；本机需开 sshd 并配好免密登录。\n{env_fwd}exec {fwd} {cmd}\n"
    );
    match p.flag("write").filter(|w| !w.is_empty()) {
        Some(path) => {
            std::fs::write(path, &script)
                .map_err(|e| CliError(format!("写入 shim 失败: {e}"), 1))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755));
            }
            Ok(json!({
                "written": path,
                "host": host,
                "executable": cfg!(unix),
            }))
        }
        None => {
            print!("{script}");
            std::process::exit(0);
        }
    }
}

/// POSIX 单引号引用（sh 脚本内嵌用户值：host / 密钥路径）
fn sh_quote(s: &str) -> String {
    let safe = !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_./=@:%+".contains(&b));
    if safe {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', r"'\''"))
    }
}
