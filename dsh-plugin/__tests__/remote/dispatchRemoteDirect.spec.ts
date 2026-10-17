/**
 * dispatch 远端接线 · 降级链（D31 / AD §4.7；从原 dispatchRemote.spec 拆出——棘轮
 * max-lines，等量迁移）：degraded 直连 fake ssh 脚本 / 家族缺失拒绝 / 悬空路由不
 * 静默降级。夹具 = dispatchRemoteFx.ts。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dispatchHeadless } from "../../src/host/dispatch/headless";
import { createFakeTerminal, dispatchInteractive } from "../../src/host/dispatch/interactive";
import { remoteHeadlessDeps, remoteInteractiveParts, RemoteDispatchRejection } from "../../src/host/remote/sshExecutor";
import { listDeployments } from "../../src/host/remote/deployments";
import { setupDispatchRemoteFx, TARGET, WORKDIR } from "./dispatchRemoteFx";

const fx = setupDispatchRemoteFx();

describe("降级链：degraded 直连 ssh", () => {
  it("家族缺失 + degraded → ShellRunner 直连 ssh（免密预检先行 + node 前缀 + 信封回传）", async () => {
    fx.familyAvailable = false;
    fx.seedAgent("claude", "-p {prompt}", { command: "/usr/local/bin/claude" });
    const depId = fx.seedReadyDeployment({ degraded: true });
    const taskId = fx.seedDeploymentTask("直连任务", { workdir: WORKDIR });
    const record = join(fx.db.dir, "direct-record.txt");
    const bin = fx.fakeSshScript(
      `printf '%s\\n' "$*" >> '${record}'\necho '${JSON.stringify({ session_id: "sess-direct-1", is_error: false })}'`,
    );
    // 免密预检先行：platform.sshCheck 走既有 sshCheck（probe 注入 fake ssh 脚本）
    const directPlatform = fx.directPlatform(bin);
    const deps = remoteHeadlessDeps(fx.db.conn, directPlatform, { sshBin: bin });
    const outcome = await dispatchHeadless(fx.db.conn, deps, taskId);
    expect(outcome.state).toBe("done");
    expect(outcome.sessionId).toBe("sess-direct-1");
    const recorded = String(readFileSync(record, "utf8"));
    const lines = recorded.split("\n").filter((l) => l !== "");
    expect(lines.length).toBeGreaterThanOrEqual(2); // 预检探测（… true）+ 派发执行
    expect(lines[0]).toContain("BatchMode=yes");
    expect(lines[0].trim().endsWith("true")).toBe(true); // 免密预检先行
    expect(lines[1]).toContain("-p 22"); // target user@host:port 端口解析
    expect(lines[1]).toContain(`cd /srv/app || exit 1; exec /usr/local/bin/node /usr/local/bin/claude`);
    // 落账执行世界快照照常（remote_host = target）
    expect(fx.lastSession(taskId)["remote_host"]).toBe(TARGET);
    expect(listDeployments(fx.db.conn)[depId]?.degraded).toBe(true);
  });
});

describe("降级链：家族缺失拒绝与悬空路由", () => {
  it("家族缺失 + 未 degraded → 拒绝给指引（SSH_FAMILY_MISSING；交互 = 复制完整命令行）", async () => {
    fx.familyAvailable = false;
    fx.seedReadyDeployment(); // 未降级
    const taskId = fx.seedDeploymentTask("家族缺失任务");
    const headlessDeps = remoteHeadlessDeps(fx.db.conn, fx.platform);
    await expect(dispatchHeadless(fx.db.conn, headlessDeps, taskId)).rejects.toMatchObject({
      tag: "SSH_FAMILY_MISSING",
      message: expect.stringContaining("dsh-ssh 家族未装载"),
    });
    expect(fx.state(taskId)).toBeNull();
    expect(fx.scope.commands).toHaveLength(0); // 零远端探测

    // 交互降级：复制完整命令行（不注入终端，note 携带命令行与目标）
    const taskId2 = fx.seedDeploymentTask("家族缺失交互");
    const parts = remoteInteractiveParts(fx.db.conn, fx.platform);
    const outcome = await dispatchInteractive(
      fx.db.conn,
      { terminal: createFakeTerminal(), terminalFor: parts.terminalFor, deploymentPrecheck: parts.deploymentPrecheck },
      taskId2,
    );
    expect(outcome.terminal).toBe("copy-line");
    expect(outcome.note).toContain("复制完整命令行");
    expect(outcome.note).toContain(TARGET);
    expect(outcome.note).toContain("claude");
    expect(fx.lastSession(taskId2)["session_id"]).toBeNull(); // 无 PTY 会话标识
  });

  it("路由指向的部署缺失 → DEPLOYMENT_NOT_READY（不静默降级本机）", async () => {
    const taskId = fx.seedDeploymentTask("悬空路由");
    fx.db.conn.prepare("DELETE FROM settings WHERE key='dsh:deployments'").run();
    const deps = remoteHeadlessDeps(fx.db.conn, fx.platform);
    await expect(dispatchHeadless(fx.db.conn, deps, taskId)).rejects.toBeInstanceOf(RemoteDispatchRejection);
    await expect(dispatchHeadless(fx.db.conn, deps, taskId)).rejects.toMatchObject({ tag: "DEPLOYMENT_NOT_READY" });
    expect(fx.state(taskId)).toBeNull();
  });
});
