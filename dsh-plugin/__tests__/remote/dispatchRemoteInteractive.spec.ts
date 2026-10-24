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
import { setupDispatchRemoteFx, ALIAS, ENVELOPE, execScriptOf, TARGET, WORKDIR } from "./dispatchRemoteFx";

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
    expect(fx.scope.spawnTerminalCalls[0]?.command).toBe("/usr/bin/zsh");
    expect(fx.scope.spawnTerminalCalls[0]?.args).toEqual(["-l"]);
    expect(fx.scope.spawnTerminalCalls[0]?.cwd).toBe(WORKDIR);
    expect(fx.scope.terminalWrites).toHaveLength(1);
    expect(fx.scope.terminalWrites[0]?.sessionId).toBe("pty-1");
    expect(fx.scope.terminalWrites[0]?.data).toContain("claude");
    expect(fx.scope.terminalWrites[0]?.data.endsWith("\n")).toBe(true);
    const row = fx.lastSession(taskId);
    expect(row["kind"]).toBe("dispatch_interactive");
    // PTY 句柄带 pty: 标记落账（非 agent 会话 id——回放不组 --resume <句柄>）
    expect(row["session_id"]).toBe("pty:pty-1");
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
    expect(fx.lastSession(taskId)["session_id"]).toBe("pty:pty-1");
  });

  it("存量未标记句柄行（pty: 标记之前落账）重派仍复用同 PTY，新账本行补上标记", async () => {
    fx.seedReadyDeployment();
    const taskId = fx.seedDeploymentTask("交互存量句柄");
    await dispatchInteractive(fx.db.conn, interactiveDeps(), taskId);
    fx.db.conn.prepare("UPDATE agent_sessions SET session_id='pty-1' WHERE task_id=?").run(taskId);
    dispatchReport(fx.db.conn, taskId, "failed", null);
    const second = await dispatchInteractive(fx.db.conn, interactiveDeps(), taskId);
    expect(second.terminal).toBe("pty-1");
    expect(fx.scope.spawnTerminalCalls).toHaveLength(1);
    expect(fx.lastSession(taskId)["session_id"]).toBe("pty:pty-1");
  });
});

