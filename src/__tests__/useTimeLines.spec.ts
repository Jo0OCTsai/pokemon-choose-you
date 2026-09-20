import { describe, expect, it } from "vitest";
import { lineDedupKey, pickTimeLine } from "../composables/useTimeLines";

describe("useTimeLines 时刻台词", () => {
  it("工作时段（9~18 点）eligible 整点台词", () => {
    expect(pickTimeLine(new Date(2026, 8, 12, 10, 0))).toBe("hour"); // 周六上午也加油
    expect(pickTimeLine(new Date(2026, 8, 12, 9, 0))).toBe("hour");
    expect(pickTimeLine(new Date(2026, 8, 12, 18, 30))).toBe("hour");
    expect(pickTimeLine(new Date(2026, 8, 12, 8, 59))).toBeNull();
    expect(pickTimeLine(new Date(2026, 8, 12, 19, 0))).toBeNull();
    expect(pickTimeLine(new Date(2026, 8, 12, 21, 0))).toBeNull();
  });

  it("深夜（≥23 点或 <5 点）eligible 深夜台词", () => {
    expect(pickTimeLine(new Date(2026, 8, 12, 23, 0))).toBe("night");
    expect(pickTimeLine(new Date(2026, 8, 13, 2, 0))).toBe("night");
    expect(pickTimeLine(new Date(2026, 8, 12, 22, 59))).toBeNull();
  });

  it("周五 18 点后 eligible 周五晚台词（18 点前还是整点台词）", () => {
    expect(pickTimeLine(new Date(2026, 8, 11, 19, 0))).toBe("friday"); // 2026-09-11 周五
    expect(pickTimeLine(new Date(2026, 8, 11, 17, 0))).toBe("hour");
    expect(pickTimeLine(new Date(2026, 8, 12, 19, 0))).toBeNull(); // 周六晚不播周五台词
  });

  it("精灵生日优先级最高（即使撞上深夜时段）", () => {
    const d = new Date(2026, 8, 12, 23, 30);
    expect(pickTimeLine(d, { birthday: { month: 9, day: 12 } })).toBe("birthday");
    expect(pickTimeLine(d, { birthday: { month: 9, day: 13 } })).toBe("night");
  });

  it("去重键：整点按小时分桶，其余按天", () => {
    const a = new Date(2026, 8, 12, 10, 5);
    const b = new Date(2026, 8, 12, 11, 5);
    const c = new Date(2026, 8, 13, 10, 5);
    expect(lineDedupKey("hour", a)).not.toBe(lineDedupKey("hour", b));
    expect(lineDedupKey("hour", a)).not.toBe(lineDedupKey("hour", c));
    expect(lineDedupKey("night", a)).toBe(lineDedupKey("night", b));
    expect(lineDedupKey("friday", a)).not.toBe(lineDedupKey("friday", c));
  });
});
