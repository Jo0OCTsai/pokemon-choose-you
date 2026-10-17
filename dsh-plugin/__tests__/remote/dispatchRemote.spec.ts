/**
 * dispatch 远端接线 · 家族链全流程（任务 2.8 / AD §4.7/§5.4；从原 dispatchRemote.spec
 * 拆出——棘轮 max-lines，等量迁移）：就绪复核前置 / node 前缀 + 信封回传 + 执行世界
 * 快照 / 事务外执行 / 失败路径与超时。夹具 = dispatchRemoteFx.ts。
 */
import { describe, expect, it } from "vitest";
import { dispatchHeadless, runQueuedHeadless } from "../../src/host/dispatch/headless";
import { remoteHeadlessDeps } from "../../src/host/remote/sshExecutor";
import { listDeployments } from "../../src/host/remote/deployments";
import { seedTask } from "../helpers";
import { setupDispatchRemoteFx, ALIAS, ENVELOPE, TARGET, WORKDIR } from "./dispatchRemoteFx";

const fx = setupDispatchRemoteFx();

describe("sshExecutor 家族链（无头）：就绪派发与信封回传", () => {
  it("就绪部署派发：node 前缀 + command -v 解析 + 信封回传 + 执行世界快照落账", async () => {
    const depId = fx.seedReadyDeployment();
    const taskId = fx.seedDeploymentTask("远端任务", { workdir: WORKDIR });
    fx.scope.enqueueSpawn({ code: 0, stdout: ENVELOPE, stderr: "", durationMs: 5 });
    const outcome = await dispatchHeadless(fx.db.conn, remoteHeadlessDeps(fx.db.conn, fx.platform), taskId);
    expect(outcome.state).toBe("done");
    expect(outcome.sessionId).toBe("sess-remote-1");
    // 就绪复核（活性 + 摘要）经 scope.shell；可执行解析 command -v；执行经 spawn
    expect(fx.scope.commands).toContain("printf pky-ok");
    expect(fx.scope.commands).toContain(`command -v claude`);
    const spawn = fx.scope.spawns.find((argv) => argv[0] === "/bin/sh");
    expect(spawn).toBeDefined();
    const script = spawn?.[1] === "-c" ? (spawn?.[2] ?? "") : "";
    expect(script).toContain("cd /srv/app || exit 1");
    expect(script).toContain("exec /usr/local/bin/node /usr/local/bin/claude");
    expect(script).toContain("export PK_DISPATCH_TASK=");
    // prompt 无占位变体走 stdin（本用例 args 含 {prompt} → argv 内替换，不裸拼分隔符）
    // 落账：执行世界快照 remote_host = 部署 target + workdir 生效目录（A27）
    const row = fx.lastSession(taskId);
    expect(row["kind"]).toBe("dispatch_headless");
    expect(row["remote_host"]).toBe(TARGET);
    expect(row["workdir"]).toBe(WORKDIR);
    expect(row["session_id"]).toBe("sess-remote-1");
    expect(fx.state(taskId)).toBe("done");
    expect(fx.slotCount()).toBe(0);
    expect(listDeployments(fx.db.conn)[depId]?.status).toBe("ready");
  });

  it("stdin 管道承载 prompt（args 无占位时不上命令行）", async () => {
    fx.seedAgent("claude", "--json");
    fx.seedReadyDeployment();
    const taskId = fx.seedDeploymentTask("远端任务2");
    const outcome = await dispatchHeadless(fx.db.conn, remoteHeadlessDeps(fx.db.conn, fx.platform), taskId);
    expect(outcome.state).toBe("done");
    const spawn = fx.scope.spawns.find((argv) => argv[0] === "/bin/sh");
    const script = spawn?.[2] ?? "";
    expect(script).not.toContain("===== 待办数据开始 =====");
  });
});

describe("sshExecutor 家族链（无头）：前置拒绝与排队", () => {
  it("就绪复核前置拒绝（draft 态零远端探测）：DEPLOYMENT_NOT_READY + 不发执行 SSH", async () => {
    fx.seedReadyDeployment({ status: "draft" });
    const taskId = fx.seedDeploymentTask("远端任务3");
    const deps = remoteHeadlessDeps(fx.db.conn, fx.platform);
    await expect(dispatchHeadless(fx.db.conn, deps, taskId)).rejects.toMatchObject({
      tag: "DEPLOYMENT_NOT_READY",
    });
    expect(fx.state(taskId)).toBeNull(); // claim 前拦截，状态不受污染
    expect(fx.slotCount()).toBe(0);
    expect(fx.scope.spawns).toHaveLength(0); // 不发执行 SSH
    expect(fx.scope.commands).toHaveLength(0); // 未开通态 recheck 不探测
  });

  it("排队自动派发：复核拒绝 → 不领取保持 queued（不自动重放）", async () => {
    fx.seedReadyDeployment({ status: "disconnected" });
    fx.scope.simulateDisconnect();
    const taskId = seedTask(fx.db.conn, "排队远端", { status: "scheduled" });
    fx.db.conn.prepare("UPDATE tasks SET dispatch_state='queued' WHERE id=?").run(taskId);
    const tagId = Number(
      (
        fx.db.conn
          .prepare("INSERT INTO tags (name, dimension_id, meta, created_at) VALUES ('排队远端', 1, NULL, 't')")
          .run() as { lastInsertRowid: number | bigint }
      ).lastInsertRowid,
    );
    fx.db.conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(taskId, tagId);
    fx.db.conn
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dsh:dispatch_routes', ?)")
      .run(JSON.stringify({ 排队远端: { agentId: "claude", deployment: { ref: ALIAS, target: TARGET } } }));
    const result = await runQueuedHeadless(fx.db.conn, remoteHeadlessDeps(fx.db.conn, fx.platform), taskId);
    expect(result.started).toBe(false);
    expect(fx.state(taskId)).toBe("queued");
    expect(fx.slotCount()).toBe(0);
  });
});

