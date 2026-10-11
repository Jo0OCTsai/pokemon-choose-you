/**
 * health/logRing：环形缓冲容量、级别/来源过滤、limit 口径、最新在上、出口脱敏。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LogRing, LOG_RING_CAPACITY, logQuery, LOG_TAIL_DEFAULT } from "../src/host/health/logRing";
import { createTestDb, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

function pushSeq(ring: LogRing, n: number, level = "info"): void {
  for (let i = 1; i <= n; i++) {
    ring.log(level as "info", "radio/test", `消息 ${i}`, `2026-10-11T00:00:${String(i).padStart(2, "0")}+00:00`);
  }
}

describe("环形缓冲", () => {
  it("超容量丢最旧（2000 条滚动）", () => {
    const ring = new LogRing();
    pushSeq(ring, LOG_RING_CAPACITY + 300);
    expect(ring.size).toBe(LOG_RING_CAPACITY);
    const newest = ring.query({ limit: 1 }).entries[0];
    expect(newest.message).toBe(`消息 ${LOG_RING_CAPACITY + 300}`);
    expect(ring.query().total).toBe(LOG_RING_CAPACITY);
  });

  it("最新在上；offset 分页跳过最新条目", () => {
    const ring = new LogRing();
    pushSeq(ring, 3);
    const all = ring.query().entries;
    expect(all.map((e) => e.message)).toEqual(["消息 3", "消息 2", "消息 1"]);
    expect(ring.query({ offset: 1 }).entries[0].message).toBe("消息 2");
  });

  it("limit 默认 500、上限 2000，total 为匹配总数（不受 limit 截断）", () => {
    const ring = new LogRing();
    pushSeq(ring, 700);
    const q = ring.query();
    expect(q.entries.length).toBe(LOG_TAIL_DEFAULT);
    expect(q.total).toBe(700);
    expect(ring.query({ limit: 9999 }).entries.length).toBe(700);
  });
});

describe("过滤（级别 / 来源）", () => {
  it("minLevel 过滤在缓冲上执行（error≥warn≥info≥debug）", () => {
    const ring = new LogRing();
    ring.log("debug", "t/a", "d", "t1");
    ring.log("info", "t/a", "i", "t2");
    ring.log("warn", "t/b", "w", "t3");
    ring.log("error", "t/b", "e", "t4");
    expect(ring.query({ minLevel: "warn" }).entries.map((e) => e.message)).toEqual(["e", "w"]);
    expect(ring.query({ minLevel: "info" }).total).toBe(3);
    // 未知级别（rank 0）不参与 minLevel 语义（对齐 level_rank 口径）
    ring.push({ time: "t5", level: "note", target: "t/b", message: "n" });
    expect(ring.query({ minLevel: "debug" }).total).toBe(4);
  });

  it("target 精确过滤；组合 minLevel + target", () => {
    const ring = new LogRing();
    ring.log("info", "radio/pollLoop", "poll", "t1");
    ring.log("error", "judge/orchestrator", "judge", "t2");
    expect(ring.query({ target: "judge/orchestrator" }).entries.map((e) => e.message)).toEqual(["judge"]);
    expect(ring.query({ target: "radio/pollLoop", minLevel: "error" }).total).toBe(0);
  });
});

describe("logQuery 出口脱敏", () => {
  it("message 过三层管线：键名遮蔽，库内真名遮蔽；原始内存文本保留", () => {
    db.conn.prepare("INSERT INTO settings (key, value) VALUES ('feishu_my_name', '蔡乔蓉')").run();
    const ring = new LogRing();
    ring.log("warn", "radio/fetcher", "拉取失败 token=abc123def456 蔡乔蓉说的", "t1");
    const out = logQuery(db.conn, ring, {});
    expect(out.entries[0].message).toBe("拉取失败 token=*** ***说的");
    // 缓冲内的原文未被改写（脱敏只发生在出口拷贝）
    expect(ring.query().entries[0].message).toContain("abc123def456");
  });
});
