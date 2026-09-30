import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promptIssueLevel, usePromptEditor } from "../composables/usePromptEditor";
import { flush, makeSpec, setup, SPECS } from "./helpers/promptEditorHarness";

/**
 * usePromptEditor 前端预校验与保存/恢复默认状态机（装载/缓冲/生命周期用例见
 * usePromptEditor.spec.ts；共享夹具与 harness 见 helpers/promptEditorHarness.ts）。
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("usePromptEditor 前端预校验：阻断级", () => {
  it("缺少必要占位符：列出全部缺失名（阻断级，保存禁用）", async () => {
    const { panels } = await setup();
    const pet = panels[1];
    pet.startEdit();
    pet.draft = "没有占位符的文本";
    const kinds = pet.issues.map((i) => i.kind);
    expect(kinds).toContain("missing");
    const missing = pet.issues.find((i) => i.kind === "missing");
    expect(missing?.names).toEqual(["<CONTEXT>", "<QUESTION>"]);
    expect(pet.canSave).toBe(false);
    pet.draft = "补了一个 <QUESTION>";
    expect(pet.issues.find((i) => i.kind === "missing")?.names).toEqual(["<CONTEXT>"]);
    pet.draft = "补齐 <CONTEXT> 与 <QUESTION>";
    expect(pet.issues.some((i) => i.kind === "missing")).toBe(false);
    expect(pet.canSave).toBe(true);
  });

  it("超长：字符数按 code point 计（[...str] 口径），超限阻断", async () => {
    const { panels } = await setup();
    const pet = panels[1];
    pet.startEdit();
    pet.draft = "<CONTEXT> <QUESTION> " + "a".repeat(20_000);
    const over = pet.issues.find((i) => i.kind === "overlong");
    expect(over).toMatchObject({ count: 20_021, limit: 20_000 });
    expect(pet.canSave).toBe(false);
    // emoji 是 2 个 UTF-16 单元但 1 个 code point：10000 个 emoji 不超限
    pet.draft = "<CONTEXT> <QUESTION> " + "😀".repeat(10_000);
    expect(pet.issues.some((i) => i.kind === "overlong")).toBe(false);
    expect(pet.canSave).toBe(true);
  });
});

describe("usePromptEditor 前端预校验：中性预告与分级", () => {
  it("空白与同默认是中性预告（不阻断保存）", async () => {
    const { panels } = await setup();
    const pet = panels[1];
    pet.startEdit();
    pet.draft = "   ";
    expect(pet.issues.map((i) => i.kind)).toEqual(["blank"]);
    expect(pet.canSave).toBe(true); // 空白保存 = 恢复默认
    pet.draft = SPECS[1].defaultText;
    expect(pet.issues.map((i) => i.kind)).toEqual(["sameDefault"]);
    expect(pet.canSave).toBe(true);
    // 本来就是默认的面板再输入等默认文本：不提示（避免噪音）
    const im = panels[0];
    im.startEdit();
    im.draft = SPECS[0].defaultText;
    expect(im.issues).toHaveLength(0);
  });

  it("分级映射：missing/overlong/saveFailed 阻断红、unknown 警告黄、blank/sameDefault 中性", () => {
    expect(promptIssueLevel({ kind: "missing", names: [] })).toBe("block");
    expect(promptIssueLevel({ kind: "overlong", count: 1, limit: 1 })).toBe("block");
    expect(promptIssueLevel({ kind: "saveFailed", message: "x" })).toBe("block");
    expect(promptIssueLevel({ kind: "unknown", names: [] })).toBe("warn");
    expect(promptIssueLevel({ kind: "blank" })).toBe("info");
    expect(promptIssueLevel({ kind: "sameDefault" })).toBe("info");
  });
});

describe("usePromptEditor 保存：成功与失败路径", () => {
  it("保存成功：以响应 spec 直接替换面板数据（前端零推导），退出编辑并留 4s 提示", async () => {
    const saved = makeSpec({ overrideText: "新规则 <AGENT_ID>", source: "custom" });
    const save = vi.fn(async () => ({ spec: saved, unknownPlaceholders: ["<FOO>"] }));
    const ed = usePromptEditor({ load: vi.fn(async () => SPECS), save });
    await flush();
    const im = ed.panels.value[0];
    im.startEdit();
    im.draft = "新规则 <AGENT_ID>";
    const ok = await im.save();
    expect(ok).toBe(true);
    expect(save).toHaveBeenCalledWith("ai_prompt_im_classify", "新规则 <AGENT_ID>");
    expect(im.spec.source).toBe("custom");
    expect(im.effectiveText).toBe("新规则 <AGENT_ID>"); // 状态来自后端响应，不本地推导
    expect(im.editing).toBe(false);
    expect(im.dirty).toBe(false);
    expect(im.hint).toBe("saved");
    expect(im.issues.find((i) => i.kind === "unknown")?.names).toEqual(["<FOO>"]); // 未知占位符仅展示后端清单
    vi.advanceTimersByTime(3_999);
    expect(im.hint).toBe("saved");
    vi.advanceTimersByTime(1);
    expect(im.hint).toBeNull();
  });

  it("保存失败：编辑态与缓冲保留，后端 Invalid 文案进校验区，修正后可再存", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("缺少必要占位符：<AGENT_ID>"))
      .mockResolvedValue({
        spec: makeSpec({ source: "custom", overrideText: "x <AGENT_ID>" }),
        unknownPlaceholders: [],
      });
    const ed = usePromptEditor({ load: vi.fn(async () => SPECS), save });
    await flush();
    const im = ed.panels.value[0];
    im.startEdit();
    // 前端预校验通过（含必要占位符），但后端兜底复验拒绝（如默认文本演进的并发场景）
    im.draft = "前端校验放行 <AGENT_ID> 后端仍拒绝";
    await expect(im.save()).resolves.toBe(false);
    expect(im.editing).toBe(true);
    expect(im.draft).toBe("前端校验放行 <AGENT_ID> 后端仍拒绝");
    expect(im.issues.find((i) => i.kind === "saveFailed")?.message).toBe("缺少必要占位符：<AGENT_ID>");
    im.draft = "补齐 <AGENT_ID>";
    await expect(im.save()).resolves.toBe(true);
    expect(im.issues.some((i) => i.kind === "saveFailed")).toBe(false);
  });
});

describe("usePromptEditor 保存：前置拦截与空白路径", () => {
  it("阻断级校验未过时 save 直接拒绝，不发起后端调用", async () => {
    const { panels, save } = await setup();
    const pet = panels[1];
    pet.startEdit();
    pet.draft = "缺占位符";
    await expect(pet.save()).resolves.toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("空白保存走同一保存路径（= 恢复默认语义）", async () => {
    const { panels, save } = await setup();
    const pet = panels[1];
    pet.startEdit();
    pet.draft = "";
    await expect(pet.save()).resolves.toBe(true);
    expect(save).toHaveBeenCalledWith("ai_prompt_pet_chat", "");
  });
});

describe("usePromptEditor 恢复默认两步确认", () => {
  it('恢复默认两步：确认后经 save(key, "") 删行，spec 回 default 并提示', async () => {
    const restored = makeSpec({
      id: "pet_chat",
      storageKey: "ai_prompt_pet_chat",
      overrideText: null,
      source: "default",
    });
    const save = vi.fn(async () => ({ spec: restored, unknownPlaceholders: [] }));
    const ed = usePromptEditor({ load: vi.fn(async () => SPECS), save });
    await flush();
    const pet = ed.panels.value[1];
    pet.requestRestore();
    expect(pet.confirming).toBe(true);
    pet.cancelRestore();
    expect(pet.confirming).toBe(false);
    expect(save).not.toHaveBeenCalled();
    pet.requestRestore();
    await expect(pet.confirmRestore()).resolves.toBe(true);
    expect(save).toHaveBeenCalledWith("ai_prompt_pet_chat", "");
    expect(pet.confirming).toBe(false);
    expect(pet.spec.source).toBe("default");
    expect(pet.hint).toBe("restored");
  });

  it("恢复失败（后端拒绝）：确认条保持，错误文案可见", async () => {
    const save = vi.fn().mockRejectedValue(new Error("该提示词不支持编辑"));
    const ed = usePromptEditor({ load: vi.fn(async () => SPECS), save });
    await flush();
    const pet = ed.panels.value[1];
    pet.requestRestore();
    await expect(pet.confirmRestore()).resolves.toBe(false);
    expect(pet.confirming).toBe(true);
    expect(pet.issues.find((i) => i.kind === "saveFailed")?.message).toBe("该提示词不支持编辑");
  });
});
