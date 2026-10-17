/**
 * dispatch 远端接线 · 断连收口 + 迟到回传（从原 dispatchRemote.spec 拆出——棘轮
 * max-lines，等量迁移）：断连置失败可重派 / 竞态先行不重复落账 / recheck 恢复挂
 * lateReport 只增行不改写。夹具 = dispatchRemoteFx.ts。
 */
import { describe, expect, it } from "vitest";
import { dispatchHeadless } from "../../src/host/dispatch/headless";
import { createRemoteDispatchGuard, remoteHeadlessDeps } from "../../src/host/remote/sshExecutor";
import { listDeployments } from "../../src/host/remote/deployments";
import { LATE_REPORT_ORIGIN } from "../../src/host/remote/lateReport";
import { normalizeTraceTimestamp, traceProbeCommand } from "../../src/host/remote/sshExecutor";
import { seedTask } from "../helpers";
import { setupDispatchRemoteFx, ALIAS, ENVELOPE, TARGET, WORKDIR } from "./dispatchRemoteFx";

const fx = setupDispatchRemoteFx();

/** 断连窗口内落定的一条失败派发行（执行世界快照 = target + workdir） */
function insertFailedSession(taskId: number): number {
  return Number(
    (
      fx.db.conn
        .prepare(
          "INSERT INTO agent_sessions (task_id, agent_id, agent_name, session_id, command, exit_code, status, " +
            "kind, workdir, remote_host, remote_port, remote_key, created_at) " +
            "VALUES (?, 'claude', 'claude', 'dead-1', '无头派发 · 失败', 255, 'error', 'dispatch_headless', ?, ?, 0, '', ?)",
        )
        .run(taskId, WORKDIR, TARGET, new Date().toISOString()) as { lastInsertRowid: number | bigint }
    ).lastInsertRowid,
  );
}

describe("断连收口（scope 断开事件）", () => {
  it("进行中派发置失败可重派：单事务收口（failed + error 账本 + 删槽）+ 实体 disconnected", async () => {
    const depId = fx.seedReadyDeployment();
    const taskId = fx.seedDeploymentTask("断连任务");
    fx.scope.enqueueSpawn("hold");
    const pending = dispatchHeadless(fx.db.conn, remoteHeadlessDeps(fx.db.conn, fx.platform), taskId);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fx.state(taskId)).toBe("running");

    const guard = createRemoteDispatchGuard(fx.db.conn, fx.platform);
    await guard.onScopeDisconnected(depId);
    expect(fx.state(taskId)).toBe("failed");
    expect(fx.slotCount()).toBe(0);
    const row = fx.lastSession(taskId);
    expect(row["status"]).toBe("error");
    expect(row["remote_host"]).toBe(TARGET);
    expect(String(row["command"])).toContain("连接断开");
    expect(listDeployments(fx.db.conn)[depId]?.status).toBe("disconnected");

    fx.scope.releaseHeldSpawn({ code: 255, stdout: "", stderr: "broken pipe", durationMs: 0 }); // 在途 flow 收口（幂等）
    const late = await pending;
    expect(late.state).toBe("failed"); // 断连结论不被迟到回传复活

    // 可重派：恢复连接 + recheck 转 ready 后再次派发成功
    fx.scope.reconnect();
    const recheck = await guard.recheck(depId);
    expect(recheck.ready).toBe(true);
    fx.scope.enqueueSpawn({ code: 0, stdout: ENVELOPE, stderr: "", durationMs: 5 });
    const again = await dispatchHeadless(fx.db.conn, remoteHeadlessDeps(fx.db.conn, fx.platform), taskId);
    expect(again.state).toBe("done");
    expect(fx.state(taskId)).toBe("done");
  });

  it("已收口任务不重复落账（竞态先行）+ 部署消失静默", async () => {
    const depId = fx.seedReadyDeployment();
    const taskId = fx.seedDeploymentTask("断连竞态");
    fx.db.conn.prepare("UPDATE tasks SET dispatch_state='failed' WHERE id=?").run(taskId);
    const guard = createRemoteDispatchGuard(fx.db.conn, fx.platform);
    await guard.onScopeDisconnected(depId); // 非在途：零新增账本行
    const rows = fx.db.conn.prepare("SELECT COUNT(*) AS n FROM agent_sessions WHERE task_id=?").get(taskId) as {
      n: number;
    };
    expect(rows.n).toBe(0);

    const ghost = await createRemoteDispatchGuard(fx.db.conn, fx.platform).onScopeDisconnected("ghost-id");
    expect(ghost).toBeUndefined();
  });
});

