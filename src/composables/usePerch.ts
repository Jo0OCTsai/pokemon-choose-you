/**
 * 屏幕边缘栖息（PET_EXPERIENCE_PROPOSAL F4）：拖拽松手时判定窗口底缘是否落在
 * 任务栏 / Dock 上沿一带（≤72px），是则切「坐着/趴着」姿态（动画幅度减半）。
 * 只做姿态修饰，不新增状态机状态；攀爬/窗口交互不做（红线）。
 */

/** 栖息判定带宽度（逻辑像素）：窗口底边距工作区底缘不超过这么近就算「到了边上」 */
export const PERCH_ZONE_PX = 72;

/**
 * 纯判定：winBottom = 窗口底边 y，workBottom = 当前显示器工作区底边 y。
 * 窗口底边在工作区底缘上方 ≤PERCH_ZONE_PX、或压进任务栏区域时均算栖息。
 */
export function shouldPerch(winBottom: number, workBottom: number, zone = PERCH_ZONE_PX): boolean {
  return workBottom - winBottom <= zone;
}
