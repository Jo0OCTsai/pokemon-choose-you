/**
 * 瞬态台词气泡的显示时长（VPet 范式：时长随文本长度自适应，说完自动淡出）。
 * 基础 3.5s 保证短台词读得完，每字 +120ms（约 8 字/秒的宽松阅读速度），封顶 12s。
 */
export const BUBBLE_MIN_MS = 3500;
export const BUBBLE_MS_PER_CHAR = 120;
export const BUBBLE_MAX_MS = 12_000;

export function bubbleDuration(text: string): number {
  // 按 Unicode 码点计数：CJK 与 emoji 都算一个字
  const chars = [...(text ?? "")].length;
  return Math.min(BUBBLE_MIN_MS + chars * BUBBLE_MS_PER_CHAR, BUBBLE_MAX_MS);
}