/** 迟到留痕断言（审计行 + 补录行 + 不改写三面） */
function expectLateReportRows(taskId: number, failedRowId: number, failedRowBefore: Record<string, unknown>): void {
  const log = fx.db.conn
    .prepare("SELECT * FROM task_logs WHERE task_id=? AND origin=?")
    .get(taskId, LATE_REPORT_ORIGIN) as Record<string, unknown> | undefined;
  expect(log).toBeDefined();
  expect(String(log?.["new_value"])).toContain("失败结论不变");
  const supplemented = fx.db.conn.prepare("SELECT * FROM agent_sessions WHERE kind=?").all(LATE_REPORT_ORIGIN) as Array<
    Record<string, unknown>
  >;
  expect(supplemented).toHaveLength(1);
  expect(supplemented[0]?.["remote_host"]).toBe(TARGET);
  // 不改写：任务态保持 failed、既有失败行逐字段一致
  expect(fx.state(taskId)).toBe("failed");
  const failedRowAfter = fx.db.conn.prepare("SELECT * FROM agent_sessions WHERE id=?").get(failedRowId) as Record<
    string,
    unknown
  >;
  expect(failedRowAfter).toEqual(failedRowBefore);
}

describe("迟到回传留痕（recheck 恢复挂 lateReport）", () => {
  it("窗口内痕迹 → 审计留痕 + agent_sessions 补录；失败结论与既有行不改写", async () => {
    const depId = fx.seedReadyDeployment();
    // 路由引用该部署（guard 的 target/失败行查询面）——任务本身无需挂路由
    fx.db.conn
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dsh:dispatch_routes', ?)")
      .run(JSON.stringify({ 迟到项目: { agentId: "claude", deployment: { ref: ALIAS, target: TARGET } } }));
    const guard = createRemoteDispatchGuard(fx.db.conn, fx.platform);
    const taskId = seedTask(fx.db.conn, "迟到任务");
    fx.db.conn.prepare("UPDATE tasks SET dispatch_state='failed' WHERE id=?").run(taskId);

    await guard.onScopeDisconnected(depId); // 窗口起点
    const failedRowId = insertFailedSession(taskId);
    const failedRowBefore = fx.db.conn.prepare("SELECT * FROM agent_sessions WHERE id=?").get(failedRowId) as Record<
      string,
      unknown
    >;

    fx.scope.program(/^find /, {
      code: 0,
      stdout: `${WORKDIR}-pk-${taskId}\t${new Date().toISOString()}\n`,
    });
    const outcome = await guard.recheck(depId); // 恢复 → 迟到核对
    expect(outcome.recovered).toBe(true);
    expectLateReportRows(taskId, failedRowId, failedRowBefore);
  });

  it("窗口外痕迹 / 无痕迹 → 零落痕；traceProbeCommand 与时间戳归一化纯函数面", () => {
    expect(normalizeTraceTimestamp("2026-10-17T10:30:00.123456789+0800")).toBe("2026-10-17T10:30:00.123456789+08:00");
    expect(normalizeTraceTimestamp("2026-10-17T10:30:00Z")).toBe("2026-10-17T10:30:00Z");
    expect(normalizeTraceTimestamp("2026-10-17 10:30:00")).toBeNull(); // 非 find -printf 形态
    const cmd = traceProbeCommand("/srv/app repo"); // 含空格路径逐参引用
    expect(cmd).toContain(`-path '/srv/app repo'`);
    expect(cmd).toContain(`-o -name 'app repo-pk-*'`);
    expect(cmd).toContain("-printf '%p\\t%TY-%Tm-%TdT%TH:%TM:%TS%Tz\\n'");
  });
});
