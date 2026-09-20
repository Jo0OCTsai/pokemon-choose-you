import { describe, expect, it } from "vitest";
import { PERCH_ZONE_PX, shouldPerch } from "../composables/usePerch";

describe("usePerch 边缘栖息判定", () => {
  const workBottom = 900; // 工作区底缘（任务栏上沿）

  it("窗口底边贴到工作区底缘 ≤72px 判栖息", () => {
    expect(shouldPerch(900, workBottom)).toBe(true); // 正好贴住
    expect(shouldPerch(850, workBottom)).toBe(true); // 50px 内
    expect(shouldPerch(900 - PERCH_ZONE_PX, workBottom)).toBe(true); // 恰好 72px
    expect(shouldPerch(827, workBottom)).toBe(false); // 73px，还差一点
    expect(shouldPerch(400, workBottom)).toBe(false); // 悬在半空
  });

  it("压进任务栏区域也算栖息（拖过头松手）", () => {
    expect(shouldPerch(950, workBottom)).toBe(true);
  });

  it("阈值可随缩放放大（物理像素判定）", () => {
    expect(shouldPerch(900 - 144, workBottom, 144)).toBe(true); // 2x 屏：144 物理px
    expect(shouldPerch(900 - 145, workBottom, 144)).toBe(false);
  });
});
