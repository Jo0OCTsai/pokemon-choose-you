/**
 * health/supportReport：结构（版本/平台/健康/日志 200 条）、脱敏零泄漏、空日志态。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSupportReport, REPORT_LOG_LINES } from "../src/host/health/supportReport";
import { HealthState, AI } from "../src/host/health/snapshot";
import { LogRing } from "../src/host/health/logRing";
import { createTestDb, seedAgents, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

/** 报告的日志段行（时间前缀 + [info] 标记） */
function reportLogLines(ring: LogRing): string[] {
  const report = buildSupportReport(
    db.conn,
    new HealthState(),
    ring,
    { pluginVersion: "0.1.0" },
    { now: "2026-10-11T00:00:00+00:00" },
  );
  return report.split("\n").filter((l) => l.startsWith("t") && l.includes("[info]"));
}

describe("buildSupportReport", () => {
  it("含版本头（插件 + dsh 占位 + 平台）、健康段、最近日志段", () => {
    seedAgents(db.conn, [{ id: "a1" }]);
    const state = new HealthState();
    state.recordFailure(AI, "token=super-secret-value 泄漏了", "2026-10-11T00:00:00+00:00");
    const ring = new LogRing();
    ring.log("info", "radio/pollLoop", "本轮拉取 3 条", "2026-10-11T00:00:01+00:00");
    const report = buildSupportReport(
      db.conn,
      state,
      ring,
      { pluginVersion: "0.1.0", dshVersion: "0.2.0-rc.2", platform: "darwin" },
      {
        now: "2026-10-11T00:00:02+00:00",
      },
    );
    expect(report).toContain("就决定是你了 支持报告");
    expect(report).toContain("版本：0.1.0 · dsh：0.2.0-rc.2 · 平台：darwin · 生成时间：2026-10-11T00:00:02+00:00");
    expect(report).toContain("[ai] 状态 degraded");
    expect(report).toContain("token=***");
    expect(report).not.toContain("super-secret-value");
    expect(report).toContain("[info][radio/pollLoop] 本轮拉取 3 条");
  });
});

describe("buildSupportReport · 空态与条数上限", () => {
  it("无 dsh 版本时省略 dsh 段；无日志时呈现（无日志）", () => {
    const report = buildSupportReport(
      db.conn,
      new HealthState(),
      new LogRing(),
      { pluginVersion: "0.1.0" },
      {
        now: "2026-10-11T00:00:00+00:00",
      },
    );
    expect(report).not.toContain("dsh：");
    expect(report).toContain("（无日志）");
  });

  it("日志段最多 200 条且按时间正序呈现（最新在末尾）", () => {
    const ring = new LogRing();
    for (let i = 1; i <= REPORT_LOG_LINES + 100; i++) {
      ring.log("info", "t", `消息 ${i}`, `t${i}`);
    }
    const logLines = reportLogLines(ring);
    expect(logLines.length).toBe(REPORT_LOG_LINES);
    expect(logLines[0]).toContain(`消息 ${101}`);
    expect(logLines[logLines.length - 1]).toContain(`消息 ${REPORT_LOG_LINES + 100}`);
  });

  it("密钥零泄漏：日志里的邮箱/凭证前缀/库内真名全部遮蔽", () => {
    db.conn.prepare("INSERT INTO settings (key, value) VALUES ('feishu_my_name', '蔡乔蓉')").run();
    const ring = new LogRing();
    ring.log("error", "judge/cli", "agent 输出含 ghp_0123456789abcdefghijklm 与 joe@example.com，蔡乔蓉的凭证", "t1");
    const report = buildSupportReport(
      db.conn,
      new HealthState(),
      ring,
      { pluginVersion: "0.1.0" },
      {
        now: "2026-10-11T00:00:00+00:00",
      },
    );
    expect(report).not.toContain("ghp_0123456789abcdefghijklm");
    expect(report).not.toContain("joe@example.com");
    expect(report).not.toContain("蔡乔蓉");
    expect(report).toContain("***@***");
  });
});
