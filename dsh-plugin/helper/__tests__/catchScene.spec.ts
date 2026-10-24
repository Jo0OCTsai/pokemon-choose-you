import { describe, expect, it } from "vitest";
import {
  MILESTONES,
  crossedMilestone,
  planCatchScene,
  plainSceneSeq,
  sceneStarCount,
  streakCeremonyDays,
  streakSceneSeq,
} from "../src/state/catchScene.ts";

/** 连胜/里程碑演出判定（FR-B3）：里程碑优先、互不叠加；连胜 = 今日首捕且 ≥3 天 */
describe("crossedMilestone", () => {
  it("跨过 100 阈值（99 → 100）", () => {
    expect(crossedMilestone(99, 100)).toBe(100);
  });
  it("未跨过 → null（99→99 / 99→99 与 101→120 无阈值）", () => {
    expect(crossedMilestone(99, 99)).toBeNull();
    expect(crossedMilestone(101, 120)).toBeNull();
  });
  it("一次跨过多个阈值取最高（8 → 120 → 100）", () => {
    expect(crossedMilestone(8, 120)).toBe(100);
  });
  it("数据缺失（null）或倒退 → null", () => {
    expect(crossedMilestone(null, 100)).toBeNull();
    expect(crossedMilestone(99, null)).toBeNull();
    expect(crossedMilestone(100, 99)).toBeNull();
  });
  it("阈值集 = {10,50,100,200,500,1000}", () => {
    expect([...MILESTONES]).toEqual([10, 50, 100, 200, 500, 1000]);
  });
});

describe("streakCeremonyDays", () => {
  it("今日首捕（0 → >0）且连胜 ≥3 天 → 天数", () => {
    expect(streakCeremonyDays({ days: 5, todayCount: 0 }, { days: 5, todayCount: 1 })).toBe(5);
  });
  it("连胜 <3 天 → null", () => {
    expect(streakCeremonyDays({ days: 2, todayCount: 0 }, { days: 2, todayCount: 1 })).toBeNull();
  });
  it("非今日首捕（今日已有完成）→ null", () => {
    expect(streakCeremonyDays({ days: 5, todayCount: 1 }, { days: 5, todayCount: 2 })).toBeNull();
  });
  it("快照缺失 → null", () => {
    expect(streakCeremonyDays(null, { days: 5, todayCount: 1 })).toBeNull();
    expect(streakCeremonyDays({ days: 5, todayCount: 0 }, null)).toBeNull();
  });
});

describe("planCatchScene 里程碑优先互不叠加（Gherkin「里程碑优先」）", () => {
  it("图鉴 99 且连胜 5 天今日首捕 → milestone（不叠加 streak）", () => {
    expect(planCatchScene({ milestone: 100, streakDays: 5 })).toBe("milestone");
  });
  it("无里程碑、连胜达标 → streak", () => {
    expect(planCatchScene({ milestone: null, streakDays: 3 })).toBe("streak");
  });
  it("默认 plain", () => {
    expect(planCatchScene({})).toBe("plain");
    expect(planCatchScene({ milestone: null, streakDays: null })).toBe("plain");
  });
});

describe("演出时序表", () => {
  it("单球 ≤1.5s（桌面节拍：蹲 120 → 飞 300 → 落地 350 → 三摇 600 → 星星收场）", () => {
    const seq = plainSceneSeq();
    expect(seq.at(-1)!.at).toBeLessThanOrEqual(1500);
    expect(seq[0]).toMatchObject({ phase: "crouch" });
    expect(seq.filter((s) => s.phase === "land")).toHaveLength(1);
    expect(seq.filter((s) => s.phase === "shake")).toHaveLength(1);
  });
  it("双球三摇 ~2.2s（桌面实拍节拍）、双球侧 ±1 交替、各摇 2 轮", () => {
    const seq = streakSceneSeq();
    expect(seq.at(-1)!.at).toBeLessThanOrEqual(2300);
    expect(seq.filter((s) => s.phase === "shake" && s.side === -1)).toHaveLength(2);
    expect(seq.filter((s) => s.phase === "shake" && s.side === 1)).toHaveLength(2);
  });
  it("星星档位：milestone 12 / streak 14 / plain 6", () => {
    expect(sceneStarCount("milestone")).toBe(12);
    expect(sceneStarCount("streak")).toBe(14);
    expect(sceneStarCount("plain")).toBe(6);
  });
});
