import { describe, expect, it } from "vitest";
import {
  MATE_AFTER_FOCUS_SEC,
  MATE_FALLBACK,
  mateSessionReset,
  pickMateSprite,
  shouldInviteMate,
} from "../src/state/mate.ts";

/** 陪跑（FR-B4）：专注满 25 分钟一位；默认关；一次会话一位；排除当前与主宝可梦 */
describe("shouldInviteMate", () => {
  const base = { enabled: true, working: true, focusSec: 25 * 60, present: false, shownThisSession: false };

  it("专注满 25 分钟且 working 且开 → 请", () => {
    expect(shouldInviteMate(base)).toBe(true);
    expect(MATE_AFTER_FOCUS_SEC).toBe(25 * 60);
  });
  it("差一秒不到 25 分钟 → 不请", () => {
    expect(shouldInviteMate({ ...base, focusSec: 25 * 60 - 1 })).toBe(false);
  });
  it("默认关（enabled=false）→ 永不请", () => {
    expect(shouldInviteMate({ ...base, enabled: false })).toBe(false);
  });
  it("非 working（暂停/无任务）→ 不请", () => {
    expect(shouldInviteMate({ ...base, working: false })).toBe(false);
  });
  it("已在场或本场已请 → 不再请（一次会话一位一次）", () => {
    expect(shouldInviteMate({ ...base, present: true })).toBe(false);
    expect(shouldInviteMate({ ...base, shownThisSession: true })).toBe(false);
  });
});

describe("pickMateSprite", () => {
  it("从池中挑一位且排除当前与主宝可梦", () => {
    const pool = ["pikachu", "psyduck", "chansey", "snorlax"];
    for (let i = 0; i < 20; i++) {
      const picked = pickMateSprite(pool, ["pikachu", "chansey"]);
      expect(["psyduck", "snorlax"]).toContain(picked);
    }
  });
  it("池空/全被排除 → 回退伊布", () => {
    expect(pickMateSprite([], ["pikachu"])).toBe(MATE_FALLBACK);
    expect(pickMateSprite(["pikachu"], ["pikachu"])).toBe(MATE_FALLBACK);
  });
  it("空串条目不入候选", () => {
    expect(pickMateSprite(["", "eevee"], [])).toBe("eevee");
  });
});

describe("mateSessionReset", () => {
  it("专注会话结束（running true→false）→ 重置标记", () => {
    expect(mateSessionReset(false, true)).toBe(true);
  });
  it("会话进行中/未开始过 → 不重置", () => {
    expect(mateSessionReset(true, false)).toBe(false);
    expect(mateSessionReset(true, true)).toBe(false);
    expect(mateSessionReset(false, false)).toBe(false);
  });
});
