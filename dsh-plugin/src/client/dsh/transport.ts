/**
 * dsh 客户端 RPC transport（Phase B 真实适配层）：client 半边 HostTransport 的 dsh
 * connection 实现——命令经官方共享 `/api` 通道的 Typert Remote 端点 `pky/call` 上行
 * （2026-10-13 迁移：原 connection.rpc.handle 自定义通道 `/pky` 在 rc.2 对第三方插件
 * 不可用；官方宿主→客户端数据面全走 api-gateway 的 Remote），args 按源码参数名键控
 * （{command, payload?}——SRC 模式 wire 契约）。双信封：传输层 ConnectionRpcResult
 * 的 value 即 host 侧业务信封（PROTOCOL §2 ok/fail——Remote 方法不抛错，业务错误码
 * 不进传输层错误路径），传输失败信封按 dsh 通用形态逆向还原（hint → details.hint）。
 *
 * pageOpen 推送：本层只持本地监听注册面（on/emitPageOpen），事件源 = pageOpenStream.ts 经
 * ctx.remote 订阅 host 流端点 `pky/pageOpenEvents` 后调 emitPageOpen 注入（测试亦经此注入）。
 */
import { ERROR_CODES, type HostTransport, type PageOpenEvent, type PkyErrorShape, type PkyResult } from "../rpc";

/** dsh ConnectionRpcFailure（线上契约三字段：code/message/details） */
export interface DshConnectionFailure {
  readonly code: string;
  readonly message: string;
  readonly details: Record<string, unknown>;
}

/** dsh ConnectionRpcResult（ctx.connection.rpc.call 的返回形态） */
export type DshConnectionResult =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: DshConnectionFailure };

/** ctx.connection.rpc 的调用面（client 侧 ctx 属性子集，结构化收窄） */
export interface DshConnectionRpc {
  call(channel: string, endpoint: string, payload?: unknown): Promise<DshConnectionResult>;
}

/** transport 面 + pageOpen 本地分发口（host 推送接面/测试注入用） */
export interface DshRpcTransport extends HostTransport {
  emitPageOpen(event: PageOpenEvent): void;
}

/** 已知错误码全集（15 业务码 + 传输层通用 2 码） */
const KNOWN_CODES: ReadonlySet<string> = new Set<string>([...ERROR_CODES, "INVALID_ARGUMENT", "NOT_FOUND"]);

/** 失败信封还原：hint 从 details 取回；未知码（dsh internal/transport 层）折叠为 INVALID_ARGUMENT，原码并入 message 保留诊断 */
function restoreError(error: DshConnectionFailure): PkyErrorShape {
  const known = KNOWN_CODES.has(error.code);
  const code: PkyErrorShape["code"] = known ? (error.code as PkyErrorShape["code"]) : "INVALID_ARGUMENT";
  const message = known ? error.message : `[${error.code}] ${error.message}`;
  if (typeof error.details.hint === "string" && error.details.hint !== "") {
    return { code, message, hint: error.details.hint };
  }
  return { code, message };
}

/**
 * Remote 端点线面（单源 = host 侧 src/host/dsh/remoteService.ts 的服务名/方法名与
 * SRC 参数名；此处内联避免把 host 模块卷进 client bundle——同 settings 键字面量的
 * 锚定惯例）。
 */
const REMOTE_CHANNEL = "/api";
const REMOTE_ENDPOINT = "pky/call";

/** 构造 dsh RPC transport：命令 → /api 通道 Remote 端点 pky/call，双信封剥层还原 */
export function createDshRpcTransport(rpc: DshConnectionRpc): DshRpcTransport {
  const pageOpenListeners = new Set<(event: PageOpenEvent) => void>();
  return {
    async send<T>(command: string, params?: unknown): Promise<PkyResult<T>> {
      const args = params === undefined ? { command } : { command, payload: params };
      const result = await rpc.call(REMOTE_CHANNEL, REMOTE_ENDPOINT, { args });
      if (!result.ok) {
        return { ok: false, error: restoreError(result.error) };
      }
      // 传输成功：value = host 业务信封（PkyResult）原样透传
      const envelope = result.value as PkyResult<T>;
      if (envelope === null || typeof envelope !== "object" || typeof (envelope as { ok?: unknown }).ok !== "boolean") {
        return { ok: false, error: { code: "INVALID_ARGUMENT", message: "Remote 返回值不是业务信封" } };
      }
      if (!envelope.ok) {
        return { ok: false, error: envelope.error };
      }
      return { ok: true, data: envelope.data as T };
    },
    on(event: "pageOpen", listener: (event: PageOpenEvent) => void): () => void {
      if (event !== "pageOpen") {
        return () => {};
      }
      pageOpenListeners.add(listener);
      return () => {
        pageOpenListeners.delete(listener);
      };
    },
    emitPageOpen(event: PageOpenEvent): void {
      for (const listener of pageOpenListeners) {
        listener(event);
      }
    },
  };
}
