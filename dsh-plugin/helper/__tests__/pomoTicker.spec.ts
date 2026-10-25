/**
 * 番茄收尾出口用例（B3 + 决策3 对齐桌面）：focus 到期自动接短休息（breakMin>0 且非
 * trial）、trial 零挫败收尾、到期系统通知（sys.notify 记录器断言）、长番茄 chime 打点
 * （中点 1 声 / 剩 5 分钟 2 声，仅 ≥45min 且 chime 开）。fake timers 驱动 1s tick。
 */
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHelperRuntime, type UiEvent } from "../src/runtime/index.ts";
import type { HeadlessSys } from "../src/sys/index.ts";
import { PomoTicker } from "../src/runtime/pomoTicker.ts";

function makeHarness() {
  const events: UiEvent[] = [];
  const runtime = createHelperRuntime({
    input: new PassThrough(),
    output: new PassThrough(),
    onUiEvent: (ev) => events.push(ev),
  });
  return { runtime, sys: runtime.sys as HeadlessSys, events };
}

const CFG = { durations: [15, 25, 45, 60], breakMin: 5, enabled: true, notify: false, chime: false };

describe("PomoTicker tick 出口", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("focus 到期回调 kind=focus；chime 关不打点", () => {
    const ended: string[] = [];
    const chimes: number[] = [];
    const t = new PomoTicker(
      () => Date.now(),
      (k) => ended.push(k),
      (c) => chimes.push(c),
    );
    t.config = { ...CFG, durations: [45] };
    t.beginFocus(45);
    vi.setSystemTime(Date.now() + 23 * 60_000);
    vi.advanceTimersByTime(1_000);
    expect(chimes).toEqual([]);
    vi.setSystemTime(Date.now() + 30 * 60_000);
    vi.advanceTimersByTime(1_000);
    expect(ended).toEqual(["focus"]);
    t.dispose();
  });
});

describe("PomoTicker 长番茄打点", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("chime 开 + ≥45min：中点 1 声、剩 5 分钟 2 声（各一次不重复）", () => {
    const chimes: number[] = [];
    const t = new PomoTicker(
      () => Date.now(),
      () => undefined,
      (c) => chimes.push(c),
    );
    t.config = { ...CFG, chime: true };
    t.beginFocus(45);
    vi.setSystemTime(Date.now() + 23 * 60_000);
    vi.advanceTimersByTime(1_000);
    expect(chimes).toEqual([1]);
    vi.setSystemTime(Date.now() + 18 * 60_000); // 剩 ~4min（过 5min 线）
    vi.advanceTimersByTime(1_000);
    expect(chimes).toEqual([1, 2]);
    vi.advanceTimersByTime(2_000);
    expect(chimes).toEqual([1, 2]); // 各一次，不重复
    t.dispose();
  });

  it("chime 开 + 15min 短番茄全程不打点", () => {
    const chimes: number[] = [];
    const t = new PomoTicker(
      () => Date.now(),
      () => undefined,
      (c) => chimes.push(c),
    );
    t.config = { ...CFG, chime: true };
    t.beginFocus(15);
    vi.setSystemTime(Date.now() + 14 * 60_000);
    vi.advanceTimersByTime(1_000);
    expect(chimes).toEqual([]); // 短番茄全程无打点
    t.dispose();
  });
});

describe("runtime 番茄收尾（决策3：自动接休息 + 通知）", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("focus 到期：气泡 + 自动进 break（breakMin>0）；notify 关不发声", () => {
    const h = makeHarness();
    h.runtime.pomo.beginFocus(15);
    vi.advanceTimersByTime(15 * 60_000 + 1_100);
    const texts = h.events.filter((e) => e.kind === "bubble").map((e) => (e as { text: string }).text);
    expect(texts.some((t) => t.includes("番茄收工"))).toBe(true);
    expect(texts.includes("☕ 休息一下")).toBe(true);
    expect(h.runtime.pomoPhase?.kind).toBe("break");
    expect(h.sys.notify.records.some((r) => r.kind === "pomo-done")).toBe(false);
    h.runtime.dispose();
  });

  it("notify 开 → 到期系统通知；trial 到期零挫败收尾不接休息", () => {
    const input = new PassThrough();
    const events: UiEvent[] = [];
    const runtime = createHelperRuntime({
      input,
      output: new PassThrough(),
      onUiEvent: (ev) => events.push(ev),
    });
    input.write(
      `${JSON.stringify({
        type: "pomodoro-config",
        durations: [15, 25, 45, 60],
        breakMin: 5,
        enabled: true,
        notify: true,
        chime: false,
        lang: "zh-Hans",
      })}\n`,
    );
    runtime.pomo.beginFocus(15);
    vi.advanceTimersByTime(15 * 60_000 + 1_100);
    expect((runtime.sys as HeadlessSys).notify.records.some((r) => r.kind === "pomo-done")).toBe(true);
    runtime.pomo.beginTrial();
    vi.advanceTimersByTime(5 * 60_000 + 1_100);
    expect(runtime.pomoPhase).toBeNull();
    expect(
      events.filter((e) => e.kind === "bubble").some((e) => (e as { text: string }).text.includes("5 分钟打卡")),
    ).toBe(true);
    runtime.dispose();
  });
});
