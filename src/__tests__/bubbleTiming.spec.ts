import { describe, expect, it } from "vitest";
import { BUBBLE_MAX_MS, BUBBLE_MIN_MS, BUBBLE_MS_PER_CHAR, bubbleDuration } from "../bubbleTiming";

describe("bubbleDuration 瞬态台词时长", () => {
  it("空文案给基础时长", () => {
    expect(bubbleDuration("")).toBe(BUBBLE_MIN_MS);
  });

  it("时长随长度线性递增", () => {
    expect(bubbleDuration("皮卡~")).toBe(BUBBLE_MIN_MS + 3 * BUBBLE_MS_PER_CHAR);
    expect(bubbleDuration("一二三四五六七八九十")).toBeGreaterThan(bubbleDuration("一二三"));
  });

  it("超长文案封顶", () => {
    expect(bubbleDuration("字".repeat(500))).toBe(BUBBLE_MAX_MS);
  });

  it("按 Unicode 码点计数，emoji 不折半", () => {
    expect(bubbleDuration("🎉🎉🎉🎉🎉")).toBe(BUBBLE_MIN_MS + 5 * BUBBLE_MS_PER_CHAR);
  });
});
