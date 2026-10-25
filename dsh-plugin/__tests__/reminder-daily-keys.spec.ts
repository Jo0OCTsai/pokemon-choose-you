/**
 * reminder/daily-keys：当日去重键 CAS（AD §4.6）——当日一次、同日跨连接让位、
 * 次日可再抢；键名与桌面 fresh_start_last_run / review_last_notified 逐字一致。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, scalar, type TestDb } from "./helpers";
import { FRESH_START_LAST_RUN, REVIEW_LAST_NOTIFIED, claimDailyKey } from "../src/host/reminder/daily-keys";

describe("claimDailyKey 当日去重 CAS", () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb();
  });
  afterEach(() => {
    db.close();
  });

  it("键不存在 → 建行并抢到；同日再抢让位；次日可再抢", () => {
    expect(claimDailyKey(db.conn, FRESH_START_LAST_RUN, "2026-09-13")).toBe(true);
    expect(scalar(db.conn, "SELECT value FROM settings WHERE key=?", FRESH_START_LAST_RUN)).toBe("2026-09-13");
    expect(claimDailyKey(db.conn, FRESH_START_LAST_RUN, "2026-09-13")).toBe(false);
    expect(claimDailyKey(db.conn, FRESH_START_LAST_RUN, "2026-09-14")).toBe(true);
  });

  it("跨连接同窗竞争：只有一条连接抢到当日键（双形态仲裁）", () => {
    const other = db.secondConn();
    expect(claimDailyKey(db.conn, REVIEW_LAST_NOTIFIED, "2026-09-13")).toBe(true);
    expect(claimDailyKey(other, REVIEW_LAST_NOTIFIED, "2026-09-13")).toBe(false);
    expect(scalar(other, "SELECT value FROM settings WHERE key=?", REVIEW_LAST_NOTIFIED)).toBe("2026-09-13");
  });

  it("两键独立互不干扰（逾期归草丛与每周复盘各占一键）", () => {
    expect(claimDailyKey(db.conn, FRESH_START_LAST_RUN, "2026-09-13")).toBe(true);
    expect(claimDailyKey(db.conn, REVIEW_LAST_NOTIFIED, "2026-09-13")).toBe(true);
    expect(claimDailyKey(db.conn, FRESH_START_LAST_RUN, "2026-09-13")).toBe(false);
    expect(claimDailyKey(db.conn, REVIEW_LAST_NOTIFIED, "2026-09-13")).toBe(false);
  });

  it("键名与桌面逐字一致（跨形态仲裁键）", () => {
    expect(FRESH_START_LAST_RUN).toBe("fresh_start_last_run");
    expect(REVIEW_LAST_NOTIFIED).toBe("review_last_notified");
  });
});
