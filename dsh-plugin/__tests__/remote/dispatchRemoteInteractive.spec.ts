/**
 * dispatch 远端接线 · 交互分支 + worktree（从原 dispatchRemote.spec 拆出——棘轮
 * max-lines，等量迁移）：spawnTerminal 真 PTY / 同上下文重派 / 关闭兜底 / 复制命令行
 * 降级 / worktree 幂等与失败降级 / planRemoteRoute 判定表。夹具 = dispatchRemoteFx.ts。
 */
import { describe, expect, it } from "vitest";
import { dispatchHeadless } from "../../src/host/dispatch/headless";
import { dispatchInteractive, dispatchReport } from "../../src/host/dispatch/interactive";
import { createFakeTerminal } from "../../src/host/dispatch/terminalAdapters";
import { planRemoteRoute, remoteHeadlessDeps, remoteInteractiveParts } from "../../src/host/remote/sshExecutor";
import { DEPLOYMENTS_KEY, listDeployments } from "../../src/host/remote/deployments";
import { setupDispatchRemoteFx, ALIAS, ENVELOPE, TARGET, WORKDIR } from "./dispatchRemoteFx";

const fx = setupDispatchRemoteFx();

function interactiveDeps() {
  const parts = remoteInteractiveParts(fx.db.conn, fx.platform);
  return {
    terminal: createFakeTerminal(),
    terminalFor: parts.terminalFor,
    deploymentPrecheck: parts.deploymentPrecheck,
  };
}

describe("交互 TerminalAdapter：PTY 注入与同上下文重派", () => {
  it("spawnTerminal 真 PTY + 命令注入 + 会话标识落账（kind=dispatch_interactive）", async () => {
    fx.seedReadyDeployment();
    const taskId = fx.seedDeploymentTask("交互远端", { workdir: WORKDIR });
    const outcome = await dispatchInteractive(fx.db.conn, interactiveDeps(), taskId);
    expect(outcome.state).toBe("running");
    expect(outcome.terminal).toBe("pty-1");
    expect(fx.scope.spawnTerminalCalls).toHaveLength(1);
    expect(fx.scope.spawnTerminalCalls[0]?.command).toBe("/bin/sh");
    expect(fx.scope.spawnTerminalCalls[0]?.cwd).toBe(WORKDIR);
    expect(fx.scope.terminalWrites).toHaveLength(1);
    expect(fx.scope.terminalWrites[0]?.sessionId).toBe("pty-1");
    expect(fx.scope.terminalWrites[0]?.data).toContain("claude");
    expect(fx.scope.terminalWrites[0]?.data.endsWith("\n")).toBe(true);
    const row = fx.lastSession(taskId);
    expect(row["kind"]).toBe("dispatch_interactive");
    expect(row["session_id"]).toBe("pty-1");
    expect(row["remote_host"]).toBe(ALIAS);
  });

  it("同上下文重派 = 同 sessionId 注入（不新开会话）", async () => {
    fx.seedReadyDeployment();
    const taskId = fx.seedDeploymentTask("交互重派");
    await dispatchInteractive(fx.db.conn, interactiveDeps(), taskId);
    dispatchReport(fx.db.conn, taskId, "failed", "上一轮中断"); // 解锁重派
    const second = await dispatchInteractive(fx.db.conn, interactiveDeps(), taskId);
    expect(second.terminal).toBe("pty-1");
    expect(fx.scope.spawnTerminalCalls).toHaveLength(1); // 未新开
    expect(fx.scope.terminalWrites).toHaveLength(2);
    expect(fx.scope.terminalWrites[1]?.sessionId).toBe("pty-1");
  });
});

