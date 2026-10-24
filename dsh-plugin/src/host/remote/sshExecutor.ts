/**
 * dispatch 远端接线（AD §3.2/§4.7 / 任务 2.8）：DispatchExecutor 的远端实现
 * （SshScope 家族链 + 直连降级链）、ShellRunner 远端实现（worktree 脚本远端跑）、
 * 交互 TerminalAdapter 远端分支（spawnTerminal 真 PTY + 同上下文重派注入 + 关闭
 * 兜底新开）、断连收口 guard 与 recheck 恢复时的迟到回传挂接。
 *
 * 本文件零 dsh import（SshScope / 家族 capability 探测 / 免密预检全部经注入，
 * RemoteDispatchPlatform 即装配缝——真实实现归 dsh/sshScope.ts + probeDsh.ts，
 * 装配归任务 2.9）。事务边界（AD §5.4）：远端执行不持库事务（事务外编排），
 * 回传/断连失败路径单条 BEGIN IMMEDIATE 收口；事务内零 SSH 调用。
 *
 * 错误 tag 机器稳定：DEPLOYMENT_NOT_READY / SSH_FAMILY_MISSING 本地 tag
 * （RemoteDispatchRejection），PROTOCOL §2 的错误码映射归任务 2.9，本模块不触碰。
 *
 * 实现按职责拆件（棘轮 max-lines，等量迁移）：家族链执行 = sshExecutorScope.ts、
 * 直连降级链 + ShellRunner = sshExecutorDirect.ts、交互终端 = sshExecutorTerminal.ts、
 * 装配缝 = sshExecutorDeps.ts、断连收口 + 迟到回传 = sshExecutorGuard.ts；
 * 本文件为统一再出口（消费面不变）。
 */
import type { Conn } from "../storage/db";
import type { ResolvedDispatchRoute } from "../dispatch/routes";
import type { SshCheckOutcome } from "../dispatch/sshCheck";
import { deploymentByAlias, type DeploymentEntity } from "./deployments";
import type { SshScope } from "./sshScope";

// ---- 注入面（装配缝——2.9 消费） ----

/**
 * SshScope + 终端扩充面（交互派发消费）：dsh/sshScope.ts 的具体类结构满足本接口
 * （writeTerminal/terminateTerminal 为接口外扩充面）；测试 fake 同形。
 */
export interface SshTerminalScope extends SshScope {
  /** 向已登记终端写入（同上下文重派注入；会话未知/已收口 = false） */
  writeTerminal(sessionId: string, data: string): Promise<boolean>;
  /** 关闭已登记终端（兜底收口；会话未知/已收口 = false） */
  terminateTerminal(sessionId: string): Promise<boolean>;
}

/** 远端派发装配依赖（平台面经注入——本目录零 dsh import） */
export interface RemoteDispatchPlatform {
  /** 按部署取/建 SshScope（家族链装配 = SshScopeHost.scopeFor；null = 连接不可用） */
  scopeFor(entity: DeploymentEntity): Promise<SshTerminalScope | null>;
  /** 本地 helper 制品权威摘要（recheck 即时复核基准，与 provision 步④ 同源） */
  readHelperArtifact(): { sha256: string };
  /** dsh-ssh 家族 capability 探测回调（false = 家族缺失 → 降级链判定） */
  sshFamilyAvailable(): boolean;
  /** 直连降级免密预检（缺省系统 sshCheck；测试注入 fake） */
  sshCheck?(target: string): Promise<SshCheckOutcome>;
  /** 时钟注入（断连窗口记账；缺省 nowRfc3339） */
  now?(): string;
}

/** 远端装配可调项（测试缩短超时 / fake ssh 二进制；生产缺省全走既有口径） */
export interface RemoteDispatchOptions {
  /** 无头超时下限（秒；缺省 600 既有口径——测试缩短等待用） */
  minTimeoutSecs?: number;
  /** 直连降级链的 ssh 二进制（缺省系统 ssh；测试 fake 脚本） */
  sshBin?: string;
  /** 直连降级链建连超时（秒） */
  connectTimeoutSecs?: number;
}

// ---- 前置拒绝（tag 机器稳定；命令层 2.9 映射错误码） ----

/** 前置拒绝 tag（本地 tag——PROTOCOL §2 映射归 2.9，勿在此定义错误码） */
export type RemoteDispatchRejectTag = "DEPLOYMENT_NOT_READY" | "SSH_FAMILY_MISSING";

/** 派发前置拒绝（就绪复核/降级链判定失败；在 claim 前抛出，任务状态不受污染） */
export class RemoteDispatchRejection extends Error {
  readonly tag: RemoteDispatchRejectTag;
  readonly hint?: string;

  constructor(tag: RemoteDispatchRejectTag, message: string, hint?: string) {
    super(message);
    this.name = "RemoteDispatchRejection";
    this.tag = tag;
    this.hint = hint;
  }
}

// ---- 路由计划（local / family / direct / reject——降级链判定单源） ----

export type RemoteRoutePlan =
  | { kind: "local" }
  | { kind: "family"; entity: DeploymentEntity }
  | { kind: "direct"; entity: DeploymentEntity }
  | { kind: "reject"; tag: RemoteDispatchRejectTag; message: string; hint?: string };

/**
 * 远端路由判定（AD §4.7 + D31）：本机路由 = local；部署路由按实体与家族 capability
 * 三分支——非降级部署走 sshExecutor（家族链）；degraded 标记（D31 显式确认留痕）走
 * ShellRunner 直连 ssh；家族缺失且未降级 → 拒绝给装载指引。只消费 route.deployment
 * （判定链路以 agent 绑定合成的最小路由同样可判）。
 */
export function planRemoteRoute(
  conn: Conn,
  route: Pick<ResolvedDispatchRoute, "deployment">,
  platform: RemoteDispatchPlatform,
): RemoteRoutePlan {
  if (route.deployment === null) {
    return { kind: "local" };
  }
  const ref = route.deployment.ref;
  const entity = deploymentByAlias(conn, ref);
  if (entity === null) {
    return {
      kind: "reject",
      tag: "DEPLOYMENT_NOT_READY",
      message: `部署「${ref}」已被移除，无法远程派发`,
      hint: "可在设置的远程部署中重新添加，或解除该 agent 的部署绑定改回本机执行",
    };
  }
  if (entity.degraded) {
    return { kind: "direct", entity };
  }
  if (!platform.sshFamilyAvailable()) {
    return {
      kind: "reject",
      tag: "SSH_FAMILY_MISSING",
      message: `SSH 组件未安装，无法远程派发「${ref}」`,
      hint: "可在设置页按指引安装 SSH 组件后重试",
    };
  }
  return { kind: "family", entity };
}

// ---- 统一再出口（拆件前的全部导出面——消费方 import 路径不变） ----

export {
  createSshDispatchExecutor,
  loginShellProbeCommand,
  REMOTE_PATH_BOOTSTRAP,
  type ResolvedRemoteCli,
} from "./sshExecutorScope";
export { createDirectSshExecutor, scopeShellRunner, directSshRunner } from "./sshExecutorDirect";
export { createRemoteTerminalAdapter, createCopyLineTerminal } from "./sshExecutorTerminal";
export {
  createDeploymentPrecheck,
  remoteHeadlessDeps,
  remoteInteractiveParts,
  remoteJudgeExecutorFor,
  type RemoteInteractiveParts,
} from "./sshExecutorDeps";
export {
  createRemoteDispatchGuard,
  type RemoteDispatchGuard,
  normalizeTraceTimestamp,
  traceProbeCommand,
  scopeTraceProber,
} from "./sshExecutorGuard";
