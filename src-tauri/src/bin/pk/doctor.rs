//! doctor 子命令：本机/远程环境体检（库完整性、并发、上下文、技能、schema）。
use crate::cli::default_db_path;
use crate::context::run_context;
use pokemon_choose_you_lib::skills::{frontmatter_version, skill_dir_for, SKILL_VERSION};
use rusqlite::Connection;
use serde_json::json;

/// doctor 单项检查的 JSON 条目：name + ok/warn/fail + detail + 可选 fix（照跑即可修复的命令/动作）
fn doctor_check(
    name: &str,
    status: &str,
    detail: String,
    fix: Option<String>,
) -> serde_json::Value {
    json!({ "name": name, "status": status, "detail": detail, "fix": fix })
}

/// 环境自检（对标 brew/gh doctor）：数据库存在性与 schema 版本、完整性、并发配置、
/// context 读链路、技能安装版本；--ssh <host> 时额外测远程 pk 可达性（排查 shim 部署）。
/// 有 fail 时退出码 1；warn 不影响退出码（可选改进项）。库缺失/损坏本身就是诊断对象，
/// 因此 doctor 不走常规 open_db（那会直接失败），而是逐项检查并汇报。
pub(crate) fn doctor_report(
    db_override: Option<&std::path::Path>,
    ssh_target: Option<&str>,
) -> (serde_json::Value, i32) {
    let mut checks = vec![doctor_check(
        "version",
        "ok",
        format!("pk {}", env!("CARGO_PKG_VERSION")),
        None,
    )];

    let path = match db_override {
        Some(p) => p.to_path_buf(),
        None => default_db_path().unwrap_or_default(),
    };
    if !path.exists() {
        checks.push(doctor_check(
            "database",
            "fail",
            format!("数据库不存在：{}", path.display()),
            Some("先启动一次应用（或 pk init-db / 用 PK_DB 指定路径）".into()),
        ));
    } else {
        checks.push(doctor_check(
            "database",
            "ok",
            path.display().to_string(),
            None,
        ));
        match Connection::open(&path) {
            Ok(conn) => {
                // 只设 busy_timeout 不动 journal_mode：并发检查要读库的真实持久状态
                let _ = conn.execute_batch("PRAGMA busy_timeout=5000;");
                checks.extend(schema_checks(&conn));
                checks.push(integrity_check(&conn));
                checks.push(concurrency_check(&conn));
                checks.push(context_check(&conn));
            }
            Err(e) => checks.push(doctor_check(
                "database",
                "fail",
                format!("打开失败：{e}"),
                Some("检查文件权限与所在磁盘状态".into()),
            )),
        }
    }
    checks.extend(skill_doctor_checks());
    if let Some(host) = ssh_target {
        checks.push(remote_doctor_check(host));
    }

    let count = |st: &str| checks.iter().filter(|c| c["status"] == st).count();
    let fail = count("fail");
    (
        json!({
            "checks": checks,
            "summary": {
                "ok": count("ok"),
                "warn": count("warn"),
                "fail": fail,
            }
        }),
        if fail > 0 { 1 } else { 0 },
    )
}

/// schema 版本与关键表：库比程序新（pk 需随应用升级）/ 库落后（应用未完成迁移）/ 缺表
fn schema_checks(conn: &Connection) -> Vec<serde_json::Value> {
    let mut out = vec![];
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(-1);
    let expected = pokemon_choose_you_lib::db::expected_schema_version();
    if version == expected {
        out.push(doctor_check(
            "schema",
            "ok",
            format!("schema v{version}，与当前 pk 一致"),
            None,
        ));
    } else if version > expected {
        out.push(doctor_check(
            "schema",
            "fail",
            format!("数据库 schema v{version} 比本 pk（v{expected}）新"),
            Some("pk 随应用分发：升级应用后其自带的 pk 会自动接管".into()),
        ));
    } else {
        out.push(doctor_check(
            "schema",
            "fail",
            format!("数据库 schema v{version} 落后于 pk（v{expected}），应用未完成迁移"),
            Some("启动一次应用完成迁移（pk 自身不执行迁移）".into()),
        ));
    }
    const TABLES: &[&str] = &[
        "tasks",
        "categories",
        "tags",
        "task_tags",
        "task_notes",
        "task_logs",
        "chat_messages",
        "chat_feedback",
        "agent_sessions",
        "settings",
        "sync_state",
        "feishu_users",
    ];
    let present: Vec<String> = {
        let mut stmt = match conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_%'")
        {
            Ok(s) => s,
            Err(_) => return out,
        };
        stmt.query_map([], |r| r.get::<_, String>(0))
            .map(|rows| rows.filter_map(Result::ok).collect())
            .unwrap_or_default()
    };
    let missing: Vec<&str> = TABLES
        .iter()
        .filter(|t| !present.iter().any(|p| p == *t))
        .copied()
        .collect();
    if missing.is_empty() {
        out.push(doctor_check(
            "tables",
            "ok",
            format!("{} 张表齐全", TABLES.len()),
            None,
        ));
    } else {
        out.push(doctor_check(
            "tables",
            "fail",
            format!("缺少表：{}", missing.join("、")),
            Some("schema 与 pk 版本不匹配，升级应用后重试".into()),
        ));
    }
    out
}

