import { describe, expect, it } from "vitest";
import {
  LineDedup,
  birthdayOf,
  companionDays,
  lineDedupKey,
  pickTimeLine,
  timeLinesBlocked,
} from "../src/state/timeLines.ts";

/** 时刻台词（FR-B2）：优先级 生日 > 深夜 > 周五晚 > 整点；普通类每天一次/整点类每小时一次 */
describe("pickTimeLine 优先级", () => {
  it("生日最高优先（深夜时段也生日胜出）", () => {
    const birthdayNight = new Date(2026, 9, 17, 23, 30); // 10-17 深夜
    expect(pickTimeLine(birthdayNight, { birthday: { month: 10, day: 17 } })).toBe("birthday");
  });

  it("深夜 23:00–04:59", () => {
    expect(pickTimeLine(new Date(2026, 0, 10, 23, 0))).toBe("night");
    expect(pickTimeLine(new Date(2026, 0, 10, 4, 59))).toBe("night");
    expect(pickTimeLine(new Date(2026, 0, 10, 5, 0))).not.toBe("night");
    expect(pickTimeLine(new Date(2026, 0, 10, 22, 59))).not.toBe("night");
  });

  it("周五晚 ≥18 点", () => {
    expect(pickTimeLine(new Date(2026, 9, 16, 18, 0))).toBe("friday"); // 2026-10-16 周五
    expect(pickTimeLine(new Date(2026, 9, 16, 20, 0))).toBe("friday");
    // 周五但 <18 → hour（在 9–18 内）
    expect(pickTimeLine(new Date(2026, 9, 16, 15, 0))).toBe("hour");
    // 周六晚 → null（18–23 非周五无台词）
    expect(pickTimeLine(new Date(2026, 9, 17, 20, 0))).toBeNull();
  });

  it("工作时段整点 9:00–18:59", () => {
    expect(pickTimeLine(new Date(2026, 0, 10, 9, 0))).toBe("hour");
    expect(pickTimeLine(new Date(2026, 0, 10, 18, 59))).toBe("hour");
    expect(pickTimeLine(new Date(2026, 0, 10, 8, 59))).toBeNull();
    expect(pickTimeLine(new Date(2026, 0, 10, 19, 30))).toBeNull();
  });

  it("无生日上下文不判生日", () => {
    expect(pickTimeLine(new Date(2026, 9, 17, 10, 0), {})).toBe("hour");
    expect(pickTimeLine(new Date(2026, 9, 17, 10, 0))).toBe("hour");
  });
});

describe("lineDedupKey 频次", () => {
  it("普通类每天一次（同日同键）", () => {
    const a = lineDedupKey("night", new Date(2026, 9, 17, 23, 1));
    const b = lineDedupKey("night", new Date(2026, 9, 17, 23, 59));
    expect(a).toBe(b);
    expect(lineDedupKey("night", new Date(2026, 9, 18, 0, 1))).not.toBe(a);
  });

  it("整点类每小时一次（同小时同键、换小时换键）", () => {
    const h9 = lineDedupKey("hour", new Date(2026, 9, 17, 9, 30));
    const h9b = lineDedupKey("hour", new Date(2026, 9, 17, 9, 59));
    const h10 = lineDedupKey("hour", new Date(2026, 9, 17, 10, 0));
    expect(h9).toBe(h9b);
    expect(h9).not.toBe(h10);
  });
});

describe("timeLinesBlocked 禁播闸门", () => {
  const open = { asleep: false, urgent: false, chatOpen: false, sceneBusy: false, dragging: false, quickOpen: false };
  it("全开 → 不拦", () => {
    expect(timeLinesBlocked(open)).toBe(false);
  });
  it("睡觉/urgent/对话/演出/拖拽/快捷屏 任一 → 拦", () => {
    expect(timeLinesBlocked({ ...open, asleep: true })).toBe(true);
    expect(timeLinesBlocked({ ...open, urgent: true })).toBe(true);
    expect(timeLinesBlocked({ ...open, chatOpen: true })).toBe(true);
    expect(timeLinesBlocked({ ...open, sceneBusy: true })).toBe(true);
    expect(timeLinesBlocked({ ...open, dragging: true })).toBe(true);
    expect(timeLinesBlocked({ ...open, quickOpen: true })).toBe(true);
  });
});

describe("生日数值面", () => {
  it("companionDays：整天下取整、至少 1", () => {
    const met = Date.UTC(2026, 0, 1);
    expect(companionDays(met, met + 86_400_000 * 30)).toBe(30);
    expect(companionDays(met, met + 86_400_000 * 30 + 3_600_000)).toBe(30);
    expect(companionDays(met, met)).toBe(1);
    expect(companionDays(0, met)).toBe(1);
  });

  it("birthdayOf：首次见面日的月/日（1 基）；非法时间戳 → null", () => {
    expect(birthdayOf(Date.UTC(2026, 9, 17, 3, 0))).toEqual({ month: 10, day: 17 });
    expect(birthdayOf(0)).toBeNull();
  });
});

describe("LineDedup 内存去重", () => {
  it("同键只消费一次", () => {
    const dedup = new LineDedup();
    expect(dedup.consume("k1")).toBe(true);
    expect(dedup.consume("k1")).toBe(false);
    expect(dedup.consume("k2")).toBe(true);
  });
});
