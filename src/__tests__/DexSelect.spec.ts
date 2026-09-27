import { afterEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import DexSelect from "../components/DexSelect.vue";

const options = [
  { value: "a", label: "选项甲" },
  { value: "b", label: "选项乙" },
  { value: "c", label: "选项丙" },
  { value: "d", label: "选项丁（禁用）", disabled: true },
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
    expect(w.findAll(".ds-list li")).toHaveLength(4);
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

  it("disabled 选项不可选：点击不更新 model 且列表不收起", async () => {
    const w = mount(DexSelect, { props: { modelValue: "a", options } });
    await w.get(".ds-btn").trigger("click");
    await w.findAll(".ds-list li")[3].trigger("click");
    expect(w.emitted("update:modelValue")).toBeUndefined();
    expect(w.find(".ds-list").exists()).toBe(true);
    // 语义与视觉：li 带 disabled 类与 aria-disabled
    const li = w.findAll(".ds-list li")[3];
    expect(li.classes()).toContain("disabled");
    expect(li.attributes("aria-disabled")).toBe("true");
  });

  it("ariaLabel 透传到触发按钮；列表带 listbox/option 语义", async () => {
    const w = mount(DexSelect, { props: { modelValue: "a", options, ariaLabel: "维度选择" } });
    expect(w.get(".ds-btn").attributes("aria-label")).toBe("维度选择");
    await w.get(".ds-btn").trigger("click");
    expect(w.get(".ds-list").attributes("role")).toBe("listbox");
    const lis = w.findAll(".ds-list li");
    expect(lis[0].attributes("role")).toBe("option");
    expect(lis[0].attributes("aria-selected")).toBe("true");
    expect(lis[1].attributes("aria-selected")).toBe("false");
  });
});
