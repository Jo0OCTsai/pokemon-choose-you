/**
 * dsh tools 注册面（AD §3.1 tools/：dsh tools 注册，会话模型与判定通道的统一
 * 消费面——薄壳，全部转发到 domain/judge/dispatch；FR-T2 与 pk 面等价）。
 *
 * 本模块只约定注册表形态与调用信封；真实 dsh tools API 的接线（注册/反注册/schema
 * 投影）由 dsh 适配层消费本注册表完成——适配层薄壳，本任务不接真 dsh。
 * 错误信封 = PROTOCOL §2 `{ error: { code, message, hint? } }`（PkyError → 信封；
 * 非 PkyError 原样上抛——编程缺陷不静默吞掉）。
 */
import type { Conn } from "../storage/db";
import { fail, ok, PkyError, type PkyResult } from "../storage/errors";

/** 工具执行上下文：连接 + 审计 origin（默认 `dsh:tools`，可带会话后缀）+ 桌宠生命周期面 */
export interface ToolContext {
  conn: Conn;
  origin?: string;
  /** 桌宠 helper 生命周期（petShow/petHide 工具消费；未装配时该二工具报参数错） */
  pet?: { show(): Promise<unknown>; hide(): void };
}

/** 单个工具定义：名字 + schema 摘要（dsh tools API 的描述面）+ 薄转发 handler */
export interface ToolDef<P = never, R = unknown> {
  name: string;
  /** 一句话用途（dsh tools 注册时的 description 摘要） */
  summary: string;
  /** 参数名清单（摘要形态；真实 JSON schema 投影归 dsh 适配层） */
  params?: string[];
  handler(args: P, ctx: ToolContext): R | Promise<R>;
}

/** 注册表：名字 → 工具；重复注册即抛错（装配期防覆盖） */
export interface ToolRegistry {
  readonly defs: readonly ToolDef[];
  names(): string[];
  get(name: string): ToolDef;
  /** 统一调用入口：PkyError → 错误信封；成功 → { ok: true, data } */
  call(name: string, args: unknown, ctx: ToolContext): Promise<PkyResult<unknown>>;
}

export function defineTools(defs: ToolDef[]): ToolRegistry {
  const tools = new Map<string, ToolDef>();
  for (const def of defs) {
    if (tools.has(def.name)) {
      throw new PkyError("INVALID_ARGUMENT", `工具 ${def.name} 重复注册`);
    }
    tools.set(def.name, def);
  }
  return {
    defs,
    names: () => [...tools.keys()],
    get(name: string): ToolDef {
      const def = tools.get(name);
      if (def === undefined) {
        throw new PkyError("INVALID_ARGUMENT", `未知工具 ${name}，可用工具见注册表`);
      }
      return def;
    },
    async call(name, args, ctx) {
      try {
        const def = tools.get(name);
        if (def === undefined) {
          return fail(new PkyError("INVALID_ARGUMENT", `未知工具 ${name}`));
        }
        return ok(await def.handler((args ?? {}) as never, ctx));
      } catch (error) {
        if (error instanceof PkyError) {
          return fail(error);
        }
        throw error;
      }
    },
  };
}
