/**
 * 开通向导幂等状态机（AD §4.5 / FR-RD2，步③ 按 spike 修正 C 修订为 runtime 闭包
 * 安装）：四步固定序 probe-ssh → probe-node → upload → verify（upload 为步骤 id
 * 保持不变，语义 = 远端 npm 闭包安装 dsh-ssh 家族——lib/helper.js 是分包产物非自
 * 包含单文件，单文件上传不可行，依据 specs/dsh-plugin-full-parity/spike-dsh-ssh.md）。
 * 单次 provisionRun 只执行下一未完成步骤并返回该步结果（客户端步进驱动）；已完成
 * 步骤跳过（幂等重跑）；步骤状态持久化在部署实体 provision 字段。
 *
 * 实体路径永不含 `~`（deploymentUpsert 拒收前置不变式）——posixQuote 永不与 `~`
 * 展开叠加。远端操作全部事务外编排（事务内禁止 SSH 调用），事务只收口实体状态
 * （单条 BEGIN IMMEDIATE 整读-改-整写）。
 *
 * 错误 tag 机器稳定：SSH_AUTH_REQUIRED / PROVISION_STEP_FAILED / HELPER_HASH_MISMATCH
 * （命令层映射为 contracts 错误码——追加归任务 2.9，本模块不触碰 PROTOCOL.md）。
 * 摘要不符拒绝就绪不降级直连（D31）——degraded 标记仅经 degradeConfirm 显式确认可达。
 *
 * 步骤执行器 + 命令组装拆件 = provisionSteps.ts（棘轮 max-lines，等量迁移）；
 * 本文件为统一再出口（消费面不变）。
 */
import { txImmediate, type Conn } from "../storage/db";
import { notFound, paramError } from "../storage/errors";
import { deploymentById, listDeployments, type DeploymentEntity } from "./deployments";
import { initialProvisionState } from "./provisionCommands";
import { execUpload, execVerify } from "./provisionInstall";
import { execProbeSsh, execProbeNode, type StepOutcome } from "./provisionSteps";
import type { SshScope } from "./sshScope";

/** 固定步骤序（幂等状态机遍历序） */
export type ProvisionStep = "probe-ssh" | "probe-node" | "upload" | "verify";

export const PROVISION_STEPS: readonly ProvisionStep[] = ["probe-ssh", "probe-node", "upload", "verify"];

/** 步骤失败 tag（机器稳定；1:1 映射 AD §4.2 错误码，装配归任务 2.9） */
export type ProvisionErrorTag = "SSH_AUTH_REQUIRED" | "PROVISION_STEP_FAILED" | "HELPER_HASH_MISMATCH";

/** 单步持久化结果（pending = 未执行/被重置） */
export interface ProvisionStepResult {
  status: "pending" | "ok" | "failed";
  /** 失败时的机器稳定 tag */
  tag?: ProvisionErrorTag;
  /** 失败摘要 / 成功详情（如 node 版本） */
  message?: string;
  /** 最近一次变更时刻（RFC3339；pending 初始为空串） */
  at: string;
}

/** 开通向导持久化状态（部署实体 provision 字段形态） */
export interface ProvisionState {
  steps: Record<ProvisionStep, ProvisionStepResult>;
  /** 步① 探测的远端 $HOME（缺省 helperPath 的展开基准——路径不变式） */
  homeDir: string | null;
}

/** 向导呈现视图（provisionStatus 命令 / deploymentList View 数据面） */
export interface ProvisionStepView {
  step: ProvisionStep;
  status: "pending" | "ok" | "failed";
  message?: string | null;
}

export interface ProvisionStatus {
  steps: ProvisionStepView[];
  failedStep: ProvisionStep | null;
  /** 有失败步 → 幂等可重试（从中断处继续） */
  retryable: boolean;
  /** 全部步骤 ok */
  done: boolean;
}

/** 本机插件闭包内 helper 制品信息（步③ npm 钉版 + 步④ 权威摘要的同闭包单源） */
export interface HelperArtifactInfo {
  /** 本机闭包内 @deepseek-ai/dsh-ssh 包版本（npm 安装 spec 钉版——与权威 hash 同闭包，防错版安装） */
  version: string;
  /** 权威 sha256 = 运行时读本机闭包 lib/helper.js 入口计算（防构建机/安装机依赖版本漂移） */
  sha256: string;
}

/** 开通依赖（平台面经接口注入——本目录零 dsh import） */
export interface ProvisionDeps {
  /** 按部署取 SshScope（免密不可达时返回 null / 非 connected scope） */
  scopeFor(entity: DeploymentEntity): Promise<SshScope | null>;
  /** 本地 helper 制品信息：来源 = 插件包 node_modules 内 @deepseek-ai/dsh-ssh 闭包
   * （package.json 版本 + lib/helper.js 入口 sha256——spike 修正 C 权威口径） */
  readHelperArtifact(): HelperArtifactInfo;
  /** 插件版本（安装目录版本段——多版本 provision 目录隔离不互踩） */
  pluginVersion: string;
}

/** 单步执行结果（ok=false 时 tag 机器稳定；deployment 为落库后的最新实体） */
export interface ProvisionRunResult {
  ok: boolean;
  /** 本次执行的步骤；null = 全部已完成（幂等无操作） */
  step: ProvisionStep | null;
  /** 失败 tag（ok=false 时存在） */
  tag?: ProvisionErrorTag;
  message?: string;
  hint?: string;
  status: ProvisionStatus;
  deployment: DeploymentEntity;
}

// ---- 状态视图 ----

