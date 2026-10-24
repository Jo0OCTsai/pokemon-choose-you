/**
 * 交互派发（A15）：终端面板适配器接口（真实 dsh 终端后续装配；fake 记录注入）→
 * 注入任务命令 + 会话/执行标识写入派发记录（agent_sessions kind=dispatch_interactive）
 * → 完成回传 = agent 经 todo_dispatch_done/fail 工具语义（dispatchReport：收口 +
 * 账本）→ 无回传手动收口兜底（dispatchReport 标记 / dispatchReset 重置）。
 * 不解析终端输出（A15 铁律）。
 *
 * 行为基准 = src-tauri/src/commands/dispatch/exec.rs（交互通道：claim → 命令行组装 →
 * 唤起 → log_dispatch → running 待回传；唤起失败迁移 failed）。
 */
import { statSync } from "node:fs";
import { nowRfc3339, type Conn } from "../storage/db";
import { PkyError } from "../storage/errors";
import {
  claimDispatch,
  dispatchTransition,
  DS_DONE,
  DS_FAILED,
  DS_RUNNING,
  markDispatchIdle,
  transitionOrAlready,
} from "../domain/dispatch";
import { getSetting, type AgentConfig } from "../domain/settings";
import { getTask } from "../domain/tasks";
import { agentLine, interactiveArgs, promptSummary } from "./cmdline";
import { dstLaunchLine, isDshKind } from "./dstLaunch";
import { prepareDispatchPrompt, type DispatchPromptPrep } from "./prompt";
import type { ResolvedDispatchRoute } from "./routes";
import { logAgentSession, executionWorld, kindForCommand, sessionFlags } from "./sessions";
import type { SshCheckOutcome } from "./sshCheck";
import type { HandoffReasonCode } from "./terminalAdapters";

/**
 * 终端面板适配器（真实 dsh 终端面板后续装配）：注入一行命令到目标终端，返回
 * 终端标识（呈现用）与可选会话/执行标识（落 agent_sessions.session_id——dsh 终端
 * pane/会话 id，交互回放路由用）。不解析终端输出（A15）。
 * 实现件：handoff/fake = terminalAdapters.ts；desktop 外部终端 = dsh/externalTerminal.ts。
 */
export interface TerminalAdapter {
  inject(input: {
    line: string;
    agent: AgentConfig;
    taskId: number;
    workdir: string | null;
    /** 终端偏好值（共享设置 terminal_preference——desktop 外部终端解析用；适配器自决是否消费） */
    terminalPreference?: string | null;
  }): Promise<{ terminal: string; sessionRef?: string; note?: string; reason?: HandoffReasonCode }>;
}

export interface InteractiveDeps {
  terminal: TerminalAdapter;
  /** deployment 路由免密预检（真实 ssh / 测试注入） */
  sshCheck?(target: string): Promise<SshCheckOutcome>;
  /** 按路由取终端适配器（远端路由 = spawnTerminal 真 PTY 分支；undefined = 回落 terminal） */
  terminalFor?(route: ResolvedDispatchRoute): TerminalAdapter | undefined;
  /**
   * 派发前部署就绪复核（remote/sshExecutor 装配面注入；语义同 HeadlessDeps 同名钩子：
   * 失败前置拒绝，抛 RemoteDispatchRejection——tag 机器稳定，命令层 2.9 映射错误码）。
   * 注入本钩子后 sshCheck 不再重复执行。
   */
  deploymentPrecheck?(route: ResolvedDispatchRoute): Promise<void>;
}

export interface InteractiveOutcome {
  state: string;
  terminal: string;
  note: string | null;
  /** agent_sessions 行 id */
  sessionRowId: number;
  /** 注入的命令行（呈现/审计） */
  line: string;
  /** handoff 原因（terminal=copy-line 时在场——客户端 web 提示分流） */
  reason?: HandoffReasonCode;
}

/**
 * 本地派发工作目录存在性校验（probe.rs local_dispatch_dir 语义 + exec.rs 前置验：
 * 目录配错应报错而不是静默进继承 cwd）。只展开 ~ 前缀，不自动创建。
 */
