/**
 * 契约 op · 配置对齐面（prompt_* / agent_* / config_write）：oracle 的 harness 组合
 * （键白名单 → 修订检测 → 校验 → upsert/DELETE）镜像，落库走 domain/settings +
 * domain/prompt-overrides。prompt 状态摘要 {source, missingPlaceholders, overlong,
 * currentOverride} = prompt_spec_state 同构（currentOverride 取原始 settings 行）。
 */
import {
  editableSpecByKey,
  promptOverride,
  promptReset,
  resolveOverride,
  type PromptSpec,
} from "../../src/host/domain/prompt-overrides";
import {
  agentDelete,
  agentUpsert,
  getSetting,
  loadAgents,
  writeSettings,
  type AgentConfig,
} from "../../src/host/domain/settings";
import type { Conn } from "../../src/host/storage/db";
import type { OpFn } from "./harness";
import { run, TagError } from "./opsTask";

function str(args: Record<string, unknown>, key: string): string | undefined {
  return typeof args[key] === "string" ? (args[key] as string) : undefined;
}

/** prompt_spec_state 镜像：三态来源 + 缺占位符 + 超长 + 原始覆盖行（null = 无行） */
function specState(conn: Conn, spec: PromptSpec): Record<string, unknown> {
  const resolved = resolveOverride(conn, spec);
  return {
    source: resolved.source,
    missingPlaceholders: resolved.missing,
    overlong: resolved.overlong,
    currentOverride: spec.storageKey === null ? null : getSetting(conn, spec.storageKey),
  };
}

/** agents_summary 镜像：[{id, name, command, enabled}] */
function agentsSummary(conn: Conn): unknown {
  return loadAgents(conn).map((a) => ({ id: a.id, name: a.name, command: a.command, enabled: a.enabled ?? true }));
}

/** 键白名单前置（oracle：非可编辑键 → PROMPT_VALIDATION_FAILED:key-not-editable） */
function editableSpec(conn: Conn, key: string): PromptSpec {
  void conn;
  const spec = editableSpecByKey(key);
  if (spec === null) {
    throw new TagError("PROMPT_VALIDATION_FAILED:key-not-editable");
  }
  return spec;
}

/** 配置对齐面 op 表 */
export function configOps(): Record<string, OpFn> {
  return {
    prompt_override: (ctx, args) =>
      run(() => {
        const conn = ctx.conn(0);
        const key = str(args, "key") ?? "";
        const spec = editableSpec(conn, key);
        const before = specState(conn, spec);
        const out = promptOverride(conn, key, str(args, "value") ?? "", {
          expectedValue: str(args, "expectedValue"),
          force: args.force === true,
        });
        return { before, after: specState(conn, spec), unknownPlaceholders: out.unknownPlaceholders };
      }),
    prompt_reset: (ctx, args) =>
      run(() => {
        const conn = ctx.conn(0);
        const key = str(args, "key") ?? "";
        const spec = editableSpec(conn, key);
        const before = specState(conn, spec);
        promptReset(conn, key, { expectedValue: str(args, "expectedValue"), force: args.force === true });
        return { before, after: specState(conn, spec), unknownPlaceholders: [] };
      }),
    agent_upsert: (ctx, args) =>
      run(() => {
        const conn = ctx.conn(0);
        agentUpsert(conn, args.agent as AgentConfig, {
          expectedAgentIds: Array.isArray(args.expectedAgentIds) ? (args.expectedAgentIds as string[]) : undefined,
          force: args.force === true,
        });
        return agentsSummary(conn);
      }),
    agent_delete: (ctx, args) =>
      run(() => {
        const conn = ctx.conn(0);
        agentDelete(conn, str(args, "id") ?? "", {
          expectedAgentIds: Array.isArray(args.expectedAgentIds) ? (args.expectedAgentIds as string[]) : undefined,
          force: args.force === true,
        });
        return agentsSummary(conn);
      }),
    config_write: (ctx, args) =>
      run(() => {
        const kvs = (args.keyValues ?? {}) as Record<string, string>;
        writeSettings(ctx.conn(0), kvs);
        return { written: Object.keys(kvs).length };
      }),
  };
}

export { specState };
