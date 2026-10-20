/**
 * 无头执行核心（dispatchHeadless / runQueuedHeadless 两入口共用）：worktree 策略 →
 * 续接旗标 → 执行 → 回传落库（agent_sessions + 状态机收口 + 删槽）。异常封闭：claim
 * 之后的任何抛错都转为 failed 收口 + 删槽，不泄漏 running 态与租约行
 * （run_headless_dispatch「不再向上抛执行错误」同语义）。
 */
import { DS_DONE, DS_FAILED, transitionOrAlready } from "../domain/dispatch";
import { releaseSlot } from "../domain/dispatch-slots";
import type { Conn } from "../storage/db";
import type { DispatchPromptPrep } from "./prompt";
import {
  createLocalExecutor,
  effectiveTimeoutSecs,
  parseHeadlessEnvelope,
  type DispatchExecutor,
  type ExecOutcome,
} from "./executor";
import { dispatchArgs, summarizeLine } from "./cmdline";
import { dshJsonFlag, parseDshSessionId } from "./dshSession";
import { executionWorld, kindForCommand, logAgentSession, sessionFlags } from "./sessions";
import { noOpWorktree } from "./worktree";
import type { AgentConfig } from "../domain/settings";
import type { ResolvedDispatchRoute } from "./routes";
import type { HeadlessDeps, HeadlessOutcome } from "./headless";

/** 收口迁移失败不阻断（Rust log::warn 同语义——并发已收口按幂等处理） */
function safeTransition(conn: Conn, taskId: number, to: string, origin: string): void {
  try {
    transitionOrAlready(conn, taskId, to, origin);
  } catch {
    // 第三态冲突：另一形态已收口——槽已删、账已落，不重复处理
  }
}

/** 执行前准备产物（worktree 生效目录 + 续接旗标 + 命令面） */
interface HeadlessPlan {
  effectiveDir: string;
  args: string;
  summary: string;
  preSession: string | null;
  wtNote: string | null;
  remote: ReturnType<typeof executionWorld>;
}

/** worktree 预备（配置驱动：route.worktree 开 + workdir 非空才隔离；否则原目录）。
 * worktreeFor（远端路由经 SSH runner 执行同款脚本）优先，回落既有 worktree 缺省链。 */
async function ensureWorktreeDir(
  deps: HeadlessDeps,
  prep: DispatchPromptPrep,
): Promise<{ dir: string | null; note: string | null }> {
  if (!prep.route.worktree || prep.route.workdir.trim() === "") {
    return { dir: null, note: null };
  }
  const strategy = deps.worktreeFor?.(prep.route) ?? deps.worktree ?? noOpWorktree();
  return strategy.ensure({ workdir: prep.route.workdir, taskId: prep.task.id });
}

/** worktree 策略 + 续接旗标 + 预生成会话落库（进程被杀也留续接线索）；dsh kind 补 `--json`（会话 id 捕获通道） */
async function planHeadlessRun(conn: Conn, deps: HeadlessDeps, prep: DispatchPromptPrep): Promise<HeadlessPlan> {
  const { agent, route } = prep;
  const wt = await ensureWorktreeDir(deps, prep);
  const kind = kindForCommand(agent.command);
  const { flags, preSession } = sessionFlags(kind, prep.prevSession);
  const args = [dispatchArgs(agent.args), flags, dshJsonFlag(kind, agent.args)].filter((s) => s !== "").join(" ");
  if (preSession !== null) {
    conn.prepare("UPDATE tasks SET dispatched_session=? WHERE id=?").run(preSession, prep.task.id);
  }
  return {
    effectiveDir: wt.dir ?? route.workdir,
    args,
    summary: `无头派发 · ${summarizeLine(
      agent.command,
      args.split(/\s+/).filter((t) => t !== ""),
      prep.prompt,
    )}`,
    preSession,
    wtNote: wt.note,
    remote: executionWorld(agent, route),
  };
}

/** 生效会话 id 落库（信封回填 > dsh 事件流捕获 > 预生成 > 上一轮；null 不动共享列） */
function rememberSession(conn: Conn, prep: DispatchPromptPrep, sessionId: string | null): string | null {
  if (sessionId !== null) {
    conn.prepare("UPDATE tasks SET dispatched_session=? WHERE id=?").run(sessionId, prep.task.id);
  }
  return sessionId;
}

/** 执行成败判定（超时 / 执行错误 / 非零退出码 / 信封 is_error） */
function runFailed(outcome: ExecOutcome, envelope: { isError: boolean }): boolean {
  return outcome.timedOut || outcome.error !== undefined || outcome.exitCode !== 0 || envelope.isError;
}

/** 退出码落账值（超时被杀 / spawn 失败拿不到 → null，对齐 Rust 失败路径） */
function exitCodeOf(outcome: ExecOutcome): number | null {
  return outcome.timedOut || outcome.error !== undefined ? null : outcome.exitCode;
}

