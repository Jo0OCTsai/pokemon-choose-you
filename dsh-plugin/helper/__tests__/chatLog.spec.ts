import { describe, expect, it } from "vitest";
import { CHAT_HISTORY_MAX, CHAT_MAX_QUESTION, chatQuestion, pushChatEntry } from "../src/state/chatLog.ts";

/** AI 聊聊数值面（FR-A8）：问题 ≤200 字符；历史内存 3 条不持久化 */
describe("chatQuestion 校验", () => {
  it("trim 后非空 → 通过并返回 trim 文本", () => {
    expect(chatQuestion("  连胜几天了？ ")).toBe("连胜几天了？");
  });
  it("空/纯空白 → null", () => {
    expect(chatQuestion("")).toBeNull();
    expect(chatQuestion("   ")).toBeNull();
  });
  it("≤200 字符（码点计）→ 通过；201 → null", () => {
    const q200 = "a".repeat(200);
    expect(chatQuestion(q200)).toBe(q200);
    expect(chatQuestion("a".repeat(201))).toBeNull();
    expect(CHAT_MAX_QUESTION).toBe(200);
  });
});

describe("pushChatEntry 历史封顶", () => {
  it("超过 3 条挤出最旧", () => {
    let log = pushChatEntry([], { role: "bot", text: "greet" });
    log = pushChatEntry(log, { role: "user", text: "q1" });
    log = pushChatEntry(log, { role: "bot", text: "a1" });
    log = pushChatEntry(log, { role: "user", text: "q2" });
    expect(log).toHaveLength(CHAT_HISTORY_MAX);
    expect(log.map((e) => e.text)).toEqual(["q1", "a1", "q2"]);
  });
  it("不满 3 条原样追加", () => {
    const log = pushChatEntry(pushChatEntry([], { role: "user", text: "q" }), { role: "bot", text: "a" });
    expect(log).toHaveLength(2);
    expect(CHAT_HISTORY_MAX).toBe(3);
  });
});
