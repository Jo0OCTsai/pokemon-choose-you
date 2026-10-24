/**
 * 部署注册面 op（PROTOCOL §8 · ADR-0003）：deployment_upsert / deployment_delete 的
 * TS 回放实现——薄转发 src/host/remote 域原语；错误 tag = PkyError code 原样
 * （与 Rust oracle DeploymentError.tag 逐字单源；不走 opsTask.run 的 tagOf——
 * 它把通用码重映射为 Tauri AppError 词汇 invalid/not_found，域码 op 不适用）。
 */
import type { OpFn, OpResult } from "./harness";
import { PkyError } from "../../src/host/storage/errors";
import {
  deploymentUpsert,
  listDeployments,
  storeDeployments,
  type DeploymentUpsertInput,
  type PkTunnelConfig,
} from "../../src/host/remote/deployments";

/** op 结果包装（域码直通；非 PkyError 按 db——opsTask.run 的非 PkyError 分支同语义） */
function runDomain(fn: () => unknown): OpResult {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    return { ok: false, error: error instanceof PkyError ? error.code : "db" };
  }
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

/** deployment_upsert op（入参 = upsert 输入对象；出参 {deployment: 实体}） */
const deploymentUpsertOp: OpFn = (ctx, args) =>
  runDomain(() => {
    const input: DeploymentUpsertInput = {
      id: str(args, "id"),
      alias: str(args, "alias") ?? "",
      nodePath: str(args, "nodePath"),
      workdir: str(args, "workdir"),
      note: str(args, "note"),
      confirmAliasRefs: args.confirmAliasRefs === true,
    };
    // pkTunnel 三态：absent=保持 / null=清除 / 对象=设置
    if ("pkTunnel" in args) {
      input.pkTunnel = args.pkTunnel === null ? null : (args.pkTunnel as PkTunnelConfig);
    }
    const { deployment } = deploymentUpsert(ctx.conn(0), input);
    return { deployment };
  });

/**
 * deployment_delete op（PROTOCOL §8：语义 = 实体状态变迁，不含远端自清理编排——
 * 那是宿主适配层职责；与 Rust oracle deployment_delete 同粒度）
 */
const deploymentDeleteOp: OpFn = (ctx, args) =>
  runDomain(() => {
    const id = str(args, "id") ?? "";
    const conn = ctx.conn(0);
    const deployments = listDeployments(conn);
    if (deployments[id] === undefined) {
      throw new PkyError("NOT_FOUND", `部署 ${id} 不存在`);
    }
    delete deployments[id];
    storeDeployments(conn, deployments);
    return { deleted: true };
  });

export function deploymentOps(): Record<string, OpFn> {
  return {
    deployment_upsert: deploymentUpsertOp,
    deployment_delete: deploymentDeleteOp,
  };
}
