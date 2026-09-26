//! pk 整合测试：全部经 run 分发器走全链路（库逻辑复用应用的 conn 层函数）。
use crate::cli::format_log_line;
use crate::doctor::doctor_report;
use crate::remote::{parse_forced_command, run_remote, shlex_split};
use crate::suggest::suggest_batch_from_str;
use pokemon_choose_you_lib::skills::skill_dir_for;
use rusqlite::params;

use super::*;
use pokemon_choose_you_lib::db;

// ---- forced command（__ssh_entry）解析 ----

fn exe_of_this_test_binary() -> std::path::PathBuf {
    std::env::current_exe().unwrap()
}

#[test]
fn forced_command_accepts_shim_shapes() {
    let exe = exe_of_this_test_binary();
    let exe_str = exe.to_string_lossy();
    // shim 的标准产出：env 前缀 + PK_* 透传 + 绝对路径 + 参数
    let (envs, args) = parse_forced_command(
        &format!("env PK_LOG_FILE=\"/tmp/log dir/a.log\" {exe_str} task list --limit all"),
        &exe,
    )
    .unwrap();
    assert_eq!(
        envs,
        vec![("PK_LOG_FILE".to_string(), "/tmp/log dir/a.log".to_string())]
    );
    assert_eq!(args, vec!["task", "list", "--limit", "all"]);
    // 无 env 前缀（Windows 本机形态）/ 无 PK_*（fwd=env 裸前缀）也接受
    let (e2, a2) = parse_forced_command(&format!("{exe_str} --version"), &exe).unwrap();
    assert!(e2.is_empty());
    assert_eq!(a2, vec!["--version"]);
    let (e3, a3) = parse_forced_command(&format!("env {exe_str} suggest todo"), &exe).unwrap();
    assert!(e3.is_empty());
    assert_eq!(a3, vec!["suggest", "todo"]);
    // 含空格路径（posix_quote 后的单引号形态）
    let (e4, a4) = parse_forced_command(&format!("env '{exe_str}' task get 3",), &exe).unwrap();
    assert!(e4.is_empty());
    assert_eq!(a4, vec!["task", "get", "3"]);
}

#[test]
fn forced_command_rejects_non_pk_programs() {
    let exe = exe_of_this_test_binary();
    // 换成任意别的程序（shell / 自身目录外的二进制）→ 拒绝
    for bad in [
        "env /bin/sh -c 'rm -rf ~'",
        "/bin/sh",
        "env /usr/bin/env x",
        "env PK_HACK=1 /bin/true",
    ] {
        assert!(parse_forced_command(bad, &exe).is_err(), "应拒绝: {bad}");
    }
    // 白名单外的 PK_* 变量 → 拒绝（env 赋值只认 PK_LOG_FILE / PK_DISPATCH_TASK）
    let exe_str = exe.to_string_lossy();
    assert!(parse_forced_command(&format!("env PK_HACK=1 {exe_str} task list"), &exe).is_err());
    // 缺程序路径 / 空命令 → 拒绝
    assert!(parse_forced_command("", &exe).is_err());
    assert!(parse_forced_command("env", &exe).is_err());
}

#[test]
fn shlex_split_handles_quotes_and_rejects_broken() {
    assert_eq!(
        shlex_split("a 'b c' \"d e\" f\\ g").unwrap(),
        vec!["a", "b c", "d e", "f g"]
    );
    assert_eq!(
        shlex_split("PK_X=\"v w\" 'x y'").unwrap(),
        vec!["PK_X=v w", "x y"]
    );
    // 换行是空白；未闭合引号报错
    assert_eq!(shlex_split("a\n\tb").unwrap(), vec!["a", "b"]);
    assert!(shlex_split("a 'b").is_err());
    assert!(shlex_split("a \"b").is_err());
    assert!(shlex_split("a b\\").is_err());
}

/// 每个用例独立的内存库（迁移 + 默认分类），复用应用的 init_conn 保证 schema 一致
fn test_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    db::init_conn(&conn).unwrap();
    conn
}

fn run_ok(conn: &mut Connection, args: &[&str]) -> serde_json::Value {
    let owned: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    run(conn, &owned).unwrap_or_else(|e| panic!("命令 {args:?} 失败: {}", e.0))
}

fn run_err(conn: &mut Connection, args: &[&str]) -> CliError {
    let owned: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    run(conn, &owned).unwrap_err()
}

fn create(conn: &mut Connection, title: &str) -> i64 {
    let out = run_ok(conn, &["task", "create", "--title", title]);
    out["created"]["id"].as_i64().unwrap()
}

/// pk 写进应用日志文件的行必须能被诊断页的日志解析器识别（target=pk、级别正确），
/// 否则 agent 的 pk 调用在日志视图里不可见
#[test]
fn cli_log_line_parses_as_log_entry() {
    let now = chrono::Utc::now();
    let line = format_log_line(now, "INFO", "pk suggest batch --agent claude-code");
    let entries = pokemon_choose_you_lib::commands::diagnostics::parse_log_lines(&line);
    let e = entries.first().expect("单行应解析为一条日志");
    assert_eq!(e.target, "pk");
    assert_eq!(e.level, "info");
    assert_eq!(e.message, "pk suggest batch --agent claude-code");
    // 换行压平成空格：日志文件一行一条，诊断页按行解析
    let multi = format_log_line(now, "ERROR", "失败退出（码 1）: 带换行\n的消息");
    assert!(!multi.contains('\n'), "消息内换行须压平: {multi}");
}

