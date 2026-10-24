/**
 * mock 域共用件（从 mockRemote.ts 拆出——棘轮 max-lines，等量迁移）：pendingCode
 * 错误码先行面 + paramError/notFound 失败信封 + 部署实体查找 + 写门禁拦截信封。
 * 命令组实现：部署 CRUD = mockDeployments.ts、开通向导 = mockProvision.ts、
 * 会话 = mockRemote.ts（统一再出口）。
 */
import { PkyError, type ErrorCode } from "../host/storage/errors";
import type { PkyErrorShape } from "../host/storage/errors";
import type { DeploymentEntity } from "./rpcTypes";
import type { MockContext } from "./mockHost";

/** 任务 2.9 落地前的错误码先行面（host 枚举尚未扩容——窄化转换保类型绿，扩容后不变；
 *  mock 域共用件） */
export function pendingCode(code: string): ErrorCode {
  return code as ErrorCode;
}

export function paramError(message: string, hint?: string): { ok: false; error: PkyErrorShape } {
  return { ok: false, error: new PkyError("INVALID_ARGUMENT", message, hint).toShape() };
}

export function notFound(message: string): { ok: false; error: PkyErrorShape } {
  return { ok: false, error: new PkyError("NOT_FOUND", message).toShape() };
}

/** 部署实体查找 */
export function findDeployment(ctx: MockContext, id: string): DeploymentEntity | undefined {
  return ctx.state.deployments.find((d) => d.id === id);
}

/** 写门禁拦截信封（未拦截 = null；拦截 = {ok:false,error} 定型收口——防字面量拓宽） */
export function writeBlocked(ctx: MockContext): { ok: false; error: PkyErrorShape } | null {
  const blocked = ctx.guardWritable();
  return blocked !== null ? { ok: false, error: blocked.toShape() } : null;
}
