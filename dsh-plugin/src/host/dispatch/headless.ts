/**
 * 无头派发编排（AD §4.5 无头派发序列图）：路由解析 → 槽获取（domain 原语：
 * COUNT 上限 + claim + INSERT 同事务）→ worktree 策略 → 执行 → 回传落库
 * （agent_sessions kind=dispatch_headless + 状态机收口 done/failed + 删槽）→
 * 超时置失败记原因（DISPATCH_TIMEOUT）。
 *
 * 行为基准 = src-tauri/src/commands/dispatch/headless.rs（session_flags / 信封解析 /
 * ensure_worktree / run_headless_dispatch）+ exec.rs（claim 口径）+ auto.rs（槽闸门）。
 * 会话续接 A14 双路径：subagent 适配（attach-or-create 经执行器接口承载，真实 dsh
 * subagent 桥后续装配）/外部 CLI（session_flags：claude --resume / pi --session-id
 * 预生成 uuid；tasks.dispatched_session 共享列，运行时不匹配则新会话）。
 * 会话落账原语见 sessions.ts（sessions.rs 对应物）；执行核心见 headlessRun.ts。
 */
import { nowRfc3339, txImmediate, type Conn } from "../storage/db";
import { PkyError } from "../storage/errors";
import { claimDispatch, dispatchTransition, DS_DONE, DS_FAILED } from "../domain/dispatch";
import { acquireSlot, releaseSlot, slotLeaseSecs } from "../domain/dispatch-slots";
import type { AgentConfig } from "../domain/settings";
import { resolveDispatchRoute, type ResolvedDispatchRoute } from "./routes";
import { prepareDispatchPrompt, type DispatchPromptPrep } from "./prompt";
import type { DispatchExecutor } from "./executor";
import type { SshCheckOutcome } from "./sshCheck";
import type { WorktreeStrategy } from "./worktree";
import { executeAndSettle } from "./headlessRun";

// ---- 无头编排 ----

/** 无头编排依赖（全部可注入：执行器 / worktree / ssh 预检——零 dsh 依赖约束） */
export interface HeadlessDeps {
  /** 按路由构造执行器：local 子进程 / subagent 适配 / SSH provider（null = 该路由不可执行） */
  executorFor?(agent: AgentConfig, route: ResolvedDispatchRoute): DispatchExecutor | null;
  worktree?: WorktreeStrategy;
  /** 按路由取 worktree 策略（远端路由经 SSH runner 跑同款脚本；undefined = 回落 worktree 缺省链） */
  worktreeFor?(route: ResolvedDispatchRoute): WorktreeStrategy | undefined;
  /** deployment 路由的免密预检（缺省不做——真实 dsh SSH provider 装配时注入） */
  sshCheck?(target: string): Promise<SshCheckOutcome>;
  /**
   * 派发前部署就绪复核（deployment 路由统一前置，remote/sshExecutor 装配面注入）：
   * 家族链 = recheckDeployment 即时复核；直连降级链 = 免密预检先行。失败前置拒绝
   * （不发派发执行 SSH、不占槽）——抛 RemoteDispatchRejection（tag 机器稳定，
   * 命令层 2.9 映射 PROTOCOL §2 错误码）。注入本钩子后 sshCheck 不再重复执行。
   */
  deploymentPrecheck?(route: ResolvedDispatchRoute): Promise<void>;
}

/** 无头执行结果（失败不抛错：状态 + 原因 + 会话行，调用方按 state 呈现——HeadlessOutcome 同构） */
export interface HeadlessOutcome {
  state: string;
  note: string | null;
  /** 生效会话 id（信封回填 > 预生成 > 上一轮） */
  sessionId: string | null;
  /** agent_sessions 行 id（落账证据） */
  sessionRowId: number;
  /** 启动/执行失败错误码（host 命令层映射：超时 DISPATCH_TIMEOUT / 启动失败 DISPATCH_LAUNCH_FAILED） */
  code?: "DISPATCH_TIMEOUT" | "DISPATCH_LAUNCH_FAILED";
}

