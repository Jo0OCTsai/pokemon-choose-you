/**
 * 就绪复核前置 + 远端装配缝（从 sshExecutor.ts 拆出——棘轮 max-lines，等量迁移；
 * sshExecutor.ts 为统一再出口，消费面不变）：HeadlessDeps / InteractiveDeps 注入件
 * （executorFor 路由 local/ssh/直连 + worktreeFor + terminalFor + 就绪复核前置）。
 */
import type { Conn } from "../storage/db";
import { PkyError } from "../storage/errors";
import { createLocalExecutor, type DispatchExecutor } from "../dispatch/executor";
import { remotePayloadLine, sshAliasLine } from "../dispatch/cmdline";
import type { HeadlessDeps } from "../dispatch/headless";
import type { TerminalAdapter } from "../dispatch/interactive";
import type { ResolvedDispatchRoute } from "../dispatch/routes";
import { sshCheck } from "../dispatch/sshCheck";
import { gitWorktree } from "../dispatch/worktree";
import type { AgentConfig } from "../domain/settings";
import type { DeploymentEntity } from "./deployments";
import { recheckDeployment } from "./recheck";
import {
  RemoteDispatchRejection,
  planRemoteRoute,
  type RemoteDispatchOptions,
  type RemoteDispatchPlatform,
  type RemoteRoutePlan,
} from "./sshExecutor";
import { createDirectSshExecutor, directSshRunner, scopeShellRunner } from "./sshExecutorDirect";
import { createSshDispatchExecutor } from "./sshExecutorScope";
import { createCopyLineTerminal, createRemoteTerminalAdapter } from "./sshExecutorTerminal";

// ---- 就绪复核前置（派发前即时检查——DEPLOYMENT_NOT_READY 语义 tag 前置拒绝） ----

/**
 * 派发前就绪复核（无头/交互共用，mode 分叉）：
 * - headless：家族链 = recheckDeployment 即时复核（连接活性 + helper 摘要，失败态同步
 *   落实体）；直连降级链 = 免密预检先行（复用既有 sshCheck）；路由计划拒绝（部署
 *   缺失 / 家族缺失未降级）与复核失败均前置抛 RemoteDispatchRejection。
 * - interactive：家族链同样即时复核（PTY 需要活连接）；家族缺失不拒绝（降级
 *   「复制完整命令行」承载——AD §4.7 交互分支）；直连降级免预检（copy-line 无通道消费）。
 */
export function createDeploymentPrecheck(
  conn: Conn,
  platform: RemoteDispatchPlatform,
  opts: { mode?: "headless" | "interactive" } = {},
): (route: ResolvedDispatchRoute) => Promise<void> {
  const interactive = opts.mode === "interactive";
  return async (route) => {
    if (route.deployment === null) {
      return;
    }
    const plan = planRemoteRoute(conn, route, platform);
    if (plan.kind === "reject") {
      if (interactive && plan.tag === "SSH_FAMILY_MISSING") {
        return; // 交互降级「复制完整命令行」（terminalFor 承载），不前置拒绝
      }
      throw new RemoteDispatchRejection(plan.tag, plan.message, plan.hint);
    }
    if (plan.kind === "local" || plan.kind === "direct") {
      await precheckDirectChain(plan.kind, route.deployment.target, platform, interactive);
      return; // local 分支不可达（deployment 路由守卫）；interactive 直连 = copy-line 免预检
    }
    await precheckFamilyChain(conn, plan.entity, platform);
  };
}

/** 直连降级链前置（headless = 免密预检先行；interactive = copy-line 免预检） */
async function precheckDirectChain(
  kind: "local" | "direct",
  target: string,
  platform: RemoteDispatchPlatform,
  interactive: boolean,
): Promise<void> {
  if (kind === "direct" && !interactive) {
    const check = await (platform.sshCheck ?? sshCheck)(target);
    if (!check.ok) {
      throw new PkyError(check.error.code, check.error.message, check.error.hint);
    }
  }
}

