import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bandOf, hopScaleFor, useInputResponse } from "../composables/useInputResponse";

describe("useInputResponse 输入响应", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.documentElement.classList.remove("reduce-motion");
  });
  afterEach(() => vi.useRealTimers());

  describe("纯函数分档", () => {
    it("bandOf：<2 静默 · 2~5 轻打字 · ≥5 密集", () => {
      expect(bandOf(0)).toBe("silent");
      expect(bandOf(1)).toBe("silent");
      expect(bandOf(2)).toBe("light");
      expect(bandOf(4)).toBe("light");
      expect(bandOf(5)).toBe("dense");
      expect(bandOf(10)).toBe("dense");
    });

    it("hopScaleFor：静默恢复默认；耦合上限 +10%", () => {
      expect(hopScaleFor(0)).toBeNull();
      expect(hopScaleFor(1)).toBeNull();
      // cps=10 → 1/1.1 ≈ 0.909（时长缩到 90.9% = 频率 +10% 封顶）
      expect(hopScaleFor(10)).toBeCloseTo(1 / 1.1, 4);
      expect(hopScaleFor(50)).toBeCloseTo(1 / 1.1, 4);
      // 轻档只轻微加速（cps=2 → 1/1.02）
      expect(hopScaleFor(2)).toBeCloseTo(1 / 1.02, 4);
    });
  });

  describe("跟随反应（有冷却，互斥让路）", () => {
    function makeCtl(over: Partial<Parameters<typeof useInputResponse>[0]> = {}) {
      const calls = { wiggle: 0, notice: 0, doze: 0, scales: [] as (number | null)[] };
      const ctl = useInputResponse({
        isEnabled: () => true,
        isWorking: () => false,
        isWorkingCoupled: () => false,
        isBusy: () => false,
        onWiggle: () => calls.wiggle++,
        onNotice: () => calls.notice++,
        onDoze: () => calls.doze++,
        onHopScale: (s) => calls.scales.push(s),
        ...over,
      });
      ctl.start();
      return { ctl, calls };
    }

    it("轻打字触发微抖，冷却内不重复（持续打字场景）", () => {
      const { ctl, calls } = makeCtl();
      ctl.feed(3); // 先喂一次让档位立即生效，之后喂入器维持
      const feeder = setInterval(() => ctl.feed(3), 700); // 模拟真实连续打字（后端每秒喂入）
      vi.advanceTimersByTime(500);
      expect(calls.wiggle).toBe(1);
      vi.advanceTimersByTime(2000); // 仍在 2.6s 冷却内
      expect(calls.wiggle).toBe(1);
      vi.advanceTimersByTime(1500); // 过冷却（t≈4s，距首次 >2.6s）
      expect(calls.wiggle).toBe(2);
      clearInterval(feeder);
      ctl.stop();
    });

    it("密集档偶尔认真看（6s 冷却，持续打字场景）", () => {
      const { ctl, calls } = makeCtl();
      ctl.feed(8);
      const feeder = setInterval(() => ctl.feed(8), 700);
      vi.advanceTimersByTime(700);
      expect(calls.notice).toBe(1);
      vi.advanceTimersByTime(2000);
      expect(calls.notice).toBe(1);
      vi.advanceTimersByTime(4400); // t≈7.1s，距首次 >6s
      expect(calls.notice).toBe(2);
      clearInterval(feeder);
      ctl.stop();
    });

    it("停顿 >3s 后来一次哈欠/看你，再打字重置", () => {
      const { ctl, calls } = makeCtl();
      ctl.feed(4);
      vi.advanceTimersByTime(500);
      expect(calls.doze).toBe(0);
      vi.advanceTimersByTime(3100); // 静默 3s+（feed 断流按静默处理）
      expect(calls.doze).toBe(1);
      vi.advanceTimersByTime(1000);
      expect(calls.doze).toBe(1); // 一次为限
      ctl.feed(4);
      vi.advanceTimersByTime(4100);
      expect(calls.doze).toBe(2); // 重新打字后再停顿会再来一次
      ctl.stop();
    });

    it("忙时（演出中）不做小反应，但节奏耦合继续", () => {
      const { ctl, calls } = makeCtl({ isWorking: () => true, isWorkingCoupled: () => true });
      ctl.feed(10);
      vi.advanceTimersByTime(500);
      expect(calls.wiggle).toBe(0);
      expect(calls.scales.at(-1)).toBeCloseTo(1 / 1.1, 4);
      ctl.stop();
      expect(calls.scales.at(-1)).toBeNull(); // stop 恢复默认
    });

    it("working 但子开关关：不耦合", () => {
      const { ctl, calls } = makeCtl({ isWorking: () => true, isWorkingCoupled: () => false });
      ctl.feed(10);
      vi.advanceTimersByTime(500);
      expect(calls.scales.at(-1)).toBeNull();
      ctl.stop();
    });

    it("事件断流 >1.5s 按静默处理", () => {
      const { ctl, calls } = makeCtl();
      ctl.feed(6);
      vi.advanceTimersByTime(500);
      expect(calls.wiggle).toBe(1);
      vi.advanceTimersByTime(1600); // 没有新的 feed
      expect(calls.wiggle).toBe(1); // 不再反应（视为静默）
      ctl.stop();
    });
  });
});