/** 执行结果 → 状态/原因/账本行（信封回填 dispatched_session + 收口 + 删槽） */
async function settleHeadlessRun(
  conn: Conn,
  prep: DispatchPromptPrep,
  plan: HeadlessPlan,
  outcome: ExecOutcome,
  hostKey: string,
): Promise<HeadlessOutcome> {
  const { agent } = prep;
  const envelope = parseHeadlessEnvelope(outcome.stdout);
  const sessionId = rememberSession(
    conn,
    prep,
    envelope.sessionId ?? parseDshSessionId(outcome.stdout) ?? plan.preSession ?? prep.prevSession,
  );
  const failed = runFailed(outcome, envelope);
  const state = failed ? DS_FAILED : DS_DONE;
  const sessionRowId = logAgentSession(conn, {
    taskId: prep.task.id,
    agentId: agent.id,
    kind: "dispatch_headless",
    sessionId,
    command: plan.summary,
    exitCode: exitCodeOf(outcome),
    status: failed ? "error" : "ok",
    durationMs: outcome.durationMs,
    costUsd: envelope.costUsd,
    inputTokens: envelope.inputTokens,
    outputTokens: envelope.outputTokens,
    workdir: plan.effectiveDir,
    ...plan.remote,
  });
  safeTransition(conn, prep.task.id, state, "dsh:dispatch-headless");
  releaseSlot(conn, hostKey, prep.task.id);
  return {
    state,
    note: headlessNote(outcome, envelope, plan, effectiveTimeoutSecs(agent.timeoutSecs)),
    sessionId,
    sessionRowId,
    ...(outcome.timedOut ? { code: "DISPATCH_TIMEOUT" as const } : {}),
  };
}

/** 失败/降级原因文案（超时 / 执行错误 / 信封 is_error / worktree note） */
function headlessNote(
  outcome: ExecOutcome,
  envelope: { isError: boolean },
  plan: HeadlessPlan,
  timeoutSecs: number,
): string | null {
  if (outcome.timedOut) {
    return `无头执行超时（上限 ${timeoutSecs} 秒，DISPATCH_TIMEOUT）`;
  }
  if (outcome.error !== undefined) {
    return outcome.error.slice(0, 200);
  }
  if (envelope.isError) {
    return "agent 信封标记 is_error（处理失败）";
  }
  return plan.wtNote;
}

/** 缺省执行器工厂：local 子进程；deployment（远端执行世界）等真实 dsh SSH provider 装配 */
function defaultExecutorFor(agent: AgentConfig, route: ResolvedDispatchRoute): DispatchExecutor | null {
  void agent;
  return route.deployment === null ? createLocalExecutor() : null;
}

/** 执行 + 回传落库核心（两个入口共用；调用方已 claim running 并持有槽）。
 * 异常封闭：claim 之后的任何抛错（worktree/执行器故障）都转为 failed 收口 + 删槽，
 * 不泄漏 running 态与租约行（run_headless_dispatch「不再向上抛执行错误」同语义）。 */
export async function executeAndSettle(
  conn: Conn,
  deps: HeadlessDeps,
  prep: DispatchPromptPrep,
  hostKey: string,
): Promise<HeadlessOutcome> {
  try {
    const plan = await planHeadlessRun(conn, deps, prep);
    const executor = (deps.executorFor ?? defaultExecutorFor)(prep.agent, prep.route);
    if (executor === null) {
      return providerMissingOutcome(conn, prep, plan, hostKey);
    }
    const outcome = await executor.launch({
      command: prep.agent.command,
      args: plan.args,
      prompt: prep.prompt,
      workdir: plan.effectiveDir,
      timeoutSecs: prep.agent.timeoutSecs,
      // 凭据注入在 job 构造点单源生效：local（childEnvFor extra）与远端（script env 段）同吃
      env: { PK_DISPATCH_TASK: String(prep.task.id), ...((await deps.agentEnv?.(prep.agent.command)) ?? {}) },
    });
    return await settleHeadlessRun(conn, prep, plan, outcome, hostKey);
  } catch (error) {
    return containedFailure(conn, prep, hostKey, error);
  }
}

/** deployment 路由但执行 provider 未装配：failed + 指引 note（不进执行） */
function providerMissingOutcome(
  conn: Conn,
  prep: DispatchPromptPrep,
  plan: HeadlessPlan,
  hostKey: string,
): HeadlessOutcome {
  const note = `远端执行 provider 未装配（deployment ${prep.route.deployment?.ref ?? ""}）——真实 dsh SSH provider 装配后可用`;
  const sessionRowId = logAgentSession(conn, {
    taskId: prep.task.id,
    agentId: prep.agent.id,
    kind: "dispatch_headless",
    command: plan.summary,
    status: "error",
    workdir: plan.effectiveDir,
    ...executionWorld(prep.agent, prep.route),
  });
  safeTransition(conn, prep.task.id, DS_FAILED, "dsh:dispatch-headless");
  releaseSlot(conn, hostKey, prep.task.id);
  return { state: DS_FAILED, note, sessionId: prep.prevSession, sessionRowId, code: "DISPATCH_LAUNCH_FAILED" };
}

/** claim 后异常的封闭收口：error 账本行 + failed 迁移 + 删槽（不泄漏租约） */
function containedFailure(conn: Conn, prep: DispatchPromptPrep, hostKey: string, error: unknown): HeadlessOutcome {
  const reason = String(error).slice(0, 200);
  let sessionRowId = 0;
  try {
    sessionRowId = logAgentSession(conn, {
      taskId: prep.task.id,
      agentId: prep.agent.id,
      kind: "dispatch_headless",
      command: `无头派发 · ${prep.agent.command}`,
      status: "error",
      ...executionWorld(prep.agent, prep.route),
    });
    safeTransition(conn, prep.task.id, DS_FAILED, "dsh:dispatch-headless");
  } catch {
    // 落库自身故障：保留原始异常语义（槽仍尽力释放）
  }
  releaseSlot(conn, hostKey, prep.task.id);
  return { state: DS_FAILED, note: reason, sessionId: prep.prevSession, sessionRowId, code: "DISPATCH_LAUNCH_FAILED" };
}
