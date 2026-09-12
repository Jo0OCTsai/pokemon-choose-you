import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import DexDateTime from "../DexDateTime.vue";
import { i18n } from "../i18n";

// 固定"今天"，避免月末/年末边界导致用例不稳定
const FAKE_NOW = new Date(2026, 8, 12, 15, 0, 0); // 2026-09-12 周六

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FAKE_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function mountDt(modelValue: string) {
  return mount(DexDateTime, {
    props: { modelValue },
    global: { plugins: [i18n] },
  });
}

/** 与组件同款的 Intl 月份标题（zh-Hans → zh-CN） */
function monthTitle(y: number, m: number) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(
    new Date(y, m, 1),
  );
}

describe("DexDateTime", () => {
  it("未设置时显示占位文案", () => {
    const w = mountDt("");
    expect(w.get(".dt-btn").text()).toContain("未设置");
  });

  it("已设置时按钮显示格式化的日期时间", () => {
    const w = mountDt("2026-09-13T14:30");
    expect(w.get(".dt-btn").text()).toContain("2026-09-13 14:30");
  });

  it("弹出日历：当前月、周一开头、今日高亮", async () => {
    const w = mountDt("");
    await w.get(".dt-btn").trigger("click");
    expect(w.get(".dt-title").text()).toBe(monthTitle(2026, 8));
    // 2026-09-01 是周二 → 首格留白 1 个；周一窄称 "一"
    expect(w.findAll(".dt-week")[0].text()).toBe("一");
    const blanks = w.findAll(".dt-day.blank");
    expect(blanks).toHaveLength(1);
    expect(w.get(".dt-day.today").text()).toBe("12");
    expect(w.findAll(".dt-day:not(.blank)")).toHaveLength(30);
  });

  it("选日期：未选过时间默认 09:00，已选过时间保留", async () => {
    const w = mountDt("2026-09-13T14:30");
    await w.get(".dt-btn").trigger("click");
    // 点 20 号：保留已有时间部分
    const day20 = w.findAll(".dt-day").find((d) => d.text() === "20")!;
    await day20.trigger("click");
    const emitted = w.emitted("update:modelValue")!;
    expect(emitted[emitted.length - 1]).toEqual(["2026-09-20T14:30"]);

    const w2 = mountDt("");
    await w2.get(".dt-btn").trigger("click");
    const day20b = w2.findAll(".dt-day").find((d) => d.text() === "20")!;
    await day20b.trigger("click");
    const emitted2 = w2.emitted("update:modelValue")!;
    expect(emitted2[emitted2.length - 1]).toEqual(["2026-09-20T09:00"]);
  });

  it("月份导航跨年回绕", async () => {
    const w = mountDt("2026-09-13T09:00");
    await w.get(".dt-btn").trigger("click");
    const [prev, next] = w.findAll(".nav-btn");
    await prev.trigger("click");
    expect(w.get(".dt-title").text()).toBe(monthTitle(2026, 7));
    await next.trigger("click");
    await next.trigger("click");
    await next.trigger("click");
    await next.trigger("click");
    expect(w.get(".dt-title").text()).toBe(monthTitle(2026, 11));
  });

  it("清空按钮置空并收起弹层", async () => {
    const w = mountDt("2026-09-13T09:00");
    await w.get(".dt-btn").trigger("click");
    await w.get(".clear-btn").trigger("click");
    const emitted3 = w.emitted("update:modelValue")!;
    expect(emitted3[emitted3.length - 1]).toEqual([""]);
    expect(w.find(".dt-pop").exists()).toBe(false);
  });
});
