/**
 * TTS 文本预处理（桌面 src-tauri/src/voice.rs 同构，full-parity AD §4.3 tts-speak 行）：
 * 台词里的 emoji/状态符号系统 TTS 念不出还占时长——剥掉后截 120 码点；剥完为空则不发送。
 * host 侧在发送面前归一（helper 收到的 tts-speak 文本已是桌面口径）。
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
