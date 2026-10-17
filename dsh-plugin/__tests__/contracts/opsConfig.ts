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
import { agentDelete, agentUpsert, getSetting, loadAgents, type AgentConfig } from "../../src/host/domain/settings";
import { txImmediate } from "../../src/host/storage/db";
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

/** prompt_override op（override + 状态前后 + 未知占位符回显） */
const promptOverrideOp: OpFn = (ctx, args) =>
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
  });

/** prompt_reset op（reset + 状态前后；重置无未知占位符） */
const promptResetOp: OpFn = (ctx, args) =>
  run(() => {
    const conn = ctx.conn(0);
    const key = str(args, "key") ?? "";
    const spec = editableSpec(conn, key);
    const before = specState(conn, spec);
    promptReset(conn, key, { expectedValue: str(args, "expectedValue"), force: args.force === true });
    return { before, after: specState(conn, spec), unknownPlaceholders: [] };
  });

/** agent_upsert / agent_delete 共用的 expectedAgentIds 形态收敛 */
function expectedIds(args: Record<string, unknown>): string[] | undefined {
  return Array.isArray(args.expectedAgentIds) ? (args.expectedAgentIds as string[]) : undefined;
}

/** agent_upsert op（upsert + agents_summary） */
const agentUpsertOp: OpFn = (ctx, args) =>
  run(() => {
    const conn = ctx.conn(0);
    agentUpsert(conn, args.agent as AgentConfig, {
      expectedAgentIds: expectedIds(args),
      force: args.force === true,
    });
    return agentsSummary(conn);
  });

/** agent_delete op（delete + agents_summary） */
const agentDeleteOp: OpFn = (ctx, args) =>
  run(() => {
    const conn = ctx.conn(0);
    agentDelete(conn, str(args, "id") ?? "", {
      expectedAgentIds: expectedIds(args),
      force: args.force === true,
    });
    return agentsSummary(conn);
  });

/** config_write op：镜像 oracle 的 commands::set_setting——直写 upsert、无值校验（校验
 * 属插件 host 命令层 writeSettings 的 CONFIG_VALIDATION_FAILED 面，oracle 命令层不设——
 * reminder 组 quiet-boundaries 以合法路径写坏边界值构造 fail-open 场景依赖此口径）；
 * SQL 用 oracle 同款 ON CONFLICT DO UPDATE（保 rowid，final.settings 行序可比），
 * 键序按字典序迭代（oracle serde_json BTreeMap——首插次序决定 rowid，seedSetup 同口径） */
const configWriteOp: OpFn = (ctx, args) =>
  run(() => {
    const kvs = (args.keyValues ?? {}) as Record<string, string>;
    const conn = ctx.conn(0);
    txImmediate(conn, () => {
      for (const key of Object.keys(kvs).sort()) {
        conn
          .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=?2")
          .run(key, kvs[key]);
      }
    });
    return { written: Object.keys(kvs).length };
  });

/** 配置对齐面 op 表 */
export function configOps(): Record<string, OpFn> {
  return {
    prompt_override: promptOverrideOp,
    prompt_reset: promptResetOp,
    agent_upsert: agentUpsertOp,
    agent_delete: agentDeleteOp,
    config_write: configWriteOp,
  };
}

export { specState };