describe("交互 TerminalAdapter：非绝对 workdir 走 cd 段（dsh-ssh cwd 只收绝对路径）", () => {
  it("~ 前缀：cwd 不上协议、cd 段拼进注入行首（远端 shell 展开 $HOME）", async () => {
    fx.seedReadyDeployment();
    const taskId = fx.seedDeploymentTask("交互波浪号目录", { workdir: "~/.choose-you/workspace" });
    const outcome = await dispatchInteractive(fx.db.conn, interactiveDeps(), taskId);
    expect(outcome.state).toBe("running");
    expect(fx.scope.spawnTerminalCalls[0]?.cwd).toBeUndefined();
    const write = fx.scope.terminalWrites[0]?.data ?? "";
    expect(write.startsWith("cd ~/.choose-you/workspace || exit 1\n")).toBe(true);
    expect(write).toContain("claude");
    expect(fx.lastSession(taskId)["session_id"]).toBe("pty-1");
  });

  it("相对路径（含空格整体引用）", async () => {
    fx.seedReadyDeployment();
    const taskId = fx.seedDeploymentTask("交互相对目录", { workdir: "my work dir" });
    await dispatchInteractive(fx.db.conn, interactiveDeps(), taskId);
    expect(fx.scope.spawnTerminalCalls[0]?.cwd).toBeUndefined();
    expect(fx.scope.terminalWrites[0]?.data?.startsWith("cd 'my work dir' || exit 1\n")).toBe(true);
  });
});

describe("交互 TerminalAdapter：关闭兜底与降级", () => {
  it("原会话已关闭 → 兜底新开 + note 明示", async () => {
    fx.seedReadyDeployment();
    const taskId = fx.seedDeploymentTask("交互关闭兜底");
    await dispatchInteractive(fx.db.conn, interactiveDeps(), taskId);
    dispatchReport(fx.db.conn, taskId, "failed", null);
    fx.scope.closedTerminals.add("pty-1");
    const second = await dispatchInteractive(fx.db.conn, interactiveDeps(), taskId);
    expect(fx.scope.spawnTerminalCalls).toHaveLength(2);
    expect(second.terminal).toBe("pty-2");
    expect(second.note).toContain("原会话已关闭");
    expect(fx.scope.terminalWrites.at(-1)?.sessionId).toBe("pty-2");
  });

  it("degraded 部署交互 → 复制完整命令行（无 PTY 通道）", async () => {
    fx.familyAvailable = false;
    fx.seedReadyDeployment({ degraded: true });
    const taskId = fx.seedDeploymentTask("交互降级");
    const outcome = await dispatchInteractive(fx.db.conn, interactiveDeps(), taskId);
    expect(outcome.terminal).toBe("copy-line");
    expect(fx.scope.spawnTerminalCalls).toHaveLength(0);
  });

  it("就绪复核前置拒绝（disconnected 态）：不进终端注入", async () => {
    const depId = fx.seedReadyDeployment({ status: "disconnected" });
    fx.scope.simulateDisconnect();
    const taskId = fx.seedDeploymentTask("交互前置");
    await expect(dispatchInteractive(fx.db.conn, interactiveDeps(), taskId)).rejects.toMatchObject({
      tag: "DEPLOYMENT_NOT_READY",
    });
    expect(fx.scope.spawnTerminalCalls).toHaveLength(0);
    expect(fx.state(taskId)).toBeNull();
    expect(listDeployments(fx.db.conn)[depId]?.status).toBe("disconnected");
  });
});