describe("sshExecutor 家族链（无头）：失败路径", () => {
  it("远端非零退出码 → failed 记因（stderr 不吞）", async () => {
    fx.seedReadyDeployment();
    const taskId = fx.seedDeploymentTask("远端任务4");
    fx.scope.enqueueSpawn({ code: 3, stdout: "", stderr: "boom" });
    const outcome = await dispatchHeadless(fx.db.conn, remoteHeadlessDeps(fx.db.conn, fx.platform), taskId);
    expect(outcome.state).toBe("failed");
    expect(fx.state(taskId)).toBe("failed");
    expect(fx.lastSession(taskId)["status"]).toBe("error");
    expect(fx.lastSession(taskId)["exit_code"]).toBe(3);
  });

  it("远端找不到命令 → failed + 可操作指引（不抛错）", async () => {
    fx.seedReadyDeployment();
    fx.scope.remoteBins.delete("claude");
    const taskId = fx.seedDeploymentTask("远端任务5");
    const outcome = await dispatchHeadless(fx.db.conn, remoteHeadlessDeps(fx.db.conn, fx.platform), taskId);
    expect(outcome.state).toBe("failed");
    expect(outcome.note).toContain("远端找不到命令");
    expect(fx.scope.spawns.filter((argv) => argv[0] === "/bin/sh" && argv[2]?.includes("exec "))).toHaveLength(0);
  });

  it("超时置失败记因（下限可配置缩短）", async () => {
    fx.seedAgent("claude", "-p {prompt}", { timeoutSecs: 1 });
    fx.seedReadyDeployment();
    const taskId = fx.seedDeploymentTask("远端任务6");
    fx.scope.enqueueSpawn("hold");
    const deps = remoteHeadlessDeps(fx.db.conn, fx.platform, { minTimeoutSecs: 1 });
    const outcome = await dispatchHeadless(fx.db.conn, deps, taskId);
    expect(outcome.state).toBe("failed");
    expect(outcome.code).toBe("DISPATCH_TIMEOUT");
    expect(outcome.note).toContain("超时");
    expect(fx.slotCount()).toBe(0);
    fx.scope.releaseHeldSpawn({ code: 0, stdout: ENVELOPE, stderr: "", durationMs: 0 }); // 迟到放行不复活结论
  });
});

describe("事务边界（AD §5.4：远端执行不持库事务 + 单事务收口）", () => {
  it("spawn 在途时本机连接零事务窗口（claim 已提交、收口未开）", async () => {
    fx.seedReadyDeployment();
    const taskId = fx.seedDeploymentTask("远端事务");
    fx.scope.enqueueSpawn({ code: 0, stdout: ENVELOPE, stderr: "", durationMs: 5 });
    const outcome = await dispatchHeadless(fx.db.conn, remoteHeadlessDeps(fx.db.conn, fx.platform), taskId);
    expect(outcome.state).toBe("done");
    // 复跑并卡在 spawn：断言远端调用窗口内同连接开不了事务也开着事务（证明执行在事务外）
    const taskId2 = fx.seedDeploymentTask("远端事务2");
    fx.scope.enqueueSpawn("hold");
    const pending = dispatchHeadless(fx.db.conn, remoteHeadlessDeps(fx.db.conn, fx.platform), taskId2);
    await new Promise((resolve) => setTimeout(resolve, 50)); // 等 spawn 进入挂起
    expect(fx.scope.spawns.length).toBeGreaterThan(0);
    expect(fx.slotCount()).toBe(1); // claim 事务已提交（槽在场）
    expect(() => {
      fx.db.conn.exec("BEGIN IMMEDIATE");
      fx.db.conn.exec("ROLLBACK");
    }).not.toThrow(); // 执行窗口无事务持有
    fx.scope.releaseHeldSpawn({ code: 0, stdout: ENVELOPE, stderr: "", durationMs: 5 });
    const outcome2 = await pending;
    expect(outcome2.state).toBe("done");
    expect(fx.slotCount()).toBe(0); // 收口单事务删槽
  });
});