/** 手动通道的「领取 + 占槽」原子组合（exec.rs claim 口径 + 槽闸门，单条 BEGIN IMMEDIATE） */
function claimManualWithSlot(
  conn: Conn,
  opts: { taskId: number; hostKey: string; maxConcurrent: number; leaseSecs: number },
): void {
  txImmediate(conn, () => {
    const used = conn.prepare("SELECT COUNT(*) AS n FROM dispatch_slots WHERE host_key=?").get(opts.hostKey) as {
      n: number;
    };
    if (used.n >= opts.maxConcurrent) {
      throw new PkyError(
        "DISPATCH_LAUNCH_FAILED",
        `机器并发槽已满（${opts.hostKey} 上限 ${opts.maxConcurrent}）`,
        "等在途派发收口，或在设置里调大并发上限",
      );
    }
    if (!claimDispatch(conn, opts.taskId, { allowNull: true, states: [DS_DONE, DS_FAILED, "queued"] })) {
      throw new PkyError(
        "DISPATCH_ALREADY_ACTIVE",
        "该待办已在派发执行中（running）；等 agent 回传结束，或在抽屉里重置状态后重派",
      );
    }
    const now = new Date();
    const leaseExpires = nowRfc3339(new Date(now.getTime() + opts.leaseSecs * 1000));
    conn
      .prepare(
        "INSERT INTO dispatch_slots (host_key, task_id, owner, acquired_at, lease_expires_at) VALUES (?, ?, 'dsh', ?, ?)",
      )
      .run(opts.hostKey, opts.taskId, nowRfc3339(now), leaseExpires);
  });
}

/** deployment 路由前置（claim 前）：统一就绪复核优先（远端分支内含免密预检），回落既有 sshCheck */
async function preflightDeployment(connDeps: HeadlessDeps, route: ResolvedDispatchRoute): Promise<void> {
  if (route.deployment === null) {
    return;
  }
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
}

/**
 * 手动无头派发（host 命令 dispatchHeadless）：取数 →（部署前置：就绪复核 / 免密预检
 * SSH_AUTH_REQUIRED）→ 领取 + 占槽（原子；重复派发 DISPATCH_ALREADY_ACTIVE、槽满
 * DISPATCH_LAUNCH_FAILED）→ 执行收口。
 * 与 Rust 差异（有意）：主应用手动无头不占槽（用户发起），dsh 形态无头一律占机器槽
 * ——无人值守执行与自动派发同一并发口径（AD §4.5 槽表跨形态合计语义）。
 */
export async function dispatchHeadless(
  conn: Conn,
  deps: HeadlessDeps,
  taskId: number,
  opts: { routeOverride?: string } = {},
): Promise<HeadlessOutcome> {
  const prep = prepareDispatchPrompt(conn, taskId, opts.routeOverride);
  await preflightDeployment(deps, prep.route);
  claimManualWithSlot(conn, {
    taskId,
    hostKey: prep.route.hostKey,
    maxConcurrent: prep.route.maxConcurrent,
    leaseSecs: slotLeaseSecs(prep.agent.timeoutSecs),
  });
  return executeAndSettle(conn, deps, prep, prep.route.hostKey);
}

/** 排队任务的无头执行（自动派发循环逐个调用）：acquireSlot 原语（COUNT+claim+INSERT 同事务） */
export async function runQueuedHeadless(
  conn: Conn,
  deps: HeadlessDeps,
  taskId: number,
): Promise<{ started: false } | { started: true; outcome: HeadlessOutcome }> {
  const route = resolveDispatchRoute(conn, taskId);
  if (route.deployment !== null && deps.deploymentPrecheck !== undefined) {
    try {
      await deps.deploymentPrecheck(route);
    } catch {
      // 部署未就绪/家族缺失：不领取不占槽，保持 queued 下轮再试（不自动重放远端操作）
      return { started: false };
    }
  }
  const acquired = acquireSlot(conn, {
    taskId,
    hostKey: route.hostKey,
    maxConcurrent: route.maxConcurrent,
    leaseSecs: slotLeaseSecs(route.agent.timeoutSecs),
  });
  if (!acquired) {
    // 槽满 / 已被领取：保持 queued，下轮再试（槽满等待）
    return { started: false };
  }
  let prep: DispatchPromptPrep;
  try {
    prep = prepareDispatchPrompt(conn, taskId);
  } catch (error) {
    // 领取后准备失败：迁移 failed + 删槽（dispatch_tick 同款），原因入审计
    return { started: true, outcome: queuedPrepFailure(conn, taskId, route.hostKey, error) };
  }
  return { started: true, outcome: await executeAndSettle(conn, deps, prep, route.hostKey) };
}

/** 排队领取后的准备失败收口（failed + 原因入审计 + 删槽） */
function queuedPrepFailure(conn: Conn, taskId: number, hostKey: string, error: unknown): HeadlessOutcome {
  const reason = String(error).slice(0, 200);
  dispatchTransition(conn, taskId, DS_FAILED, reason, "dsh:dispatch-auto");
  releaseSlot(conn, hostKey, taskId);
  return { state: DS_FAILED, note: reason, sessionId: null, sessionRowId: 0, code: "DISPATCH_LAUNCH_FAILED" };
}