#[test]
fn create_get_list_roundtrip() {
    let mut conn = test_db();
    let id = create(&mut conn, "交周报");
    let got = run_ok(&mut conn, &["task", "get", &id.to_string()]);
    assert_eq!(got["task"]["title"], "交周报");
    assert_eq!(got["task"]["status"], "inbox", "无截止时间默认草丛");
    assert_eq!(got["task"]["source"], "cli", "CLI 建的任务标记来源");
    assert_eq!(got["notes"].as_array().map(Vec::len), Some(0));

    let list = run_ok(&mut conn, &["task", "list"]);
    assert_eq!(list["count"], 1);
    assert_eq!(list["tasks"][0]["id"], json!(id));

    let today = run_ok(&mut conn, &["task", "list", "today"]);
    assert_eq!(today["count"], 0, "无截止时间不进 today");
}

#[test]
fn create_with_due_goes_scheduled_and_validates_input() {
    let mut conn = test_db();
    let out = run_ok(
        &mut conn,
        &[
            "task",
            "create",
            "--title",
            "开会",
            "--due",
            "2026-09-13T10:00",
            "--priority",
            "high",
        ],
    );
    assert_eq!(out["created"]["status"], "scheduled", "有截止时间直接排期");
    assert_eq!(out["created"]["priority"], "high");

    let bad = run_err(
        &mut conn,
        &["task", "create", "--title", "x", "--priority", "urgent!!"],
    );
    assert_eq!(bad.1, 2, "非法优先级是用法错误");
    assert!(bad.0.contains("优先级"));

    let bad_due = run_err(
        &mut conn,
        &["task", "create", "--title", "x", "--due", "明天"],
    );
    assert!(bad_due.0.contains("时间"), "时间格式校验: {}", bad_due.0);
}

/// tag create：agent 自助扩词表（带维度与 origin=agent）；list 带维度信息
#[test]
fn tag_create_and_list_carry_dimension() {
    let mut conn = test_db();
    let out = run_ok(
        &mut conn,
        &["tag", "create", "PokemonApp", "--dimension", "project"],
    );
    assert_eq!(out["created"]["dimension"], json!("project"));
    assert_eq!(out["created"]["origin"], json!("agent"));
    // 未知维度报业务错误
    let err = run_err(&mut conn, &["tag", "create", "x", "--dimension", "nope"]);
    assert_eq!(err.1, 1, "{}", err.0);
    let list = run_ok(&mut conn, &["tag", "list"]);
    assert_eq!(list["tags"][0]["dimension"], json!("project"));
    assert_eq!(list["dimensions"][0]["key"], json!("project"));
    // context 带维度剩余名额
    let ctx = run_ok(&mut conn, &["context"]);
    assert_eq!(ctx["dimensions"][0]["remaining"], json!(19));
    assert_eq!(ctx["tags"][0]["dimension"], json!("project"));
}

/// suggest 的维度化标签校验：词表内未标 isNew 报错；isNew 需维度存在且未满
#[test]
fn suggest_validates_proposed_tags() {
    let mut conn = test_db();
    conn.execute(
        "INSERT INTO chat_messages (message_id, content, created_at) VALUES ('om_t', 'x', 'x')",
        [],
    )
    .unwrap();
    // 词表外未标 isNew → 业务错误（提示协议）
    let err = run_err(
        &mut conn,
        &[
            "suggest",
            "todo",
            "--message",
            "om_t",
            "--title",
            "t",
            "--tags",
            "幻觉",
        ],
    );
    assert!(err.0.contains("isNew"), "{}", err.0);
    // 批量协议：isNew=true 且维度合法 → 通过（标签在接受建议时才真正创建）
    conn.execute(
        "INSERT INTO chat_messages (message_id, content, created_at) VALUES ('om_t2', 'x', 'x')",
        [],
    )
    .unwrap();
    let ok_body = r#"{"results":[{"messageId":"om_t2","action":"todo","title":"t2","tags":[{"name":"新项目","dimension":"project","isNew":true}]}]}"#;
    let v = suggest_batch_from_str(&mut conn, ok_body, Some("ag")).unwrap();
    assert_eq!(v["submitted"], json!(1));
    // isNew 但维度未知 → 拒绝（维度满的分支在 lib 侧 create_tag_conn 测试覆盖）
    conn.execute(
        "INSERT INTO chat_messages (message_id, content, created_at) VALUES ('om_t3', 'x', 'x')",
        [],
    )
    .unwrap();
    let full = r#"{"results":[{"messageId":"om_t3","action":"todo","title":"t3","tags":[{"name":"挤不进","dimension":"nope","isNew":true}]}]}"#;
    let err = suggest_batch_from_str(&mut conn, full, None).unwrap_err();
    assert!(err.0.contains("维度"), "{}", err.0);
}

