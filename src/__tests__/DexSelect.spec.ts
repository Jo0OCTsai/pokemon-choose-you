import { afterEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import DexSelect from "../DexSelect.vue";

const options = [
  { value: "a", label: "选项甲" },
  { value: "b", label: "选项乙" },
  { value: "c", label: "选项丙" },
];

afterEach(() => {
  document.body.innerHTML = "";
});

describe("DexSelect", () => {
  it("按钮显示当前选中项的 label", () => {
    const w = mount(DexSelect, { props: { modelValue: "b", options } });
    expect(w.get(".ds-btn").text()).toContain("选项乙");
    expect(w.find(".ds-list").exists()).toBe(false);
  });

  it("点击按钮展开/收起选项列表", async () => {
    const w = mount(DexSelect, { props: { modelValue: "a", options } });
    await w.get(".ds-btn").trigger("click");
    expect(w.findAll(".ds-list li")).toHaveLength(3);
    expect(w.get(".ds-list li.sel").text()).toContain("选项甲");
    await w.get(".ds-btn").trigger("click");
    expect(w.find(".ds-list").exists()).toBe(false);
  });

  it("选择选项后更新 model 并收起", async () => {
    const w = mount(DexSelect, { props: { modelValue: "a", options } });
    await w.get(".ds-btn").trigger("click");
    await w.findAll(".ds-list li")[2].trigger("click");
    expect(w.emitted("update:modelValue")).toEqual([["c"]]);
    expect(w.find(".ds-list").exists()).toBe(false);
  });

  it("组件外 mousedown 关闭列表", async () => {
    const w = mount(DexSelect, { props: { modelValue: "a", options }, attachTo: document.body });
    await w.get(".ds-btn").trigger("click");
    expect(w.find(".ds-list").exists()).toBe(true);
    document.dispatchEvent(new MouseEvent("mousedown"));
    await new Promise((r) => setTimeout(r));
    expect(w.find(".ds-list").exists()).toBe(false);
  });

  it("未知值回退显示原始值", () => {
    const w = mount(DexSelect, { props: { modelValue: "zzz", options } });
    expect(w.get(".ds-btn").text()).toContain("zzz");
  });
});
