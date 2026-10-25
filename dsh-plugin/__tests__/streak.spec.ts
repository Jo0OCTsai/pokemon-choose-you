/**
 * domain/streak：连胜纯核心（FR-B3 三 Gherkin + 400 回溯边界）与 streakFromDb 薄封装
 * （真实临时库：DISTINCT 本地日去重、今日捕捉计数）。行为基准 = 桌面 pet.rs
 * streak_eval / streak_conn（contracts/fixtures/streak 由 Rust oracle 锁定）。
 */
import { describe, expect, it } from "vitest";
import { createTestDb, scalar, type TestDb } from "./helpers";
import { STREAK_LOOKBACK_DAYS, parseDay, streakEval, streakFromDb } from "../src/host/domain/streak";

const DAY = 86_400_000;

/** 以 today 为锚生成 done 本地日集合（offset 0 = 今天） */
function daySet(today: string, offsets: number[]): Set<string> {
  const base = parseDay(today);
  if (base === null) {
    throw new Error(`bad today: ${today}`);
  }
  return new Set(offsets.map((o) => new Date(base - o * DAY).toISOString().slice(0, 10)));
}

describe("streakEval 纯核心（FR-B3 宽容日算法）", () => {
  const today = "2026-09-13";

  it("宽容日：第一个空天消耗宽容日、第二个空天即断、今日未完成不算断", () => {
    // 近 4 日本地自然日完成情况 有/无/无/无（今天为「无」且未结束）：今天空着用掉
    // 唯一宽容日，昨天计一天；再往前第一个空天即断 → 连胜 1 天且不清零
    expect(streakEval(daySet(today, [1]), today, 0)).toEqual({ days: 1, todayCount: 0 });
    // 最早捕捉在 4 天前（今天/昨天/前天三连空）→ 第二个空天即断 → 0
    expect(streakEval(daySet(today, [4]), today, 0)).toEqual({ days: 0, todayCount: 0 });
  });

  it("今日未完成不清零：昨天+前天连续 → 连胜 2 天且 todayCount=0", () => {
    expect(streakEval(daySet(today, [1, 2]), today, 0)).toEqual({ days: 2, todayCount: 0 });
  });

  it("宽容日可落在连胜中段（今天、前天、大前天有 → 3 天）", () => {
    expect(streakEval(daySet(today, [0, 2, 3]), today, 1)).toEqual({ days: 3, todayCount: 1 });
  });

  it("同日多捕计一：days 按自然日去重，todayCount 原样带回", () => {
    expect(streakEval(daySet(today, [0, 1]), today, 3)).toEqual({ days: 2, todayCount: 3 });
  });

  it("回溯上限 400 天：恰好 400 / 超出 / 今日空三边界", () => {
    expect(STREAK_LOOKBACK_DAYS).toBe(400);
    const span = (from: number, to: number): Set<string> => {
      const offsets: number[] = [];
      for (let i = from; i <= to; i++) {
        offsets.push(i);
      }
      return daySet(today, offsets);
    };
    expect(streakEval(span(0, 399), today, 1).days).toBe(400);
    expect(streakEval(span(0, 400), today, 1).days).toBe(400);
    expect(streakEval(span(1, 400), today, 0).days).toBe(399);
  });

  it("非法 today / 非法日期串防御", () => {
    expect(() => streakEval(new Set(), "2026-02-30", 0)).toThrow();
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay("2026-13-01")).toBeNull();
    expect(parseDay("not-a-day")).toBeNull();
    // doneDays 内的非法串在收集侧过滤（契约 op 同口径：filter_map parse.ok）
  });
});

describe("streakFromDb（桌面 streak_conn 镜像 · 真实临时库）", () => {
  // tz 口径：SQL date(completed_at,'localtime') 按机器时区折算（桌面同款）——
  // 用本地正午完成时刻播种，避开午夜边界使断言时区无关（Rust seed_done 同手法）
  let db: TestDb;
  function seedDone(title: string, localDayOffset: number): void {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - localDayOffset, 12, 0, 0);
    const at = d.toISOString();
    db.conn
      .prepare("INSERT INTO tasks (title, status, created_at, completed_at) VALUES (?, 'done', ?, ?)")
      .run(title, at, at);
  }

  it("连续三天（今天/昨天/前天）→ days=3、todayCount=1", () => {
    db = createTestDb();
    for (const off of [0, 1, 2]) {
      seedDone(`t${off}`, off);
    }
    expect(streakFromDb(db.conn)).toEqual({ days: 3, todayCount: 1 });
    db.close();
  });

  it("今天空 + 昨天有 → days=1 不清零；同日多捕 DISTINCT 去重", () => {
    db = createTestDb();
    seedDone("a", 1);
    seedDone("b", 1);
    expect(streakFromDb(db.conn)).toEqual({ days: 1, todayCount: 0 });
    db.close();
  });

  it("空库 / 非空未完成 → days=0、todayCount=0", () => {
    db = createTestDb();
    expect(streakFromDb(db.conn)).toEqual({ days: 0, todayCount: 0 });
    db.conn
      .prepare("INSERT INTO tasks (title, status, created_at) VALUES ('open', 'active', '2026-01-01T00:00:00Z')")
      .run();
    expect(streakFromDb(db.conn)).toEqual({ days: 0, todayCount: 0 });
    db.close();
  });

  it("注入 now：today 口径跟随注入时钟（todayCount 只数注入今日）", () => {
    db = createTestDb();
    seedDone("today-noon", 0);
    const tomorrow = new Date(new Date().setHours(12, 0, 0, 0) + DAY);
    expect(streakFromDb(db.conn, tomorrow)).toEqual({ days: 1, todayCount: 0 });
    expect(scalar(db.conn, "SELECT COUNT(*) FROM tasks")).toBe(1);
    db.close();
  });
});
