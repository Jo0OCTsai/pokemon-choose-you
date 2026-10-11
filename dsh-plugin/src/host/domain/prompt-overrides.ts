/**
 * 提示词覆盖（ai_prompt_* 4 键 + dispatch 只读项）——行为基准 =
 * src-tauri/src/ai/prompt_overrides.rs：白名单 / 空白或等于默认 = 删行（恢复默认
 * 语义）/ 20000 code points 上限 / 必要占位符保存与运行时双重校验 / 未知占位符
 * 警告（非阻断）/ 三态生效来源（default/custom/default_warned）回落。
 * 修订检测（A24 ②）：expectedValue（读时 overrideText 基线）与库内当前行失配 →
 * SETTING_MODIFIED_ELSEWHERE（force 重发覆盖）。
 */
import { txImmediate, type Conn } from "../storage/db";
import { PkyError, paramError } from "../storage/errors";
import { getSetting, setSetting, deleteSetting } from "./settings";
import {
  CAPTURE_SYSTEM_PROMPT,
  PET_CHAT_SYSTEM_PROMPT,
  TAG_HEALTH_SYSTEM_PROMPT,
  TOOLS_SYSTEM_PROMPT,
} from "./prompts";
import { dispatchPromptExample } from "./injection";

/** 单条覆盖的长度上限（Unicode code points；Rust chars().count() 口径） */
export const PROMPT_MAX_CHARS = 20000;

/** 覆盖存储键前缀（settings 表；通用原语旁路口径：configRead/configWrite 不拦该前缀） */
export const PROMPT_KEY_PREFIX = "ai_prompt_";

export interface PromptSpec {
  /** 功能标识（稳定唯一） */
  id: string;
  /** 覆盖存储键（dispatch 只读项为 null） */
  storageKey: string | null;
  editable: boolean;
  /** 内置默认全文（恢复默认的基准；字节对齐 src-tauri/src/ai/prompts.rs 编译常量） */
  defaultText: string;
  /** 必要占位符（保存与运行时双重校验；空集 = 无动态注入点） */
  requiredPlaceholders: string[];
}

export const PROMPT_SPECS: PromptSpec[] = [
  {
    id: "im_classify",
    storageKey: "ai_prompt_im_classify",
    editable: true,
    defaultText: TOOLS_SYSTEM_PROMPT,
    requiredPlaceholders: ["<AGENT_ID>"],
  },
  {
    id: "capture",
    storageKey: "ai_prompt_capture",
    editable: true,
    defaultText: CAPTURE_SYSTEM_PROMPT,
    requiredPlaceholders: ["<AGENT_ID>"],
  },
  {
    id: "pet_chat",
    storageKey: "ai_prompt_pet_chat",
    editable: true,
    defaultText: PET_CHAT_SYSTEM_PROMPT,
    requiredPlaceholders: ["<CONTEXT>", "<QUESTION>"],
  },
  {
    id: "tag_health",
    storageKey: "ai_prompt_tag_health",
    editable: true,
    defaultText: TAG_HEALTH_SYSTEM_PROMPT,
    requiredPlaceholders: [],
  },
];

/** 生效来源三态（snake_case 字面量 = 前端契约字面量） */
export type PromptSource = "default" | "custom" | "default_warned";

export interface ResolvedPrompt {
  text: string;
  source: PromptSource;
  missing: string[];
  overlong: boolean;
}

/** 目录视图模型（host 命令 promptList/promptGet 响应；字段集对齐主应用 PromptSpecInfo） */
export interface PromptSpecInfo {
  id: string;
  storageKey: string | null;
  editable: boolean;
  defaultText: string;
  requiredPlaceholders: string[];
  lengthLimit: number;
  overrideText: string | null;
  /** 生效文本（custom = 覆盖原文；default/default_warned = 内置默认） */
  text: string;
  source: PromptSource;
  missingPlaceholders: string[];
  overlong: boolean;
}

