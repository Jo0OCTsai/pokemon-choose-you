/**
 * dsh 客户端 RPC transport（Phase B 真实适配层）：client 半边 HostTransport 的 dsh
 * connection 实现——命令经自有通道 `/pky` 上行（端点名 = 命令名；通道常量与 host
 * 半边 rpcDispatch 单源），下行按 ConnectionRpcResult（{ok,value} | {ok,error:{code,
 * message,details}}）逆向还原成 PROTOCOL §2 信封（{ok,data} | {ok,error:{code,
 * message,hint?}}）——host 侧 rpcDispatch 的正向转换（hint → details.hint）在此还原。
 *
 * 视图模型归一（平台胶水的漂移吸收位）：diagnosticsSnapshot 的 host 字段 status →
 * 客户端契约 DiagnosticsLink.level（Phase A 上线面冻结不改，client 消费面按契约取 level）。
 * pageOpen 推送：host 侧推送通道尚未接 dsh 事件面——本层先提供本地监听注册面
 * （emitPageOpen 供桥接/测试注入），真实 host→client 推送接面后续落型。
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

/** diagnosticsSnapshot 视图模型归一：host 字段 status → 客户端契约 level（level 已在则不动；status 键剔除——契约面外字段不透传） */
function normalizeDiagnostics(value: unknown): unknown {
  if (value === null || typeof value !== "object" || !Array.isArray((value as { links?: unknown }).links)) {
    return value;
  }
  const links = (value as { links: unknown[] }).links.map((link) => {
    if (link === null || typeof link !== "object" || typeof (link as { level?: unknown }).level === "string") {
      return link;
    }
    const { status, ...rest } = link as { status?: unknown } & Record<string, unknown>;
    return { ...rest, level: typeof status === "string" ? status : "off" };
  });
  return { ...(value as Record<string, unknown>), links };
}

/**
 * RPC 通道字面量（单源 = host 侧 src/host/dsh/rpcDispatch.ts 的 PKY_RPC_CHANNEL；
 * 此处内联避免把 host 模块卷进 client bundle——同 settings 键字面量的锚定惯例）。
 */
const PKY_RPC_CHANNEL = "/pky";

/** 构造 dsh RPC transport：命令 → 自有通道 `/pky`（端点名 = 命令名），结果信封逆向还原 */
export function createDshRpcTransport(rpc: DshConnectionRpc): DshRpcTransport {
  const pageOpenListeners = new Set<(event: PageOpenEvent) => void>();
  return {
    async send<T>(command: string, params?: unknown): Promise<PkyResult<T>> {
      const result = await rpc.call(PKY_RPC_CHANNEL, command, params ?? {});
      if (result.ok) {
        const data = command === "diagnosticsSnapshot" ? normalizeDiagnostics(result.value) : result.value;
        return { ok: true, data: data as T };
      }
      return { ok: false, error: restoreError(result.error) };
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
