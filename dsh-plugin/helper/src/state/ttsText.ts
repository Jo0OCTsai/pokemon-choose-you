/**
 * TTS 文本预处理（host pet/ttsText.ts 同构——桌面 voice.rs 口径；helper 侧自触发面
 * [生日/对话回答/allDone 收工] 在发送前归一）：剥 emoji/符号/控制字符截 120 码点，
 * 剥完为空返回 null（不发送）。host→helper 的 tts-speak 已在 host 侧归一，此处仅供
 * helper 本地触发面，语义必须与 host 保持一致（两侧同源测试对齐）。
 */

/** emoji / 符号 / 控制字符（保留中日英与常用标点、↑↓ 时刻用语——桌面口径） */
function isSymbolIsh(cp: number): boolean {
  if (cp < 0x80) return cp < 0x20 || cp === 0x7f;
  if (cp >= 0x1f000 && cp <= 0x1faff) return true;
  if (cp >= 0x2600 && cp <= 0x27bf) return true;
  return cp >= 0x2190 && cp <= 0x21ff && cp !== 0x2191 && cp !== 0x2193;
}

/** 剥符号/emoji 截 120 码点；剥完为空返回 null（不发送） */
export function prepareTtsText(text: string): string | null {
  const cleaned = Array.from(text)
    .filter((ch) => !isSymbolIsh(ch.codePointAt(0) ?? 0))
    .slice(0, 120)
    .join("")
    .trim();
  return cleaned === "" ? null : cleaned;
}