/** 实体 → 向导呈现视图（固定步骤序；至多一个 failed 步——状态机在失败处停） */
export function provisionStatusOf(entity: DeploymentEntity): ProvisionStatus {
  const state = entity.provision ?? initialProvisionState();
  const steps: ProvisionStepView[] = PROVISION_STEPS.map((step) => ({
    step,
    status: state.steps[step].status,
    message: state.steps[step].message ?? null,
  }));
  const failedStep = PROVISION_STEPS.find((s) => state.steps[s].status === "failed") ?? null;
  return { steps, failedStep, retryable: failedStep !== null, done: steps.every((s) => s.status === "ok") };
}

// ---- 状态机推进 ----

/** 步骤 id → 执行器分派（执行器实现：probe 两步 = provisionSteps，upload/verify = provisionInstall） */
function executeStep(step: ProvisionStep, entity: DeploymentEntity, deps: ProvisionDeps): Promise<StepOutcome> {
  switch (step) {
    case "probe-ssh":
      return execProbeSsh(entity, deps);
    case "probe-node":
      return execProbeNode(entity, deps);
    case "upload":
      return execUpload(entity, deps);
    case "verify":
      return execVerify(entity, deps);
  }
}

/** 步骤结果落库（事务只收口实体状态；实体并发消失 → notFound） */
function persistOutcome(
  conn: Conn,
  id: string,
  apply: (entity: DeploymentEntity) => DeploymentEntity,
): DeploymentEntity {
  return txImmediate(conn, () => {
    const deployments = listDeployments(conn);
    const current = deployments[id];
    if (current === undefined) {
      throw notFound(`部署 ${id} 不存在（开通过程中被移除）`);
    }
    const next = apply(current);
    deployments[id] = next;
    conn
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run("dsh:deployments", JSON.stringify(deployments));
    return next;
  });
}

/**
 * 开通向导单步推进（provisionRun）：执行下一未完成步骤并同步返回该步结果；
 * 已完成步骤跳过（幂等重跑从中断处继续）；全部完成 → 无操作返回当前视图。
 * 远端操作在事务外；每步结果单条 BEGIN IMMEDIATE 收口。
 */
export async function provisionRun(conn: Conn, id: string, deps: ProvisionDeps): Promise<ProvisionRunResult> {
  const entity = deploymentById(conn, id);
  if (entity === null) {
    throw notFound(`部署 ${id} 不存在`);
  }
  const state = entity.provision ?? initialProvisionState();
  const nextStep = PROVISION_STEPS.find((s) => state.steps[s].status !== "ok");
  if (nextStep === undefined) {
    return { ok: true, step: null, status: provisionStatusOf(entity), deployment: entity };
  }
  const outcome = await executeStep(nextStep, entity, deps);
  const deployment = persistOutcome(conn, id, outcome.apply);
  return {
    ok: outcome.ok,
    step: nextStep,
    ...(outcome.ok ? {} : { tag: outcome.tag, hint: outcome.hint }),
    message: outcome.message,
    status: provisionStatusOf(deployment),
    deployment,
  };
}

// ---- 降级确认（D31：直连降级仅经显式确认留痕可达；向导重跑不可绕行） ----

/** 曾摘要不符（provision verify 失败记录 tag = HELPER_HASH_MISMATCH——recheck 复核同样落此记） */
export function mismatchRecorded(entity: DeploymentEntity): boolean {
  const verify = entity.provision?.steps.verify;
  return verify?.status === "failed" && verify.tag === "HELPER_HASH_MISMATCH";
}

/** helper 从未安装（未落 helperPath 且 upload 步骤从未 ok） */
export function helperNeverInstalled(entity: DeploymentEntity): boolean {
  return entity.helperPath === "" && entity.provision?.steps.upload.status !== "ok";
}

/**
 * 降级直连显式确认（deploymentDegradeConfirm）：仅在「helper 从未安装且训练家显式
 * 选择跳过」或「曾摘要不符 + 显式确认」两态可达；已就绪（摘要校验通过）或安装
 * 未完成出结论的部署拒绝。确认后 status=ready + degraded=true（诊断留痕）。
 */
export function degradeConfirm(
  conn: Conn,
  id: string,
  opts: { acknowledgedRisk: boolean },
): { deployment: DeploymentEntity } {
  if (opts.acknowledgedRisk !== true) {
    throw paramError("降级直连须显式确认风险（acknowledgedRisk: true）");
  }
  return txImmediate(conn, () => {
    const deployments = listDeployments(conn);
    const entity = deployments[id];
    if (entity === undefined) {
      throw notFound(`部署 ${id} 不存在`);
    }
    const allowed = mismatchRecorded(entity) || helperNeverInstalled(entity);
    if (!allowed) {
      throw paramError(
        entity.status === "ready" && entity.helperHash !== null
          ? "部署 helper 摘要已校验通过，无需降级直连"
          : "部署不在可降级状态（从未安装或曾摘要不符才可显式确认降级）——先完成开通向导",
      );
    }
    const next: DeploymentEntity = {
      ...entity,
      status: "ready",
      degraded: true,
      lastError: "已确认降级直连（ShellRunner）：helper 摘要未经校验，风险已知悉",
    };
    deployments[id] = next;
    conn
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run("dsh:deployments", JSON.stringify(deployments));
    return { deployment: next };
  });
}

// ---- 统一再出口（拆件前的全部导出面——消费方 import 路径不变） ----

export {
  HELPER_ENTRY_SUFFIX,
  defaultHelperPath,
  helperInstallDir,
  homeProbeCommand,
  initialProvisionState,
  installDirFromHelperPath,
  npmInstallCommand,
  npmProbeCommand,
  probeNodeCommand,
  sha256Command,
  sshFamilySpec,
} from "./provisionCommands";
export { markHelperMismatch } from "./provisionInstall";
