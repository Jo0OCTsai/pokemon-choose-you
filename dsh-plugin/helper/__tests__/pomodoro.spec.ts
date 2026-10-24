import { describe, expect, it } from "vitest";
import {
  DEFAULT_POMO_CONFIG,
  mmss,
  msLeft,
  ringProgress,
  startBreak,
  startFocus,
  startTrial,
  tickPhase,
  TRIAL_MIN,
} from "../src/state/pomodoro.ts";

describe("番茄本地计时（D2：绝不自动续轮）", () => {
  it("startFocus 默认档 = durations[1]（25min）；自定义档生效", () => {
    const p = startFocus(DEFAULT_POMO_CONFIG, 0);
    expect(p).toEqual({ kind: "focus", endAt: 25 * 60_000, durationMin: 25 });
    expect(startFocus(DEFAULT_POMO_CONFIG, 0, 45)).toMatchObject({ durationMin: 45 });
  });

  it("tickPhase：未到期不动；到期 ended 且 phase=null（不自动接休息/下一轮）", () => {
    const p = startFocus(DEFAULT_POMO_CONFIG, 0, 15);
    expect(tickPhase(p, 14 * 60_000)).toEqual({ phase: p, ended: false });
    const done = tickPhase(p, 15 * 60_000);
    expect(done).toEqual({ phase: null, ended: true });
  });

  it("🍦 先试 5 分钟（trial）到期同样不自动接休息", () => {
    const t = startTrial(0);
    expect(t).toEqual({ kind: "trial", endAt: TRIAL_MIN * 60_000 });
    expect(tickPhase(t, TRIAL_MIN * 60_000 + 1).ended).toBe(true);
  });

  it("break：startBreak 配置分钟；msLeft/mmss 倒计时口径", () => {
    // enabled 为 PomoConfig 必填（pomodoro_enabled parity）——本用例只测倒计时口径，置 true
    const b = startBreak({ durations: [25], breakMin: 5, enabled: true }, 0);
    expect(msLeft(b, 60_000)).toBe(4 * 60_000);
    expect(mmss(4 * 60_000)).toBe("04:00");
    expect(mmss(0)).toBe("00:00");
    expect(mmss(65_000)).toBe("01:05");
  });

  it("ringProgress：绿→琥珀→红（0.7/0.95 档位）；无 phase 返回 null", () => {
    const p = startFocus(DEFAULT_POMO_CONFIG, 0, 10);
    expect(ringProgress(null, 0)).toBeNull();
    expect(ringProgress(p, 0)?.tone).toBe("green");
    expect(ringProgress(p, 7 * 60_000)?.tone).toBe("amber");
    expect(ringProgress(p, 9 * 60_000 + 30_001)?.tone).toBe("red");
    expect(ringProgress(p, 20 * 60_000)?.pct).toBe(1);
  });
});
