/**
 * remote/lateReport：迟到回传留痕——断连窗口内失败派发的远端活动痕迹（注入探测）
 * → 只增行（task_logs 审计 + agent_sessions 补录，origin/kind = dsh:late-report）；
 * 不改写失败结论（无任何 UPDATE 既有行路径——既有行/任务状态前后快照断言）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LATE_REPORT_ORIGIN, lateReport, validateLateReportInput } from "../../src/host/remote/lateReport";
import { logAgentSession } from "../../src/host/dispatch/sessions";
import { createTestDb, scalar, seedTask, type TestDb } from "../helpers";
import type { LateReportFailedRow, LateReportTrace } from "../../src/host/remote/lateReport";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

const WINDOW = { disconnectedAt: "2026-10-17T10:00:00+08:00", recoveredAt: "2026-10-17T11:00:00+08:00" };

/** 落一条断连窗口内失败的派发账本行（执行世界快照 = 远端部署） */
function seedFailedDispatch(opts: { taskId: number | null; workdir?: string; remoteHost?: string }): number {
  return logAgentSession(
    db.conn,
    {
      taskId: opts.taskId,
      agentId: "ag-1",
      kind: "dispatch_headless",
      command: "无头派发 · 失败",
      exitCode: -1,
      status: "error",
      workdir: opts.workdir ?? "/srv/app",
      remoteHost: opts.remoteHost ?? "u@dev-box",
    },
    "2026-10-17T10:30:00+08:00",
  );
}

function failedRow(rowId: number, taskId: number | null, workdir = "/srv/app"): LateReportFailedRow {
  return { rowId, taskId, agentId: "ag-1", workdir, remoteHost: "u@dev-box" };
}

function probeWith(traces: LateReportTrace[], log: string[] = []) {
  return async (workdir: string) => {
    log.push(workdir);
    return traces;
  };
}

/** 审计留痕断言（task_logs 只增一行 + origin/内容三面） */
function expectAuditRow(taskId: number, taskLogsBefore: number): void {
  expect(Number(scalar(db.conn, "SELECT COUNT(*) FROM task_logs"))).toBe(taskLogsBefore + 1);
  const audit = db.conn.prepare("SELECT * FROM task_logs WHERE origin=?").get(LATE_REPORT_ORIGIN) as {
    task_id: number;
    action: string;
    field: string;
    new_value: string;
  };
  expect(audit.task_id).toBe(taskId);
  expect(audit.action).toBe("update");
  expect(audit.field).toBe("late_report");
  expect(audit.new_value).toContain("失败结论不变");
  expect(audit.new_value).toContain("COMMIT_EDITMSG");
}

/** 会话补录断言（agent_sessions 只增一行 + 快照 workdir/remote_host 保留） */
function expectSupplementRow(taskId: number, sessionsBefore: number): void {
  expect(Number(scalar(db.conn, "SELECT COUNT(*) FROM agent_sessions"))).toBe(sessionsBefore + 1);
  const supplement = db.conn.prepare("SELECT * FROM agent_sessions WHERE kind=?").get(LATE_REPORT_ORIGIN) as {
    task_id: number | null;
    status: string;
    workdir: string;
    remote_host: string;
  };
  expect(supplement.task_id).toBe(taskId);
  expect(supplement.status).toBe("ok");
  expect(supplement.workdir).toBe("/srv/app");
  expect(supplement.remote_host).toBe("u@dev-box");
}

/** 不改写断言（失败行原样 + 任务派发状态原样） */
function expectNoRewrite(rowId: number, taskId: number): void {
  const failedRowAfter = db.conn.prepare("SELECT status, exit_code FROM agent_sessions WHERE id=?").get(rowId) as {
    status: string;
    exit_code: number;
  };
  expect(failedRowAfter).toEqual({ status: "error", exit_code: -1 });
  expect(scalar(db.conn, "SELECT dispatch_state FROM tasks WHERE id=?", taskId)).toBe("failed");
}

describe("迟到回传留痕：窗口内证据留痕（只增行）", () => {
  it("窗口内活动痕迹 → 1 行审计（并入任务时间线）+ 1 行会话补录；失败结论不改写", async () => {
    const taskId = seedTask(db.conn, "远端任务");
    db.conn.prepare("UPDATE tasks SET dispatch_state='failed' WHERE id=?").run(taskId);
    const rowId = seedFailedDispatch({ taskId });
    const taskLogsBefore = Number(scalar(db.conn, "SELECT COUNT(*) FROM task_logs"));
    const sessionsBefore = Number(scalar(db.conn, "SELECT COUNT(*) FROM agent_sessions"));

    const result = await lateReport(
      db.conn,
      {
        deploymentAlias: "dev-box",
        ...WINDOW,
        failedRows: [failedRow(rowId, taskId)],
      },
      {
        probeTraces: probeWith([{ path: "/srv/app-pk-12/.git/COMMIT_EDITMSG", mtime: "2026-10-17T10:20:00+08:00" }]),
      },
      "2026-10-17T11:00:01+08:00",
    );

    expect(result).toEqual({ audited: 1, supplemented: 1 });
    // 审计留痕 + 会话补录 + 不改写失败结论（三面断言辅助）
    expectAuditRow(taskId, taskLogsBefore);
    expectSupplementRow(taskId, sessionsBefore);
    expectNoRewrite(rowId, taskId);
  });
});