export function localDispatchDir(workdir: string): string | null {
  const configured = workdir.trim();
  if (configured === "") {
    return null;
  }
  if (configured.startsWith("~/")) {
    const home = process.env["HOME"];
    if (home === undefined || home === "") {
      return configured;
    }
    return `${home}/${configured.slice(2)}`;
  }
  return configured;
}

/** 前置校验：deployment 就绪复核 / 免密预检（SSH_AUTH_REQUIRED）+ 本地目录先验（exec.rs 同款） */
async function assertInteractiveRoute(connDeps: InteractiveDeps, route: ResolvedDispatchRoute): Promise<void> {
  if (route.deployment !== null) {
    if (connDeps.deploymentPrecheck !== undefined) {
      await connDeps.deploymentPrecheck(route);
      return;
    }
    if (connDeps.sshCheck !== undefined) {
      const check = await connDeps.sshCheck(route.deployment.target);
      if (!check.ok) {
        throw new PkyError(check.error.code, check.error.message, check.error.hint);
      }
    }
    return; // 远端目录交给远端 shell 报错（远程不本地预检）
  }
  const dir = localDispatchDir(route.workdir);
  if (dir !== null && !isDirectory(dir)) {
    throw new PkyError(
      "INVALID_ARGUMENT",
      `派发工作目录不存在: ${dir}（在标签的派发设置里改正；留空则用 agent 工作目录）`,
    );
  }
}

/**
 * 交互首行（终端注入 / 账本摘要共用）：dsh 类 agent 换 dst 前端（dstLaunch.ts——dsh 本体无
 * 交互旗标）；其余 = agent 命令 + 交互参数（清洗会话恢复开关）+ 会话旗标（claude/pi 预生成
 * `--session-id <uuid>`）+ prompt 首条输入整体引用。
 */
function launchLine(agent: AgentConfig, prompt: string, flags: readonly string[] = []): string {
  return isDshKind(agent.command)
    ? dstLaunchLine(prompt)
    : agentLine(agent.command, [...interactiveArgs(agent.historyArgs), ...flags], prompt);
}

/**
 * 交互启动的会话旗标（sessionFlags 单源，prevSession 恒空走预生成分支）：claude/pi 预生成
 * `--session-id <uuid>`——账本 session_id 落真实会话 id，回放精确 `--resume <id>`（外部终端/
 * ssh 窗口无句柄形态的回放解）；dsh 的 `--session-id` 是 adopt 语义不可预生成、其余 agent 无
 * 可靠续接 → 无旗标（回放走 picker 兜底）。
 */
function interactiveSessionFlags(agent: AgentConfig): { flags: string[]; preSession: string | null } {
  const { flags, preSession } = sessionFlags(kindForCommand(agent.command), null);
  return { flags: flags === "" ? [] : flags.split(" "), preSession };
}

/**
 * 注入成功：落 agent_sessions（kind=dispatch_interactive）。session_id 优先级 = 适配器句柄
 * （dsh 终端 pane / PTY——重派复用查询键）> 预生成会话 id（claude/pi）> NULL（picker 兜底）；
 * 预生成 id 同时回写 tasks.dispatched_session（后续无头轮次续接不断层——planHeadlessRun 同款）。
 */
function logInteractiveSession(
  conn: Conn,
  prep: DispatchPromptPrep,
  launched: { sessionRef?: string; note?: string },
  preSession: string | null,
  flags: readonly string[],
): number {
  const { agent, route } = prep;
  if (preSession !== null) {
    conn.prepare("UPDATE tasks SET dispatched_session=? WHERE id=?").run(preSession, prep.task.id);
  }
  return logAgentSession(
    conn,
    {
      taskId: prep.task.id,
      agentId: agent.id,
      kind: "dispatch_interactive",
      // claude 会话 id 预生成已知（interactiveSessionFlags）；适配器句柄在场则优先
      sessionId: launched.sessionRef ?? preSession ?? null,
      command: launchLine(agent, promptSummary(prep.prompt), flags),
      status: "ok",
      workdir: route.workdir,
      ...executionWorld(agent, route),
    },
    nowRfc3339(),
  );
}

