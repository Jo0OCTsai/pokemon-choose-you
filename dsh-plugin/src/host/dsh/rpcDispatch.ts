/**
 * client→host RPC 分发（平台胶水层，Phase A host 侧）。
 *
 * 55 条 host 命令（commands.ts 的 HOST_COMMAND_NAMES——50 Phase A 条目 + 5 条实体
 * 读域）挂 dsh connection 的**自有通道** `/pky` 下：`ctx.connection.rpc.handle("/pky", dispatch)`
 * ——通道上端点名即 host 命令名。不占用共享 `/api` 通道：dsh-client-connection 的
 * 共享通道单拦截器独占（第二个 intercept 抛 "already has an interceptor"），抢注会让
 * 宿主 api-gateway 的注册失败、全部 stock RPC 404（实测踩坑：Plugins 页清单读取挂掉）。
 * 本模块只做信封转换（纯逻辑，单测直测）；hostEntry 负责挂到真实 connection 表面
 * （headless 组合无 connection 服务——不注册即不挂）。
 *
 * 线上形态（与 dsh-client-connection 的 ConnectionRpcHandlerResult 结构对齐）：
 * - 成功：`{ ok: true, value: <信封 data> }`
 * - 失败：`{ ok: false, error: { code, message, details: { hint? } } }`——
 *   PROTOCOL §2 的 hint 落 dsh 通用失败形态的 details 载荷（ConnectionRpcFailure
 *   的 code/message/details 三字段为线上契约，客户端半边 Phase B 逆向还原信封）。
 */
import type { HostCommandCaller } from "../commands";

/**
 * RPC 通道名（客户端 transport.ts 内联同字面量 + 注释锚定此单源；满足 dsh
 * CHANNEL_PATTERN 且非保留的 /api）。
 */
export const PKY_RPC_CHANNEL = "/pky";

/** 分发结果（结构对齐 ConnectionRpcHandlerResult，attachments 不用） */
export type PkyRpcResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } };

/**
 * 组装分发器：`/pky` 通道端点（= host 命令名）→ host 命令调用 → 线上结果。
 * 空端点回 INVALID_ARGUMENT 信封；未知命令由 createHostCommands 统一回 INVALID_ARGUMENT
 * 信封（不抛错）；命令实现的非 PkyError 异常按约定原样上抛（编程缺陷不静默，dsh 转通用 internal 失败）。
 */
export function createPkyRpcDispatcher(
  commands: HostCommandCaller,
): (endpoint: string, payload?: unknown) => Promise<PkyRpcResult> {
  return async (endpoint, payload) => {
    if (endpoint.length === 0) {
      return {
        ok: false,
        error: { code: "INVALID_ARGUMENT", message: "空命令端点", details: {} },
      };
    }
    const result = await commands(endpoint, payload);
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
