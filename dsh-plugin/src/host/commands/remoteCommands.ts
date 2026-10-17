/**
 * host 命令 · 远程部署/开通向导域（full-parity AD §4.1 部署族 7 条 + D31 降级确认 1 条）：
 * deploymentList / deploymentUpsert / deploymentDelete / deploymentRecheck /
 * provisionRun / provisionStatus / deploymentDegradeConfirm。
 * 命令层薄：参数形状校验 → domain 调用（remote/ 纯逻辑）→ 信封响应；远端 SSH 编排
 * 全在 domain（事务外），事务只收口实体状态。domain 错误 tag 机器稳定，本层 1:1 映射
 * PROTOCOL §2 错误码（provisionRun 失败 tag = SSH_AUTH_REQUIRED / PROVISION_STEP_FAILED /
 * HELPER_HASH_MISMATCH）。平台面（SshScope / helper 制品）经 deps.remote 注入——未装配
 * （非 dsh 宿主）时远端编排类命令按 HELPER_CAPABILITY_MISSING 降级拒绝（NFR-12 零静默）；
 * 纯 settings 读写类（list/upsert/delete/degradeConfirm/provisionStatus）不依赖平台面。
 */
import { notFound, PkyError } from "../storage/errors";
import type { CommandTable, HostCommandDeps, RemoteCommandPlatform } from "./context";
import {
  deploymentDelete,
  deploymentUpsert,
  listDeployments,
  type DeploymentEntity,
  type DeploymentUpsertInput,
} from "../remote/deployments";
import {
  degradeConfirm as degradeConfirmDomain,
  provisionRun as provisionRunDomain,
  provisionStatusOf,
} from "../remote/provision";
import { recheckDeployment } from "../remote/recheck";

/** 平台面未装配的降级拒绝（非 dsh 宿主内运行——相关命令明确报错不静默） */
function requirePlatform(deps: HostCommandDeps): RemoteCommandPlatform {
  if (deps.remote === undefined) {
    throw new PkyError(
      "HELPER_CAPABILITY_MISSING",
      "远程部署平台面未装配（不在 dsh 宿主内运行或 dsh-ssh 家族缺失）",
      "远程部署管理需在 dsh 宿主内使用；家族缺失时按诊断段指引装载后重试",
    );
  }
  return deps.remote;
}

/** 实体在位校验（provisionStatus 等纯读命令的前置） */
function requireDeployment(deps: HostCommandDeps, id: unknown): DeploymentEntity {
  if (typeof id !== "string" || id === "") {
    throw new PkyError("INVALID_ARGUMENT", "缺少部署 id");
  }
  const entity = listDeployments(deps.conn)[id];
  if (entity === undefined) {
    throw notFound(`部署 ${id} 不存在`);
  }
  return entity;
}

/** 部署 CRUD 段（list/upsert/delete；纯 settings 面——平台面缺席也可用，delete 清理跳过） */
function deploymentCommandSet(): CommandTable {
  return {
    // 部署列表：实体数组 + 三档计数（ready / pending=未开通或未出结论 / broken=断开）
    deploymentList: (_p, deps) => {
      const deployments = Object.values(listDeployments(deps.conn));
      const ready = deployments.filter((d) => d.status === "ready").length;
      const broken = deployments.filter((d) => d.status === "disconnected").length;
      return { deployments, counts: { ready, pending: deployments.length - ready - broken, broken } };
    },
    // 新建/编辑（alias 唯一、路径不变式、改名级联确认全在 domain 校验）
    deploymentUpsert: (p, deps) => {
      const input = p as DeploymentUpsertInput;
      if (typeof input?.alias !== "string") {
        throw new PkyError("INVALID_ARGUMENT", "缺少部署别名（OpenSSH 别名）");
      }
      const result = deploymentUpsert(deps.conn, input);
      deps.onWrites();
      return result;
    },
    // 移除 = 关连接 + 远端自清理尽力执行（平台面缺席时清理跳过，删除不阻塞）
    deploymentDelete: async (p, deps) => {
      const id = (p as { id?: unknown }).id;
      if (typeof id !== "string" || id === "") {
        throw new PkyError("INVALID_ARGUMENT", "缺少部署 id");
      }
      const remote = deps.remote;
      const result = await deploymentDelete(deps.conn, id, {
        ...(remote === undefined ? {} : { disconnect: () => remote.disconnect(id) }),
        ...(remote === undefined ? {} : { scopeFor: (entity) => remote.scopeFor(entity) }),
      });
      deps.onWrites();
      return result;
    },
  };
}

/** 开通向导段（recheck/provisionRun/provisionStatus/degradeConfirm） */
function provisionCommandSet(): CommandTable {
  return {
    // 手动就绪复核（连接活性 + helper 摘要；复核失败不报错——结果落实体状态呈现）
    deploymentRecheck: async (p, deps) => {
      const id = requireDeployment(deps, (p as { id?: unknown }).id).id;
      const platform = requirePlatform(deps);
      await recheckDeployment(deps.conn, id, {
        scopeFor: platform.scopeFor,
        readHelperArtifact: platform.readHelperArtifact,
      });
      deps.onWrites();
      return { deployment: requireDeployment(deps, id) };
    },
    // 开通向导单步推进（客户端步进驱动；失败 tag 1:1 映射 PROTOCOL §2）
    provisionRun: async (p, deps) => {
      const id = requireDeployment(deps, (p as { id?: unknown }).id).id;
      const platform = requirePlatform(deps);
      const outcome = await provisionRunDomain(deps.conn, id, {
        scopeFor: platform.scopeFor,
        readHelperArtifact: platform.readHelperArtifact,
        pluginVersion: deps.meta.pluginVersion,
      });
      deps.onWrites();
      if (!outcome.ok) {
        throw new PkyError(
          outcome.tag ?? "PROVISION_STEP_FAILED",
          outcome.message ?? `开通步骤 ${String(outcome.step)} 失败`,
          outcome.hint ?? `失败步骤：${String(outcome.step)}`,
        );
      }
      return { status: outcome.status };
    },
    // 向导呈现（各步骤结果 + 失败步 + 可重试标记；纯实体读）
    provisionStatus: (p, deps) => {
      const entity = requireDeployment(deps, (p as { id?: unknown }).id);
      return { status: provisionStatusOf(entity) };
    },
    // D31 显式降级确认（仅「从未安装」或「曾摘要不符」两态可达；确认留痕诊断段）
    deploymentDegradeConfirm: (p, deps) => {
      const args = p as { id?: unknown; acknowledgedRisk?: unknown };
      const result = degradeConfirmDomain(deps.conn, requireDeployment(deps, args.id).id, {
        acknowledgedRisk: args.acknowledgedRisk === true,
      });
      deps.onWrites();
      return result;
    },
  };
}

/** 部署/开通向导命令表（8 条） */
export function remoteCommands(): CommandTable {
  return { ...deploymentCommandSet(), ...provisionCommandSet() };
}
