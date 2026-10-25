import { describe, expect, it } from "vitest";
import { CpsGauge, bandOf, shouldEmitActivity, ACTIVITY_EMIT_MIN_GAP_MS } from "../src/state/inputCps.ts";

/** cps 滑动窗口（AD §4.4 只计数数值面）：窗口计数 + ≥1s 节流 + 三档 */
describe("CpsGauge", () => {
  it("窗口内事件数 = cps；窗口外滑出", () => {
    let t = 0;
    const gauge = new CpsGauge(() => t, 1_000);
    gauge.feed();
    gauge.feed();
    gauge.feed();
    t = 500;
    expect(gauge.sample()).toBe(3); // 全在窗口内
    t = 1_100;
    expect(gauge.sample()).toBe(0); // 全部滑出
  });

  it("半窗事件保留", () => {
    let t = 0;
    const gauge = new CpsGauge(() => t, 1_000);
    gauge.feed(); // t=0
    t = 600;
    gauge.feed(); // t=600
    t = 900;
    expect(gauge.sample()).toBe(2);
    t = 1_050; // t=0 滑出（900-1000 边界外）
    gauge.feed();
    expect(gauge.sample()).toBe(2);
  });

  it("缓冲封顶丢最旧（防无界增长）", () => {
    const t = 0;
    const gauge = new CpsGauge(() => t, 10_000, 4);
    for (let i = 0; i < 10; i++) gauge.feed();
    expect(gauge.sample()).toBe(4);
  });

  it("reset 清零（停止计数时）", () => {
    const gauge = new CpsGauge(() => 0);
    gauge.feed();
    gauge.reset();
    expect(gauge.sample()).toBe(0);
  });
});

describe("shouldEmitActivity 节流", () => {
  it("距上次上行 ≥1s 才允许（边界含）", () => {
    expect(shouldEmitActivity(0, 1_000)).toBe(true);
    expect(shouldEmitActivity(0, 999)).toBe(false);
    expect(ACTIVITY_EMIT_MIN_GAP_MS).toBe(1_000);
  });
  it("首报立即允许（-Infinity 语义）", () => {
    expect(shouldEmitActivity(Number.NEGATIVE_INFINITY, 0)).toBe(true);
  });
});

describe("bandOf 三档", () => {
  it("<2 静默 / 2–5 轻微 / ≥5 密集", () => {
    expect(bandOf(0)).toBe("silent");
    expect(bandOf(1.9)).toBe("silent");
    expect(bandOf(2)).toBe("light");
    expect(bandOf(4.9)).toBe("light");
    expect(bandOf(5)).toBe("dense");
    expect(bandOf(10)).toBe("dense");
  });
});
