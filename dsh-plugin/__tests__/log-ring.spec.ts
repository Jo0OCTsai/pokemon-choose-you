/**
 * health/logRing：环形缓冲容量、级别/来源过滤、limit 口径、最新在上；
 * logQuery 磁盘单源（ADR-0005：读共享日志最新文件，环仅喂支持报告）+
 * 出口脱敏、文件序分页、来源包含匹配。
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LogRing, LOG_RING_CAPACITY, logQuery, LOG_TAIL_DEFAULT, parseDiskLogLines } from "../src/host/health/logRing";
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
  it("message 过三层管线：键名遮蔽，库内真名遮蔽；磁盘原文未被改写", () => {
    db.conn.prepare("INSERT INTO settings (key, value) VALUES ('feishu_my_name', '蔡乔蓉')").run();
    const logDir = mkdtempSync(join(tmpdir(), "pky-logs-"));
    writeFileSync(
      join(logDir, "pokemon-choose-you.log"),
      "[2026-10-12][10:00:00][dsh/radio][WARN] 拉取失败 token=abc123def456 蔡乔蓉说的\n",
      "utf8",
    );
    const out = logQuery(db.conn, {}, logDir);
    expect(out.entries[0].message).toBe("拉取失败 token=*** ***说的");
    // 磁盘文件原文未被改写（脱敏只发生在出口拷贝）
    expect(readFileSync(join(logDir, "pokemon-choose-you.log"), "utf8")).toContain("abc123def456");
  });
});

describe("logQuery 磁盘单源（ADR-0005）", () => {
  it("只读磁盘：内存环条目不参与（插件自身日志经 FileLogSink 同文件落盘）", () => {
    const logDir = mkdtempSync(join(tmpdir(), "pky-logs-"));
    writeFileSync(join(logDir, "pokemon-choose-you.log"), "[2026-10-12][10:00:00][app/poll][INFO] 桌面一条\n", "utf8");
    const ring = new LogRing();
    ring.log("info", "radio/fetcher", "插件环一条", "2026-10-13T08:00:00+00:00");
    expect(logQuery(db.conn, {}, logDir).entries.map((e) => e.message)).toEqual(["桌面一条"]);
    // 未注入 logDir（undefined）= 空集——测试确定性口径
    expect(logQuery(db.conn, {}).total).toBe(0);
  });

  it("文件序即时间序：最新在上、offset 跳过最新条目、total 为过滤总数", () => {
    const logDir = mkdtempSync(join(tmpdir(), "pky-logs-"));
    writeFileSync(
      join(logDir, "2026-10-12.log"),
      "[2026-10-12][09:00:00][app/ui][WARN] 旧一行\n[2026-10-12][10:00:00][app/poll][INFO] 新一行\n",
      "utf8",
    );
    const out = logQuery(db.conn, {}, logDir);
    expect(out.entries.map((e) => e.message)).toEqual(["新一行", "旧一行"]);
    expect(logQuery(db.conn, { offset: 1 }, logDir).entries.map((e) => e.message)).toEqual(["旧一行"]);
    expect(out.total).toBe(2);
  });

  it("minLevel 过滤；来源子串命中（target 或 message，桌面 LogViewer 同口径）", () => {
    const logDir = mkdtempSync(join(tmpdir(), "pky-logs-"));
    writeFileSync(
      join(logDir, "pokemon-choose-you.log"),
      "[2026-10-12][09:00:00][app/ui][INFO] 一\n[2026-10-12][09:30:00][app/ui][ERROR] 二\n[2026-10-12][10:00:00][dsh/radio][INFO] 三\n",
      "utf8",
    );
    expect(logQuery(db.conn, { minLevel: "error" }, logDir).entries.map((e) => e.message)).toEqual(["二"]);
    expect(logQuery(db.conn, { target: "POLL" }, logDir).total).toBe(0);
    expect(logQuery(db.conn, { target: "radio" }, logDir).entries.map((e) => e.target)).toEqual(["dsh/radio"]);
  });

  it("目录缺失 / 无 .log 文件 / 空目录 = 空集不报错；续行并入上一条", () => {
    expect(logQuery(db.conn, {}, join(tmpdir(), "pky-missing-logs")).total).toBe(0);
    const emptyDir = mkdtempSync(join(tmpdir(), "pky-empty-logs-"));
    expect(logQuery(db.conn, {}, emptyDir).total).toBe(0);
    expect(
      parseDiskLogLines("[a][b][t][INFO] 第一行\n多行消息的续行\n[c][d][t2][ERROR] 第二条").map((e) => e.level),
    ).toEqual(["info", "error"]);
  });
});
