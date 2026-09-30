import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { usePromptEditor } from "../composables/usePromptEditor";
import { flush, makeSpec, setup, SPECS } from "./helpers/promptEditorHarness";

/**
 * usePromptEditor 装载/三态映射/编辑缓冲/提示行生命周期（保存/恢复/校验用例见
 * usePromptEditor.save.spec.ts；共享夹具与 harness 见 helpers/promptEditorHarness.ts）。
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("usePromptEditor 装载与三态映射", () => {
  it("装载成功后面板按目录顺序就绪，loading 复位，无错误", async () => {
    const { panels } = await setup();
    expect(panels.map((p) => p.id)).toEqual(["im_classify", "pet_chat", "tag_health", "dispatch"]);
  });

  it("三态映射：default 生效文本=内置默认；custom 生效文本=覆盖原文并标记有覆盖", async () => {
    const { panels } = await setup();
    const im = panels[0];
    expect(im.spec.source).toBe("default");
    expect(im.effectiveText).toBe(SPECS[0].defaultText);
    expect(im.hasOverride).toBe(false);
    const pet = panels[1];
    expect(pet.spec.source).toBe("custom");
    expect(pet.effectiveText).toBe(SPECS[1].overrideText);
    expect(pet.hasOverride).toBe(true);
  });

  it("default_warned 生效文本回落内置默认，但编辑预填覆盖原文供修复", async () => {
    const warned = makeSpec({
      overrideText: "旧版覆盖，缺新占位符",
      source: "default_warned",
      missingPlaceholders: ["<AGENT_ID>"],
    });
    const { panels } = await setup([warned]);
    const p = panels[0];
    expect(p.effectiveText).toBe(warned.defaultText);
    p.startEdit();
    expect(p.draft).toBe("旧版覆盖，缺新占位符");
    expect(p.hasOverride).toBe(true); // 恢复默认入口可见
  });

  it("装载失败：loadError 呈现原始错误文本，面板清空；重试成功后恢复", async () => {
    const ed = usePromptEditor({
      load: vi.fn().mockRejectedValueOnce(new Error("db 繁忙")).mockResolvedValueOnce(SPECS),
      save: vi.fn(),
    });
    await flush();
    expect(ed.loadError.value).toBe("db 繁忙");
    expect(ed.panels.value).toHaveLength(0);
    await ed.reload();
    expect(ed.loadError.value).toBeNull();
    expect(ed.panels.value).toHaveLength(4);
  });
});

describe("usePromptEditor 编辑缓冲与脏检查", () => {
  it("进入编辑：预填覆盖原文（无覆盖时预填内置默认），初始不脏；修改后脏", async () => {
    const { panels } = await setup();
    const pet = panels[1];
    pet.startEdit();
    expect(pet.editing).toBe(true);
    expect(pet.draft).toBe(SPECS[1].overrideText);
    expect(pet.dirty).toBe(false);
    pet.draft = "改过的桌宠 <CONTEXT> <QUESTION>";
    expect(pet.dirty).toBe(true);
    const im = panels[0];
    im.startEdit();
    expect(im.draft).toBe(SPECS[0].defaultText); // 无覆盖 → 预填默认
  });

  it("取消编辑：退出编辑态、丢弃缓冲、回看已保存状态", async () => {
    const { panels } = await setup();
    const pet = panels[1];
    pet.startEdit();
    pet.draft = "半成品";
    pet.cancelEdit();
    expect(pet.editing).toBe(false);
    expect(pet.dirty).toBe(false);
    expect(pet.effectiveText).toBe(SPECS[1].overrideText); // 已保存内容不受影响
    pet.startEdit();
    expect(pet.draft).toBe(SPECS[1].overrideText); // 重新进入预填已保存内容
  });

  it("派发只读面板 startEdit 是 no-op（安全结构不可编辑）", async () => {
    const { panels } = await setup();
    const dis = panels[3];
    dis.startEdit();
    expect(dis.editing).toBe(false);
    expect(dis.draft).toBe("");
  });
});

describe("usePromptEditor 提示行生命周期", () => {
  it("组件卸载后清理 4s 提示定时器（无泄漏）", async () => {
    const save = vi.fn(async () => ({
      spec: makeSpec({ source: "custom", overrideText: "x <AGENT_ID>" }),
      unknownPlaceholders: [],
    }));
    let ed: ReturnType<typeof usePromptEditor> | undefined;
    const Host = defineComponent({
      setup() {
        ed = usePromptEditor({ load: vi.fn(async () => SPECS), save });
        return () => h("div");
      },
    });
    const w = mount(Host);
    await flush();
    const im = ed!.panels.value[0];
    im.startEdit();
    im.draft = "新文本 <AGENT_ID>";
    await im.save();
    expect(im.hint).toBe("saved");
    w.unmount();
    vi.advanceTimersByTime(10_000);
    expect(im.hint).toBe("saved"); // 定时器已随卸载销毁，提示不再被清除
  });
});
