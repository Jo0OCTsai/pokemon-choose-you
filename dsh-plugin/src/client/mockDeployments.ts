/**
 * mockHost 命令组 · 部署 CRUD 与复核（从 mockRemote.ts 拆出——棘轮 max-lines，等量
 * 迁移；mockRemote.ts 为统一再出口，消费面不变）：编辑回落未就绪——U23/漂移 1；
 * degraded 留痕保留——U31。
 */
import type { HostClient } from "./rpc";
import type { DeploymentEntity, DeploymentUpsertInput } from "./rpcTypes";
import type { MockContext } from "./mockHost";
import type { PkyErrorShape } from "../host/storage/errors";
import { findDeployment, notFound, paramError, writeBlocked } from "./mockDeploy";

/** 远端路径字段校验（拒 ~ 前缀；合法 = 归一后值） */
function validatePathField(label: string, value: string): string | { ok: false; error: PkyErrorShape } {
  if (value.startsWith("~")) {
    return paramError(`${label}需为展开后的绝对路径（不支持 ~ 前缀）`);
  }
  return value;
}

/** nodePath 校验（新建必填 + 拒 ~；合法 = 归一值） */
function validateNodePath(params: DeploymentUpsertInput): string | { ok: false; error: PkyErrorShape } {
  const nodePath = params.nodePath?.trim() ?? "";
  if (params.id === undefined && nodePath === "") {
    return paramError("Node 路径不能为空");
  }
  return validatePathField("Node 路径", nodePath);
}

/** upsert 入参校验（别名非空 / 新建 nodePath 必填 / 路径拒 ~ / alias 唯一） */
function validateUpsertParams(
  ctx: MockContext,
  params: DeploymentUpsertInput,
): { alias: string; nodePath: string; workdir: string } | { ok: false; error: PkyErrorShape } {
  const alias = params.alias.trim();
  if (alias === "") {
    return paramError("别名不能为空");
  }
  const nodeChecked = validateNodePath(params);
  if (typeof nodeChecked !== "string") {
    return nodeChecked;
  }
  const workdir = validatePathField("工作目录", params.workdir?.trim() ?? "");
  if (typeof workdir !== "string") {
    return workdir;
  }
  if (ctx.state.deployments.some((d) => d.alias === alias && d.id !== params.id)) {
    return paramError(`别名「${alias}」已存在`);
  }
  return { alias, nodePath: nodeChecked, workdir };
}

/** upsert 新建分支（status=not_ready，全诊断字段归零） */
function upsertCreate(
  ctx: MockContext,
  params: DeploymentUpsertInput,
  fields: { alias: string; nodePath: string; workdir: string },
) {
  const entity: DeploymentEntity = {
    id: `dep-${ctx.state.deployments.length + 1}`,
    alias: fields.alias,
    nodePath: fields.nodePath,
    helperPath: "",
    helperHash: null,
    workdir: fields.workdir,
    note: params.note ?? "",
    status: "not_ready",
    lastError: null,
    provision: null,
    degraded: false,
    pkTunnel: null,
  };
  ctx.state.deployments.push(entity);
  return ctx.ok({ deployment: entity });
}

/** upsert 编辑分支（省略路径保持现值；编辑保存回落未就绪；degraded 留痕保留） */
function upsertEdit(
  ctx: MockContext,
  params: DeploymentUpsertInput,
  fields: { alias: string; nodePath: string; workdir: string },
) {
  const entity = findDeployment(ctx, params.id ?? "");
  if (entity === undefined) {
    return notFound(`部署 ${params.id} 不存在`);
  }
  entity.alias = fields.alias;
  if (fields.nodePath !== "") {
    entity.nodePath = fields.nodePath;
  }
  if (fields.workdir !== "") {
    entity.workdir = fields.workdir;
  }
  if (params.note !== undefined) {
    entity.note = params.note;
  }
  // 编辑保存回落未就绪（路径变更后需重跑开通向导复核）；直连留痕随实体保留
  entity.status = "not_ready";
  entity.helperHash = null;
  return ctx.ok({ deployment: entity });
}

