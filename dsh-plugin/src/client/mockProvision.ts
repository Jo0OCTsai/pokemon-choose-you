/**
 * mockHost 命令组 · 开通向导（从 mockRemote.ts 拆出——棘轮 max-lines，等量迁移；
 * mockRemote.ts 为统一再出口，消费面不变）：单步状态机（provisionRun 客户端步进
 * 驱动 + provisionStatus 呈现 + D31 降级确认 deploymentDegradeConfirm）。
 * 错误码先行面经 pendingCode 窄化构造（枚举扩容后转换仍成立）。
 */
import { PkyError } from "../host/storage/errors";
import type { PkyErrorShape } from "../host/storage/errors";
import type { HostClient } from "./rpc";
import type { DeploymentEntity, ProvisionErrorTag, ProvisionStatus, ProvisionStep } from "./rpcTypes";
import type { MockContext } from "./mockHost";
import { findDeployment, notFound, paramError, pendingCode, writeBlocked } from "./mockDeploy";

/** mock 时刻（确定性夹具） */
const MOCK_NOW = "2026-10-17T09:00:00+08:00";

/** 四步固定序（与 host remote/provision PROVISION_STEPS 同序） */
const PROVISION_STEPS: readonly ProvisionStep[] = ["probe-ssh", "probe-node", "upload", "verify"];

/** 步骤 ok 详情（向导输出屏示例行） */
const STEP_OK_DETAIL: Record<ProvisionStep, string> = {
  "probe-ssh": "BatchMode 连接成功 · $HOME=/home/trainer",
  "probe-node": "v20.11.0",
  upload: "helper.js 已写入 · chmod 700 · 远端 sha256 复核一致",
  verify: "远端摘要与预期一致",
};

/** 单步失败编排形态（MockHostState.provisionFail；kind → 错误码映射） */
export type MockProvisionFailKind = "auth" | "step" | "hash";

/** 初始 provision 状态（全步 pending） */
function initialProvision(): NonNullable<DeploymentEntity["provision"]> {
  const steps = {} as NonNullable<DeploymentEntity["provision"]>["steps"];
  for (const step of PROVISION_STEPS) {
    steps[step] = { status: "pending", at: "" };
  }
  return { steps, homeDir: null };
}

/** provision 状态 → 向导呈现视图（host provisionStatusOf 同构的内存版） */
function provisionView(entity: DeploymentEntity): ProvisionStatus {
  const steps = PROVISION_STEPS.map((step) => {
    const result = entity.provision?.steps[step];
    return { step, status: result?.status ?? "pending", message: result?.message ?? null };
  });
  const failed = steps.find((s) => s.status === "failed");
  return {
    steps,
    failedStep: failed?.step ?? null,
    retryable: failed !== undefined,
    done: steps.every((s) => s.status === "ok"),
  };
}

/** provision 单步失败编排（步骤置 failed + 实体回落；kind → 错误信封） */
function failProvisionStep(
  entity: DeploymentEntity,
  provision: NonNullable<DeploymentEntity["provision"]>,
  next: ProvisionStep,
  fail: NonNullable<MockContext["state"]["provisionFail"]>,
): { ok: false; error: PkyErrorShape } {
  const message = fail.message ?? `步骤 ${next} 执行失败`;
  const tag: ProvisionErrorTag =
    fail.kind === "auth"
      ? "SSH_AUTH_REQUIRED"
      : fail.kind === "hash"
        ? "HELPER_HASH_MISMATCH"
        : "PROVISION_STEP_FAILED";
  provision.steps[next] = { status: "failed", tag, message, at: MOCK_NOW };
  entity.status = "not_ready";
  entity.lastError = message;
  if (fail.kind === "auth") {
    return {
      ok: false,
      error: new PkyError(
        "SSH_AUTH_REQUIRED",
        message,
        "先在本机跑 ssh-copy-id（或把公钥加入 ssh-agent），再回到这里重试",
      ).toShape(),
    };
  }
  if (fail.kind === "hash") {
    return {
      ok: false,
      error: new PkyError(
        pendingCode("HELPER_HASH_MISMATCH"),
        message,
        "远端 helper 摘要与预期不符——拒绝置为就绪；可经「转直连」显式降级（留痕）",
      ).toShape(),
    };
  }
  return {
    ok: false,
    error: new PkyError(pendingCode("PROVISION_STEP_FAILED"), message, `失败步骤：${next}`).toShape(),
  };
}

function mockProvisionRun(ctx: MockContext, params: { id: string }) {
  const blocked = writeBlocked(ctx);
  if (blocked !== null) {
    return blocked;
  }
  const entity = findDeployment(ctx, params.id);
  if (entity === undefined) {
    return notFound(`部署 ${params.id} 不存在`);
  }
  const provision = (entity.provision ??= initialProvision());
  const next = PROVISION_STEPS.find((step) => provision.steps[step].status !== "ok");
  if (next === undefined) {
    // 幂等无操作（全部已完成）
    return ctx.ok({ status: provisionView(entity) });
  }
  const fail = ctx.state.provisionFail;
  if (fail !== null && fail.step === next) {
    return failProvisionStep(entity, provision, next, fail);
  }
  provision.steps[next] = { status: "ok", message: STEP_OK_DETAIL[next], at: MOCK_NOW };
  if (PROVISION_STEPS.every((step) => provision.steps[step].status === "ok")) {
    // 四步全过：置就绪 + 清 degraded 留痕（U31：重跑全过方清除）
    entity.status = "ready";
    entity.degraded = false;
    entity.helperPath = "/home/trainer/.dsh-helper/pky-helper-1.0.0.js";
    entity.helperHash = "mock-sha256-abcdef";
    entity.lastError = null;
  }
  return ctx.ok({ status: provisionView(entity) });
}

function mockProvisionStatus(ctx: MockContext, params: { id: string }) {
  ctx.record("provisionStatus", params);
  const entity = findDeployment(ctx, params.id);
  if (entity === undefined) {
    return notFound(`部署 ${params.id} 不存在`);
  }
  return ctx.ok({ status: provisionView(entity) });
}

function mockDegradeConfirm(ctx: MockContext, params: { id: string; acknowledgedRisk?: boolean }) {
  ctx.record("deploymentDegradeConfirm", params);
  const blocked = writeBlocked(ctx);
  if (blocked !== null) {
    return blocked;
  }
  const entity = findDeployment(ctx, params.id);
  if (entity === undefined) {
    return notFound(`部署 ${params.id} 不存在`);
  }
  if (params.acknowledgedRisk !== true) {
    return paramError("转直连需显式确认风险（acknowledgedRisk: true）");
  }
  entity.degraded = true;
  entity.status = "ready";
  entity.lastError = null;
  return ctx.ok({ deployment: entity });
}

/** 开通向导单步状态机 + 状态呈现 + D31 显式降级确认 */
export function provisionCommands(
  ctx: MockContext,
): Pick<HostClient, "provisionRun" | "provisionStatus" | "deploymentDegradeConfirm"> {
  return {
    async provisionRun(params) {
      ctx.record("provisionRun", params);
      return await mockProvisionRun(ctx, params);
    },
    async provisionStatus(params) {
      return await mockProvisionStatus(ctx, params);
    },
    async deploymentDegradeConfirm(params) {
      return await mockDegradeConfirm(ctx, params);
    },
  };
}
