/** storage/db：连接 PRAGMA、txImmediate 短事务助手（禁止嵌套/失败回滚） */
import { describe, expect, it } from "vitest";
import { CONN_PRAGMAS, getUserVersion, nowRfc3339, txImmediate } from "../src/host/storage/db";
import { createTestDb } from "./helpers";

describe("open：连接级 PRAGMA（db.rs CONN_PRAGMAS 逐字一致）", () => {
  it("WAL + NORMAL + busy_timeout=5000 打开即生效", () => {
    const db = createTestDb();
    try {
      expect(db.conn.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
      expect(db.conn.prepare("PRAGMA synchronous").get()).toEqual({ synchronous: 1 });
      expect(db.conn.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
    } finally {
      db.close();
    }
  });

  it("PRAGMA 常量字符串与主应用逐字一致", () => {
    expect(CONN_PRAGMAS).toBe("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;");
  });
});

describe("txImmediate：单条 BEGIN IMMEDIATE 短事务", () => {
  it("成功路径提交可见", () => {
    const db = createTestDb();
    try {
      txImmediate(db.conn, () => {
        db.conn.prepare("INSERT INTO settings (key, value) VALUES ('k', 'v')").run();
      });
      expect(db.conn.prepare("SELECT value FROM settings WHERE key='k'").get()).toEqual({ value: "v" });
    } finally {
      db.close();
    }
  });

  it("fn 抛错整体回滚", () => {
    const db = createTestDb();
    try {
      expect(() =>
        txImmediate(db.conn, () => {
          db.conn.prepare("INSERT INTO settings (key, value) VALUES ('k', 'v')").run();
          throw new Error("boom");
        }),
      ).toThrowError("boom");
      expect(db.conn.prepare("SELECT value FROM settings WHERE key='k'").get()).toBeUndefined();
    } finally {
      db.close();
    }
  });
});

describe("txImmediate：单条 BEGIN IMMEDIATE 短事务·下", () => {
  it("嵌套禁止：事务中再开事务直接报错（PROTOCOL.md §1）", () => {
    const db = createTestDb();
    try {
      expect(() =>
        txImmediate(db.conn, () => {
          txImmediate(db.conn, () => undefined);
        }),
      ).toThrowError(/不允许嵌套/);
      // 外层事务被回滚，未留下悬挂事务
      expect(() => db.conn.prepare("INSERT INTO settings (key, value) VALUES ('k', 'v')").run()).not.toThrow();
    } finally {
      db.close();
    }
  });

  it("getUserVersion 读取 schema 版本", () => {
    const db = createTestDb();
    try {
      expect(getUserVersion(db.conn)).toBe(1);
    } finally {
      db.close();
    }
  });
});

describe("nowRfc3339：时间戳形态（与 chrono to_rfc3339 同形态，字典序可比较）", () => {
  it("+00:00 后缀而非 Z，供跨形态 rfc3339 字典序比较不失真", () => {
    const s = nowRfc3339(new Date("2026-10-11T07:23:45.123Z"));
    expect(s).toBe("2026-10-11T07:23:45.123+00:00");
  });

  it("同 instant 生成的串相等（确定性注入）", () => {
    const d = new Date("2026-01-15T09:00:00+08:00");
    expect(nowRfc3339(d)).toBe(nowRfc3339(d));
  });
});
