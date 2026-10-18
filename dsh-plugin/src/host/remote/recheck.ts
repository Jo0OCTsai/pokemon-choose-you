/**
 * 就绪复核（AD §3.2/§4.7 / SDD §3.3）：周期（timer 注入，装配归组 2）与派发前即时
 * 两类消费共用。复核面 = 连接活性（轻量命令）+ helper sha256（权威源 = 运行时读本地
 * 制品计算——与 provision 步④ 同基准）。
 *
 * 失败语义（SDD §3.3 状态图）：
 * - 连接活性失败 → status=disconnected + lastError（传输层断开——不可重放）；
 * - 摘要不符 → status=not_ready + provision 记 HELPER_HASH_MISMATCH（拒绝就绪不降级
 *   直连——D31，降级仅经 degradeConfirm 显式确认可达）；
 * - 断开 → 恢复（活性 + 摘要全过）→ status=ready + recovered 信号（迟到回传核对
 *   触发——lateReport 由消费方挂接本回调，装配归任务 2.8）。
 *
 * 远端操作事务外编排；状态收口单条 BEGIN IMMEDIATE。零 dsh import（SshScope 注入）。
 */
import { txImmediate, type Conn } from "../storage/db";
import { notFound } from "../storage/errors";
import { deploymentById, listDeployments, type DeploymentEntity, type DeploymentStatus } from "./deployments";
import { markHelperMismatch, sha256Command } from "./provision";
import type { SshScope } from "./sshScope";

/** 复核依赖（平台面经接口注入） */
export interface RecheckDeps {
  scopeFor(entity: DeploymentEntity): Promise<SshScope | null>;
  /** 本地 helper 制品权威摘要（运行时读文件计算；只取 sha256——recheck 不重传内容） */
  readHelperArtifact(): { sha256: string };
}

/** 复核结果（供派发前即时检查消费：ready=false 时 reason 说明） */
export interface RecheckOutcome {
  ready: boolean;
  reason?: string;
  /** 断开 → 恢复（迟到回传核对触发信号） */
  recovered: boolean;
}

export interface RecheckOptions {
  /** 恢复回调（状态已收口为 ready 后触发；lateReport 挂接点） */
  onRecovered?: (entity: DeploymentEntity) => void | Promise<void>;
}

/** 连接活性探测命令（固定串，零插值） */
export function livenessCommand(): string {
  return "printf pky-ok";
}

/** 解析 sha256sum 输出首 token（hex 小写；解析不出 = null） */
function parseSha256(stdout: string): string | null {
  const token = stdout.trim().split(/\s+/)[0] ?? "";
  return /^[0-9a-f]{64}$/.test(token) ? token : null;
}

type RecheckFailure =
  | { kind: "disconnected"; reason: string }
  | { kind: "hash-exec"; reason: string }
  | { kind: "mismatch"; reason: string };

/** 远端复核（事务外）：活性 → 摘要；失败分类驱动状态迁移 */
async function probeRemote(entity: DeploymentEntity, deps: RecheckDeps): Promise<RecheckFailure | null> {
  const got = await probeLiveness(entity, deps);
  if ("kind" in got) {
    return got;
  }
  return await probeHelperHash(got.scope, entity, deps);
}

/** 连接活性探测（建立 scope + 轻量命令；任一失败 = disconnected 分类） */
async function probeLiveness(
  entity: DeploymentEntity,
  deps: RecheckDeps,
): Promise<{ scope: SshScope } | { kind: "disconnected"; reason: string }> {
  let scope: SshScope | null = null;
  try {
    scope = await deps.scopeFor(entity);
  } catch (error) {
    return { kind: "disconnected", reason: `连接建立失败：${String(error).slice(0, 160)}` };
  }
  if (scope === null || !scope.connected) {
    return { kind: "disconnected", reason: "连接不可用（免密登录未配置或已断开）" };
  }
  try {
    const alive = await scope.shell(livenessCommand());
    if (alive.code !== 0 || !alive.stdout.includes("pky-ok")) {
      return { kind: "disconnected", reason: `连接活性探测失败（exit ${alive.code}）` };
    }
  } catch (error) {
    return { kind: "disconnected", reason: `连接活性探测异常：${String(error).slice(0, 160)}` };
  }
  return { scope };
}

