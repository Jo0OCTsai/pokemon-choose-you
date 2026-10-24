/**
 * dispatch 远端接线 · 家族链全流程（任务 2.8 / AD §4.7/§5.4；从原 dispatchRemote.spec
 * 拆出——棘轮 max-lines，等量迁移）：就绪复核前置 / node 前缀 + 信封回传 + 执行世界
 * 快照 / 事务外执行 / 失败路径与超时。夹具 = dispatchRemoteFx.ts。
 */
import { describe, expect, it } from "vitest";
import { dispatchHeadless, runQueuedHeadless } from "../../src/host/dispatch/headless";
import type { ResolvedDispatchRoute } from "../../src/host/dispatch/routes";
import type { AgentConfig } from "../../src/host/domain/settings";
import { remoteHeadlessDeps, REMOTE_PATH_BOOTSTRAP } from "../../src/host/remote/sshExecutor";
import { listDeployments } from "../../src/host/remote/deployments";
import { seedTask } from "../helpers";
import { setupDispatchRemoteFx, ALIAS, ENVELOPE, execScriptOf, WORKDIR } from "./dispatchRemoteFx";

const fx = setupDispatchRemoteFx();

describe("sshExecutor 家族链（无头）：就绪派发与信封回传", () => {
  it("就绪部署派发：node 前缀 + command -v 解析 + 信封回传 + 执行世界快照落账", async () => {
    const depId = fx.seedReadyDeployment();
    const taskId = fx.seedDeploymentTask("远端任务", { workdir: WORKDIR });
    fx.scope.enqueueSpawn({ code: 0, stdout: ENVELOPE, stderr: "", durationMs: 5 });
    const outcome = await dispatchHeadless(fx.db.conn, remoteHeadlessDeps(fx.db.conn, fx.platform), taskId);
    expect(outcome.state).toBe("done");
    expect(outcome.sessionId).toBe("sess-remote-1");
    // 就绪复核（活性 + 摘要）经 scope.shell；可执行解析 = 登录 shell 视角 command -v
    // （ssh 会话同环境）；执行经登录 shell argv [shell, -l, -c]
    expect(fx.scope.commands).toContain("printf pky-ok");
    expect(fx.scope.spawns).toContainEqual(["/usr/bin/zsh", "-l", "-c", "command -v claude"]);
    const script = execScriptOf(fx.scope.spawns);
    expect(script).toContain("cd /srv/app || exit 1");
    expect(script).toContain("exec /usr/local/bin/node /usr/local/bin/claude");
    expect(script).toContain("export PK_DISPATCH_TASK=");
    // prompt 无占位变体走 stdin（本用例 args 含 {prompt} → argv 内替换，不裸拼分隔符）
    // 落账：执行世界快照 remote_host = 部署 target（= alias）+ workdir 生效目录（A27）
    const row = fx.lastSession(taskId);
    expect(row["kind"]).toBe("dispatch_headless");
    expect(row["remote_host"]).toBe(ALIAS);
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
    expect(execScriptOf(fx.scope.spawns)).not.toContain("===== 待办数据开始 =====");
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
    // 执行世界 = 默认 agent 绑定（无路由/无 meta——解析走 default 层也命中绑定）
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
    expect(fx.scope.spawns.filter((argv) => (argv[3] ?? argv[2] ?? "").includes("exec "))).toHaveLength(0);
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

  it("本机分支执行器同吃 opts.minTimeoutSecs（回归：此前漏传恒 600 秒下限）", async () => {
    const executor = remoteHeadlessDeps(fx.db.conn, fx.platform, { minTimeoutSecs: 1 }).executorFor?.(
      {} as AgentConfig,
      { deployment: null } as ResolvedDispatchRoute,
    );
    expect(executor).toBeDefined();
    const outcome = await executor!.launch({ command: "sleep", args: "5", prompt: "", workdir: null, timeoutSecs: 1 });
    expect(outcome.timedOut).toBe(true);
  });
});

describe("sshExecutor 家族链（无头）：探测通道异常（传输层失败与负缓存）", () => {
  it("探测通道异常（如部署工作目录不存在 → spawn ENOENT）→ 通道/工作目录指引，不误报找不到命令", async () => {
    fx.seedReadyDeployment();
    fx.scope.remoteBins.delete("claude");
    fx.scope.spawnError = new Error("spawn /bin/sh ENOENT");
    const taskId = fx.seedDeploymentTask("远端任务-enoent");
    const outcome = await dispatchHeadless(fx.db.conn, remoteHeadlessDeps(fx.db.conn, fx.platform), taskId);
    expect(outcome.state).toBe("failed");
    expect(outcome.note).toContain("spawn /bin/sh ENOENT");
    expect(outcome.note).toContain("工作目录");
    expect(outcome.note).not.toContain("远端找不到命令");
  });

  it("探测通道异常不落负缓存：同一执行器恢复后重试可解析", async () => {
    fx.seedReadyDeployment();
    fx.scope.remoteBins.delete("claude");
    fx.scope.spawnError = new Error("spawn /bin/sh ENOENT");
    const executor = remoteHeadlessDeps(fx.db.conn, fx.platform).executorFor!(
      {} as AgentConfig,
      { deployment: { ref: ALIAS, target: ALIAS } } as unknown as ResolvedDispatchRoute,
    )!;
    const job = { command: "claude", args: "-p {prompt}", prompt: "hi", workdir: null, timeoutSecs: 10 };
    const first = await executor.launch(job);
    expect(first.error).toContain("spawn /bin/sh ENOENT");
    fx.scope.spawnError = null;
    fx.scope.remoteBins.set("claude", "/usr/local/bin/claude");
    fx.scope.enqueueSpawn({ code: 0, stdout: ENVELOPE, stderr: "", durationMs: 5 });
    const second = await executor.launch(job);
    expect(second.error).toBeUndefined();
    expect(second.exitCode).toBe(0);
  });
});

describe("sshExecutor 家族链（无头）：可执行解析与执行面 shell", () => {
  it("CLI 只装在 ~/.local/bin → 登录 shell 视角可解析（ssh 会话同环境）并直执行原生二进制", async () => {
    fx.seedReadyDeployment();
    // npm --prefix ~/.local 全局 CLI 场景（pky-remote 实测）：登录环境含 ~/.local/bin
    fx.scope.remoteBins.set("claude", "/home/dev/.local/bin/claude");
    fx.scope.files.set("/home/dev/.local/bin/claude", "\u007fELF(fake-native-cli)");
    fx.scope.enqueueSpawn({ code: 0, stdout: ENVELOPE, stderr: "", durationMs: 5 });
    const taskId = fx.seedDeploymentTask("远端任务-localbin");
    const outcome = await dispatchHeadless(fx.db.conn, remoteHeadlessDeps(fx.db.conn, fx.platform), taskId);
    expect(outcome.state).toBe("done");
    expect(fx.scope.spawns).toContainEqual(["/usr/bin/zsh", "-l", "-c", "command -v claude"]);
    expect(execScriptOf(fx.scope.spawns)).toContain("exec /home/dev/.local/bin/claude");
  });

  it("登录 shell 视角探不到 → 回落 /bin/sh + PATH 兜底段探测仍可解析（回归：helper 缺省 PATH 缺 ~/.local/bin）", async () => {
    fx.seedReadyDeployment();
    fx.scope.remoteBins.set("claude", "/home/dev/.local/bin/claude");
    fx.scope.files.set("/home/dev/.local/bin/claude", "\u007fELF(fake-native-cli)");
    fx.scope.loginProbeMisses.add("claude");
    fx.scope.enqueueSpawn({ code: 0, stdout: ENVELOPE, stderr: "", durationMs: 5 });
    const taskId = fx.seedDeploymentTask("远端任务-fallback");
    const outcome = await dispatchHeadless(fx.db.conn, remoteHeadlessDeps(fx.db.conn, fx.platform), taskId);
    expect(outcome.state).toBe("done");
    expect(fx.scope.commands).toContain(`${REMOTE_PATH_BOOTSTRAP}; command -v claude`);
    expect(execScriptOf(fx.scope.spawns)).toContain("exec /home/dev/.local/bin/claude");
  });
});

describe("sshExecutor 家族链（无头）：登录 shell 封装与退化形态", () => {
  it("登录 shell 函数/别名封装（.zshenv 等）→ 走 shell 名形态：登录 shell 内裸名执行、不 exec、退出码传播", async () => {
    fx.seedReadyDeployment();
    fx.scope.loginFunctions.add("claude");
    fx.scope.enqueueSpawn({ code: 0, stdout: ENVELOPE, stderr: "", durationMs: 5 });
    const taskId = fx.seedDeploymentTask("远端任务-fn");
    const outcome = await dispatchHeadless(fx.db.conn, remoteHeadlessDeps(fx.db.conn, fx.platform), taskId);
    expect(outcome.state).toBe("done");
    const script = execScriptOf(fx.scope.spawns);
    expect(script).toContain("; claude -p"); // 收口段裸名（无 exec 前缀）
    expect(script).not.toContain("exec ");
    // 执行 argv = 登录 shell 形态（非 /bin/sh）
    expect(fx.scope.spawns.some((argv) => argv[1] === "-l" && argv[3] === script)).toBe(true);
  });

  it("登录 shell 探测失败（getent 无果）→ /bin/sh 退化形态执行（[sh, -c]），探测同形态无 -l", async () => {
    fx.seedReadyDeployment();
    fx.scope.program(/getent passwd/, { code: 0, stdout: "" });
    fx.scope.enqueueSpawn({ code: 0, stdout: ENVELOPE, stderr: "", durationMs: 5 });
    const taskId = fx.seedDeploymentTask("远端任务-shfallback");
    const outcome = await dispatchHeadless(fx.db.conn, remoteHeadlessDeps(fx.db.conn, fx.platform), taskId);
    expect(outcome.state).toBe("done");
    // 探测与执行同为 [sh, -c] 形态（退化无 -l）；执行 spawn 以 export PATH 前缀区分
    const sh = fx.scope.spawns.find(
      (argv) => argv[0] === "/bin/sh" && argv[1] === "-c" && !(argv[2] ?? "").startsWith("command -v "),
    );
    expect(sh).toBeDefined();
    expect(sh?.[2]).toContain("exec /usr/local/bin/node /usr/local/bin/claude");
    expect(fx.scope.spawns).toContainEqual(["/bin/sh", "-c", "command -v claude"]);
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
