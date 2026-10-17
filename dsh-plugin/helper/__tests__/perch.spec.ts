import { describe, expect, it } from "vitest";
import { PERCH_ZONE_PX, perchTransition, shouldPerch } from "../src/state/perch.ts";

/** 坐栖判定（FR-B1）：底边距工作区底 ≤72 逻辑像素即栖息；拎起即离开 */
describe("shouldPerch", () => {
  it("底边贴合工作区底缘 → 栖息", () => {
    expect(shouldPerch(1000, 1000)).toBe(true);
  });

  it("底边在底缘上方 72px 内 → 栖息（边界含）", () => {
    expect(shouldPerch(928, 1000)).toBe(true);
    expect(shouldPerch(928 - 1, 1000)).toBe(false);
  });

  it("压进任务栏区域（winBottom > workBottom）→ 栖息", () => {
    expect(shouldPerch(1080, 1000)).toBe(true);
  });

  it("自定义带宽（缩放场景）", () => {
    expect(shouldPerch(870, 1000, 144)).toBe(true);
    expect(shouldPerch(870, 1000, 72)).toBe(false);
  });

  it("默认带宽 = 72", () => {
    expect(PERCH_ZONE_PX).toBe(72);
  });
});

describe("perchTransition", () => {
  it("false → true = seat（首次落座，说落座台词）", () => {
    expect(perchTransition(false, true)).toBe("seat");
  });
  it("true → false = leave（拎起/拖离）", () => {
    expect(perchTransition(true, false)).toBe("leave");
  });
  it("状态不变 = none", () => {
    expect(perchTransition(true, true)).toBe("none");
    expect(perchTransition(false, false)).toBe("none");
  });
});