/** 家族链前置（recheckDeployment 即时复核——连接活性 + helper 摘要，失败态同步落实体） */
async function precheckFamilyChain(
  conn: Conn,
  entity: DeploymentEntity,
  platform: RemoteDispatchPlatform,
): Promise<void> {
  const outcome = await recheckDeployment(conn, entity.id, {
    scopeFor: platform.scopeFor,
    readHelperArtifact: platform.readHelperArtifact,
  });
  if (!outcome.ready) {
    throw new RemoteDispatchRejection(
      "DEPLOYMENT_NOT_READY",
      `部署「${entity.alias}」未就绪：${outcome.reason ?? "连接活性/helper 摘要复核未通过"}`,
      "可在设置的远程部署里重跑开通向导或手动重连（deploymentRecheck）后重试",
    );
  }
}

// ---- 装配缝（2.9 消费面：HeadlessDeps / InteractiveDeps 注入件） ----

/** 路由计划 → 执行器（local = 本机子进程；family/direct 远端两链；reject = null 交调用方收口） */
function executorForPlan(
  plan: RemoteRoutePlan,
  target: string,
  platform: RemoteDispatchPlatform,
  opts: RemoteDispatchOptions,
): DispatchExecutor | null {
  if (plan.kind === "local") {
    return createLocalExecutor(opts.minTimeoutSecs);
  }
  if (plan.kind === "reject") {
    return null;
  }
  if (plan.kind === "direct") {
    return createDirectSshExecutor({
      target,
      nodePath: plan.entity.nodePath,
      label: plan.entity.alias,
      ...(opts.minTimeoutSecs === undefined ? {} : { minTimeoutSecs: opts.minTimeoutSecs }),
      ...(opts.sshBin === undefined ? {} : { sshBin: opts.sshBin }),
      ...(opts.connectTimeoutSecs === undefined ? {} : { connectTimeoutSecs: opts.connectTimeoutSecs }),
    });
  }
  return createSshDispatchExecutor({
    scopeFor: () => platform.scopeFor(plan.entity),
    nodePath: plan.entity.nodePath,
    label: plan.entity.alias,
    ...(opts.minTimeoutSecs === undefined ? {} : { minTimeoutSecs: opts.minTimeoutSecs }),
  });
}

/** 无头派发远端装配（executorFor 路由 local/ssh/直连 + worktreeFor + 就绪复核前置） */
export function remoteHeadlessDeps(
  conn: Conn,
  platform: RemoteDispatchPlatform,
  opts: RemoteDispatchOptions = {},
): HeadlessDeps {
  return {
    executorFor: (_agent, route) => {
      const plan = planRemoteRoute(conn, route, platform);
      if (plan.kind === "local") {
        return createLocalExecutor();
      }
      if (route.deployment === null) {
        return null; // 前置复核应已拒绝；兜底走 providerMissing 收口（failed + 指引）
      }
      return executorForPlan(plan, route.deployment.target, platform, opts);
    },
    worktreeFor: (route) => {
      const plan = planRemoteRoute(conn, route, platform);
      if (plan.kind === "family") {
        return gitWorktree(scopeShellRunner(() => platform.scopeFor(plan.entity)));
      }
      if (plan.kind === "direct" && route.deployment !== null) {
        return gitWorktree(
          directSshRunner(route.deployment.target, {
            ...(opts.sshBin === undefined ? {} : { sshBin: opts.sshBin }),
            ...(opts.connectTimeoutSecs === undefined ? {} : { connectTimeoutSecs: opts.connectTimeoutSecs }),
          }),
        );
      }
      return undefined; // 本机路由回落装配层既有 worktree 缺省链
    },
    deploymentPrecheck: createDeploymentPrecheck(conn, platform),
  };
}

/**
 * 判定远端执行面工厂（cliJudgeExecutor.remoteExecutorFor 注入件；desktop judge.rs
 * resolve_remote_target 同构）：agent 绑定部署 → 以绑定合成最小路由（ref = target = alias）
 * 经 planRemoteRoute 选型 family/direct；reject 分支抛 PkyError（PROTOCOL §2 映射与
 * envelope 同款：SSH_FAMILY_MISSING → HELPER_CAPABILITY_MISSING，其余 DEPLOYMENT_NOT_READY）
 * ——判定不回落本机（执行世界与账本必须一致）。**工作目录随执行世界**：随执行器返回部署
 * 实体登记的 workdir（cliJudgeExecutor 以其压过 agent.workdir——本机路径语义在远端展开成
 * 远端 home 子目录或不存在；实体未登记返回空串由调用方回落 agent.workdir）。未绑定部署 →
 * null（调用方本机路径）。minTimeoutSecs 由调用方按判定口径传入（派发缺省 600 对判定过长）。
 */
