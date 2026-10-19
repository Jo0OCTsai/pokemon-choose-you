/**
 * 部署 upsert（从 deployments.ts 拆出——棘轮 max-lines，等量迁移；deployments.ts
 * 为统一再出口，消费面不变）：新建/编辑两分支 + alias 唯一索引校验 + 路径不变式
 * （§4.5：nodePath/workdir 只存展开后 POSIX 绝对路径——显式拒 `~` 前缀与相对路径）
 * + 改名被 agent 绑定引用时的级联/拒绝（执行世界单源）。
 */
import { randomUUID } from "node:crypto";
import { txImmediate, type Conn } from "../storage/db";
import { notFound, PkyError, paramError } from "../storage/errors";
import { loadAgents, storeAgents, type AgentConfig } from "../domain/settings";
import { listDeployments, storeDeployments, type DeploymentEntity, type PkTunnelConfig } from "./deployments";

/** upsert 入参（AD §4.1：helperPath 不在编辑面——provision 步③ 落定；
 * 编辑时 nodePath/workdir 可省略 = 保持现值；pkTunnel 三态：undefined=保持 /
 * null=清除 / 对象=设置——PROTOCOL §8） */
export interface DeploymentUpsertInput {
  id?: string;
  alias: string;
  nodePath?: string;
  workdir?: string;
  note?: string;
  pkTunnel?: PkTunnelConfig | null;
  /** alias 改名且被 agent 绑定（ai_agents.deployment）引用时：true = 级联更新绑定 */
  confirmAliasRefs?: boolean;
}

/** 部署输入不变式错（PROTOCOL §2 DEPLOYMENT_INPUT_INVALID——与 Rust oracle tag 单源） */
function inputInvalid(message: string): PkyError {
  return new PkyError("DEPLOYMENT_INPUT_INVALID", message);
}

// ---- 路径不变式（§4.5：`~` 展开与 posixQuote 互斥——实体路径永不含 `~`） ----

/** 校验一条远端路径：allowEmpty（workdir 空串 = 登录目录缺省）；非空必须 POSIX
 * 绝对路径且不带 `~` 前缀（路径不变式——实体只存展开后绝对路径） */
function validateRemotePath(field: string, value: string, allowEmpty: boolean): string {
  const v = value.trim();
  if (v === "") {
    if (allowEmpty) {
      return "";
    }
    throw inputInvalid(`部署的${field}不能为空`);
  }
  if (v.startsWith("~")) {
    throw inputInvalid(`部署的${field}不接受「~」前缀——请填展开后的绝对路径（如 /home/user/...）`);
  }
  if (!v.startsWith("/")) {
    throw inputInvalid(`部署的${field}必须是远端绝对路径（以 / 开头）`);
  }
  return v;
}

/** pkTunnel 端口校验（PROTOCOL §8：1..=65535） */
function validatePkTunnel(cfg: PkTunnelConfig): void {
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) {
    throw inputInvalid("pkTunnel 端口必须在 1..=65535");
  }
}

/** 绑定了某 alias 的 agent 列表（改名级联/拒绝的判定面——执行世界单源） */
function agentsBoundToAlias(conn: Conn, alias: string): AgentConfig[] {
  return loadAgents(conn).filter((a) => a.deployment?.trim() === alias);
}

/** pkTunnel 三态解析（undefined=保持现值 / null=清除 / 对象=设置——PROTOCOL §8） */
function resolvedPkTunnel(current: DeploymentEntity, input: DeploymentUpsertInput): PkTunnelConfig | null {
  return input.pkTunnel === undefined ? current.pkTunnel : (input.pkTunnel ?? null);
}

/** 是否发生实质字段变更（连接相关字段变动 → 需重跑开通向导） */
function materialChanged(
  current: DeploymentEntity,
  next: { alias: string; nodePath: string; workdir: string },
): boolean {
  return current.alias !== next.alias || current.nodePath !== next.nodePath || current.workdir !== next.workdir;
}
/** 新建实体（生成 id，status=draft，全部诊断字段归零；pkTunnel 可随建设置） */
function newDeploymentEntity(
  alias: string,
  nodePath: string,
  workdir: string,
  note: string,
  pkTunnel: PkTunnelConfig | null,
): DeploymentEntity {
  return {
    id: randomUUID(),
    alias,
    nodePath,
    helperPath: "",
    helperHash: null,
    workdir,
    note,
    status: "draft",
    lastError: null,
    provision: null,
    degraded: false,
    pkTunnel,
  };
}

/** 改名被 agent 绑定引用时的级联处理（未确认 → 拒绝并列出受影响 agent；确认 → 同事务更新绑定） */
function applyAliasRename(conn: Conn, current: DeploymentEntity, alias: string, confirmAliasRefs: boolean): void {
  if (current.alias === alias) {
    return;
  }
  const bound = agentsBoundToAlias(conn, current.alias);
  if (bound.length === 0) {
    return;
  }
  if (!confirmAliasRefs) {
    throw paramError(
      `别名「${current.alias}」正被 ${bound.length} 个 agent 绑定（${bound.map((a) => a.name || a.id).join("、")}）；` +
        "改名需携带 confirmAliasRefs:true 级联更新 agent 绑定",
    );
  }
  const agents = loadAgents(conn);
  for (const agent of agents) {
    if (agent.deployment?.trim() === current.alias) {
      agent.deployment = alias;
    }
  }
  storeAgents(conn, agents);
}

