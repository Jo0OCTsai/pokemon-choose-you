import { vi } from "vitest";
import { usePromptEditor, type PromptPanelState } from "../../composables/usePromptEditor";
import type { PromptSpecInfo, SavePromptResult } from "../../types";

/**
 * usePromptEditor 系列 spec 的共享测试基座：specs 夹具（4 功能目录样本：默认态/
 * 自定义态/空占位符/只读派发）与装载 harness（load/save fake 注入 + 微任务冲刷）。
 * 装载/缓冲用例与保存/恢复/校验用例分属两个 spec 文件，共用本基座避免夹具复制。
 */

export function makeSpec(over: Partial<PromptSpecInfo> = {}): PromptSpecInfo {
  return {
    id: "im_classify",
    storageKey: "ai_prompt_im_classify",
    editable: true,
    defaultText: "默认判定器，agent 标识 <AGENT_ID>。",
    requiredPlaceholders: ["<AGENT_ID>"],
    lengthLimit: 20000,
    overrideText: null,
    source: "default",
    missingPlaceholders: [],
    overlong: false,
    ...over,
  };
}

export const SPECS: PromptSpecInfo[] = [
  makeSpec(),
  makeSpec({
    id: "pet_chat",
    storageKey: "ai_prompt_pet_chat",
    defaultText: "桌宠默认 <CONTEXT> <QUESTION>",
    requiredPlaceholders: ["<CONTEXT>", "<QUESTION>"],
    overrideText: "自定义桌宠 <CONTEXT> <QUESTION>",
    source: "custom",
  }),
  makeSpec({
    id: "tag_health",
    storageKey: "ai_prompt_tag_health",
    defaultText: "标签治理指令（词表由应用追加）",
    requiredPlaceholders: [],
  }),
  makeSpec({
    id: "dispatch",
    storageKey: null,
    editable: false,
    defaultText: "派发提示词示例（含定界块结构）",
    requiredPlaceholders: [],
  }),
];

export interface Ctx {
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  panels: PromptPanelState[];
}

/** 微任务冲刷（fake timers 下 setTimeout 不会走，装载是纯微任务链） */
export async function flush(ticks = 5): Promise<void> {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

/** 装载完成后取面板集合（按 id 取用方便） */
export async function setup(
  specs: PromptSpecInfo[] = SPECS,
  saveImpl?: (key: string, value: string) => Promise<SavePromptResult>,
): Promise<Ctx> {
  const load = vi.fn(async () => specs);
  const save = vi.fn(
    saveImpl ?? (async (): Promise<SavePromptResult> => ({ spec: specs[0], unknownPlaceholders: [] })),
  );
  const ed = usePromptEditor({ load, save });
  await flush();
  return { load, save, panels: ed.panels.value };
}