export function remoteJudgeExecutorFor(
  conn: Conn,
  platform: RemoteDispatchPlatform,
  opts: RemoteDispatchOptions = {},
): (agent: AgentConfig) => { executor: DispatchExecutor; workdir: string } | null {
  return (agent) => {
    const alias = agent.deployment?.trim() ?? "";
    if (alias === "") {
      return null;
    }
    const plan = planRemoteRoute(conn, { deployment: { ref: alias, target: alias } }, platform);
    if (plan.kind === "reject") {
      const code = plan.tag === "SSH_FAMILY_MISSING" ? "HELPER_CAPABILITY_MISSING" : "DEPLOYMENT_NOT_READY";
      throw new PkyError(code, `判定无法在部署上执行：${plan.message}`, plan.hint);
    }
    const executor = executorForPlan(plan, alias, platform, opts);
    if (executor === null || plan.kind === "local") {
      return executor === null ? null : { executor, workdir: "" };
    }
    return { executor, workdir: plan.entity.workdir.trim() };
  };
}

/** 交互派发远端装配件（terminalFor 远端分支 + 就绪复核前置） */
export interface RemoteInteractiveParts {
  /** InteractiveDeps.terminalFor 注入件（undefined = 回落本机 terminal） */
  terminalFor(route: ResolvedDispatchRoute): TerminalAdapter | undefined;
  /** InteractiveDeps.deploymentPrecheck 注入件（与无头共用单源） */
  deploymentPrecheck(route: ResolvedDispatchRoute): Promise<void>;
}

/**
 * 部署路由 → 本机 GUI 终端弹 ssh 别名窗口（desktop exec.rs 远端分支同构：ssh -tt <别名>
 * 在用户面前的终端执行）：载荷自携 cd 段（远端目录），本机侧 workdir 传 null；无 sessionRef
 * ——每次新远端 shell，重派不复用会话（tmux 续接形态见 docs/debt.md）。弹窗失败/无终端由
 * 本机适配器自行回落 copy-line（note 携带完整 ssh 行）。
 */
function createSshWindowTerminal(local: TerminalAdapter, target: string): TerminalAdapter {
  return {
    async inject({ line, agent, taskId, workdir, terminalPreference }) {
      const launched = await local.inject({
        line: sshAliasLine(target, remotePayloadLine(line, workdir)),
        agent,
        taskId,
        workdir: null,
        terminalPreference,
      });
      // 本机终端的句柄不是远端 agent 会话 id——不落 session_id（回放按无句柄处理）
      return {
        terminal: launched.terminal,
        ...(launched.note === undefined ? {} : { note: launched.note }),
        ...(launched.reason === undefined ? {} : { reason: launched.reason }),
      };
    },
  };
}

/**
 * 交互远端装配：本机 GUI 终端在场（localSshWindow 注入）→ 部署路由一律弹 ssh 别名窗口
 * （不经 dsh-ssh PTY——无 UI 面用户看不见）；缺席 → 家族链 = 真 PTY 适配器；直连降级/
 * 家族缺失 = 复制完整命令行兜底
 */
export function remoteInteractiveParts(
  conn: Conn,
  platform: RemoteDispatchPlatform,
  opts: { localSshWindow?: TerminalAdapter } = {},
): RemoteInteractiveParts {
  return {
    terminalFor: (route) => {
      if (route.deployment === null) {
        return undefined; // 本机路由回落 InteractiveDeps.terminal
      }
      if (opts.localSshWindow !== undefined) {
        return createSshWindowTerminal(opts.localSshWindow, route.deployment.target);
      }
      const plan = planRemoteRoute(conn, route, platform);
      if (plan.kind === "family") {
        return createRemoteTerminalAdapter({
          conn,
          scopeFor: () => platform.scopeFor(plan.entity),
          entity: plan.entity,
          target: route.deployment.target,
        });
      }
      if (plan.kind === "direct") {
        return createCopyLineTerminal("部署为降级直连，无 dsh-ssh 终端通道", route.deployment.target);
      }
      return createCopyLineTerminal("dsh-ssh 家族未装载", route.deployment.target);
    },
    deploymentPrecheck: createDeploymentPrecheck(conn, platform, { mode: "interactive" }),
  };
}
