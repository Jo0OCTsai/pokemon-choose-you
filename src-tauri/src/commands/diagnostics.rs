use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::health::{self, ProviderHealth};
use rusqlite::Connection;
use tauri::{Manager, State};

// ---- 诊断：集成健康 / 运行日志 / 支持报告 ----

/// 诊断页展示的单个链路健康信息（健康记录 + 配置态 + 收音机积压合并而来）
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationHealthInfo {
    /// feishu / ai
    pub provider: String,
    pub configured: bool,
    /// 飞书的后台轮询开关；其余链路配置即启用
    pub enabled: bool,
    /// off / paused / idle / ok / degraded / down
    pub status: String,
    pub last_success_at: Option<String>,
    pub last_error: Option<String>,
    pub last_error_at: Option<String>,
    pub consecutive_failures: u32,
    /// 下次预计轮询时间（epoch 毫秒），仅飞书
    pub next_poll_at: Option<i64>,
    /// 飞书：收音机里待确认的建议数（todo / update）
    pub pending_count: i64,
    /// AI：收音机分类使用的 agent 名称
    pub primary_agent: String,
}

/// 设置读取：秘钥类键经 secrets 模块（OS 钥匙串优先，settings 表回落），其余直读表
fn settings_getter(conn: &Connection) -> impl Fn(&str) -> Option<String> + '_ {
    move |k| crate::secrets::secret_get(conn, k)
}

/// 飞书链路是否已具备运行条件：lark-cli 可执行文件存在（lark_bin() 返回已补扫
/// GUI 缺失目录的绝对路径，这里看文件即可；裸命令名兜底扫进程 PATH）。
/// 登录态不在诊断快照里判断（需要跑子进程），由轮询失败信息与设置页授权状态展示。
fn feishu_configured(bin: &str) -> bool {
    let p = std::path::Path::new(bin);
    if p.is_file() {
        return true;
    }
    if bin.contains('/') {
        return false; // 指定了路径但文件不存在
    }
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).any(|dir| dir.join(bin).is_file()))
        .unwrap_or(false)
}