function mockDeploymentList(ctx: MockContext) {
  ctx.record("deploymentList");
  const ds = ctx.state.deployments;
  const counts = {
    ready: ds.filter((d) => d.status === "ready").length,
    pending: ds.filter((d) => d.status !== "ready" && d.status !== "disconnected").length,
    broken: ds.filter((d) => d.status === "disconnected").length,
  };
  const deployments = ds.map((d) => ({ ...d, tunnel: ctx.state.tunnelStates[d.id] ?? null }));
  return ctx.ok({ deployments, counts });
}

/** 本机 ssh config 别名（部署表单下拉数据源——真实侧解析见 host remote/sshConfig） */
function mockSshAliasList(ctx: MockContext) {
  ctx.record("sshAliasList");
  return ctx.ok({ aliases: [...ctx.state.sshAliases] });
}

function mockDeploymentUpsert(ctx: MockContext, params: DeploymentUpsertInput) {
  ctx.record("deploymentUpsert", params);
  const blocked = writeBlocked(ctx);
  if (blocked !== null) {
    return blocked;
  }
  const fields = validateUpsertParams(ctx, params);
  if ("ok" in fields) {
    return fields;
  }
  return params.id === undefined ? upsertCreate(ctx, params, fields) : upsertEdit(ctx, params, fields);
}

function mockDeploymentDelete(ctx: MockContext, params: { id: string }) {
  ctx.record("deploymentDelete", params);
  const blocked = writeBlocked(ctx);
  if (blocked !== null) {
    return blocked;
  }
  const entity = findDeployment(ctx, params.id);
  if (entity === undefined) {
    return notFound(`部署 ${params.id} 不存在`);
  }
  ctx.state.deployments = ctx.state.deployments.filter((d) => d.id !== params.id);
  // 远端 helper 托管自清理尽力执行（失败不阻塞移除，仅留最近错误）
  const attempted = entity.status === "ready" || entity.status === "disconnected";
  return ctx.ok({
    id: params.id,
    cleanup: attempted
      ? entity.status === "disconnected"
        ? { attempted: true, ok: false, detail: "连接已断开，远端自清理跳过（仅记录到诊断段）" }
        : { attempted: true, ok: true }
      : { attempted: false, ok: true },
  });
}

function mockDeploymentRecheck(ctx: MockContext, params: { id: string }) {
  ctx.record("deploymentRecheck", params);
  const blocked = writeBlocked(ctx);
  if (blocked !== null) {
    return blocked;
  }
  const entity = findDeployment(ctx, params.id);
  if (entity === undefined) {
    return notFound(`部署 ${params.id} 不存在`);
  }
  if (entity.status === "disconnected") {
    // 重连复核两分支（对齐真实宿主 recheckDeployment：结果落实体状态呈现）
    if (ctx.state.recheckRecovers) {
      entity.status = "ready";
      entity.lastError = null;
    } else {
      entity.lastError = "连接不可用（免密登录未配置或已断开）";
    }
  }
  return ctx.ok({ deployment: entity });
}

/** 部署 CRUD 与复核（+ 表单别名数据源） */
export function deploymentCommands(
  ctx: MockContext,
): Pick<HostClient, "deploymentList" | "sshAliasList" | "deploymentUpsert" | "deploymentDelete" | "deploymentRecheck"> {
  return {
    async deploymentList() {
      return await mockDeploymentList(ctx);
    },
    async sshAliasList() {
      return await mockSshAliasList(ctx);
    },
    async deploymentUpsert(params) {
      return await mockDeploymentUpsert(ctx, params);
    },
    async deploymentDelete(params) {
      return await mockDeploymentDelete(ctx, params);
    },
    async deploymentRecheck(params) {
      return await mockDeploymentRecheck(ctx, params);
    },
  };
}
