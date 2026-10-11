/**
 * radio/watermark：读取、CAS 推进、双写、他形态竞争合并（双连接交错不丢不重）；
 * radio/backoff：倍数序列与间隔口径。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { advanceWatermark, readWatermark, WATERMARK_SETTING_KEY } from "../src/host/radio/watermark";
import { backoffFactor, pollIntervalSecs, sleepSeconds } from "../src/host/radio/backoff";
import { createTestDb, scalar, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

describe("watermark 读取与推进", () => {
  it("空库读 null；首拉推进双写生效", () => {
    expect(readWatermark(db.conn)).toBeNull();
    const out = advanceWatermark(db.conn, null, 1000, "2026-10-11T00:00:00+00:00");
    expect(out).toEqual({ advanced: true, cursor: 1000 });
    expect(readWatermark(db.conn)).toBe(1000);
    expect(scalar(db.conn, "SELECT cursor FROM sync_state WHERE provider='feishu'")).toBe("1000");
    expect(scalar(db.conn, "SELECT value FROM settings WHERE key=?", WATERMARK_SETTING_KEY)).toBe("1000");
  });

  it("oldCursor 匹配时 CAS 推进生效", () => {
    advanceWatermark(db.conn, null, 1000);
    const out = advanceWatermark(db.conn, 1000, 2000, "2026-10-11T00:01:00+00:00");
    expect(out.advanced).toBe(true);
    expect(readWatermark(db.conn)).toBe(2000);
  });

  it("CAS 失配（他形态已推进）：重读合并取 max，水位不回退", () => {
    advanceWatermark(db.conn, null, 1000);
    // 本形态还拿着旧水位 1000，他形态已推到 5000
    advanceWatermark(db.conn, 1000, 5000);
    // 本形态带着过期的 old=1000 想推 3000：CAS 落空 → 合并保 5000
    const out = advanceWatermark(db.conn, 1000, 3000, "2026-10-11T00:02:00+00:00");
    expect(out).toEqual({ advanced: false, cursor: 5000 });
    expect(readWatermark(db.conn)).toBe(5000);
    // 反向：过期方的新值更大时合并抬升到 max
    const up = advanceWatermark(db.conn, 1000, 8000, "2026-10-11T00:03:00+00:00");
    expect(up).toEqual({ advanced: true, cursor: 8000 });
  });

  it("sync_state 行缺失但 settings 镜像存在（崩溃半写）：推进收敛双写", () => {
    db.conn.prepare("INSERT INTO settings (key, value) VALUES ('feishu_cursor', '700')").run();
    expect(readWatermark(db.conn)).toBe(700);
    const out = advanceWatermark(db.conn, 700, 900, "2026-10-11T00:04:00+00:00");
    expect(out.advanced).toBe(true);
    expect(scalar(db.conn, "SELECT cursor FROM sync_state WHERE provider='feishu'")).toBe("900");
  });
});

describe("watermark 双连接交错（不丢不重）", () => {
  it("两连接各持旧水位交错推进：收敛到 max，两处存储一致", () => {
    const a = db.conn;
    const b = db.secondConn();
    advanceWatermark(a, null, 1000);
    // A、B 同时读到 1000，各自拉取后先后推进
    const fromA = advanceWatermark(a, 1000, 2600, "2026-10-11T00:05:00+00:00");
    const fromB = advanceWatermark(b, 1000, 2500, "2026-10-11T00:05:01+00:00");
    expect(fromA.advanced).toBe(true);
    expect(fromB.advanced).toBe(false);
    const final = readWatermark(b);
    expect(final).toBe(2600);
    // 双写一致（两连接视角相同）
    expect(scalar(b, "SELECT cursor FROM sync_state WHERE provider='feishu'")).toBe("2600");
    expect(scalar(b, "SELECT value FROM settings WHERE key='feishu_cursor'")).toBe("2600");
  });

  it("并发首拉：INSERT 抢占一方胜出，另一方合并", () => {
    const a = db.conn;
    const b = db.secondConn();
    const r1 = advanceWatermark(a, null, 1000);
    const r2 = advanceWatermark(b, null, 1500);
    expect(r1.advanced).toBe(true);
    expect(r2.cursor).toBe(1500);
    expect(readWatermark(a)).toBe(1500);
  });
});

describe("backoff", () => {
  it("失败计数驱动的倍数序列：1→2→4→8 封顶，成功复位", () => {
    expect([0, 1, 2, 3, 4, 10].map(backoffFactor)).toEqual([1, 2, 4, 8, 8, 8]);
    expect(backoffFactor(-1)).toBe(1);
  });

  it("睡眠秒数 = 间隔 × 倍数", () => {
    expect(sleepSeconds(120, 0)).toBe(120);
    expect(sleepSeconds(120, 1)).toBe(240);
    expect(sleepSeconds(30, 3)).toBe(240);
  });

  it("间隔读取：非法/过小回落默认 120；≥30 下限", () => {
    expect(pollIntervalSecs(db.conn)).toBe(120);
    for (const bad of ["abc", "0", "10", "-5"]) {
      db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('feishu_poll_interval', ?)").run(bad);
      expect(pollIntervalSecs(db.conn)).toBe(120);
    }
    db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('feishu_poll_interval', '300')").run();
    expect(pollIntervalSecs(db.conn)).toBe(300);
  });
});
