//! 无头通道（§5.3）：worktree 隔离（§7）、无头参数适配与会话续接、JSON 信封解析、
//! 无头执行与状态迁移、会话落库（成功 / 失败 / 兜底）。
use super::cmdline::summarize_line;
use super::prompt::dispatch_prompt;
use super::route::DispatchPrep;
use super::state::{transition_or_already, DS_DONE, DS_FAILED};
use crate::ai::{self, posix_quote, AgentConfig, AgentRemote};
use crate::commands::sessions::{log_session_conn, NewAgentSession};
use crate::commands::skills::ssh_run;
use crate::db::Db;
use crate::error::AppResult;
use crate::models::AgentSession;
use rusqlite::params;

/// 无头派发超时下限（秒）：任务处理远慢于分类（§5.3）
const DISPATCH_MIN_TIMEOUT_SECS: u64 = 600;

/// 派发用无头参数：剔除应用分类预设塞的 `--allowedTools Bash(pk:*)`（派发要读写仓库，
/// §6 白名单只约束分类）。值列表里的预设项一并剔除；用户自定义的其他 --allowedTools 值保留
pub(crate) fn dispatch_args(args: &str) -> String {
    const PRESET_WHITELIST: &str = "Bash(pk:*)";
    let toks: Vec<&str> = args.split_whitespace().collect();
    toks.iter()
        .enumerate()
        .filter(|(i, t)| {
            // 预设白名单值（单值或值列表成员）一律剔除
            if **t == PRESET_WHITELIST {
                return false;
            }
            // 只带预设值的旗标一并剔除（值是别的工具时旗标保留）
            if **t == "--allowedTools" && toks.get(i + 1) == Some(&PRESET_WHITELIST) {
                return false;
            }
            true
        })
        .map(|(_, t)| *t)
        .collect::<Vec<_>>()
        .join(" ")
}

/// 会话续接参数（按 agent 语法，§5.3）：claude 上一轮有会话 id → `--resume` 续接上下文，
/// 否则预生成 `--session-id <uuid v4>`（应用侧落 dispatched_session，真实 id 由信封回填）。
/// pi 的 `--session-id` 不存在则按该 id 创建，预生成续接与 claude 同型。
/// 其他 agent 无可靠续接，每轮新会话
pub(crate) fn session_flags(
    kind: Option<&str>,
    prev_session: Option<&str>,
) -> (String, Option<String>) {
    let prev = prev_session.map(str::trim).filter(|s| !s.is_empty());
    match kind {
        Some("claude-code") | Some("pi") => match prev {
            Some(id) => {
                let flag = if kind == Some("pi") {
                    "--session-id"
                } else {
                    "--resume"
                };
                (format!("{flag} {id}"), None)
            }
            None => {
                let id = uuid::Uuid::new_v4().to_string();
                (format!("--session-id {id}"), Some(id))
            }
        },
        _ => (String::new(), None),
    }
}

/// claude `--output-format json` 信封的回传字段（§8 无头完成信号）；非 JSON 输出全空
#[derive(Debug, Default)]
struct HeadlessEnvelope {
    session_id: Option<String>,
    cost_usd: Option<f64>,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    is_error: bool,
}

fn parse_headless_envelope(stdout: &str) -> HeadlessEnvelope {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(stdout.trim()) else {
        return HeadlessEnvelope::default();
    };
    HeadlessEnvelope {
        session_id: v
            .get("session_id")
            .and_then(|x| x.as_str())
            .map(String::from),
        cost_usd: v.get("total_cost_usd").and_then(|x| x.as_f64()),
        input_tokens: v
            .get("usage")
            .and_then(|u| u.get("input_tokens"))
            .and_then(|x| x.as_i64()),
        output_tokens: v
            .get("usage")
            .and_then(|u| u.get("output_tokens"))
            .and_then(|x| x.as_i64()),
        is_error: v.get("is_error").and_then(|x| x.as_bool()).unwrap_or(false),
    }
}