describe("迟到回传留痕：零落痕路径", () => {
  it("窗口外 / mtime 不可解析 / workdir 空 → 不落任何行", async () => {
    const taskId = seedTask(db.conn, "任务");
    const inWindow = seedFailedDispatch({ taskId, workdir: "/srv/in" });
    const badTime = seedFailedDispatch({ taskId, workdir: "/srv/bad" });
    const emptyDir = seedFailedDispatch({ taskId, workdir: "" });
    const probes = new Map<string, LateReportTrace[]>([
      ["/srv/in", [{ path: "/srv/in/wt", mtime: "2026-10-17T09:59:59+08:00" }]], // 窗口前
      ["/srv/bad", [{ path: "/srv/bad/wt", mtime: "not-a-time" }]], // 不可解析
    ]);
    const result = await lateReport(
      db.conn,
      {
        deploymentAlias: "dev-box",
        ...WINDOW,
        failedRows: [
          failedRow(inWindow, taskId, "/srv/in"),
          failedRow(badTime, taskId, "/srv/bad"),
          failedRow(emptyDir, taskId, ""),
        ],
      },
      { probeTraces: async (workdir) => probes.get(workdir) ?? [] },
    );
    expect(result).toEqual({ audited: 0, supplemented: 0 });
    expect(Number(scalar(db.conn, "SELECT COUNT(*) FROM task_logs"))).toBe(0);
    expect(Number(scalar(db.conn, "SELECT COUNT(*) FROM agent_sessions WHERE kind=?", LATE_REPORT_ORIGIN))).toBe(0);
  });

  it("task 无关联（taskId null）→ 只补会话行，不写任务时间线", async () => {
    const rowId = seedFailedDispatch({ taskId: null });
    const result = await lateReport(
      db.conn,
      { deploymentAlias: "dev-box", ...WINDOW, failedRows: [failedRow(rowId, null)] },
      { probeTraces: probeWith([{ path: "/srv/app/wt", mtime: "2026-10-17T10:05:00+08:00" }]) },
    );
    expect(result).toEqual({ audited: 0, supplemented: 1 });
    expect(Number(scalar(db.conn, "SELECT COUNT(*) FROM task_logs"))).toBe(0);
  });
});

describe("迟到回传留痕：尽力执行路径", () => {
  it("探测抛错 → 该行尽力跳过，其余行照常留痕", async () => {
    const t1 = seedTask(db.conn, "任务一");
    const t2 = seedTask(db.conn, "任务二");
    const r1 = seedFailedDispatch({ taskId: t1, workdir: "/srv/boom" });
    const r2 = seedFailedDispatch({ taskId: t2, workdir: "/srv/ok" });
    const result = await lateReport(
      db.conn,
      {
        deploymentAlias: "dev-box",
        ...WINDOW,
        failedRows: [failedRow(r1, t1, "/srv/boom"), failedRow(r2, t2, "/srv/ok")],
      },
      {
        probeTraces: async (workdir) => {
          if (workdir === "/srv/boom") {
            throw new Error("scope gone");
          }
          return [{ path: "/srv/ok/wt", mtime: "2026-10-17T10:10:00+08:00" }];
        },
      },
    );
    expect(result).toEqual({ audited: 1, supplemented: 1 });
    expect(Number(scalar(db.conn, "SELECT COUNT(*) FROM agent_sessions WHERE kind=?", LATE_REPORT_ORIGIN))).toBe(1);
  });

  it("无失败行 / 无窗口内证据 → 零行零调用", async () => {
    const empty = await lateReport(
      db.conn,
      { deploymentAlias: "d", ...WINDOW, failedRows: [] },
      { probeTraces: probeWith([]) },
    );
    expect(empty).toEqual({ audited: 0, supplemented: 0 });
    const taskId = seedTask(db.conn, "任务");
    const rowId = seedFailedDispatch({ taskId });
    const none = await lateReport(
      db.conn,
      { deploymentAlias: "d", ...WINDOW, failedRows: [failedRow(rowId, taskId)] },
      { probeTraces: probeWith([]) },
    );
    expect(none).toEqual({ audited: 0, supplemented: 0 });
  });
});

describe("入参防御", () => {
  it("窗口时间不可解析 → 参数错", async () => {
    expect(() =>
      validateLateReportInput({ deploymentAlias: "d", disconnectedAt: "bad", recoveredAt: "bad", failedRows: [] }),
    ).toThrowError(/RFC3339/);
    await expect(
      lateReport(
        db.conn,
        { deploymentAlias: "d", disconnectedAt: "bad", recoveredAt: "bad", failedRows: [] },
        { probeTraces: probeWith([]) },
      ),
    ).rejects.toThrowError(/RFC3339/);
  });
});
