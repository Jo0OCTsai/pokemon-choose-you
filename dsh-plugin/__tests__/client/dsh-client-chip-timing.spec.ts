/**
 * chipTiming 纯函数（client/dsh/clientEntry）：chip 计时三态判定——相位归属当前任务
 * 且未到期 → 倒计时（break = resting；focus/trial 随任务 paused/running）；否则已专注
 * 时长快照。装配面见 dsh-client-entry.spec.tsx。
 */
import { describe, expect, it } from "vitest";
import { chipTiming } from "../../src/client/dsh/clientEntry";
import { makeTask } from "./fixtures";

describe("chipTiming · 相位归属与回落", () => {
  const now = Date.parse("2026-10-20T10:00:00Z");
  const task = makeTask({ id: 3, status: "active", startedAt: "2026-10-20T09:58:30Z" });
  const later = new Date(now + 90_000).toISOString();

  it("相位归属当前任务（或无归属）且未到期 → 倒计时秒；break → resting", () => {
    expect(chipTiming(task, { kind: "focus", endAt: later, durationMin: 25, taskId: 3 }, now)).toEqual({
      mode: "running",
      secondsLeft: 90,
    });
    expect(chipTiming(task, { kind: "trial", endAt: later, durationMin: null, taskId: null }, now)).toEqual({
      mode: "running",
      secondsLeft: 90,
    });
    expect(chipTiming(task, { kind: "break", endAt: later, durationMin: null, taskId: "3" }, now).mode).toBe("resting");
    expect(
      chipTiming({ ...task, status: "paused" }, { kind: "focus", endAt: later, durationMin: 25, taskId: 3 }, now).mode,
    ).toBe("paused");
  });

  it("相位归属别的任务 / 已到期 / 无相位 → 回落已专注时长快照（paused 随任务态）", () => {
    const elapsed = { mode: "running", secondsLeft: 90 };
    expect(chipTiming(task, { kind: "focus", endAt: later, durationMin: 25, taskId: 4 }, now)).toEqual(elapsed);
    expect(
      chipTiming(task, { kind: "focus", endAt: new Date(now - 1).toISOString(), durationMin: 25, taskId: 3 }, now),
    ).toEqual(elapsed);
    expect(chipTiming(task, null, now)).toEqual(elapsed);
    expect(chipTiming({ ...task, status: "paused" }, null, now).mode).toBe("paused");
    expect(chipTiming({ ...task, startedAt: null }, null, now).secondsLeft).toBe(0);
  });
});