/** 按存储键取可编辑目录项（save 键白名单；dispatch 无键、未知键均 null） */
export function editableSpecByKey(key: string): PromptSpec | null {
  return PROMPT_SPECS.find((s) => s.storageKey === key && s.editable) ?? null;
}

/** 当前覆盖行（无行 / 空白 → null——expectedValue 基线的读取面） */
export function currentOverrideText(conn: Conn, spec: PromptSpec): string | null {
  const raw = spec.storageKey === null ? null : getSetting(conn, spec.storageKey);
  if (raw === null || raw.trim() === "") {
    return null;
  }
  return raw;
}

function toSpecInfo(conn: Conn, spec: PromptSpec, resolved: ResolvedPrompt): PromptSpecInfo {
  const raw = spec.storageKey === null ? null : getSetting(conn, spec.storageKey);
  return {
    id: spec.id,
    storageKey: spec.storageKey,
    editable: spec.editable,
    defaultText: spec.defaultText,
    requiredPlaceholders: spec.requiredPlaceholders,
    lengthLimit: PROMPT_MAX_CHARS,
    overrideText: raw,
    text: resolved.text,
    source: resolved.source,
    missingPlaceholders: resolved.missing,
    overlong: resolved.overlong,
  };
}

/**
 * 运行时解析（固定优先序，与保存规则同序）：
 * ① 无行 / 空白 / 与默认逐字一致 → default（无警示——逐字一致判定优先于缺占位符/
 * 超长判定）；② 行存在且非空白但不满足（≤上限 && 必要占位符齐全）→ default_warned
 * （文本回落默认）；③ 其余 → custom（文本 = 覆盖原文）。坏覆盖永不挂判定管道。
 */
export function resolveOverride(conn: Conn, spec: PromptSpec): ResolvedPrompt {
  const fallback = (): ResolvedPrompt => ({
    text: spec.defaultText,
    source: "default",
    missing: [],
    overlong: false,
  });
  const raw = spec.storageKey === null ? null : getSetting(conn, spec.storageKey);
  if (raw === null || raw.trim() === "" || raw === spec.defaultText) {
    return fallback();
  }
  const overlong = Array.from(raw).length > PROMPT_MAX_CHARS;
  const missing = spec.requiredPlaceholders.filter((p) => !raw.includes(p));
  if (overlong || missing.length > 0) {
    return { text: spec.defaultText, source: "default_warned", missing, overlong };
  }
  return { text: raw, source: "custom", missing: [], overlong: false };
}

/**
 * 目录视图（host 命令 promptList：固定 5 项 = 4 可编辑 + dispatch 只读示例项，
 * dispatch 的 defaultText 是真实拼装的示例渲染——prompt.rs dispatch_prompt_example）。
 */
export function promptList(conn: Conn): PromptSpecInfo[] {
  const items = PROMPT_SPECS.map((spec) => toSpecInfo(conn, spec, resolveOverride(conn, spec)));
  const dispatchSpec: PromptSpec = {
    id: "dispatch",
    storageKey: null,
    editable: false,
    defaultText: dispatchPromptExample(),
    requiredPlaceholders: [],
  };
  items.push({
    ...toSpecInfo(conn, dispatchSpec, {
      text: dispatchSpec.defaultText,
      source: "default",
      missing: [],
      overlong: false,
    }),
  });
  return items;
}

/** 单项视图（host 命令 promptGet：编辑器基线；expectedValue 取自本次 overrideText） */
export function promptGet(conn: Conn, key: string): PromptSpecInfo {
  const spec = editableSpecByKey(key);
  if (spec === null) {
    throw paramError("该提示词不支持编辑");
  }
  return toSpecInfo(conn, spec, resolveOverride(conn, spec));
}

export interface PromptOverrideOptions {
  expectedValue?: string;
  force?: boolean;
}