/// 假名化闭环：context 输出的待办标题已代号化（我的称呼 → 「我」）；
/// suggest 回写的代号在落库前还原成真名——两端共用 feishu_users 映射，
/// 「同代号 = 同人」跨进程成立，用户可见文本不含代号
#[test]
fn context_scrubs_titles_and_suggest_restores_aliases() {
    let mut conn = test_db();
    let set = |k: &str, v: &str| {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value=?2",
            params![k, v],
        )
        .unwrap();
    };
    set("feishu_my_open_id", "ou_me");
    set("feishu_my_name", "乔老板");
    conn.execute(
        "INSERT INTO feishu_users (open_id, name, alias, updated_at) VALUES
            ('ou_me', '乔老板', '', '2026-09-01'),
            ('ou_z', '张三', '成员_00aa', '2026-09-01')",
        [],
    )
    .unwrap();
    create(&mut conn, "找张三对齐材料");
    create(&mut conn, "给乔老板准备发言稿");
    let ctx = run_ok(&mut conn, &["context"]);
    let titles: Vec<&str> = ctx["openTasks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["title"].as_str().unwrap())
        .collect();
    assert!(titles.contains(&"找成员_00aa对齐材料"), "{titles:?}");
    assert!(titles.contains(&"给我准备发言稿"), "{titles:?}");

    // 模型按代号回写 → 落库还原真名
    conn.execute(
        "INSERT INTO chat_messages (message_id, content, created_at) VALUES ('om_a', 'x', 'x')",
        [],
    )
    .unwrap();
    let out = suggest_batch_from_str(
        &mut conn,
        r#"{"results":[{"messageId":"om_a","action":"todo","title":"找成员_00aa对齐材料","reason":"成员_00aa明确指派"}]}"#,
        None,
    )
    .unwrap();
    assert_eq!(out["submitted"], json!(1));
    let (title, reason): (String, String) = conn
        .query_row(
            "SELECT suggested_title, suggested_reason FROM chat_messages WHERE message_id='om_a'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(title, "找张三对齐材料");
    assert!(reason.contains("张三"), "{}", reason);
}

/// 迟到回调：应用已把消息标成「AI 判定失败」（agent 超时被杀），被杀前派出的
/// pk 子进程随后仍能把判定写库——校验只看 review_status，error 须能翻正，
/// 否则迟到的正确判定永远被压在失败态下
#[test]
fn suggest_flips_error_status_when_review_pending() {
    let mut conn = test_db();
    conn.execute(
        "INSERT INTO chat_messages (message_id, chat_name, sender, content, ai_status, review_status, created_at)
         VALUES ('om_late', '项目群', '张三', '明天交周报', 'error', 'pending', '2026-09-20T00:00:00Z')",
        [],
    )
    .unwrap();
    let out = suggest_batch_from_str(
        &mut conn,
        r#"{"results":[{"messageId":"om_late","action":"todo","title":"交周报","reason":"对方明确要求周五前交付"}]}"#,
        Some("claude-code"),
    )
    .unwrap();
    assert_eq!(out["submitted"], json!(1));
    let (status, title): (String, Option<String>) = conn
        .query_row(
            "SELECT ai_status, suggested_title FROM chat_messages WHERE message_id='om_late'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(status, "todo", "迟到回调把 error 翻成 todo");
    assert_eq!(title.as_deref(), Some("交周报"));
}

#[test]
fn update_supports_clear_due_and_tags() {
    let mut conn = test_db();
    conn.execute(
        "INSERT INTO tags (name, description, created_at) VALUES ('重要', '', 'x')",
        [],
    )
    .unwrap();
    let id = create(&mut conn, "带时间");
    let out = run_ok(
        &mut conn,
        &[
            "task",
            "update",
            &id.to_string(),
            "--due",
            "2026-09-13T10:00",
            "--tags",
            "重要",
            "--priority",
            "urgent",
        ],
    );
    // --due 只改时间不自动升级状态（与应用 update 语义一致），进路线需显式 --status
    assert_eq!(out["updated"]["status"], "inbox");
    assert_eq!(out["updated"]["dueAt"], "2026-09-13T10:00");
    assert_eq!(
        out["updated"]["tags"],
        json!([{ "name": "重要", "dimension": "topic" }])
    );

    let out = run_ok(
        &mut conn,
        &["task", "update", &id.to_string(), "--status", "scheduled"],
    );
    assert_eq!(out["updated"]["status"], "scheduled");

    // --due "" 清空截止时间：草丛不变量把它归回 inbox
    let out = run_ok(&mut conn, &["task", "update", &id.to_string(), "--due", ""]);
    assert_eq!(
        out["updated"]["dueAt"],
        serde_json::Value::Null,
        "空串清空截止"
    );
    assert_eq!(out["updated"]["status"], "inbox");
    assert_eq!(
        out["updated"]["tags"],
        json!([{ "name": "重要", "dimension": "topic" }]),
        "未传 --tags 不动标签"
    );

    let unknown = run_err(
        &mut conn,
        &["task", "update", &id.to_string(), "--tags", "不存在的标签"],
    );
    assert!(
        unknown.0.contains("未知标签"),
        "未知标签报错: {}",
        unknown.0
    );
}

#[test]
fn done_start_pause_lifecycle() {
    let mut conn = test_db();
    let a = create(&mut conn, "A");
    let b = create(&mut conn, "B");

    let started = run_ok(&mut conn, &["task", "start", &a.to_string()]);
    assert_eq!(started["started"]["status"], "active");
    let current = run_ok(&mut conn, &["task", "current"]);
    assert_eq!(current["current"]["id"], json!(a));

    // 开始 B 会把 A 顶回 scheduled
    let _ = run_ok(&mut conn, &["task", "start", &b.to_string()]);
    let current = run_ok(&mut conn, &["task", "current"]);
    assert_eq!(current["current"]["id"], json!(b));
    let list = run_ok(&mut conn, &["task", "list"]);
    let a_row = list["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["id"] == json!(a))
        .unwrap();
    assert_eq!(a_row["status"], "scheduled");

    let paused = run_ok(&mut conn, &["task", "pause"]);
    assert_eq!(paused["paused"]["id"], json!(b));

    let done = run_ok(&mut conn, &["task", "done", &a.to_string()]);
    assert_eq!(done["done"]["status"], "done");
    assert!(done["done"]["completedAt"].is_string(), "完成写入完成时间");
    let open = run_ok(&mut conn, &["task", "list"]);
    assert_eq!(open["count"], 1, "done 后不在 open 列表");
}

#[test]
fn search_note_log_and_delete() {
    let mut conn = test_db();
    let id = create(&mut conn, "写季度报告");
    let _other = create(&mut conn, "无关任务");

    let hit = run_ok(&mut conn, &["task", "search", "季度"]);
    assert_eq!(hit["count"], 1);

    let note = run_ok(
        &mut conn,
        &[
            "note",
            "add",
            &id.to_string(),
            "对方确认周五交付",
            "--source",
            "ai",
        ],
    );
    assert_eq!(note["added"]["source"], "ai");
    let notes = run_ok(&mut conn, &["note", "list", &id.to_string()]);
    assert_eq!(notes["notes"].as_array().map(Vec::len), Some(1));

    let logs = run_ok(&mut conn, &["log", &id.to_string()]);
    let entries = logs["logs"].as_array().unwrap();
    assert!(
        entries.iter().any(|l| l["action"] == "create"),
        "操作日志含 create"
    );

    let del = run_ok(&mut conn, &["task", "delete", &id.to_string()]);
    assert_eq!(del["deleted"], json!(id));
    let err = run_err(&mut conn, &["task", "get", &id.to_string()]);
    assert!(err.0.contains("不存在"), "删除后查询报不存在: {}", err.0);
}

#[test]
fn category_tag_list_and_context() {
    let mut conn = test_db();
    let cats = run_ok(&mut conn, &["category", "list"]);
    assert_eq!(
        cats["categories"].as_array().map(Vec::len),
        Some(5),
        "内置五分类"
    );

    let ctx = run_ok(&mut conn, &["context"]);
    assert!(ctx["now"].is_string());
    assert_eq!(
        ctx["categories"].as_array().map(Vec::len),
        Some(5),
        "context 只列启用分类"
    );
    assert_eq!(ctx["openTasks"].as_array().map(Vec::len), Some(0));

    let id = create(&mut conn, "上下文任务");
    let ctx = run_ok(&mut conn, &["context"]);
    assert_eq!(ctx["openTasks"][0]["id"], json!(id));
}

/// 技能分发：--dir 安装到任意目录、重复安装标记 updated、未知 agent 报用法错误并给 --dir 出路
#[test]
fn skill_install_show_and_unknown_agent() {
    let mut conn = test_db();
    let dir = std::env::temp_dir().join(format!("pk-skill-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);

    // 首次安装
    let out = run_ok(
        &mut conn,
        &[
            "skill",
            "install",
            "claude-code",
            "--dir",
            &dir.to_string_lossy(),
        ],
    );
    assert_eq!(out["installed"], true);
    assert_eq!(out["updated"], false, "首次安装");
    assert_eq!(
        out["version"],
        pokemon_choose_you_lib::skills::SKILL_VERSION
    );
    let md = std::fs::read_to_string(dir.join("SKILL.md")).unwrap();
    assert!(md.contains("pk task create"), "技能内容含命令速查");
    assert!(md.contains("name: pokemon-choose-you"), "带 frontmatter");
    assert!(md.contains("pk suggest"), "含建议提交通道");
    assert!(
        dir.join("references").join("commands.md").exists(),
        "引用文件一并安装"
    );
    assert!(
        dir.join("references").join("suggest-workflow.md").exists(),
        "批处理工作流一并安装"
    );

    // 同版本重装幂等
    let out = run_ok(
        &mut conn,
        &[
            "skill",
            "install",
            "claude-code",
            "--dir",
            &dir.to_string_lossy(),
        ],
    );
    assert_eq!(out["updated"], false, "同版本重装幂等");

    // 旧版本在位 → 提示更新
    std::fs::write(
        dir.join("SKILL.md"),
        "---\nname: pokemon-choose-you\nversion: \"1\"\n---\n旧内容",
    )
    .unwrap();
    let out = run_ok(
        &mut conn,
        &[
            "skill",
            "install",
            "claude-code",
            "--dir",
            &dir.to_string_lossy(),
        ],
    );
    assert_eq!(out["updated"], true, "跨版本提示更新");
    assert_eq!(out["previousVersion"], "1");

    // 未知 agent 给出 --dir 出路（pi 已是内置目标，用未知名验证）
    let err = run_err(&mut conn, &["skill", "install", "cursor"]);
    assert_eq!(err.1, 2);
    assert!(err.0.contains("--dir"), "{}", err.0);

    // 内置目标 + --dir：正常安装（不写默认目录）
    let pi_dir = dir.join("pi");
    let out = run_ok(
        &mut conn,
        &["skill", "install", "pi", "--dir", &pi_dir.to_string_lossy()],
    );
    assert_eq!(out["installed"], true);
    assert!(pi_dir.join("SKILL.md").is_file());

    // 目录规则：claude-code / opencode 的落点结构正确（不实际写）
    let claude = skill_dir_for("claude-code", None).unwrap_or_else(|e| panic!("{e}"));
    assert!(
        claude.ends_with(".claude/skills/pokemon-choose-you")
            || claude.to_string_lossy().contains(".claude"),
        "{claude:?}"
    );
    let opencode = skill_dir_for("opencode", None).unwrap_or_else(|e| panic!("{e}"));
    assert!(
        opencode.to_string_lossy().contains("opencode"),
        "{opencode:?}"
    );
    let pi = skill_dir_for("pi", None).unwrap_or_else(|e| panic!("{e}"));
    assert!(pi.to_string_lossy().contains(".pi/agent/skills"), "{pi:?}");
    let _ = std::fs::remove_dir_all(&dir);
}

/// 会话回链与成本记录：log 落库（关联任务 + 成本/时长）→ list 查询任务时间线
#[test]
fn session_log_and_list_roundtrip() {
    let mut conn = test_db();
    let id = create(&mut conn, "修登录bug");
    let out = run_ok(
        &mut conn,
        &[
            "session",
            "log",
            "--task",
            &id.to_string(),
            "--agent",
            "claude-code",
            "--session",
            "sess-1",
            "--command",
            "claude -p 修登录bug",
            "--exit-code",
            "0",
            "--duration-ms",
            "61000",
            "--cost",
            "0.12",
            "--in-tokens",
            "1000",
            "--out-tokens",
            "2000",
        ],
    );
    assert_eq!(out["session"]["taskId"], id);
    assert_eq!(out["session"]["sessionId"], "sess-1");
    assert_eq!(
        out["session"]["agentName"], "claude-code",
        "无配置时用 id 兜底"
    );
    assert_eq!(out["session"]["durationMs"], 61000);

    // 任务时间线查得到；全局列表也有
    let list = run_ok(&mut conn, &["session", "list", "--task", &id.to_string()]);
    assert_eq!(list["sessions"].as_array().unwrap().len(), 1);
    let all = run_ok(&mut conn, &["session", "list"]);
    assert_eq!(all["sessions"].as_array().unwrap().len(), 1);

    // 缺 --agent 报用法错误；关联不存在的任务报业务错误
    let err = run_err(&mut conn, &["session", "log"]);
    assert_eq!(err.1, 2, "缺参数是用法错误");
    let err = run_err(
        &mut conn,
        &["session", "log", "--agent", "a", "--task", "999"],
    );
    assert!(err.0.contains("不存在"), "{}", err.0);
}

/// dispatch 回传：running → done（备注入审计日志）；无派发上下文静默跳过；
/// start 领取开工幂等；非法迁移报业务错误
#[test]
fn dispatch_report_transitions_and_skips_without_context() {
    let mut conn = test_db();
    let id = create(&mut conn, "修登录");

    // 无 --task 且无 PK_DISPATCH_TASK：skipped（Stop hook 挂上后普通会话结束不刷错）
    std::env::remove_var("PK_DISPATCH_TASK");
    let out = run_ok(&mut conn, &["dispatch", "done"]);
    assert!(out["skipped"].is_string(), "{out}");

    // NULL → done 非法（先由应用派发领取 running）
    let err = run_err(&mut conn, &["dispatch", "done", "--task", &id.to_string()]);
    assert_eq!(err.1, 1, "状态机拦截是业务错误");
    assert!(err.0.contains("不能迁移"), "{}", err.0);

    // start 领取开工（NULL → running），重复 start 幂等
    let out = run_ok(&mut conn, &["dispatch", "start", "--task", &id.to_string()]);
    assert_eq!(out["state"], "running");
    let out = run_ok(&mut conn, &["dispatch", "start", "--task", &id.to_string()]);
    assert_eq!(out["idempotent"], true, "已 running 直接成功: {out}");

    // done 带备注：状态迁移 + 审计日志带备注
    let out = run_ok(
        &mut conn,
        &[
            "dispatch",
            "done",
            "--task",
            &id.to_string(),
            "--note",
            "修复完成",
        ],
    );
    assert_eq!(out["state"], "done");
    let (state, log): (Option<String>, String) = conn
        .query_row(
            "SELECT dispatch_state,
                    (SELECT new_value FROM task_logs WHERE task_id=?1 AND field='dispatch_state'
                     ORDER BY id DESC LIMIT 1)
             FROM tasks WHERE id=?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(state.as_deref(), Some("done"));
    assert!(log.contains("done：修复完成"), "{log}");

    // PK_DISPATCH_TASK 环境变量兜底（应用无头派发注入的上下文）
    conn.execute(
        "UPDATE tasks SET dispatch_state='running' WHERE id=?1",
        params![id],
    )
    .unwrap();
    std::env::set_var("PK_DISPATCH_TASK", id.to_string());
    let out = run_ok(&mut conn, &["dispatch", "fail", "--note", "退出码 1"]);
    std::env::remove_var("PK_DISPATCH_TASK");
    assert_eq!(out["state"], "failed");
}

#[test]
fn remote_shim_writes_forwarding_script() {
    let args = |v: &[&str]| -> Vec<String> { v.iter().map(|s| s.to_string()).collect() };
    // 缺 --host 是用法错误
    let err = run_remote(&args(&["shim"])).unwrap_err();
    assert_eq!(err.1, 2);
    assert!(err.0.contains("--host"), "{}", err.0);

    let dir = std::env::temp_dir().join(format!("pk-shim-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let out = run_remote(&args(&[
        "shim",
        "--host",
        "dev@box",
        "--port",
        "2222",
        "--key",
        "~/.ssh/id_ed",
        "--write",
        &dir.to_string_lossy(),
    ]))
    .unwrap();
    assert_eq!(
        out["written"].as_str().unwrap(),
        dir.to_string_lossy().as_ref()
    );
    let script = std::fs::read_to_string(&dir).unwrap();
    assert!(script.contains("exec ssh"), "{script}");
    assert!(script.contains("-p 2222"), "{script}");
    // host/key 引用后进脚本（含特殊字符的值不被 /bin/sh 拆词）
    assert!(script.contains("-i '~/.ssh/id_ed'"), "{script}");
    assert!(
        script.contains(" 'dev@box'") || script.contains(" dev@box "),
        "{script}"
    );
    // 连接复用三件套 + PK_* 透传段 + 命令透传（unix 本机走 $fwd 前缀）
    assert!(script.contains("ControlMaster=auto"), "{script}");
    assert!(script.contains("ControlPersist=10m"), "{script}");
    assert!(script.contains("[ -n \"$PK_DISPATCH_TASK\" ]"), "{script}");
    #[cfg(unix)]
    assert!(
        script.contains("dev@box \"$fwd pk\" \"$@\""),
        "命令透传回本机: {script}"
    );
    #[cfg(windows)]
    assert!(
        script.contains("dev@box pk \"$@\""),
        "命令透传回本机: {script}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn unknown_commands_are_usage_errors() {
    let mut conn = test_db();
    let err = run_err(&mut conn, &["nonsense"]);
    assert_eq!(err.1, 2);
    let err = run_err(&mut conn, &["task", "fly"]);
    assert_eq!(err.1, 2);
    let err = run_err(&mut conn, &["task", "get", "abc"]);
    assert_eq!(err.1, 2, "非数字 id 是用法错误");
}

#[test]
fn doctor_ok_on_fresh_db_and_fails_on_missing() {
    let dir = std::env::temp_dir().join(format!("pk-doctor-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let dbp = dir.join("d.db");
    {
        let conn = Connection::open(&dbp).unwrap();
        db::init_conn(&conn).unwrap();
    }
    let (report, code) = doctor_report(Some(&dbp), None);
    assert_eq!(code, 0, "健康库退出码 0（warn 不算失败）: {report}");
    assert_eq!(report["summary"]["fail"], 0);
    let by = |n: &str| {
        report["checks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == n)
            .unwrap_or_else(|| panic!("缺检查项 {n}: {report}"))
            .clone()
    };
    assert_eq!(by("database")["status"], "ok");
    assert_eq!(by("schema")["status"], "ok");
    assert_eq!(by("tables")["status"], "ok");
    assert_eq!(by("integrity")["status"], "ok");
    assert_eq!(by("context")["status"], "ok");
    // 新库未跑过应用/pk 读写，journal_mode 可能还没切 WAL → warn 合法
    assert_ne!(by("concurrency")["status"], "fail");

    // 库不存在：database fail + 退出码 1 + 修复建议
    let (report, code) = doctor_report(Some(&dir.join("none.db")), None);
    assert_eq!(code, 1);
    assert_eq!(report["summary"]["fail"], 1);
    let db_check = report["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "database")
        .unwrap();
    assert_eq!(db_check["status"], "fail");
    assert!(db_check["fix"].is_string(), "fail 项必带修复建议");

    // 库 schema 比程序新：fail + 指引升级
    {
        let conn = Connection::open(&dbp).unwrap();
        conn.execute_batch("PRAGMA user_version = 99;").unwrap();
    }
    let (report, code) = doctor_report(Some(&dbp), None);
    assert_eq!(code, 1);
    let schema = report["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "schema")
        .unwrap();
    assert_eq!(schema["status"], "fail");
    assert!(schema["detail"].as_str().unwrap().contains("v99"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn dry_run_validates_without_writing() {
    let mut conn = test_db();
    conn.execute(
        "INSERT INTO tags (name, description, created_at) VALUES ('重要', '', 'x')",
        [],
    )
    .unwrap();

    // create：非法参数照常拒绝（dry-run 不是绕过校验的后门）
    let err = run_err(
        &mut conn,
        &[
            "task",
            "create",
            "--title",
            "x",
            "--priority",
            "nope",
            "--dry-run",
        ],
    );
    assert_eq!(err.1, 2);

    let out = run_ok(
        &mut conn,
        &[
            "task",
            "create",
            "--title",
            "交周报",
            "--category",
            "工作",
            "--due",
            "2026-09-14T10:00",
            "--tags",
            "重要",
            "--dry-run",
        ],
    );
    assert_eq!(out["dryRun"], true);
    assert_eq!(out["wouldCreate"]["title"], "交周报");
    assert_eq!(out["wouldCreate"]["scheduled"], true, "带 due 即排期");
    assert_eq!(out["wouldCreate"]["tags"], json!(["重要"]));
    let list = run_ok(&mut conn, &["task", "list"]);
    assert_eq!(list["total"], 0, "dry-run 不落库");

    // update：目标不存在报业务错误；存在时只回显不改
    let id = create(&mut conn, "真任务");
    let err = run_err(
        &mut conn,
        &["task", "update", "999", "--priority", "high", "--dry-run"],
    );
    assert_eq!(err.1, 1);
    assert!(err.0.contains("不存在"), "{}", err.0);
    let out = run_ok(
        &mut conn,
        &[
            "task",
            "update",
            &id.to_string(),
            "--priority",
            "high",
            "--dry-run",
        ],
    );
    assert_eq!(out["wouldUpdate"]["priority"], "high");
    let got = run_ok(&mut conn, &["task", "get", &id.to_string()]);
    assert_eq!(got["task"]["priority"], "normal", "dry-run 不改库");

    // delete：只确认存在性
    let out = run_ok(&mut conn, &["task", "delete", &id.to_string(), "--dry-run"]);
    assert_eq!(out["wouldDelete"], json!(id));
    let got = run_ok(&mut conn, &["task", "get", &id.to_string()]);
    assert_eq!(got["task"]["id"], json!(id), "dry-run 不删除");
}

#[test]
fn task_list_limits_with_truncation_hint() {
    let mut conn = test_db();
    for i in 0..3 {
        create(&mut conn, &format!("任务{i}"));
    }
    // 默认 50：小库不截断
    let out = run_ok(&mut conn, &["task", "list"]);
    assert_eq!(out["count"], 3);
    assert_eq!(out["total"], 3);
    assert_eq!(out["truncated"], false);
    assert!(out["hint"].is_null(), "未截断不给提示");

    // --limit 2：截断 + 提示收窄手段
    let out = run_ok(&mut conn, &["task", "list", "--limit", "2"]);
    assert_eq!(out["count"], 2);
    assert_eq!(out["total"], 3);
    assert_eq!(out["truncated"], true);
    assert!(out["hint"].as_str().unwrap().contains("search"));

    // --limit all / 0：不截断
    let out = run_ok(&mut conn, &["task", "list", "--limit", "all"]);
    assert_eq!(out["count"], 3);
    assert_eq!(out["truncated"], false);
    let out = run_ok(&mut conn, &["task", "list", "--limit", "0"]);
    assert_eq!(out["count"], 3);

    let err = run_err(&mut conn, &["task", "list", "--limit", "很多"]);
    assert_eq!(err.1, 2, "非法 limit 是用法错误");
}

/// help --json 的机器可读目录：合法 JSON、含契约信息与全部命令
#[test]
fn help_schema_lists_commands_and_contract() {
    let v: serde_json::Value = serde_json::from_str(&help_schema()).unwrap();
    assert_eq!(v["name"], "pk");
    assert_eq!(v["version"], env!("CARGO_PKG_VERSION"));
    assert!(v["exitCodes"]["2"].is_string(), "退出码契约");
    assert!(v["env"]["PK_DB"].is_string());
    let cmds = v["commands"].as_array().unwrap();
    assert!(cmds.len() >= COMMAND_INDEX.len());
    for must in [
        "task create",
        "suggest batch",
        "doctor",
        "remote shim",
        "context",
    ] {
        assert!(cmds.iter().any(|c| c["command"] == must), "缺命令 {must}");
    }
}

/// 直插一条待判定消息（模拟飞书拉取落库后的状态：ai_status/review_status 均 pending）
fn insert_msg(conn: &Connection, message_id: &str, content: &str) {
    conn.execute(
        "INSERT INTO chat_messages (message_id, content, sent_at, created_at)
         VALUES (?1, ?2, 0, 'x')",
        params![message_id, content],
    )
    .unwrap();
}

fn msg_col(conn: &Connection, message_id: &str, col: &str) -> String {
    conn.query_row(
        &format!("SELECT {col} FROM chat_messages WHERE message_id=?1"),
        params![message_id],
        |r| r.get::<_, String>(0),
    )
    .unwrap_or_default()
}

#[test]
fn suggest_todo_update_none_roundtrip() {
    let mut conn = test_db();
    insert_msg(&conn, "om_1", "明天上午交周报");

    // none：只记状态与理由
    let out = run_ok(
        &mut conn,
        &["suggest", "none", "--message", "om_1", "--reason", "闲聊"],
    );
    assert_eq!(out["applied"], "none");
    assert_eq!(msg_col(&conn, "om_1", "ai_status"), "none");
    assert_eq!(msg_col(&conn, "om_1", "suggested_reason"), "闲聊");

    // todo：建议列落库 + 幂等覆盖
    let out = run_ok(
        &mut conn,
        &[
            "suggest",
            "todo",
            "--message",
            "om_1",
            "--title",
            "交周报",
            "--category",
            "工作",
            "--priority",
            "high",
            "--due",
            "2026-09-14T10:00",
            "--reason",
            "对方明确要求",
            "--agent",
            "claude-code",
        ],
    );
    assert_eq!(out["applied"], "todo");
    assert_eq!(msg_col(&conn, "om_1", "ai_status"), "todo");
    assert_eq!(msg_col(&conn, "om_1", "suggested_title"), "交周报");
    assert_eq!(msg_col(&conn, "om_1", "ai_agent"), "claude-code");
    let out = run_ok(
        &mut conn,
        &[
            "suggest",
            "todo",
            "--message",
            "om_1",
            "--title",
            "交周报v2",
        ],
    );
    assert_eq!(out["applied"], "todo");
    assert_eq!(
        msg_col(&conn, "om_1", "suggested_title"),
        "交周报v2",
        "重提覆盖旧建议"
    );
    assert_eq!(
        msg_col(&conn, "om_1", "ai_agent"),
        "cli",
        "不带 --agent 兜底 cli"
    );

    // update：指向现有待办，落「更新建议」待确认
    let task = create(&mut conn, "已有待办");
    let out = run_ok(
        &mut conn,
        &[
            "suggest",
            "update",
            "--message",
            "om_1",
            "--task",
            &task.to_string(),
            "--due",
            "2026-09-15T09:00",
        ],
    );
    assert_eq!(out["applied"], "update");
    assert_eq!(msg_col(&conn, "om_1", "ai_status"), "update");
    let update_task: i64 = conn
        .query_row(
            "SELECT update_task_id FROM chat_messages WHERE message_id='om_1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(update_task, task);
}

#[test]
fn suggest_follow_up_attaches_note() {
    let mut conn = test_db();
    insert_msg(&conn, "om_2", "周五交付确认了");
    let task = create(&mut conn, "交付任务");
    let out = run_ok(
        &mut conn,
        &[
            "suggest",
            "follow-up",
            "--message",
            "om_2",
            "--task",
            &task.to_string(),
            "--reason",
            "进展确认",
        ],
    );
    assert_eq!(out["applied"], "followUp");
    assert_eq!(msg_col(&conn, "om_2", "ai_status"), "followup");
    assert_eq!(
        msg_col(&conn, "om_2", "review_status"),
        "accepted",
        "跟进自动应用"
    );
    assert_eq!(msg_col(&conn, "om_2", "suggested_reason"), "进展确认");
    let note: String = conn
        .query_row(
            "SELECT content FROM task_notes WHERE task_id=?1",
            params![task],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(note, "周五交付确认了", "跟进正文是消息原文");
    // 已确认的消息不能再提交
    let err = run_err(&mut conn, &["suggest", "none", "--message", "om_2"]);
    assert_eq!(err.1, 1);
    assert!(err.0.contains("人工确认"), "{}", err.0);
}

#[test]
fn suggest_validates_input() {
    let mut conn = test_db();
    insert_msg(&conn, "om_3", "内容");

    let err = run_err(
        &mut conn,
        &["suggest", "todo", "--message", "om_none", "--title", "x"],
    );
    assert_eq!(err.1, 1);
    assert!(err.0.contains("消息不存在"), "{}", err.0);

    let err = run_err(&mut conn, &["suggest", "todo", "--message", "om_3"]);
    assert_eq!(err.1, 2, "缺 title 是用法错误");
    assert!(err.0.contains("title"), "{}", err.0);

    let err = run_err(
        &mut conn,
        &[
            "suggest",
            "todo",
            "--message",
            "om_3",
            "--title",
            "x",
            "--priority",
            "urgent!!",
        ],
    );
    assert_eq!(err.1, 2);

    let err = run_err(
        &mut conn,
        &[
            "suggest",
            "todo",
            "--message",
            "om_3",
            "--title",
            "x",
            "--category",
            "不存在的分类",
        ],
    );
    assert_eq!(err.1, 1);
    assert!(err.0.contains("分类"), "{}", err.0);

    let err = run_err(
        &mut conn,
        &[
            "suggest",
            "todo",
            "--message",
            "om_3",
            "--title",
            "x",
            "--tags",
            "没有的标签",
        ],
    );
    assert!(err.0.contains("未知标签"), "{}", err.0);

    let err = run_err(
        &mut conn,
        &[
            "suggest",
            "todo",
            "--message",
            "om_3",
            "--title",
            "x",
            "--confidence",
            "maybe",
        ],
    );
    assert!(err.0.contains("confidence"), "{}", err.0);

    // update 的目标待办必须存在、缺 --task 报用法错误
    let err = run_err(
        &mut conn,
        &[
            "suggest",
            "update",
            "--message",
            "om_3",
            "--task",
            "999",
            "--title",
            "x",
        ],
    );
    assert!(err.0.contains("不存在"), "{}", err.0);
    let err = run_err(&mut conn, &["suggest", "update", "--message", "om_3"]);
    assert!(err.0.contains("updateTaskId"), "{}", err.0);
}

#[test]
fn suggest_batch_atomic_and_counts() {
    let mut conn = test_db();
    insert_msg(&conn, "om_a", "新任务消息");
    insert_msg(&conn, "om_b", "闲聊");
    insert_msg(&conn, "om_c", "进展消息");
    let task = create(&mut conn, "目标待办");

    let body = r#"{"results":[
        {"messageId":"om_a","action":"todo","title":"新任务","priority":"high"},
        {"messageId":"om_b","action":"none","reason":"闲聊"},
        {"messageId":"om_c","action":"followUp","followUpTaskId":TASK,"reason":"进展"}
    ]}"#
    .replace("TASK", &task.to_string());
    let out = suggest_batch_from_str(&mut conn, &body, Some("claude-code")).unwrap();
    assert_eq!(out["submitted"], 3);
    assert_eq!(out["todo"], 1);
    assert_eq!(out["update"], 0);
    assert_eq!(out["followUp"], 1);
    assert_eq!(out["none"], 1);
    assert_eq!(msg_col(&conn, "om_a", "ai_status"), "todo");
    assert_eq!(msg_col(&conn, "om_a", "ai_agent"), "claude-code");
    assert_eq!(msg_col(&conn, "om_c", "ai_status"), "followup");

    // 顶层数组也接受；空 action 按 none；幂等重提覆盖
    let out = suggest_batch_from_str(
        &mut conn,
        r#"[{"messageId":"om_b","reason":"再次确认"}]"#,
        None,
    )
    .unwrap();
    assert_eq!(out["none"], 1);
    assert_eq!(msg_col(&conn, "om_b", "suggested_reason"), "再次确认");

    // 整批校验一损俱损：第 2 条消息不存在 → 全部不落库
    insert_msg(&conn, "om_d", "待覆盖");
    let bad = r#"{"results":[
        {"messageId":"om_d","action":"todo","title":"x"},
        {"messageId":"om_missing","action":"none"}
    ]}"#;
    let err = suggest_batch_from_str(&mut conn, bad, None).unwrap_err();
    assert_eq!(err.1, 1);
    assert!(err.0.contains("om_missing"), "{}", err.0);
    assert!(
        err.0.contains("第 2 条"),
        "错误带序号供 agent 自纠: {}",
        err.0
    );
    assert_eq!(
        msg_col(&conn, "om_d", "ai_status"),
        "pending",
        "失败批次不落库"
    );

    // 同批重复 messageId 拒绝（防 follow-up 重复挂跟进）
    let dup = r#"{"results":[
        {"messageId":"om_d","action":"none"},
        {"messageId":"om_d","action":"none"}
    ]}"#;
    let err = suggest_batch_from_str(&mut conn, dup, None).unwrap_err();
    assert_eq!(err.1, 2);
    assert!(err.0.contains("重复"), "{}", err.0);
}
