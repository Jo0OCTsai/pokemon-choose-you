//! 派发执行编排（§5）：claim → 交互通道（本地终端唤起 / 远程 tmux attach-or-create
//! + 注入 / 无 tmux 降级直连）或无头通道分发。
use super::cmdline::{
    agent_line, agent_line_windows, direct_ssh_argv, interactive_args, summarize_line,
    tmux_attach_argv, tmux_inject_line, tmux_session_name,
};
use super::headless::{ensure_worktree, log_dispatch, run_headless_dispatch};
use super::probe::{
    local_dispatch_dir, local_trust_note, parse_remote_probe, tmux_probe_line, trust_warn_note,
};
use super::prompt::dispatch_prompt;
use super::route::{prepare_dispatch, setting_of};
use super::state::{
    claim_dispatch, dispatch_transition_conn, DS_DONE, DS_FAILED, DS_QUEUED, DS_RUNNING,
};
use crate::ai::{self, posix_quote};
use crate::commands::integrations::{
    self, local_cd_prefix, spawn_in_terminal, spawn_line_in_terminal,
};
use crate::commands::skills::ssh_run;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::AgentSession;
use tauri::State;

/// 派发结果：channel=interactive/headless；terminal 为唤起的终端程序名（无头为 None）；
/// note 为降级/部分失败说明；state 为派发后的状态（running=已启动待回传 / done / failed）
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchResult {
    pub channel: String,
    pub terminal: Option<String>,
    pub note: Option<String>,
    pub session: AgentSession,
    pub state: String,
}

