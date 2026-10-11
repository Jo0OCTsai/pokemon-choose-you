import { describe, expect, it } from "vitest";
import { BUBBLE_MAX_MS, BUBBLE_MIN_MS, BUBBLE_MS_PER_CHAR, bubbleDuration } from "../src/state/bubbleTiming.ts";

describe("气泡时序计算（3.5s + 120ms/字 封顶 12s，与主应用同口径）", () => {
  it("空/短台词 = 基础 3.5s", () => {
    expect(bubbleDuration("")).toBe(BUBBLE_MIN_MS);
    expect(bubbleDuration("嗨")).toBe(BUBBLE_MIN_MS + BUBBLE_MS_PER_CHAR);
  });

  it("每字 +120ms（按 Unicode 码点：CJK 与 emoji 各算一个字）", () => {
    expect(bubbleDuration("就决定是你了！")).toBe(BUBBLE_MIN_MS + 7 * BUBBLE_MS_PER_CHAR);
    expect(bubbleDuration("🍅这轮番茄收工了，休息一下？")).toBe(BUBBLE_MIN_MS + 14 * BUBBLE_MS_PER_CHAR);
  });

  it("长台词封顶 12s", () => {
    expect(bubbleDuration("很".repeat(100))).toBe(BUBBLE_MAX_MS);
  });
});