fn integrity_check(conn: &Connection) -> serde_json::Value {
    let rows: Vec<String> = conn
        .prepare("PRAGMA quick_check")
        .and_then(|mut stmt| {
            stmt.query_map([], |r| r.get::<_, String>(0))
                .map(|rows| rows.filter_map(Result::ok).collect())
        })
        .unwrap_or_default();
    if rows.iter().all(|r| r == "ok") {
        doctor_check("integrity", "ok", "quick_check 通过".into(), None)
    } else {
        doctor_check(
            "integrity",
            "fail",
            rows.join("; ").chars().take(200).collect(),
            Some("先关闭应用再复查；确认损坏可从设置 → 备份恢复".into()),
        )
    }
}

fn concurrency_check(conn: &Connection) -> serde_json::Value {
    let mode: String = conn
        .query_row("PRAGMA journal_mode", [], |r| r.get(0))
        .unwrap_or_default();
    if mode == "wal" {
        doctor_check(
            "concurrency",
            "ok",
            "WAL 已启用，可与运行中的应用并发读写".into(),
            None,
        )
    } else {
        doctor_check(
            "concurrency",
            "warn",
            format!("journal_mode={mode}，与应用并发读写可能报 BUSY"),
            Some("启动一次应用或运行任一 pk 读写命令即自动切为 WAL".into()),
        )
    }
}

fn context_check(conn: &Connection) -> serde_json::Value {
    match run_context(conn) {
        Ok(ctx) => doctor_check(
            "context",
            "ok",
            format!(
                "读链路正常：分类 {} · 标签 {} · 未完成待办 {}",
                ctx["categories"].as_array().map(Vec::len).unwrap_or(0),
                ctx["tags"].as_array().map(Vec::len).unwrap_or(0),
                ctx["openTasks"].as_array().map(Vec::len).unwrap_or(0)
            ),
            None,
        ),
        Err(e) => doctor_check(
            "context",
            "fail",
            format!("读取上下文失败：{}", e.0),
            Some("结合上面 schema/integrity 检查结果定位".into()),
        ),
    }
}

/// 技能安装状态：未安装提示可选安装（warn），旧版本提示更新
fn skill_doctor_checks() -> Vec<serde_json::Value> {
    let mut out = vec![];
    for agent in ["claude-code", "opencode", "pi"] {
        let entry = match skill_dir_for(agent, None) {
            Ok(dir) => dir.join("SKILL.md"),
            Err(_) => {
                out.push(doctor_check(
                    "skill",
                    "warn",
                    format!("{agent}：无法定位技能目录（home 缺失）"),
                    None,
                ));
                continue;
            }
        };
        match std::fs::read_to_string(&entry)
            .ok()
            .and_then(|md| frontmatter_version(&md))
        {
            Some(v) if v == SKILL_VERSION => out.push(doctor_check(
                "skill",
                "ok",
                format!("{agent}：v{v}（{}）", entry.display()),
                None,
            )),
            Some(v) => out.push(doctor_check(
                "skill",
                "warn",
                format!("{agent}：技能 v{v} 旧于内置 v{SKILL_VERSION}"),
                Some(format!("pk skill install {agent}")),
            )),
            None => out.push(doctor_check(
                "skill",
                "warn",
                format!("{agent}：未安装（交互/无头场景建议安装）"),
                Some(format!("pk skill install {agent}")),
            )),
        }
    }
    out
}

/// 远程 pk 可达性：BatchMode ssh 到目标跑 `pk --version`。
/// 远程部署的是 shim 时，这一条会端到端验证「ssh 免密 → shim 在 PATH → 回连本机 → 本机 pk」整条链。
fn remote_doctor_check(host: &str) -> serde_json::Value {
    match std::process::Command::new("ssh")
        .args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"])
        // -- 在 host 之前：以 - 开头的 host（罕见但合法的网名写法）不被当成 ssh 选项
        .arg("--")
        .arg(host)
        .args(["pk", "--version"])
        .output()
    {
        Ok(o) if o.status.success() => {
            let v = String::from_utf8_lossy(&o.stdout).trim().to_string();
            doctor_check("remote", "ok", format!("{host} 的 pk 可用：{v}"), None)
        }
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            let hint = if stderr.contains("127") || o.status.code() == Some(127) {
                "远端 PATH 里没有 pk：确认 shim 已放进 PATH（如 ~/bin）并 chmod +x"
            } else {
                "检查免密登录（公钥）、主机可达性与 shim 部署"
            };
            doctor_check(
                "remote",
                "fail",
                format!(
                    "{host} 执行 pk 失败（退出码 {:?}）：{}",
                    o.status.code(),
                    stderr.trim().chars().take(160).collect::<String>()
                ),
                Some(hint.into()),
            )
        }
        Err(e) => doctor_check(
            "remote",
            "fail",
            format!("无法启动 ssh：{e}"),
            Some("确认本机装有 ssh 客户端".into()),
        ),
    }
}