/// 派发一条待办给 agent（§5）：project 标签路由（agent_id 可改选覆盖），channel 缺省交互。
/// - interactive：新终端唤起 agent（本地 cd 直启 / 远程 tmux attach-or-create + 注入），状态 running，
///   完成靠 agent `pk dispatch done` / Stop hook / 手动标记；
/// - headless：无头跑完按退出码与信封自动迁移 done/failed（§5.3）。
/// 原子 claim（§7）防重复派发；成功唤起/执行即落一条 agent_sessions（§5.4）
#[tauri::command]
pub async fn dispatch_task<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<'_, Db>,
    task_id: i64,
    agent_id: Option<String>,
    channel: Option<String>,
) -> AppResult<DispatchResult> {
    let headless = channel.as_deref() == Some("headless");
    let prep = prepare_dispatch(&db, task_id, agent_id.as_deref())?;
    // 本地目录先验（交互 cd / 无头 cwd 都会失败，提前给可操作报错；远程交给 ssh/git 报错）
    let remote = prep
        .agent
        .remote
        .as_ref()
        .filter(|r| !r.host.trim().is_empty());
    if remote.is_none() {
        if let Some(d) = local_dispatch_dir(&prep.agent, &prep.workdir) {
            if !d.is_dir() {
                return Err(AppError::Invalid(format!(
                    "派发工作目录不存在: {}（在标签的派发设置里改正；留空则用 agent 工作目录）",
                    d.display()
                )));
            }
        }
    }
    {
        let conn = db.0.lock().unwrap();
        if !claim_dispatch(&conn, task_id, true, &[DS_DONE, DS_FAILED, DS_QUEUED])? {
            return Err(AppError::Invalid(
                "该待办已在派发执行中（running）；等 agent 回传结束，或在抽屉里重置状态后重派"
                    .into(),
            ));
        }
    }
    let use_worktree = setting_of(&db, "dispatch_worktree").as_deref() == Some("true");

    if headless {
        let out = run_headless_dispatch(&db, &prep, use_worktree).await;
        crate::events::broadcast(&app, crate::events::TASKS_CHANGED);
        return Ok(DispatchResult {
            channel: "headless".into(),
            terminal: None,
            note: out.note,
            session: out.session,
            state: out.state,
        });
    }

    // ---- 交互通道（M1 行为 + claim/状态机 + worktree） ----
    // 唤起哪个终端应用跟设置走（headless 不开终端，读提前了也用不到）
    let term_pref = {
        let conn = db.0.lock().unwrap();
        integrations::terminal_pref(&conn)
    };
    let prompt = dispatch_prompt(
        prep.task.id,
        &prep.task.title,
        prep.task.note.as_deref(),
        &prep.notes,
        prep.context.as_deref(),
    );
    // 信任预检只对 claude-code（其他 agent 无目录信任机制）；交互两条落点共用
    let kind = crate::skills::kind_for_command(&prep.agent.command);
    let args = interactive_args(&prep.agent.history_args);
    // 远端 ssh 的目标是 POSIX 登录 shell（posix 引用）；Windows 本地终端是
    // PowerShell，按 PS 单引号字面量逐参引用——prompt 含飞书消息原文，不能裸拼
    let line = agent_line(&prep.agent.command, &args, &prompt);
    let local_line = if cfg!(windows) {
        agent_line_windows(&prep.agent.command, &args, &prompt)
    } else {
        line.clone()
    };
    let summary = summarize_line(&prep.agent.command, &args, &prompt);

    // worktree 覆盖（opt-in）：本地/远程都换成工作树目录
    let (dir_override, wt_note) = if use_worktree && !prep.workdir.trim().is_empty() {
        ensure_worktree(remote, &prep.workdir, task_id).await
    } else {
        (None, None)
    };
    let workdir = dir_override.unwrap_or_else(|| prep.workdir.clone());

    let launched: AppResult<(String, Option<String>, Option<String>)> = match remote {
        None => {
            // 本地：cd 进派发目录后启动 agent，prompt 作为首条输入
            // （Windows 终端走 PS 引用版命令行，cd 前缀亦按 PS 分隔，见 local_cd_prefix）
            let full_line = match local_dispatch_dir(&prep.agent, &workdir) {
                Some(d) => format!("{}{}", local_cd_prefix(&d.to_string_lossy()), local_line),
                None => local_line,
            };
            let term = spawn_line_in_terminal(term_pref, &full_line).await?;
            // 信任预检：claude 首次在本目录启动会停在信任确认框，prompt 不发送
            let trust =
                local_trust_note(kind, local_dispatch_dir(&prep.agent, &workdir).as_deref());
            Ok((term.into(), trust, None))
        }
        Some(remote) => {
            // 远程：一条 ssh 预检三样——主机可达/免密（失败在这里就报出来，不开白屏终端）、
            // tmux 有无、派发目录与 claude 信任状态（未信任提示进 note）。
            // 脚本内 `|| true` 让「没装 tmux」以零退出码返回，与连接失败区分
            let probe_line = format!(
                "exec \"$SHELL\" -lc {}",
                posix_quote(&tmux_probe_line(&workdir))
            );
            let probe_out = ssh_run(remote, &probe_line, None).await.map_err(|e| {
                AppError::External(format!(
                    "SSH 连接（{}）失败: {e}（交互派发依赖免密登录，先在设置里用「测试」验证）",
                    remote.host.trim()
                ))
            })?;
            let probe = parse_remote_probe(&probe_out);
            let trust = trust_warn_note(
                kind,
                probe.claude_json.as_deref(),
                probe.dir.as_deref(),
                "远端",
            );
            if !probe.has_tmux {
                // 降级：无 tmux，直接 ssh -tt 启动（断开即结束）
                let argv = direct_ssh_argv(remote, &workdir, &line);
                let term = spawn_in_terminal(term_pref, &ai::ssh_bin(), &argv).await?;
                let note = [
                    Some(
                        "远端没有安装 tmux：已直接启动（会话不持久，断开即结束）——建议在远端安装 tmux 获得可重连的派发会话"
                            .into(),
                    ),
                    trust,
                ]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join("；");
                Ok((term.into(), (!note.is_empty()).then_some(note), None))
            } else {
                // tmux 路径：终端里 attach-or-create，应用另起 ssh 注入任务命令
                let session_name = tmux_session_name(task_id);
                let argv = tmux_attach_argv(remote, &session_name, &workdir);
                let term = spawn_in_terminal(term_pref, &ai::ssh_bin(), &argv).await?;
                let inject = format!(
                    "exec \"$SHELL\" -lc {}",
                    posix_quote(&tmux_inject_line(&session_name, &line))
                );
                let inject_note = match ssh_run(remote, &inject, None).await {
                    Ok(_) => None,
                    Err(e) => Some(format!(
                        "终端与 tmux 会话已就绪，但任务命令自动注入失败（{e}）；可在 tmux 里手动粘贴执行：{summary}"
                    )),
                };
                let note = [inject_note, trust]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join("；");
                Ok((
                    term.into(),
                    (!note.is_empty()).then_some(note),
                    Some(session_name),
                ))
            }
        }
    };

    match launched {
        Ok((terminal, launch_note, tmux_name)) => {
            let session = log_dispatch(&db, task_id, &prep.agent, &workdir, tmux_name, &summary)?;
            let note = [wt_note, launch_note]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join("；");
            Ok(DispatchResult {
                channel: "interactive".into(),
                terminal: Some(terminal),
                note: (!note.is_empty()).then_some(note),
                session,
                state: DS_RUNNING.into(),
            })
        }
        Err(e) => {
            // claim 成功但唤起失败：迁移 failed（原因入审计日志），错误原样上抛
            let reason: String = e.to_string().chars().take(200).collect();
            let _ = {
                let conn = db.0.lock().unwrap();
                dispatch_transition_conn(
                    &conn,
                    task_id,
                    Some(DS_FAILED),
                    Some(&reason),
                    "dispatch-interactive",
                )
            };
            Err(e)
        }
    }
}
