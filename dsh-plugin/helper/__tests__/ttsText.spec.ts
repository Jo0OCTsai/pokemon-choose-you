/**
 * helper 侧 TTS 文本归一（state/ttsText.ts——host pet/ttsText.ts 同构语义）：
 * 剥 emoji/符号/控制字符截 120 码点、保留 ↑↓；剥完为空 → null（不发送）。
 * 两侧语义由本用例与 host 侧用例共同钉住（helper 自触发面：生日/对话回答/allDone）。
 */
import { describe, expect, it } from "vitest";
import { prepareTtsText } from "../src/state/ttsText.ts";

describe("prepareTtsText（桌面 voice.rs 口径）", () => {
  it("剥 emoji 与装饰符号，保留正文与 ↑↓", () => {
    expect(prepareTtsText("🎉 今日图鉴圆满！皮卡丘说：收工，好好休息！")).toBe(
      "今日图鉴圆满！皮卡丘说：收工，好好休息！",
    );
    expect(prepareTtsText("🐾 连胜 5 天了↑↓！")).toBe("连胜 5 天了↑↓！");
  });

  it("截 120 码点；剥完为空 → null", () => {
    expect(prepareTtsText("🎉🎉🎉")).toBeNull();
    expect(prepareTtsText(`${"字".repeat(130)}`)).toHaveLength(120);
  });
});
