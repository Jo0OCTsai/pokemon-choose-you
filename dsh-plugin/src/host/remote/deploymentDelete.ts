/**
 * 部署移除 + 托管目录自清理（从 deployments.ts 拆出——棘轮 max-lines，等量迁移；
 * deployments.ts 为统一再出口，消费面不变）：关连接（回调注入）+ 远端 helper 托管
 * 目录自清理尽力执行（经注入 SshScope，事务外编排——事务内禁止 SSH 调用），失败
 * 不阻塞删除。
 */
import { txImmediate, type Conn } from "../storage/db";
import { notFound } from "../storage/errors";
import { posixQuote } from "../dispatch/cmdline";
import { deploymentById, listDeployments, storeDeployments, type DeploymentEntity } from "./deployments";
import { installDirFromHelperPath } from "./provision";
import type { SshScope } from "./sshScope";

/** 移除清理结果（尽力执行，失败只留诊断、不阻塞删除） */
export interface DeploymentCleanup {
  /** 是否尝试了远端自清理 */
  attempted: boolean;
  /** 尝试的清理是否全部成功（未尝试时按无失败 = true） */
  ok: boolean;
  detail?: string;
}

export interface DeploymentDeleteResult {
  id: string;
  cleanup: DeploymentCleanup;
}

/** 移除依赖（平台面经回调/接口注入——本目录零 dsh import） */
export interface DeploymentDeleteDeps {
  /** 关闭该部署的连接（scope dispose；失败不阻塞） */
  disconnect?: () => Promise<void> | void;
  /** 取该部署的 SshScope（null = 连接不可用 → 远端自清理跳过） */
  scopeFor?: (entity: DeploymentEntity) => Promise<SshScope | null>;
}

/** 远端 helper 托管目录自清理命令（安装目录 = helperPath 反推——npm 闭包布局剥离
 * node_modules 后缀，非闭包布局回落 dirname；逐参 posixQuote——NFR-11④） */
export function cleanupCommand(helperPath: string): string {
  return `rm -rf -- ${posixQuote(installDirFromHelperPath(helperPath))}`;
}

/** 远端自清理单步（连接不可用 = 跳过留诊断；失败/异常 = 尽力记录） */
async function selfCleanRemote(
  entity: DeploymentEntity,
  scopeFor: (entity: DeploymentEntity) => Promise<SshScope | null>,
  problems: string[],
): Promise<DeploymentCleanup> {
  try {
    const scope = await scopeFor(entity);
    if (scope === null || !scope.connected) {
      problems.push("远端连接不可用，跳过自清理");
      return { attempted: false, ok: true };
    }
    const result = await scope.shell(cleanupCommand(entity.helperPath));
    if (result.code !== 0) {
      problems.push(`远端自清理失败（exit ${result.code}）：${result.stderr.slice(0, 120)}`);
    }
    return { attempted: true, ok: result.code === 0 };
  } catch (error) {
    problems.push(`远端自清理异常：${String(error).slice(0, 120)}`);
    return { attempted: true, ok: false };
  }
}

/** 移除前清理编排（事务外尽力执行——先远端自清理再关连接，顺序不可倒置；失败只留诊断） */
async function runDeploymentCleanup(
  entity: DeploymentEntity,
  deps: DeploymentDeleteDeps,
): Promise<{ cleanup: DeploymentCleanup; problems: string[] }> {
  const problems: string[] = [];
  let cleanup: DeploymentCleanup = { attempted: false, ok: true };
  if (entity.helperPath !== "" && deps.scopeFor !== undefined) {
    cleanup = await selfCleanRemote(entity, deps.scopeFor, problems);
  } else if (entity.helperPath === "") {
    cleanup = { attempted: false, ok: true, detail: "helper 从未安装，无远端清理项" };
  }
  if (deps.disconnect !== undefined) {
    try {
      await deps.disconnect();
    } catch (error) {
      cleanup = { ...cleanup, ok: false };
      problems.push(`关连接失败：${String(error).slice(0, 120)}`);
    }
  }
  if (problems.length > 0) {
    cleanup = { ...cleanup, detail: problems.join("；") };
  }
  return { cleanup, problems };
}

/**
 * 移除部署（AD §4.1 deploymentDelete）：关连接 + 远端 helper 托管目录自清理尽力执行
 * （事务外编排），失败不阻塞；本机记录删除单条 BEGIN IMMEDIATE 收口。
 * 路由悬空引用不做级联（§5.2 ②——由 danglingDeploymentRefs 承接呈现）。
 */
export async function deploymentDelete(
  conn: Conn,
  id: string,
  deps: DeploymentDeleteDeps = {},
): Promise<DeploymentDeleteResult> {
  const entity = deploymentById(conn, id);
  if (entity === null) {
    throw notFound(`部署 ${id} 不存在`);
  }
  const { cleanup } = await runDeploymentCleanup(entity, deps);
  txImmediate(conn, () => {
    const deployments = listDeployments(conn);
    if (deployments[id] === undefined) {
      throw notFound(`部署 ${id} 不存在`);
    }
    delete deployments[id];
    storeDeployments(conn, deployments);
  });
  return { id, cleanup };
}
