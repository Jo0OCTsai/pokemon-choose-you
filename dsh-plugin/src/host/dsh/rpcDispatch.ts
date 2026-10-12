/**
 * client→host RPC 分发（平台胶水层，Phase A host 侧）。
 *
 * 50 条 host 命令（commands.ts 的 HOST_COMMAND_NAMES）挂 dsh connection 共享 `/api`
 * 通道的 `pky/<command>` 端点下：`ctx.connection.rpc.intercept("/api", isPkyEndpoint,
 * dispatch)`。本模块只做端点解析与信封转换（纯逻辑，单测直测）；hostEntry 负责
 * 挂到真实 connection 表面（headless 组合无 connection 服务——不拦截即不注册）。
 *
 * 线上形态（与 dsh-client-connection 的 ConnectionRpcHandlerResult 结构对齐）：
 * - 成功：`{ ok: true, value: <信封 data> }`
 * - 失败：`{ ok: false, error: { code, message, details: { hint? } } }`——
 *   PROTOCOL §2 的 hint 落 dsh 通用失败形态的 details 载荷（ConnectionRpcFailure
 *   的 code/message/details 三字段为线上契约，客户端半边 Phase B 逆向还原信封）。
 */
import type { HostCommandCaller } from "../commands";

/** 端点前缀（与客户端 rpc 约定单源；host 命令名直接拼接其后） */
export const PKY_RPC_PREFIX = "pky/";

/** 端点归属判定（intercept 的同步 matcher；仅 `pky/<非空命令>` 归本插件） */
export function isPkyEndpoint(endpoint: string): boolean {
  return endpoint.startsWith(PKY_RPC_PREFIX) && endpoint.length > PKY_RPC_PREFIX.length;
}

/** 端点 → 命令名（非 pky/ 端点返回 undefined） */
export function pkyCommandOf(endpoint: string): string | undefined {
  return isPkyEndpoint(endpoint) ? endpoint.slice(PKY_RPC_PREFIX.length) : undefined;
}

/** 分发结果（结构对齐 ConnectionRpcHandlerResult，attachments 不用） */
export type PkyRpcResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } };

/**
 * 组装分发器：`pky/<command>` → host 命令调用 → 线上结果。
 * 未知命令由 createHostCommands 统一回 INVALID_ARGUMENT 信封（不抛错）；
 * 命令实现的非 PkyError 异常按约定原样上抛（编程缺陷不静默，dsh 转通用 internal 失败）。
 */
export function createPkyRpcDispatcher(
  commands: HostCommandCaller,
): (endpoint: string, payload?: unknown) => Promise<PkyRpcResult> {
  return async (endpoint, payload) => {
    const command = pkyCommandOf(endpoint);
    if (command === undefined) {
      return {
        ok: false,
        error: { code: "INVALID_ARGUMENT", message: `非 ${PKY_RPC_PREFIX} 端点：${endpoint}`, details: {} },
      };
    }
    const result = await commands(command, payload);
    if (result.ok) {
      return { ok: true, value: result.data };
    }
    const error = result.error;
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.hint === undefined ? {} : { hint: error.hint },
      },
    };
  };
}