describe("交互 TerminalAdapter：PTY 承载 shell 会话旗标（loginShellFlags 单源——dash 拒绝 -l）", () => {
  it("登录 shell 即 /bin/sh 的部署 → 旗标为空（回归：无条件 -l 在 dash 上 Illegal option 秒退）", async () => {
    fx.seedReadyDeployment();
    fx.scope.loginShellPath = "/bin/sh";
    const taskId = fx.seedDeploymentTask("交互sh登录壳");
    await dispatchInteractive(fx.db.conn, interactiveDeps(), taskId);
    expect(fx.scope.spawnTerminalCalls[0]?.command).toBe("/bin/sh");
    expect(fx.scope.spawnTerminalCalls[0]?.args).toEqual([]);
    expect(fx.lastSession(taskId)["session_id"]).toBe("pty:pty-1");
  });

  it("登录 shell 探测失败（getent 无果）→ /bin/sh 回落同样无 -l", async () => {
    fx.seedReadyDeployment();
    fx.scope.program(/getent passwd/, { code: 1 });
    const taskId = fx.seedDeploymentTask("交互sh回落");
    await dispatchInteractive(fx.db.conn, interactiveDeps(), taskId);
    expect(fx.scope.spawnTerminalCalls[0]?.command).toBe("/bin/sh");
    expect(fx.scope.spawnTerminalCalls[0]?.args).toEqual([]);
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
    expect(fx.lastSession(taskId)["session_id"]).toBe("pty:pty-1");
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

describe("交互 TerminalAdapter：本机 GUI 终端在场 → 部署路由弹 ssh 别名窗口（desktop exec.rs 远端分支同构）", () => {
  function windowDeps(local: ReturnType<typeof createFakeTerminal>) {
    const parts = remoteInteractiveParts(fx.db.conn, fx.platform, { localSshWindow: local });
    return {
      terminal: createFakeTerminal(),
      terminalFor: parts.terminalFor,
      deploymentPrecheck: parts.deploymentPrecheck,
    };
  }

  it("ssh -tt <别名> 包装 `cd 远端目录 && agent 行` 交本机终端；本机侧 workdir=null；不开 PTY；账本 remote_host=alias、session_id 落预生成会话 id", async () => {
    fx.seedReadyDeployment();
    const local = createFakeTerminal();
    const taskId = fx.seedDeploymentTask("交互弹窗", { workdir: "~/proj" });
    const outcome = await dispatchInteractive(fx.db.conn, windowDeps(local), taskId);
    expect(outcome.state).toBe("running");
    expect(outcome.terminal).toBe("fake-terminal");
    expect(fx.scope.spawnTerminalCalls).toHaveLength(0);
    expect(local.injections).toHaveLength(1);
    const injected = local.injections[0];
    expect(injected?.workdir).toBeNull();
    expect(injected?.taskId).toBe(taskId);
    expect(injected?.line.startsWith("ssh -tt -o ConnectTimeout=10 -- dev-box exec ")).toBe(true);
    expect(injected?.line).toContain("cd ~/proj && claude");
    const row = fx.lastSession(taskId);
    expect(row["remote_host"]).toBe(ALIAS);
    expect(row["session_id"]).toMatch(/^[0-9a-f-]{36}$/); // 预生成会话 id（远端 claude 以该 id 起会话，回放远端 --resume）
  });

  it("dsh 类 agent：ssh 载荷换 dst 前端（`dst -- <提示词>`，不带 dsh 历史参数）", async () => {
    fx.seedReadyDeployment();
    fx.seedAgent("claude", "headless {prompt}", { command: "dsh" });
    const local = createFakeTerminal();
    const taskId = fx.seedDeploymentTask("交互 dst", { workdir: WORKDIR });
    await dispatchInteractive(fx.db.conn, windowDeps(local), taskId);
    expect(local.injections[0]?.line).toContain(`cd ${WORKDIR} && dst -- `);
    expect(local.injections[0]?.line).not.toContain("headless");
    expect(String(fx.lastSession(taskId)["command"])).toMatch(/^dst -- /);
  });

  it("家族缺失也不拒绝（系统 ssh 不依赖 dsh-ssh，交互前置复核放行）", async () => {
    fx.familyAvailable = false;
    fx.seedReadyDeployment();
    const local = createFakeTerminal();
    const taskId = fx.seedDeploymentTask("交互无家族");
    const outcome = await dispatchInteractive(fx.db.conn, windowDeps(local), taskId);
    expect(outcome.state).toBe("running");
    expect(local.injections[0]?.line).toContain("ssh -tt");
  });
});

describe("派发工作目录随执行世界（tag meta 缺省时 = 部署实体登记工作区，不是 agent 本机路径）", () => {
  it("交互 ssh 弹窗载荷与无头远端脚本均 cd 到实体工作区；账本 workdir 快照同值（回放据此 cd）", async () => {
    fx.seedReadyDeployment();
    fx.seedAgent("claude", "-p {prompt}", { workdir: "~/.choose-you/workspace" });
    const local = createFakeTerminal();
    const parts = remoteInteractiveParts(fx.db.conn, fx.platform, { localSshWindow: local });
    const interactiveId = fx.seedDeploymentTask("交互实体工作区");
    await dispatchInteractive(
      fx.db.conn,
      { terminal: createFakeTerminal(), terminalFor: parts.terminalFor, deploymentPrecheck: parts.deploymentPrecheck },
      interactiveId,
    );
    expect(local.injections[0]?.line).toContain(`cd ${WORKDIR} && claude`);
    expect(local.injections[0]?.line).not.toContain(".choose-you/workspace");
    expect(fx.lastSession(interactiveId)["workdir"]).toBe(WORKDIR);

    const headlessId = fx.seedDeploymentTask("无头实体工作区");
    fx.scope.enqueueSpawn({ code: 0, stdout: ENVELOPE, stderr: "", durationMs: 5 });
    await dispatchHeadless(fx.db.conn, remoteHeadlessDeps(fx.db.conn, fx.platform), headlessId);
    const script = execScriptOf(fx.scope.spawns);
    expect(script).toContain(`cd ${WORKDIR} || exit 1`);
    expect(fx.lastSession(headlessId)["workdir"]).toBe(WORKDIR);
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
    expect(execScriptOf(fx.scope.spawns)).toContain(`cd ${WORKDIR}-pk-${taskId} || exit 1`);
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
    expect(execScriptOf(fx.scope.spawns)).toContain("cd /srv/app || exit 1"); // 降级原目录
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
