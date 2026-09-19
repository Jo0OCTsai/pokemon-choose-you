import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { motionReduced, usePetIdle } from "../composables/usePetIdle";

describe("usePetIdle 生命感调度器", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.documentElement.classList.remove("reduce-motion");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("空闲态按随机间隔派发微动作，且同一时间只有一个", () => {
    const fired: string[] = [];
    const ctl = usePetIdle({ isBusy: () => false, isWorking: () => false, trigger: (a) => fired.push(a) });
    ctl.start();
    vi.advanceTimersByTime(60_000); // 远超最大间隔 9s，应多次触发
    expect(fired.length).toBeGreaterThanOrEqual(6);
    ctl.stop();
    const count = fired.length;
    vi.advanceTimersByTime(60_000);
    expect(fired.length).toBe(count); // stop 后不再调度
  });

  it("working 态只派发眨眼（专注时不打扰）", () => {
    const fired: string[] = [];
    const ctl = usePetIdle({ isBusy: () => false, isWorking: () => true, trigger: (a) => fired.push(a) });
    ctl.start();
    vi.advanceTimersByTime(120_000);
    expect(fired.length).toBeGreaterThan(0);
    expect(fired.every((a) => a === "blink")).toBe(true);
    ctl.stop();
  });

  it("忙时跳过但不中断调度", () => {
    let busy = true;
    const fired: string[] = [];
    const ctl = usePetIdle({ isBusy: () => busy, isWorking: () => false, trigger: (a) => fired.push(a) });
    ctl.start();
    vi.advanceTimersByTime(30_000);
    expect(fired).toHaveLength(0);
    busy = false;
    vi.advanceTimersByTime(30_000);
    expect(fired.length).toBeGreaterThan(0);
    ctl.stop();
  });

  it("减弱动效时调度器不启动", () => {
    document.documentElement.classList.add("reduce-motion");
    const fired: string[] = [];
    const ctl = usePetIdle({ isBusy: () => false, isWorking: () => false, trigger: (a) => fired.push(a) });
    ctl.start();
    vi.advanceTimersByTime(60_000);
    expect(fired).toHaveLength(0);
  });

  it("motionReduced 跟随 html.reduce-motion 类", () => {
    expect(motionReduced()).toBe(false);
    document.documentElement.classList.add("reduce-motion");
    expect(motionReduced()).toBe(true);
  });
});
