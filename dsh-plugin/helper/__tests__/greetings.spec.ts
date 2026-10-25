import { describe, expect, it } from "vitest";
import {
  InMemoryGreetStorage,
  PeriodGreeter,
  greetDedupKey,
  greetPeriod,
  type GreetStorage,
} from "../src/state/greetings.ts";

/** 每日时段问候（FR-B5）：早/午/晚/深夜每日各一次 */
describe("greetPeriod 时段带", () => {
  it("早 5–11 / 午 11–17 / 晚 17–22 / 深夜 22–5（跨零点）", () => {
    expect(greetPeriod(5)).toBe("morning");
    expect(greetPeriod(10)).toBe("morning");
    expect(greetPeriod(11)).toBe("day");
    expect(greetPeriod(16)).toBe("day");
    expect(greetPeriod(17)).toBe("evening");
    expect(greetPeriod(21)).toBe("evening");
    expect(greetPeriod(22)).toBe("night");
    expect(greetPeriod(23)).toBe("night");
    expect(greetPeriod(0)).toBe("night");
    expect(greetPeriod(4)).toBe("night");
  });
});

describe("greetDedupKey", () => {
  it("键含时段与自然日（同时段同日同键）", () => {
    const a = greetDedupKey("morning", new Date(2026, 9, 17, 8, 0));
    const b = greetDedupKey("morning", new Date(2026, 9, 17, 10, 30));
    expect(a).toBe(b);
    expect(greetDedupKey("day", new Date(2026, 9, 17, 12, 0))).not.toBe(a);
    expect(greetDedupKey("morning", new Date(2026, 9, 18, 8, 0))).not.toBe(a);
  });
});

describe("PeriodGreeter 各时段每日一次", () => {
  function makeStorage(): GreetStorage {
    return new InMemoryGreetStorage();
  }

  it("同时段当天只问候一次，换时段再问候", () => {
    let t = new Date(2026, 9, 17, 9, 0).getTime();
    const greeter = new PeriodGreeter(makeStorage(), () => new Date(t));
    expect(greeter.due()).toBe("morning");
    expect(greeter.due()).toBeNull(); // 同时段第二次 → null
    t = new Date(2026, 9, 17, 12, 0).getTime();
    expect(greeter.due()).toBe("day");
    t = new Date(2026, 9, 17, 18, 0).getTime();
    expect(greeter.due()).toBe("evening");
    t = new Date(2026, 9, 17, 23, 0).getTime();
    expect(greeter.due()).toBe("night");
    t = new Date(2026, 9, 17, 23, 30).getTime();
    expect(greeter.due()).toBeNull(); // 深夜已问候
  });

  it("次日同时段重新可问候", () => {
    let t = new Date(2026, 9, 17, 9, 0).getTime();
    const greeter = new PeriodGreeter(makeStorage(), () => new Date(t));
    expect(greeter.due()).toBe("morning");
    t = new Date(2026, 9, 18, 9, 0).getTime();
    expect(greeter.due()).toBe("morning");
  });

  it("存储不可用（null）→ 不问候（file:// 受限等场景直接放弃）", () => {
    const greeter = new PeriodGreeter(null, () => new Date());
    expect(greeter.due()).toBeNull();
  });
});