/** helper 摘要复核（从未安装 = null 直接过；执行失败 / 不符分类） */
async function probeHelperHash(
  scope: SshScope,
  entity: DeploymentEntity,
  deps: RecheckDeps,
): Promise<RecheckFailure | null> {
  if (entity.helperHash === null || entity.helperPath === "") {
    return null; // 从未安装 helper（degraded 直连部署）：只复核活性
  }
  let stdout = "";
  try {
    const result = await scope.shell(sha256Command(entity.helperPath));
    if (result.code !== 0) {
      return { kind: "hash-exec", reason: `远端组件验证失败（exit ${result.code}）：${result.stderr.slice(0, 120)}` };
    }
    stdout = result.stdout;
  } catch (error) {
    return { kind: "hash-exec", reason: `远端组件验证异常：${String(error).slice(0, 160)}` };
  }
  const remote = parseSha256(stdout);
  const expected = deps.readHelperArtifact().sha256.toLowerCase();
  if (remote === null || remote !== expected) {
    return {
      kind: "mismatch",
      reason: "远端组件验证未通过（与预期不一致）",
    };
  }
  return null;
}

/** 复核失败 → 实体状态迁移（disconnected / not_ready 两分支） */
function applyFailure(entity: DeploymentEntity, failure: RecheckFailure): DeploymentEntity {
  if (failure.kind === "mismatch") {
    // D31 证据留痕：provision 记 HELPER_HASH_MISMATCH（degradeConfirm 前提可判）
    return markHelperMismatch(entity, failure.reason);
  }
  const nextStatus: DeploymentStatus = failure.kind === "disconnected" ? "disconnected" : "not_ready";
  return { ...entity, status: nextStatus, lastError: failure.reason };
}

/** 状态收口（单条 BEGIN IMMEDIATE；实体并发消失 → notFound） */
function persistRecheck(
  conn: Conn,
  id: string,
  apply: (entity: DeploymentEntity) => DeploymentEntity,
): DeploymentEntity {
  return txImmediate(conn, () => {
    const deployments = listDeployments(conn);
    const current = deployments[id];
    if (current === undefined) {
      throw notFound(`部署 ${id} 不存在（复核过程中被移除）`);
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
 * 就绪复核（周期 / deploymentRecheck 手动 / 派发前即时共用）：
 * 仅 ready/disconnected 态做远端复核（未开通态不探测，直接 ready=false 说明）；
 * 全过 → ready（自 disconnected 恢复时 recovered=true 并触发回调）；失败按分类迁移。
 */
export async function recheckDeployment(
  conn: Conn,
  id: string,
  deps: RecheckDeps,
  opts: RecheckOptions = {},
): Promise<RecheckOutcome> {
  const entity = deploymentById(conn, id);
  if (entity === null) {
    throw notFound(`部署 ${id} 不存在`);
  }
  const status: DeploymentStatus = entity.status;
  if (status !== "ready" && status !== "disconnected") {
    return { ready: false, reason: "部署未就绪（先完成开通向导）", recovered: false };
  }
  const failure = await probeRemote(entity, deps);
  if (failure !== null) {
    const next = persistRecheck(conn, id, (e) => applyFailure(e, failure));
    return { ready: false, reason: next.lastError ?? failure.reason, recovered: false };
  }
  const wasDisconnected = status === "disconnected";
  const next = persistRecheck(conn, id, (e) => ({ ...e, status: "ready", lastError: null }));
  if (wasDisconnected && opts.onRecovered !== undefined) {
    await opts.onRecovered(next);
  }
  return { ready: true, recovered: wasDisconnected };
}