fn collect_health<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    conn: &Connection,
    lark_bin: &str,
) -> AppResult<Vec<IntegrationHealthInfo>> {
    let get = settings_getter(conn);
    let state = app.state::<crate::health::HealthState>();

    let feishu_enabled = get("feishu_enabled").as_deref() == Some("true");
    let pending_count = conn.query_row(
        "SELECT COUNT(*) FROM chat_messages WHERE review_status='pending' AND ai_status IN ('todo','update')",
        [],
        |r| r.get(0),
    )?;
    let primary_agent = crate::ai::primary_agent(&get);

    let mut out = vec![];
    for (provider, configured, enabled) in [
        (health::FEISHU, feishu_configured(lark_bin), feishu_enabled),
        (health::AI, primary_agent.is_some(), true),
    ] {
        let h: ProviderHealth = state.snapshot(provider);
        let ran = h.last_success_at.is_some() || h.last_error_at.is_some();
        out.push(IntegrationHealthInfo {
            provider: provider.to_string(),
            configured,
            enabled,
            status: health::level(configured, enabled, ran, h.consecutive_failures).to_string(),
            last_success_at: h.last_success_at,
            last_error: h.last_error,
            last_error_at: h.last_error_at,
            consecutive_failures: h.consecutive_failures,
            next_poll_at: if provider == health::FEISHU {
                h.next_run_at
            } else {
                None
            },
            pending_count: if provider == health::FEISHU {
                pending_count
            } else {
                0
            },
            primary_agent: primary_agent
                .as_ref()
                .map(|a| a.name.clone())
                .unwrap_or_default(),
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn integration_health<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
) -> AppResult<Vec<IntegrationHealthInfo>> {
    let conn = db.0.lock().unwrap();
    collect_health(&app, &conn, &crate::lark_cli::lark_bin())
}

// ---- 运行日志 ----

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    /// 原始时间戳（[日期][时间] 拼接），展示用
    pub time: String,
    /// debug / info / warn / error；无法解析的行为空串
    pub level: String,
    /// 日志目标（模块路径），如 app_lib::feishu
    pub target: String,
    pub message: String,
}

fn level_rank(level: &str) -> i32 {
    match level {
        "error" => 4,
        "warn" => 3,
        "info" => 2,
        "debug" | "trace" => 1,
        _ => 0,
    }
}

/// 解析 tauri-plugin-log 默认格式 `[日期][时间][target][LEVEL] message`；
/// 不成行的内容（多行消息的续行）并入上一条的 message
pub fn parse_log_lines(content: &str) -> Vec<LogEntry> {
    let mut entries: Vec<LogEntry> = vec![];
    for line in content.lines() {
        if let Some(e) = parse_log_line(line) {
            entries.push(e);
        } else if let Some(last) = entries.last_mut() {
            last.message.push('\n');
            last.message.push_str(line);
        }
    }
    entries
}

fn parse_log_line(line: &str) -> Option<LogEntry> {
    let mut rest = line;
    let mut groups = vec![];
    for _ in 0..4 {
        rest = rest.strip_prefix('[')?;
        let end = rest.find(']')?;
        groups.push(rest[..end].to_string());
        rest = &rest[end + 1..];
    }
    let level = groups[3].to_lowercase();
    if level_rank(&level) == 0 {
        return None; // 第四段不是日志级别，按非日志行处理
    }
    Some(LogEntry {
        time: format!("{} {}", groups[0], groups[1]),
        level,
        target: groups[2].clone(),
        message: rest.trim_start().to_string(),
    })
}

/// 读取最新一个日志文件的尾部条目。
/// 日志目录/文件不存在（测试环境、权限异常）按无日志处理，不报错。
#[tauri::command]
pub fn list_log_entries<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    tail: Option<usize>,
    min_level: Option<String>,
) -> AppResult<Vec<LogEntry>> {
    let dir = match app.path().app_log_dir() {
        Ok(d) => d,
        Err(_) => return Ok(vec![]),
    };
    let newest = std::fs::read_dir(&dir)
        .ok()
        .and_then(|rd| {
            rd.flatten()
                .filter(|f| f.path().extension().is_some_and(|e| e == "log"))
                .max_by_key(|f| f.metadata().ok().and_then(|m| m.modified().ok()))
        })
        .map(|f| f.path());
    let Some(path) = newest else {
        return Ok(vec![]);
    };
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => return Err(AppError::Io(e)),
    };
    let min_rank = min_level
        .as_deref()
        .map(level_rank)
        .filter(|r| *r > 0)
        .unwrap_or(0);
    let mut entries: Vec<LogEntry> = parse_log_lines(&content)
        .into_iter()
        .filter(|e| level_rank(&e.level) >= min_rank)
        .collect();
    let tail = tail.unwrap_or(500).min(2000);
    if entries.len() > tail {
        entries.drain(..entries.len() - tail);
    }
    Ok(entries)
}

// ---- 支持报告 ----

/// 值脱敏后的敏感键名单（命中键名即遮蔽其后的值）
const SENSITIVE_KEYS: &[&str] = &[
    "secret",
    "token",
    "password",
    "api_key",
    "apikey",
    "authorization",
    "bearer",
    "access_key",
];