/** 编辑分支实体构造（实质变更 → 回落未就绪并清空开通产物；仅改 note 不触发回落。
 * pkTunnel：alias 变更 = 机器身份变化 → 一并清空（PROTOCOL §8）；其余按入参三态） */
function editedDeploymentEntity(
  current: DeploymentEntity,
  input: DeploymentUpsertInput,
  alias: string,
  nextNodePath: string,
  nextWorkdir: string,
  nextPkTunnel: PkTunnelConfig | null,
): DeploymentEntity {
  const aliasChanged = current.alias !== alias;
  if (materialChanged(current, { alias, nodePath: nextNodePath, workdir: nextWorkdir })) {
    // 实质变更：目标世界已变——回落未就绪并清空开通产物（重跑向导）
    return {
      ...current,
      alias,
      nodePath: nextNodePath,
      workdir: nextWorkdir,
      note: (input.note ?? current.note).trim(),
      helperPath: "",
      helperHash: null,
      status: "not_ready",
      lastError: "部署配置已变更，需重跑开通向导",
      provision: null,
      degraded: false,
      pkTunnel: aliasChanged ? null : nextPkTunnel,
    };
  }
  return { ...current, note: (input.note ?? current.note).trim(), pkTunnel: nextPkTunnel };
}

/**
 * 部署 upsert（AD §4.1 deploymentUpsert · PROTOCOL §8）：
 * - 新建：生成 id，status=draft，全部诊断字段归零（pkTunnel 可随建设置）；
 * - 编辑：alias/nodePath/workdir 任一变更 → 状态回落 not_ready 并重置开通产物
 *   （provision/helperPath/helperHash/degraded——编辑后需重跑向导，目标世界已变）；
 *   alias 变更额外清空 pkTunnel；仅改 note 不触发回落；
 * - pkTunnel 三态：undefined=保持现值 / null=清除 / 对象=设置（端口 1..=65535）；
 * - alias 唯一（重复拒 DEPLOYMENT_ALIAS_TAKEN）；alias trim 后非空且不含空白；
 *   nodePath/workdir 拒 `~` 前缀与相对路径（路径不变式，DEPLOYMENT_INPUT_INVALID）；
 * - alias 改名且被 agent 绑定（ai_agents.deployment）引用 → 须携带 confirmAliasRefs:true
 *   级联更新绑定（与部署键同一条 BEGIN IMMEDIATE 收口），否则拒绝并列出受影响 agent。
 */
export function deploymentUpsert(conn: Conn, input: DeploymentUpsertInput): { deployment: DeploymentEntity } {
  const alias = input.alias.trim();
  if (alias === "") {
    throw inputInvalid("部署别名不能为空（OpenSSH 别名，凭据由它承载）");
  }
  if (/\s/.test(alias)) {
    throw inputInvalid("部署别名不能包含空白字符");
  }
  if (input.pkTunnel !== undefined && input.pkTunnel !== null) {
    validatePkTunnel(input.pkTunnel);
  }
  // 新建的必填校验（nodePath）；编辑分支对省略字段保持现值（见分支内）
  const nodePath = input.id === undefined ? validateRemotePath("Node 路径", input.nodePath ?? "", false) : "";
  const workdir = input.id === undefined ? validateRemotePath("工作目录", input.workdir ?? "", true) : "";

  return txImmediate(conn, () => {
    const deployments = listDeployments(conn);
    const aliasOwner = Object.values(deployments).find((d) => d.alias === alias);
    if (aliasOwner !== undefined && aliasOwner.id !== input.id) {
      throw new PkyError(
        "DEPLOYMENT_ALIAS_TAKEN",
        `别名「${alias}」已被另一个部署占用（id ${aliasOwner.id.slice(0, 8)}…，alias 唯一索引）`,
      );
    }

    let entity: DeploymentEntity;
    if (input.id === undefined) {
      entity = newDeploymentEntity(alias, nodePath, workdir, (input.note ?? "").trim(), input.pkTunnel ?? null);
    } else {
      const current = deployments[input.id];
      if (current === undefined) {
        throw notFound(`部署 ${input.id} 不存在（编辑需携带正确 id）`);
      }
      // 编辑时省略的路径字段保持现值（note-only 编辑不误伤路径不变式校验）
      const nextNodePath =
        input.nodePath === undefined ? current.nodePath : validateRemotePath("Node 路径", input.nodePath, false);
      const nextWorkdir =
        input.workdir === undefined ? current.workdir : validateRemotePath("工作目录", input.workdir, true);
      const nextPkTunnel = resolvedPkTunnel(current, input);
      applyAliasRename(conn, current, alias, input.confirmAliasRefs === true);
      entity = editedDeploymentEntity(current, input, alias, nextNodePath, nextWorkdir, nextPkTunnel);
    }
    deployments[entity.id] = entity;
    storeDeployments(conn, deployments);
    return { deployment: entity };
  });
}
