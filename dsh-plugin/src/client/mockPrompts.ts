/**
 * mockHost 命令组 · 提示词 4 键：promptList/promptGet/promptOverride/promptReset
 * （长度/占位符校验 + overrideText 基线修订检测，A24 口径）。
 */
import { PkyError, type PkyResult } from "../host/storage/errors";
import type { PromptSpecInfo } from "../host/domain/prompt-overrides";
import type { HostClient } from "./rpc";
import type { MockContext } from "./mockHost";

function findPromptSpec(ctx: MockContext, key: string): PromptSpecInfo | undefined {
  return ctx.state.promptSpecs.find((s) => s.storageKey === key);
}

/** 提示词 4 键目录与覆盖（长度/占位符校验 + overrideText 基线修订检测） */
export function promptCommands(
  ctx: MockContext,
): Pick<HostClient, "promptList" | "promptGet" | "promptOverride" | "promptReset"> {
  return {
    async promptList() {
      ctx.record("promptList");
      return { ok: true, data: { specs: ctx.state.promptSpecs } };
    },
    async promptGet(params) {
      ctx.record("promptGet", params);
      const spec = findPromptSpec(ctx, params.key);
      if (spec === undefined) {
        return { ok: false, error: new PkyError("INVALID_ARGUMENT", "该提示词不支持编辑").toShape() };
      }
      return { ok: true, data: spec };
    },
    async promptOverride(params) {
      ctx.record("promptOverride", params);
      return applyPromptOverride(ctx, params);
    },
    async promptReset(params) {
      ctx.record("promptReset", params);
      const spec = findPromptSpec(ctx, params.key);
      if (spec === undefined) {
        return { ok: false, error: new PkyError("INVALID_ARGUMENT", "该提示词不支持编辑").toShape() };
      }
      spec.overrideText = null;
      spec.source = "default";
      spec.text = spec.defaultText;
      return { ok: true, data: spec };
    },
  };
}

/** 提示词覆盖校验与落库（空白=恢复默认；超长/缺占位符拒绝；修订检测 force 覆盖） */
async function applyPromptOverride(
  ctx: MockContext,
  params: { key: string; value: string; expectedValue?: string; force?: boolean },
): Promise<PkyResult<{ spec: PromptSpecInfo; unknownPlaceholders: string[] }>> {
  const spec = findPromptSpec(ctx, params.key);
  if (spec === undefined) {
    return { ok: false, error: new PkyError("INVALID_ARGUMENT", "该提示词不支持编辑").toShape() };
  }
  const revision = promptRevisionError(spec, params);
  if (revision !== null) {
    return { ok: false, error: revision.toShape() };
  }
  const invalid = promptValidationError(spec, params.value);
  if (invalid !== null) {
    return { ok: false, error: invalid.toShape() };
  }
  spec.overrideText = params.value.trim() === "" ? null : params.value;
  spec.source = spec.overrideText === null ? "default" : "custom";
  spec.text = spec.overrideText ?? spec.defaultText;
  return { ok: true, data: { spec, unknownPlaceholders: [] } };
}

/** expectedValue 基线失配 → SETTING_MODIFIED_ELSEWHERE */
function promptRevisionError(
  spec: PromptSpecInfo,
  params: { expectedValue?: string; force?: boolean },
): PkyError | null {
  if (params.force || params.expectedValue === undefined) {
    return null;
  }
  const current = spec.overrideText ?? "";
  if (current !== (params.expectedValue ?? "")) {
    return new PkyError("SETTING_MODIFIED_ELSEWHERE", "提示词覆盖已在另一处被修改", "确认覆盖请带 force 重发整值");
  }
  return null;
}

/** 超长 / 缺必要占位符 → PROMPT_VALIDATION_FAILED */
function promptValidationError(spec: PromptSpecInfo, value: string): PkyError | null {
  if (Array.from(value).length > 20000) {
    return new PkyError("PROMPT_VALIDATION_FAILED", "提示词长度超过上限（最多 20000 字符）");
  }
  const missing = spec.requiredPlaceholders.filter((p) => !value.includes(p));
  if (value.trim() !== "" && missing.length > 0) {
    return new PkyError("PROMPT_VALIDATION_FAILED", `缺少必要占位符：${missing.join("、")}`);
  }
  return null;
}