/// 单行脱敏第二层（值形态）：不带键名也能识别的敏感形态——
/// 邮箱（local@domain → ***@***）与常见凭证前缀（sk- / ghp_ / github_pat_ /
/// AKIA / xox* 后接 8 位以上串）。日志里 agent 回复片段、报错回显常夹带这类内容
pub fn redact_values(line: &str) -> String {
    const TOKEN_PREFIXES: &[&str] = &[
        "sk-",
        "ghp_",
        "gho_",
        "ghu_",
        "ghs_",
        "github_pat_",
        "AKIA",
        "xoxb-",
        "xoxa-",
        "xoxp-",
        "xoxr-",
        "xapps-",
    ];
    let chars: Vec<char> = line.chars().collect();
    let mut out = String::with_capacity(line.len());
    let mut i = 0usize;
    while i < chars.len() {
        let rest: String = chars[i..].iter().collect();
        // 凭证前缀 + 长串（跨前缀取字母数字/_/-，至少 8 位才算凭证，避免误伤短词）
        if let Some(p) = TOKEN_PREFIXES.iter().find(|p| rest.starts_with(**p)) {
            let plen = chars[i..]
                .iter()
                .take_while(|c| c.is_ascii_alphanumeric() || **c == '_' || **c == '-')
                .count();
            if plen >= p.len() + 8 {
                out.push_str("***");
                i += plen;
                continue;
            }
        }
        // 邮箱：向前扫 local 部分字符遇到 @，向后扫域名
        if chars[i] == '@' {
            let mut s = i;
            while s > 0 && (chars[s - 1].is_ascii_alphanumeric() || "._%+-".contains(chars[s - 1]))
            {
                s -= 1;
            }
            let mut e = i + 1;
            while e < chars.len() && (chars[e].is_ascii_alphanumeric() || ".-".contains(chars[e])) {
                e += 1;
            }
            let has_local = i - s >= 1;
            let has_domain = e > i + 1 && chars[i + 1..e].contains(&'.');
            if has_local && has_domain {
                // 回退已输出的 local 部分，整体遮蔽
                let local_len = i - s;
                for _ in 0..local_len {
                    out.pop();
                }
                out.push_str("***@***");
                i = e;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

/// 单行脱敏第三层（词表）：通讯录真名、我的称呼、群聊名 → ***。
/// 这些是内容类字段（日志的消息摘要/健康错误回显里出现），键名与值形态都拦不住
fn redact_names(names: &[String], line: &str) -> String {
    let mut out = line.to_string();
    for n in names {
        if !n.is_empty() && out.contains(n.as_str()) {
            out = out.replace(n.as_str(), "***");
        }
    }
    out
}

/// 汇集本库里的敏感名词表：成员真名（feishu_users）、我的称呼（settings）、
/// 群名（feishu_chats 快照 + feishu_chat_aliases），长名优先替换
fn collect_sensitive_names(conn: &rusqlite::Connection) -> Vec<String> {
    let mut names: Vec<String> = vec![];
    let _ = conn
        .prepare("SELECT name FROM feishu_users WHERE length(name) >= 2")
        .map(|mut s| {
            let _ = s
                .query_map([], |r| r.get::<_, String>(0))
                .map(|rows| names.extend(rows.flatten()));
        });
    let _ = conn
        .prepare("SELECT chat_name FROM feishu_chats WHERE length(chat_name) >= 2")
        .map(|mut s| {
            let _ = s
                .query_map([], |r| r.get::<_, String>(0))
                .map(|rows| names.extend(rows.flatten()));
        });
    let _ = conn
        .prepare("SELECT chat_name FROM feishu_chat_aliases WHERE length(chat_name) >= 2")
        .map(|mut s| {
            let _ = s
                .query_map([], |r| r.get::<_, String>(0))
                .map(|rows| names.extend(rows.flatten()));
        });
    for k in ["feishu_my_name", "feishu_my_names"] {
        let _ = conn
            .query_row(
                "SELECT value FROM settings WHERE key=?1",
                rusqlite::params![k],
                |r| r.get::<_, String>(0),
            )
            .map(|v| names.extend(crate::anonymize::parse_name_list(&v)))
            .map_err(|_| () as ());
    }
    names.sort_by_key(|n| std::cmp::Reverse(n.chars().count()));
    names.dedup();
    names
}

pub fn redact_line(line: &str) -> String {
    let bytes = line.as_bytes();
    let mut out = String::with_capacity(line.len());
    let mut i = 0usize;
    while i < bytes.len() {
        // 键名都是 ASCII：按字节做大小写不敏感前缀匹配，避免整行 lower 后字节长度漂移
        let hit = SENSITIVE_KEYS.iter().find_map(|k| {
            bytes
                .get(i..i + k.len())
                .filter(|seg| seg.eq_ignore_ascii_case(k.as_bytes()))
                .map(|_| k.len())
        });
        if let Some(klen) = hit {
            let key_end = i + klen;
            out.push_str(&line[i..key_end]);
            // 键名后的分隔符（空格/:/= 与引号）原样保留
            let mut j = key_end;
            while j < bytes.len() && matches!(bytes[j], b' ' | b':' | b'=' | b'"' | b'\'') {
                out.push(bytes[j] as char);
                j += 1;
            }
            if j < bytes.len() {
                out.push_str("***");
                // 紧跟引号说明是引用值（"key":"value"）：吞到闭引号并补回，保持对称
                if j > key_end && (bytes[j - 1] == b'"' || bytes[j - 1] == b'\'') {
                    let quote = bytes[j - 1];
                    while j < bytes.len() && bytes[j] != quote {
                        j += 1;
                    }
                    if j < bytes.len() {
                        out.push(bytes[j] as char);
                        j += 1;
                    }
                } else {
                    // 裸值：吞到空白/常见 JSON 分隔符为止（宁可多遮，不可漏遮）
                    let start = j;
                    while j < bytes.len()
                        && !bytes[j].is_ascii_whitespace()
                        && !matches!(bytes[j], b',' | b'}' | b']' | b')' | b';')
                    {
                        j += 1;
                    }
                    // 「Bearer <凭证>」：值是 Bearer 时把随后的凭证一并遮蔽
                    // （Authorization 键会比 Bearer 先命中，不补这一刀凭证就漏了）
                    if line[start..j].eq_ignore_ascii_case("bearer") {
                        while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                            j += 1;
                        }
                        while j < bytes.len()
                            && !bytes[j].is_ascii_whitespace()
                            && !matches!(bytes[j], b',' | b'}' | b']' | b')' | b';')
                        {
                            j += 1;
                        }
                    }
                }
            }
            i = j;
        } else {
            let ch = line[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

/// 生成支持报告：版本 + 平台 + 集成健康快照 + 最近日志（脱敏）。
/// 用户把它贴到 issue 里即可附带排障上下文。
#[tauri::command]
pub fn build_support_report<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
) -> AppResult<String> {
    let mut report = String::new();
    report.push_str("就决定是你了 支持报告\n");
    report.push_str(&format!(
        "版本：{} · 平台：{} · 生成时间：{}\n\n",
        app.package_info().version,
        std::env::consts::OS,
        crate::db::now()
    ));

    report.push_str("—— 集成健康 ——\n");
    let (infos, sensitive_names) = {
        let conn = db.0.lock().unwrap();
        (
            collect_health(&app, &conn, &crate::lark_cli::lark_bin())?,
            collect_sensitive_names(&conn),
        )
    };
    // 三层脱敏：键名 → 值形态（邮箱/凭证）→ 本库名词表（人名/群名）
    let scrub = |s: &str| redact_names(&sensitive_names, &redact_values(&redact_line(s)));
    for h in &infos {
        report.push_str(&format!(
            "[{}] 状态 {} · 上次成功 {} · 连续失败 {}",
            h.provider,
            h.status,
            h.last_success_at.as_deref().unwrap_or("—"),
            h.consecutive_failures
        ));
        if h.provider == health::FEISHU && h.pending_count > 0 {
            report.push_str(&format!(" · 待确认建议 {}", h.pending_count));
        }
        if !h.primary_agent.is_empty() {
            report.push_str(&format!(" · Agent「{}」", h.primary_agent));
        }
        report.push('\n');
        if let Some(err) = &h.last_error {
            report.push_str(&format!("  最近错误：{}\n", scrub(err)));
        }
    }

    report.push_str("\n—— 最近日志（已脱敏：敏感键值 / 邮箱凭证 / 人名群名） ——\n");
    let entries = list_log_entries(
        app.clone(),
        Some(200),
        None, // 报告带全级别，交由脱敏保证安全
    )?;
    if entries.is_empty() {
        report.push_str("（无日志）\n");
    }
    for e in entries {
        report.push_str(&format!(
            "{}[{}][{}] {}\n",
            redact_line(&e.time),
            e.level,
            redact_line(&e.target),
            scrub(&e.message)
        ));
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::test_conn;
    use crate::health::HealthState;
    use rusqlite::params;
    use std::sync::Mutex;
    use tauri::Manager;

    fn setup() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(Db(Mutex::new(test_conn())));
        app.manage(HealthState::default());
        app
    }

    #[test]
    fn parse_log_line_handles_default_format() {
        let e = parse_log_line("[2026-09-12][23:00:01][app_lib::feishu][INFO] feishu: 拉取 3 条")
            .unwrap();
        assert_eq!(e.time, "2026-09-12 23:00:01");
        assert_eq!(e.level, "info");
        assert_eq!(e.target, "app_lib::feishu");
        assert_eq!(e.message, "feishu: 拉取 3 条");
        // 大小写级别归一；第四段不是已知级别则按非日志行处理
        assert_eq!(parse_log_line("[d][t][x][WARN] 唔").unwrap().level, "warn");
        assert!(parse_log_line("[d][t][x][Note] 唔").is_none());
    }

    #[test]
    fn parse_log_lines_merges_continuation_lines() {
        let content = "[a][b][t][INFO] 第一行\n多行消息的续行\n[c][d][t2][ERROR] 第二条";
        let entries = parse_log_lines(content);
        assert_eq!(entries.len(), 2);
        assert!(entries[0].message.contains("多行消息的续行"));
        assert_eq!(entries[1].level, "error");
    }

    #[test]
    fn redact_line_masks_sensitive_values() {
        assert_eq!(
            redact_line("feishu poll failed: app_secret=abcd1234efgh"),
            "feishu poll failed: app_secret=***"
        );
        assert_eq!(
            redact_line(r#"保存 "refresh_token":"u-xYz123""#),
            r#"保存 "refresh_token":"***""#
        );
        assert_eq!(
            redact_line("Authorization: Bearer t-9a8b7c6d"),
            "Authorization: ***",
            "Bearer 凭证整体遮蔽，不得残留"
        );
        // 非引用分隔的值整体遮蔽（宁可多遮，敏感内容不得残留）
        let masked = redact_line("token：很长的值");
        assert!(!masked.contains("很长的值"));
        assert!(masked.starts_with("token"));
        // 无敏感键的行原样保留（含多字节字符）
        assert_eq!(
            redact_line("AI 判定 3/5 条：新待办 2"),
            "AI 判定 3/5 条：新待办 2"
        );
    }

    /// 值形态脱敏：邮箱与常见凭证前缀，不带键名也遮（agent 回显片段的兜底）
    #[test]
    fn redact_values_masks_emails_and_token_shapes() {
        assert_eq!(
            redact_values("联系 joe.cai+tag@example.com 收尾"),
            "联系 ***@*** 收尾"
        );
        assert_eq!(
            redact_values("key: sk-proj-AbCd1234EfGh5678 done"),
            "key: *** done"
        );
        assert_eq!(
            redact_values("ghp_0123456789abcdefghijklm 失效"),
            "*** 失效"
        );
        assert_eq!(
            redact_values("AWS AKIAIOSFODNN7EXAMPLE 权限不足"),
            "AWS *** 权限不足"
        );
        // 前缀后的短串不算凭证（sk-ips 之类普通词不误伤）
        assert_eq!(redact_values("sk-ip 是普通词"), "sk-ip 是普通词");
        // 无形态可匹配时原样保留
        assert_eq!(redact_values("AI 判定 3/5 条"), "AI 判定 3/5 条");
    }

    /// 词表脱敏：库里的真名/群名在报告文本中出现即遮蔽，长名优先
    #[test]
    fn redact_names_uses_db_dictionary() {
        let conn = crate::db::tests::test_conn();
        conn.execute(
            "INSERT INTO feishu_users (open_id, name, updated_at) VALUES ('ou_a', '张三丰', 'x')",
            rusqlite::params![],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO feishu_chat_aliases (chat_id, chat_name, alias)
             VALUES ('oc_g', '项目攻坚群', '群_00aa')",
            rusqlite::params![],
        )
        .unwrap();
        let names = collect_sensitive_names(&conn);
        let out = redact_names(&names, "张三丰在 项目攻坚群 提到 joe@example.com");
        assert!(
            !out.contains("张三丰") && !out.contains("项目攻坚群"),
            "{out}"
        );
        assert!(out.contains("在 *** 提到"), "{out}");
    }

    /// 测试里插入一个启用的 agent 配置，让 AI 链路算「已配置」
    fn seed_agent_config(app: &tauri::App<tauri::test::MockRuntime>) {
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('ai_agents', ?1)",
            params![r#"[{"id":"a1","name":"Claude Code","command":"claude","args":"","historyArgs":"","timeoutSecs":120,"enabled":true}]"#],
        )
        .unwrap();
    }

    #[test]
    fn integration_health_combines_state_and_config() {
        let app = setup();
        seed_agent_config(&app);
        // 假 lark-cli：一个存在的文件即满足「已安装」（登录态不在此判定）
        let bin = std::env::temp_dir().join(format!("pk-lark-bin-{}", std::process::id()));
        std::fs::write(&bin, b"#!/bin/sh\n").unwrap();
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('feishu_enabled', 'true')",
                [],
            )
            .unwrap();
        }
        // 制造飞书失败 + AI 成功
        let state = app.state::<HealthState>();
        state.record_failure(app.handle(), health::FEISHU, "boom");
        state.record_success(app.handle(), health::AI);

        let infos = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            collect_health(app.handle(), &conn, bin.to_str().unwrap()).unwrap()
        };
        let by: std::collections::HashMap<&str, &IntegrationHealthInfo> =
            infos.iter().map(|h| (h.provider.as_str(), h)).collect();
        assert_eq!(by[health::FEISHU].status, "degraded");
        assert_eq!(by[health::FEISHU].last_error.as_deref(), Some("boom"));
        assert!(by[health::FEISHU].configured && by[health::FEISHU].enabled);
        assert_eq!(by[health::AI].status, "ok");
        assert_eq!(by[health::AI].primary_agent, "Claude Code");
        // 收音机积压计入
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO chat_messages (message_id, content, ai_status, review_status, created_at)
                 VALUES ('om_1', 'c', 'todo', 'pending', '2026-09-12T00:00:00Z')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO chat_messages (message_id, content, ai_status, review_status, created_at)
                 VALUES ('om_2', 'c', 'none', 'pending', '2026-09-12T00:00:00Z')",
                [],
            )
            .unwrap();
        }
        let infos = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            collect_health(app.handle(), &conn, bin.to_str().unwrap()).unwrap()
        };
        let feishu = infos.iter().find(|h| h.provider == health::FEISHU).unwrap();
        assert_eq!(feishu.pending_count, 1, "只有 todo/update 算待确认积压");
        let _ = std::fs::remove_file(&bin);
    }

    #[test]
    fn unconfigured_providers_report_off() {
        let app = setup();
        let infos = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            collect_health(app.handle(), &conn, "/nonexistent/pk-lark-cli").unwrap()
        };
        assert!(infos.iter().all(|h| h.status == "off"), "{infos:?}");
        assert_eq!(infos.len(), 2);
    }

    #[test]
    fn support_report_contains_health_and_redacts() {
        let app = setup();
        seed_agent_config(&app);
        let state = app.state::<HealthState>();
        state.record_failure(app.handle(), health::AI, "token=super-secret-value 泄漏了");
        let report = {
            let db = app.state::<Db>();
            build_support_report(app.handle().clone(), db).unwrap()
        };
        assert!(report.contains("支持报告"));
        assert!(report.contains("[ai] 状态 degraded"));
        assert!(report.contains("token=***"));
        assert!(
            !report.contains("super-secret-value"),
            "敏感值不得出现在报告里"
        );
    }
}
