/**
 * 坐栖判定（FR-B1，语义移植主应用 composables/usePerch.ts）：拖拽落定后窗口底边
 * 距工作区底缘 ≤72 逻辑像素（或压进任务栏/Dock 区域）即栖息——姿态幅度减半 +
 * 首次判定说落座台词；拎起（drag-start）即离开。
 *
 * 纯判定不触屏：Electron 侧 win.getBounds() 与 screen.workArea 同为 DIP，
 * 无需桌面 Tauri 的 scaleFactor 换算（调用方传逻辑像素即可）。
 */

/** 栖息判定带宽度（逻辑像素） */
export const PERCH_ZONE_PX = 72;

/**
 * 纯判定：winBottom = 窗口底边 y，workBottom = 当前显示器工作区底边 y。
 * 底边落在工作区底缘上方 ≤zone、或压进任务栏区域（winBottom > workBottom）均算栖息。
 */
export function shouldPerch(winBottom: number, workBottom: number, zone = PERCH_ZONE_PX): boolean {
  return workBottom - winBottom <= zone;
}

/** 坐栖状态迁移：拎起即离开；落定后进入/离开按 shouldPerch 结果，返回是否为「首次落座」 */
export function perchTransition(prev: boolean, next: boolean): "seat" | "leave" | "none" {
  if (next && !prev) return "seat";
  if (!next && prev) return "leave";
  return "none";
}