/// 为一次派发准备 git worktree（幂等）：仓库旁建兄弟目录与分支 pk-<任务id>，已存在则复用。
/// 返回 (生效目录, 说明)；目录 None = 降级用原目录（说明给用户）。本地经 sh、远程经 ssh，
/// 与远端同一脚本形态（定位仓库根 → 兄弟目录建/复用）
pub(crate) async fn ensure_worktree(
    remote: Option<&AgentRemote>,
    workdir: &str,
    task_id: i64,
) -> (Option<String>, Option<String>) {
    const SENTINEL: &str = "PK_WT ";
    let dir = posix_quote(workdir.trim());
    let script = format!(
        "cd {dir} || exit 1; \
         top=$(git rev-parse --show-toplevel 2>/dev/null) || exit 1; \
         wt=\"$(dirname \"$top\")/$(basename \"$top\")-pk-{task_id}\"; \
         if [ ! -d \"$wt\" ]; then \
           git -C \"$top\" worktree add -b pk-{task_id} \"$wt\" 2>/dev/null \
             || git -C \"$top\" worktree add \"$wt\" pk-{task_id} 2>/dev/null \
             || exit 1; \
         fi; \
         echo \"{SENTINEL}$wt\""
    );
    let note_ok = format!("worktree 隔离：分支 pk-{task_id}，完成后人工合并");
    let result = match remote {
        None => run_shell(&script).await,
        Some(r) => ssh_run(
            r,
            &format!("exec \"$SHELL\" -lc {}", posix_quote(&script)),
            None,
        )
        .await
        .map_err(|e| e.to_string()),
    };
    match result {
        Ok(out) => match out.lines().find(|l| l.starts_with(SENTINEL)) {
            Some(l) => (Some(l[SENTINEL.len()..].to_string()), Some(note_ok)),
            None => (None, Some("worktree 输出异常，改用原工作目录".into())),
        },
        Err(e) => (
            None,
            Some(format!(
                "worktree 建立失败（{}），改用原工作目录",
                e.chars().take(120).collect::<String>()
            )),
        ),
    }
}

