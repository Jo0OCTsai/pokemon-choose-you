/**
 * 22 工具注册（从 hostEntry.ts 拆出——棘轮 max-lines，等量迁移）：defineTool JSON DSL
 * 投影 + ok/fail 信封 → 模型可读文本渲染。
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import type { Plugin } from "../index";
import type { ToolContext } from "../tools/registry";
import type { PkyResult } from "../storage/errors";
import { toDslParameters, TODO_TOOL_PARAM_DECLS } from "./toolSchema";

/** 工具输出 schema：ok/fail 信封本身（json = 注解式放行，信封结构归 PROTOCOL §2 单源） */
const TOOL_OUTPUT_SCHEMA = {
  type: "json",
  description: "ok/fail 信封（PROTOCOL §2）：{ok:true,data} | {ok:false,error:{code,message,hint?}}",
} as const;

/** 22 工具 → ctx.tools.register(defineTool(...))；信封经 output/render 投影文本块 */
export function registerTodoTools(ctx: Context, plugin: Plugin): void {
  const supervisor = plugin.supervisor;
  const toolCtx: ToolContext = {
    conn: plugin.conn,
    origin: "dsh:tools",
    pet: supervisor === null ? undefined : { show: () => supervisor.show(), hide: () => supervisor.hide() },
  };
  for (const def of plugin.tools.defs) {
    const definition = defineTool({
      name: def.name,
      description: def.summary,
      parameters: toDslParameters(TODO_TOOL_PARAM_DECLS[def.name] ?? {}),
      output: {
        schema: TOOL_OUTPUT_SCHEMA,
        render: (_args: unknown, value: unknown) => [{ type: "text", text: renderEnvelope(value) }],
      },
      execute: (args: unknown) =>
        plugin.tools.call(def.name, args, toolCtx).then((result) => result as unknown as never),
    });
    ctx.effect(() => ctx.tools.register(definition));
  }
}

/** 信封 → 模型可读文本（失败行首标错误码，hint 换行跟随） */
function renderEnvelope(value: unknown): string {
  const result = value as PkyResult<unknown>;
  if (result.ok) {
    return JSON.stringify(result.data ?? {}, null, 2);
  }
  const error = result.error;
  return `[${error.code}] ${error.message}${error.hint === undefined ? "" : `\nhint: ${error.hint}`}`;
}
