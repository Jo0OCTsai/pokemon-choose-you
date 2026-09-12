import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import DexToggle from "../DexToggle.vue";

describe("DexToggle", () => {
  it("ON 状态显示默认文案并带 aria-pressed", () => {
    const w = mount(DexToggle, { props: { modelValue: true } });
    const btn = w.get("button");
    expect(btn.attributes("aria-pressed")).toBe("true");
    expect(btn.classes()).toContain("on");
    expect(btn.text()).toContain("ON");
  });

  it("OFF 状态显示 OFF 文案", () => {
    const w = mount(DexToggle, { props: { modelValue: false } });
    const btn = w.get("button");
    expect(btn.attributes("aria-pressed")).toBe("false");
    expect(btn.text()).toContain("OFF");
  });

  it("点击发出反向 update:modelValue", async () => {
    const w = mount(DexToggle, { props: { modelValue: false } });
    await w.get("button").trigger("click");
    expect(w.emitted("update:modelValue")).toEqual([[true]]);
    await w.setProps({ modelValue: true });
    await w.get("button").trigger("click");
    expect(w.emitted("update:modelValue")).toEqual([[true], [false]]);
  });

  it("支持自定义状态文案（草丛/路线）", () => {
    const w = mount(DexToggle, {
      props: { modelValue: false, onLabel: "丢进草丛", offLabel: "加入路线" },
    });
    expect(w.get("button").text()).toContain("加入路线");
  });
});