/// 本地跑一段 sh（worktree 预备用；出错返回带退出码的可读信息）
async fn run_shell(script: &str) -> Result<String, String> {
    let out = tokio::process::Command::new("sh")
        .arg("-c")
        .arg(script)
        .output()
        .await
        .map_err(|e| format!("无法启动 sh: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(format!(
            "退出码 {}：{}",
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

/// 无头执行结果（不再向上抛执行错误：失败也落会话记录并迁移 failed，调用方按 state 呈现）
pub(crate) struct HeadlessOutcome {
    pub(crate) state: String,
    pub(crate) note: Option<String>,
    pub(crate) session: AgentSession,
}

/// 无头派发核心（手动与自动派发共用；调用方已完成 claim，状态为 running）：
/// worktree 预备 → 参数适配（剔除分类白名单 + 会话续接）→ run_agent（PK_DISPATCH_TASK
/// 注入子进程环境，本地 Stop hook / pk dispatch 可回传）→ 退出码 + 信封判定状态（§8）
pub(crate) async fn run_headless_dispatch(
    db: &Db,
    prep: &DispatchPrep,
    use_worktree: bool,
) -> HeadlessOutcome {
    let agent = &prep.agent;
    let remote = agent.remote.as_ref().filter(|r| !r.host.trim().is_empty());
    let (effective_dir, wt_note) = if use_worktree && !prep.workdir.trim().is_empty() {
        ensure_worktree(remote, &prep.workdir, prep.task.id).await
    } else {
        (None, None)
    };
    let kind = crate::skills::kind_for_command(&agent.command);
    let mut a = agent.clone();
    a.args = dispatch_args(&agent.args);
    let (flags, pre_session) = session_flags(kind, prep.prev_session.as_deref());
    if !flags.is_empty() {
        a.args.push(' ');
        a.args.push_str(&flags);
    }
    a.workdir = effective_dir.unwrap_or_else(|| prep.workdir.clone());
    a.timeout_secs = agent.timeout_secs.max(DISPATCH_MIN_TIMEOUT_SECS);
    // 预生成会话 id 先落库（claude 首轮）：进程被杀也留续接线索
    if let Some(id) = &pre_session {
        let _ = db.0.lock().unwrap().execute(
            "UPDATE tasks SET dispatched_session=?2 WHERE id=?1",
            params![prep.task.id, id],
        );
    }
    let prompt = dispatch_prompt(
        prep.task.id,
        &prep.task.title,
        prep.task.note.as_deref(),
        &prep.notes,
        prep.context.as_deref(),
    );
    let summary = format!(
        "无头派发 · {}",
        summarize_line(&agent.command, &[], &prompt)
    );

    let started = std::time::Instant::now();
    let task_id_str = prep.task.id.to_string();
    let envs = [("PK_DISPATCH_TASK", task_id_str.as_str())];
    let run = ai::run_agent_env(&a, &prompt, &envs).await;
    let duration_ms = started.elapsed().as_millis() as i64;
    // 执行时快照（a.workdir = 生效目录：worktree 或标签 meta/agent 配置）：历史回放按此路由
    let workdir_snapshot = ai::session_workdir_snapshot(&a, &a.workdir);

    let mut note = wt_note;
    let state: &str;
    let session = match run {
        Ok(stdout) => {
            let envelope = parse_headless_envelope(&stdout);
            let session_id = envelope
                .session_id
                .clone()
                .or(pre_session)
                .or(prep.prev_session.clone());
            if let Some(sid) = &session_id {
                let _ = db.0.lock().unwrap().execute(
                    "UPDATE tasks SET dispatched_session=?2 WHERE id=?1",
                    params![prep.task.id, sid],
                );
            }
            state = if envelope.is_error {
                DS_FAILED
            } else {
                DS_DONE
            };
            if envelope.is_error {
                note = Some("agent 信封标记 is_error（处理失败）".into()).or(note);
            }
            let mut rec = NewAgentSession::for_run("dispatch_headless", agent, &workdir_snapshot);
            rec.task_id = Some(prep.task.id);
            rec.session_id = session_id;
            rec.command = Some(summary.clone());
            rec.exit_code = Some(0);
            rec.status = if envelope.is_error { "error" } else { "ok" }.into();
            rec.duration_ms = Some(duration_ms);
            rec.cost_usd = envelope.cost_usd;
            rec.input_tokens = envelope.input_tokens;
            rec.output_tokens = envelope.output_tokens;
            log_session_conn(&db.0.lock().unwrap(), &rec).unwrap_or_else(|e| {
                log::warn!("dispatch: 会话记录落库失败: {e}");
                fallback_session(prep, &summary)
            })
        }
        Err(e) => {
            state = DS_FAILED;
            let reason: String = e.to_string().chars().take(200).collect();
            note = Some(reason).or(note);
            let mut rec = NewAgentSession::for_run("dispatch_headless", agent, &workdir_snapshot);
            rec.task_id = Some(prep.task.id);
            rec.session_id = prep.prev_session.clone().or(pre_session);
            rec.command = Some(summary.clone());
            rec.status = "error".into();
            rec.duration_ms = Some(duration_ms);
            log_session_conn(&db.0.lock().unwrap(), &rec)
                .unwrap_or_else(|_| fallback_session(prep, &summary))
        }
    };
    if let Err(e) = transition_or_already(db, prep.task.id, state, "dispatch-headless") {
        log::warn!("dispatch: 状态迁移失败（{e}）");
    }
    HeadlessOutcome {
        state: state.into(),
        note,
        session,
    }
}

/// 会话落库失败时的兜底记录（时间线不因落库故障缺整行）
fn fallback_session(prep: &DispatchPrep, summary: &str) -> AgentSession {
    let (remote_host, remote_port, remote_key) =
        crate::commands::sessions::remote_snapshot(&prep.agent);
    AgentSession {
        id: 0,
        task_id: Some(prep.task.id),
        agent_id: prep.agent.id.clone(),
        agent_name: prep.agent.name.clone(),
        session_id: prep.prev_session.clone(),
        command: Some(summary.to_string()),
        exit_code: None,
        status: "ok".into(),
        duration_ms: None,
        cost_usd: None,
        input_tokens: None,
        output_tokens: None,
        kind: "dispatch_headless".into(),
        workdir: ai::session_workdir_snapshot(&prep.agent, &prep.workdir),
        tmux_session: String::new(),
        remote_host,
        remote_port,
        remote_key,
        created_at: crate::db::now(),
    }
}

/// 落一条交互派发会话记录（§5.4）：command 记命令行摘要（prompt 截断）。
/// tmux_name 为远程交互的 tmux 会话名（独立成列，回放走 attach-or-create 重连）；
/// claude 会话 id 启动时不可知，session_id 留空（终端里可用 agent 自带历史回看）
pub(crate) fn log_dispatch(
    db: &Db,
    task_id: i64,
    agent: &AgentConfig,
    workdir: &str,
    tmux_name: Option<String>,
    summary: &str,
) -> AppResult<AgentSession> {
    let conn = db.0.lock().unwrap();
    let snapshot = ai::session_workdir_snapshot(agent, workdir);
    let mut rec = NewAgentSession::for_run("dispatch_interactive", agent, &snapshot);
    rec.task_id = Some(task_id);
    rec.session_id = None;
    rec.command = Some(summary.to_string());
    rec.tmux_session = tmux_name.unwrap_or_default();
    log_session_conn(&conn, &rec)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dispatch_args_strips_only_preset_whitelist() {
        assert_eq!(
            dispatch_args("-p {prompt} --allowedTools Bash(pk:*) --output-format json"),
            "-p {prompt} --output-format json",
            "剔除应用分类预设的只读白名单（派发要读写仓库）"
        );
        assert_eq!(
            dispatch_args("-p {prompt} --allowedTools Bash(git:*) Bash(pk:*)"),
            "-p {prompt} --allowedTools Bash(git:*)",
            "用户自定义白名单保留、预设剔除"
        );
        assert_eq!(dispatch_args("-p {prompt}"), "-p {prompt}");
        assert_eq!(dispatch_args(""), "");
    }

    #[test]
    fn session_flags_resume_or_pregenerated_uuid() {
        // claude 首轮：预生成 --session-id（uuid v4 形态）
        let (flags, pre) = session_flags(Some("claude-code"), None);
        assert!(flags.starts_with("--session-id "), "{flags}");
        let id = pre.expect("预生成 id 返回给调用方落库");
        assert_eq!(flags.trim_end_matches(&format!(" {id}")), "--session-id");
        assert_eq!(id.len(), 36, "uuid v4 形态（8-4-4-4-12）: {id}");
        assert_eq!(id.matches('-').count(), 4);
        // claude 续接：--resume 上一轮会话
        let (flags, pre) = session_flags(Some("claude-code"), Some(" sess-9 "));
        assert_eq!(flags, "--resume sess-9");
        assert!(pre.is_none());
        // 其他 agent：无续接，每轮新会话
        let (flags, pre) = session_flags(Some("opencode"), Some("sess-9"));
        assert_eq!(flags, "");
        assert!(pre.is_none());
        let (flags, _) = session_flags(None, Some("sess-9"));
        assert_eq!(flags, "");
        // pi：--session-id 不存在则创建，预生成续接与 claude 同型；续接轮同旗标
        let (flags, pre) = session_flags(Some("pi"), None);
        assert!(flags.starts_with("--session-id "), "{flags}");
        assert!(pre.is_some(), "首轮预生成 id 落库");
        let (flags, pre) = session_flags(Some("pi"), Some("sess-9"));
        assert_eq!(flags, "--session-id sess-9");
        assert!(pre.is_none());
    }

    #[test]
    fn headless_envelope_extracts_return_signals() {
        let env = parse_headless_envelope(
            r#"{"type":"result","subtype":"success","session_id":"abc-1","total_cost_usd":0.42,"usage":{"input_tokens":1000,"output_tokens":2000},"is_error":false,"result":"done"}"#,
        );
        assert_eq!(env.session_id.as_deref(), Some("abc-1"));
        assert!((env.cost_usd.unwrap() - 0.42).abs() < 1e-9);
        assert_eq!(env.input_tokens, Some(1000));
        assert_eq!(env.output_tokens, Some(2000));
        assert!(!env.is_error);
        // is_error = true 视为失败
        let env = parse_headless_envelope(r#"{"is_error":true,"session_id":"abc-2"}"#);
        assert!(env.is_error);
        // 非 JSON 输出（其他 agent 的纯文本）全空
        let env = parse_headless_envelope("处理完成，变更见 git log");
        assert!(env.session_id.is_none() && env.cost_usd.is_none() && !env.is_error);
    }
}