/**
 * 保存校验（后端唯一权威，validate_prompt_save 同构）：空白 → 删行；与默认逐字一致 →
 * 删行（恢复默认语义）；超长 / 缺必要占位符 → PROMPT_VALIDATION_FAILED（文案列出
 * 上限值 / 缺失占位符名）；通过 → 落库 + 未知占位符警告（非阻断）。
 * 修订检测：expectedValue（读时 overrideText 基线）与库内当前行失配 →
 * SETTING_MODIFIED_ELSEWHERE（force 重发覆盖）。
 */
export function promptOverride(
  conn: Conn,
  key: string,
  value: string,
  opts: PromptOverrideOptions = {},
): { spec: PromptSpecInfo; unknownPlaceholders: string[] } {
  const spec = editableSpecByKey(key);
  if (spec === null || spec.storageKey === null) {
    throw paramError("该提示词不支持编辑");
  }
  const storageKey = spec.storageKey;
  return txImmediate(conn, () => {
    if (!opts.force && opts.expectedValue !== undefined) {
      const current = currentOverrideText(conn, spec) ?? "";
      if (current !== (opts.expectedValue ?? "")) {
        throw new PkyError("SETTING_MODIFIED_ELSEWHERE", "提示词覆盖已在另一处被修改", "确认覆盖请带 force 重发整值");
      }
    }
    if (value.trim() === "" || value === spec.defaultText) {
      deleteSetting(conn, storageKey);
      return { spec: toSpecInfo(conn, spec, resolveOverride(conn, spec)), unknownPlaceholders: [] };
    }
    if (Array.from(value).length > PROMPT_MAX_CHARS) {
      throw new PkyError("PROMPT_VALIDATION_FAILED", `提示词长度超过上限（最多 ${PROMPT_MAX_CHARS} 字符）`);
    }
    const missing = spec.requiredPlaceholders.filter((p) => !value.includes(p));
    if (missing.length > 0) {
      throw new PkyError("PROMPT_VALIDATION_FAILED", `缺少必要占位符：${missing.join("、")}`);
    }
    setSetting(conn, storageKey, value);
    return {
      spec: toSpecInfo(conn, spec, resolveOverride(conn, spec)),
      unknownPlaceholders: scanUnknownPlaceholders(value, spec.requiredPlaceholders),
    };
  });
}

/** 恢复默认 = 删行（「保存空白 → DELETE」现行语义的显式命令形态）；修订检测同上 */
export function promptReset(conn: Conn, key: string, opts: PromptOverrideOptions = {}): PromptSpecInfo {
  const spec = editableSpecByKey(key);
  if (spec === null || spec.storageKey === null) {
    throw paramError("该提示词不支持编辑");
  }
  const storageKey = spec.storageKey;
  return txImmediate(conn, () => {
    if (!opts.force && opts.expectedValue !== undefined) {
      const current = currentOverrideText(conn, spec) ?? "";
      if (current !== (opts.expectedValue ?? "")) {
        throw new PkyError("SETTING_MODIFIED_ELSEWHERE", "提示词覆盖已在另一处被修改", "确认覆盖请带 force 重发整值");
      }
    }
    deleteSetting(conn, storageKey);
    return toSpecInfo(conn, spec, resolveOverride(conn, spec));
  });
}

/**
 * 未知占位符扫描（scan_unknown_placeholders 同构）：`<[A-Z][A-Z0-9_]*>` 样式且不在
 * 已知集合；小写 / 混合大小写 token 不告警；重复 token 去重保序。
 */
export function scanUnknownPlaceholders(text: string, known: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "<") {
      const match = /^<[A-Z][A-Z0-9_]*>/.exec(text.slice(i));
      if (match !== null) {
        const token = match[0];
        if (!known.includes(token) && !out.includes(token)) {
          out.push(token);
        }
        i += token.length;
        continue;
      }
    }
    i += 1;
  }
  return out;
}
