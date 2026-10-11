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
import type { AgentConfig } from "../domain/settings";
import { getTask } from "../domain/tasks";
import { agentLine, interactiveArgs, summarizeLine } from "./cmdline";
import { prepareDispatchPrompt, type DispatchPromptPrep } from "./prompt";
import type { ResolvedDispatchRoute } from "./routes";
import { logAgentSession, remoteSnapshot } from "./sessions";
import type { SshCheckOutcome } from "./sshCheck";

/**
 * 终端面板适配器（真实 dsh 终端面板后续装配）：注入一行命令到目标终端，返回
 * 终端标识（呈现用）与可选会话/执行标识（落 agent_sessions.session_id——dsh 终端
 * pane/会话 id，交互回放路由用）。不解析终端输出（A15）。
 */
export interface TerminalAdapter {
  inject(input: {
    line: string;
    agent: AgentConfig;
    taskId: number;
    workdir: string | null;
  }): Promise<{ terminal: string; sessionRef?: string; note?: string }>;
}

/** fake 终端适配器（测试）：记录注入行，可编程结果 */
export interface FakeTerminal extends TerminalAdapter {
  readonly injections: Array<{ line: string; taskId: number; workdir: string | null; agentId: string }>;
  /** 下一次 inject 抛错（驱动唤起失败路径）；传 null 清除 */
  failNext(message: string | null): void;
}

export function createFakeTerminal(): FakeTerminal {
  const injections: FakeTerminal["injections"] = [];
  const state = { failMessage: null as string | null };
  return {
    injections,
    failNext(message) {
      state.failMessage = message;
    },
    async inject(input) {
      injections.push({ line: input.line, taskId: input.taskId, workdir: input.workdir, agentId: input.agent.id });
      if (state.failMessage !== null) {
        const message = state.failMessage;
        state.failMessage = null;
        throw new Error(message);
      }
      return { terminal: "fake-terminal", sessionRef: `pane-${input.taskId}` };
    },
  };
}

export interface InteractiveDeps {
  terminal: TerminalAdapter;
  /** deployment 路由免密预检（真实 ssh / 测试注入） */
  sshCheck?(target: string): Promise<SshCheckOutcome>;
}

export interface InteractiveOutcome {
  state: string;
  terminal: string;
  note: string | null;
  /** agent_sessions 行 id */
  sessionRowId: number;
  /** 注入的命令行（呈现/审计） */
  line: string;
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

/** 前置校验：deployment 免密预检（SSH_AUTH_REQUIRED）+ 本地目录先验（exec.rs 同款） */
async function assertInteractiveRoute(connDeps: InteractiveDeps, route: ResolvedDispatchRoute): Promise<void> {
  if (route.deployment !== null) {
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

/** 注入成功：落 agent_sessions（kind=dispatch_interactive，session_id=终端会话标识） */
function logInteractiveSession(
  conn: Conn,
  prep: DispatchPromptPrep,
  launched: { sessionRef?: string; note?: string },
): number {
  const { agent, route } = prep;
  return logAgentSession(
    conn,
    {
      taskId: prep.task.id,
      agentId: agent.id,
      kind: "dispatch_interactive",
      // claude 会话 id 启动时不可知：session_id 落 dsh 终端的会话/执行标识（回放路由用）
      sessionId: launched.sessionRef ?? null,
      command: summarizeLine(agent.command, interactiveArgs(agent.historyArgs), prep.prompt),
      status: "ok",
      workdir: route.workdir,
      ...remoteSnapshot(agent),
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
  const line = agentLine(agent.command, interactiveArgs(agent.historyArgs), prep.prompt);
  try {
    const launched = await deps.terminal.inject({
      line,
      agent,
      taskId,
      workdir: route.workdir === "" ? null : route.workdir,
    });
    const sessionRowId = logInteractiveSession(conn, prep, launched);
    const note = [launched.note].filter((n): n is string => n !== undefined && n !== "").join("；");
    return { state: DS_RUNNING, terminal: launched.terminal, note: note === "" ? null : note, sessionRowId, line };
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