/** claim 成功但唤起失败：迁移 failed（原因入审计 new_value，exec.rs 同款），错误上抛 */
function failInteractiveLaunch(conn: Conn, taskId: number, error: unknown): PkyError {
  const reason = String(error).slice(0, 200);
  try {
    dispatchTransition(conn, taskId, DS_FAILED, reason, "dsh:dispatch-interactive");
  } catch {
    // 迁移失败（并发已收口）保留原错误上抛
  }
  return new PkyError("DISPATCH_LAUNCH_FAILED", `终端注入失败：${reason}`, "确认 dsh 终端面板可用后重试");
}

/**
 * 交互派发（host 命令 dispatchInteractive）：取数 → 前置校验 → 原子 claim（重复派发
 * DISPATCH_ALREADY_ACTIVE）→ 命令行组装（interactive_args 清洗会话恢复开关 + prompt
 * 首条输入整体引用）→ 终端注入 → 落 agent_sessions → 状态保持 running 等回传。
 * 不解析终端输出（A15）。
 */
export async function dispatchInteractive(
  conn: Conn,
  deps: InteractiveDeps,
  taskId: number,
  opts: { routeOverride?: string } = {},
): Promise<InteractiveOutcome> {
  const prep = prepareDispatchPrompt(conn, taskId, opts.routeOverride);
  const { agent, route } = prep;
  await assertInteractiveRoute(deps, route);
  if (!claimDispatch(conn, taskId, { allowNull: true, states: [DS_DONE, DS_FAILED, "queued"] })) {
    throw new PkyError(
      "DISPATCH_ALREADY_ACTIVE",
      "该待办已在派发执行中（running）；等 agent 回传结束，或在抽屉里重置状态后重派",
    );
  }
  const { flags, preSession } = interactiveSessionFlags(agent);
  const line = launchLine(agent, prep.prompt, flags);
  try {
    const terminal = deps.terminalFor?.(route) ?? deps.terminal;
    const launched = await terminal.inject({
      line,
      agent,
      taskId,
      workdir: route.workdir === "" ? null : route.workdir,
      // 终端偏好随注入传递（desktop 外部终端按此解析；主应用 exec.rs 每次唤起前读 pref 同构）
      terminalPreference: getSetting(conn, "terminal_preference"),
    });
    const sessionRowId = logInteractiveSession(conn, prep, launched, preSession, flags);
    const note = [launched.note].filter((n): n is string => n !== undefined && n !== "").join("；");
    return {
      state: DS_RUNNING,
      terminal: launched.terminal,
      note: note === "" ? null : note,
      sessionRowId,
      line,
      ...(launched.reason === undefined ? {} : { reason: launched.reason }),
    };
  } catch (error) {
    throw failInteractiveLaunch(conn, taskId, error);
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export interface DispatchReportResult {
  state: string;
  /** true = 本次收口；false = 已收口（幂等反馈，不重复落账） */
  settled: boolean;
  sessionRowId: number | null;
}

/**
 * 派发回传处理（todo_dispatch_done/fail 工具语义 + 手动收口共用；A15）：
 * 状态机 CAS 收口（已收口径按成功反馈——transition_or_already 语义）+ 账本
 * （agent_sessions 落一条回传记录，status/exit_code 按 done/failed）。
 */
export function dispatchReport(
  conn: Conn,
  taskId: number,
  result: "done" | "failed",
  note?: string | null,
  origin = "dsh:dispatch-report",
): DispatchReportResult {
  const to = result === "done" ? DS_DONE : DS_FAILED;
  const task = getTask(conn, taskId);
  if (task.dispatchState === to) {
    return { state: to, settled: false, sessionRowId: null };
  }
  transitionOrAlready(conn, taskId, to, origin);
  const trimmed = note?.trim();
  const sessionRowId = logAgentSession(
    conn,
    {
      taskId,
      agentId: "",
      kind: "dispatch_interactive",
      command: trimmed === undefined || trimmed === "" ? `派发回传 ${result}` : trimmed.slice(0, 200),
      exitCode: result === "done" ? 0 : 1,
      status: result === "done" ? "ok" : "error",
    },
    nowRfc3339(),
  );
  return { state: to, settled: true, sessionRowId };
}

/** 无回传手动收口兜底——重置（救援卡死的 running；mark_dispatch "idle" 同构） */
export function dispatchReset(conn: Conn, taskId: number, origin = "dsh:dispatch", now = nowRfc3339()): void {
  markDispatchIdle(conn, taskId, origin, now);
}