describe("远端 worktree：脚本远端执行与幂等复用", () => {
  it("脚本在远端执行（scope.shell）+ 生效目录进执行 argv", async () => {
    fx.seedReadyDeployment();
    const taskId = fx.seedDeploymentTask("远端 worktree", { workdir: WORKDIR, worktree: true });
    fx.scope.enqueueSpawn({ code: 0, stdout: ENVELOPE, stderr: "", durationMs: 5 });
    fx.scope.program(/^cd /, { code: 0, stdout: `PK_WT ${WORKDIR}-pk-${taskId}\n` });
    const outcome = await dispatchHeadless(fx.db.conn, remoteHeadlessDeps(fx.db.conn, fx.platform), taskId);
    expect(outcome.state).toBe("done");
    expect(outcome.note).toContain("worktree 隔离");
    const wtScript = fx.scope.commands.find((c) => c.startsWith("cd /srv/app"));
    expect(wtScript).toContain("git rev-parse --show-toplevel");
    expect(wtScript).toContain(`pk-${taskId}`);
    const spawn = fx.scope.spawns.find((argv) => argv[0] === "/bin/sh");
    expect(spawn?.[2]).toContain(`cd ${WORKDIR}-pk-${taskId} || exit 1`);
    expect(fx.lastSession(taskId)["workdir"]).toBe(`${WORKDIR}-pk-${taskId}`);
  });

  it("同一任务重派幂等复用（两次派发同一 worktree 哨兵）", async () => {
    fx.seedReadyDeployment();
    const taskId = fx.seedDeploymentTask("远端 worktree2", { workdir: WORKDIR, worktree: true });
    fx.scope.program(/^cd /, { code: 0, stdout: `PK_WT ${WORKDIR}-pk-${taskId}\n` });
    await dispatchHeadless(fx.db.conn, remoteHeadlessDeps(fx.db.conn, fx.platform), taskId);
    fx.scope.enqueueSpawn({ code: 0, stdout: ENVELOPE, stderr: "", durationMs: 5 });
    await dispatchHeadless(fx.db.conn, remoteHeadlessDeps(fx.db.conn, fx.platform), taskId); // done → 可直接重派
    const wtScripts = fx.scope.commands.filter((c) => c.startsWith("cd /srv/app"));
    expect(wtScripts).toHaveLength(2); // 同款脚本两次（幂等语义由远端 git worktree add 承载）
  });
});

describe("远端 worktree：失败降级 + 路由判定表", () => {
  it("worktree 建立失败 → 降级原工作目录", async () => {
    fx.seedReadyDeployment();
    const taskId = fx.seedDeploymentTask("远端 worktree3", { workdir: WORKDIR, worktree: true });
    fx.scope.program(/^cd /, { code: 1, stdout: "", stderr: "not a git repo" });
    const outcome = await dispatchHeadless(fx.db.conn, remoteHeadlessDeps(fx.db.conn, fx.platform), taskId);
    expect(outcome.state).toBe("done");
    expect(outcome.note).toContain("worktree 建立失败");
    expect(outcome.note).toContain("改用原工作目录");
    const spawn = fx.scope.spawns.filter((argv) => argv[2]?.includes("exec ")).at(-1);
    expect(spawn?.[2]).toContain("cd /srv/app || exit 1"); // 降级原目录
  });

  it("planRemoteRoute 判定表（local / family / direct / reject 四分支）", () => {
    const localRoute = { deployment: null } as Parameters<typeof planRemoteRoute>[1];
    expect(planRemoteRoute(fx.db.conn, localRoute, fx.platform).kind).toBe("local");

    const depId = fx.seedReadyDeployment();
    const route = { deployment: { ref: ALIAS, target: TARGET } } as Parameters<typeof planRemoteRoute>[1];
    expect(planRemoteRoute(fx.db.conn, route, fx.platform).kind).toBe("family");
    fx.familyAvailable = false;
    expect(planRemoteRoute(fx.db.conn, route, fx.platform)).toMatchObject({
      kind: "reject",
      tag: "SSH_FAMILY_MISSING",
    });
    fx.familyAvailable = true;
    expect(planRemoteRoute(fx.db.conn, route, fx.platform).kind).toBe("family");

    const map = listDeployments(fx.db.conn);
    map[depId] = { ...map[depId], degraded: true };
    fx.db.conn
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(DEPLOYMENTS_KEY, JSON.stringify(map));
    fx.familyAvailable = false;
    expect(planRemoteRoute(fx.db.conn, route, fx.platform)).toMatchObject({ kind: "direct" });
    fx.familyAvailable = true;
    expect(planRemoteRoute(fx.db.conn, route, fx.platform)).toMatchObject({ kind: "direct" }); // degraded 恒直连
  });
});
