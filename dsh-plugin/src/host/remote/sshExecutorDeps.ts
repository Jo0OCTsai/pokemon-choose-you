/**
 * 就绪复核前置 + 远端装配缝（从 sshExecutor.ts 拆出——棘轮 max-lines，等量迁移；
 * sshExecutor.ts 为统一再出口，消费面不变）：HeadlessDeps / InteractiveDeps 注入件
 * （executorFor 路由 local/ssh/直连 + worktreeFor + terminalFor + 就绪复核前置）。
 */
import type { Conn } from "../storage/db";
import { PkyError } from "../storage/errors";
import { createLocalExecutor } from "../dispatch/executor";
import type { HeadlessDeps } from "../dispatch/headless";
import type { TerminalAdapter } from "../dispatch/interactive";
import type { ResolvedDispatchRoute } from "../dispatch/routes";
import { sshCheck } from "../dispatch/sshCheck";
import { gitWorktree } from "../dispatch/worktree";
import type { DeploymentEntity } from "./deployments";
import { recheckDeployment } from "./recheck";
import {
  RemoteDispatchRejection,
  planRemoteRoute,
  type RemoteDispatchOptions,
  type RemoteDispatchPlatform,
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
      if (plan.kind === "reject" || route.deployment === null) {
        return null; // 前置复核应已拒绝；兜底走 providerMissing 收口（failed + 指引）
      }
      if (plan.kind === "direct") {
        return createDirectSshExecutor({
          target: route.deployment.target,
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

/** 交互派发远端装配件（terminalFor 远端分支 + 就绪复核前置） */
export interface RemoteInteractiveParts {
  /** InteractiveDeps.terminalFor 注入件（undefined = 回落本机 terminal） */
  terminalFor(route: ResolvedDispatchRoute): TerminalAdapter | undefined;
  /** InteractiveDeps.deploymentPrecheck 注入件（与无头共用单源） */
  deploymentPrecheck(route: ResolvedDispatchRoute): Promise<void>;
}

/** 交互远端装配：家族链 = 真 PTY 适配器；直连降级/家族缺失 = 复制完整命令行兜底 */
export function remoteInteractiveParts(conn: Conn, platform: RemoteDispatchPlatform): RemoteInteractiveParts {
  return {
    terminalFor: (route) => {
      if (route.deployment === null) {
        return undefined; // 本机路由回落 InteractiveDeps.terminal
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
