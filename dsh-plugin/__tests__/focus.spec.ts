/**
 * domain/focus：D16 整分钟入账 + dsh:focus_settled 幂等账本（滚动 100，A20）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FOCUS_LEDGER_LIMIT, FOCUS_SETTLED_KEY, parseLedger, settleFocus } from "../src/host/domain/focus";
import { getSetting } from "../src/host/domain/settings";
import { createTestDb, scalar, seedTask, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

describe("整分钟入账（D16）", () => {
  it("入账累加 focus_seconds（分钟 × 60），settled=true", () => {
    const task = seedTask(db.conn, "专注");
    const r = settleFocus(db.conn, { taskId: task, localSessionId: "s1", elapsedMin: 25 });
    expect(r).toEqual({ settled: true, focusSeconds: 25 * 60 });
    const r2 = settleFocus(db.conn, { taskId: task, localSessionId: "s2", elapsedMin: 5 });
    expect(r2.focusSeconds).toBe(30 * 60);
  });

  it("幂等：同一 localSessionId 重复 settle 跳过（账本命中，不重复入账）", () => {
    const task = seedTask(db.conn, "专注");
    settleFocus(db.conn, { taskId: task, localSessionId: "s1", elapsedMin: 25 });
    const again = settleFocus(db.conn, { taskId: task, localSessionId: "s1", elapsedMin: 25 });
    expect(again.settled).toBe(false);
    expect(again.focusSeconds).toBe(25 * 60);
    expect(scalar(db.conn, "SELECT focus_seconds FROM tasks WHERE id=?", task)).toBe(25 * 60);
  });

  it("账本滚动保留最近 100 个 localSessionId", () => {
    const task = seedTask(db.conn, "专注");
    for (let i = 0; i < FOCUS_LEDGER_LIMIT + 5; i++) {
      settleFocus(db.conn, { taskId: task, localSessionId: `s${i}`, elapsedMin: 1 });
    }
    const ledger = parseLedger(getSetting(db.conn, FOCUS_SETTLED_KEY));
    expect(ledger.length).toBe(FOCUS_LEDGER_LIMIT);
    expect(ledger[0]).toBe("s5");
    expect(ledger[ledger.length - 1]).toBe(`s${FOCUS_LEDGER_LIMIT + 4}`);
    // 被裁掉的 s0 再次 settle 会重新入账（账本只承诺 100 窗口内幂等）
    const r = settleFocus(db.conn, { taskId: task, localSessionId: "s0", elapsedMin: 1 });
    expect(r.settled).toBe(true);
  });
});

describe("整分钟入账（D16）·下", () => {
  it("elapsedMin=0 也入账 0 分钟并记账本（会话封口）", () => {
    const task = seedTask(db.conn, "专注");
    const r = settleFocus(db.conn, { taskId: task, localSessionId: "s0", elapsedMin: 0 });
    expect(r.settled).toBe(true);
    expect(r.focusSeconds).toBe(0);
  });

  it("参数校验：负数 / 非整数 / 空 localSessionId / 不存在的任务 拒绝", () => {
    const task = seedTask(db.conn, "专注");
    expect(() => settleFocus(db.conn, { taskId: task, localSessionId: "", elapsedMin: 1 })).toThrowError(
      /localSessionId/,
    );
    expect(() => settleFocus(db.conn, { taskId: task, localSessionId: "s", elapsedMin: -1 })).toThrowError(
      /elapsedMin/,
    );
    expect(() => settleFocus(db.conn, { taskId: task, localSessionId: "s", elapsedMin: 1.5 })).toThrowError(
      /elapsedMin/,
    );
    expect(() => settleFocus(db.conn, { taskId: 999, localSessionId: "s", elapsedMin: 1 })).toThrowError(/不存在/);
  });

  it("parseLedger：坏数据按空账本处理", () => {
    expect(parseLedger(null)).toEqual([]);
    expect(parseLedger("not json")).toEqual([]);
    expect(parseLedger('["a", 1, "b"]')).toEqual(["a", "b"]);
  });
});
