/**
 * 判定执行世界（judge.rs resolve_remote_target 同构）：remoteJudgeExecutorFor 按 agent 绑定
 * 部署选型（未绑定 null / 家族 / 直连 / reject 抛 PkyError 不回落本机）；家族链真跑经
 * scope.spawn 在部署上执行判定 CLI（cd 工作目录 + 会话旗标）；编排/捕捉落账 remote_host。
 * 夹具 = dispatchRemoteFx.ts（默认 agent 绑定 ALIAS）。
 */
import { describe, expect, it } from "vitest";
import { remoteJudgeExecutorFor } from "../../src/host/remote/sshExecutor";
import { DEPLOYMENTS_KEY, listDeployments } from "../../src/host/remote/deployments";
import { cliJudgeExecutor, type JudgeExecutor } from "../../src/host/judge/adapters";
import { orchestrateBatch } from "../../src/host/judge/orchestrator";
import { captureTodo } from "../../src/host/judge/capture";
import { applySuggestion } from "../../src/host/domain/suggest-apply";
import type { AgentConfig } from "../../src/host/domain/settings";
import { seedMessage } from "../helpers";
import { setupDispatchRemoteFx, ALIAS, execScriptOf, WORKDIR } from "./dispatchRemoteFx";

const fx = setupDispatchRemoteFx();

function agentOf(deployment: string | null): AgentConfig {
  return {
    id: "claude",
    name: "远程CC",
    command: "claude",
    args: "-p {prompt}",
    historyArgs: "",
    workdir: WORKDIR,
    timeoutSecs: 10,
    enabled: true,
    deployment,
  };
}

function lastSession(): Record<string, unknown> {
  return fx.db.conn
    .prepare("SELECT remote_host, kind, session_id, status, workdir FROM agent_sessions ORDER BY id DESC LIMIT 1")
    .get() as Record<string, unknown>;
}

describe("remoteJudgeExecutorFor：按绑定部署选型", () => {
  it("未绑定（null / 空白）→ null；就绪部署家族在场 → 执行器；degraded → 直连执行器", () => {
    const factory = remoteJudgeExecutorFor(fx.db.conn, fx.platform, { minTimeoutSecs: 10 });
    expect(factory(agentOf(null))).toBeNull();
    expect(factory(agentOf("  "))).toBeNull();
    const depId = fx.seedReadyDeployment();
    expect(factory(agentOf(ALIAS))).not.toBeNull();
    const map = listDeployments(fx.db.conn);
    map[depId] = { ...map[depId], degraded: true };
    fx.db.conn
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(DEPLOYMENTS_KEY, JSON.stringify(map));
    fx.familyAvailable = false;
    expect(factory(agentOf(ALIAS))).not.toBeNull();
  });

  it("部署缺失 → DEPLOYMENT_NOT_READY；家族缺失未降级 → HELPER_CAPABILITY_MISSING（判定不回落本机）", () => {
    const factory = remoteJudgeExecutorFor(fx.db.conn, fx.platform);
    expect(() => factory(agentOf("ghost"))).toThrow(expect.objectContaining({ code: "DEPLOYMENT_NOT_READY" }));
    fx.seedReadyDeployment();
    fx.familyAvailable = false;
    expect(() => factory(agentOf(ALIAS))).toThrow(expect.objectContaining({ code: "HELPER_CAPABILITY_MISSING" }));
  });
});

describe("判定在部署上执行（家族链真跑）", () => {
  it("判定 CLI 经 scope.spawn 在部署上执行：cd 工作目录 + 预生成会话旗标；信封 session_id 采纳", async () => {
    fx.seedReadyDeployment();
    seedMessage(fx.db.conn, "om_1", {});
    // 远端 agent 经 pk 隧道写回判定——测试以预落一条模拟写回
    applySuggestion(fx.db.conn, { messageId: "om_1", action: "todo", title: "交周报", tags: [] }, "claude");
    fx.scope.enqueueSpawn({ code: 0, stdout: '{"result":"ok","session_id":"sess-remote"}', stderr: "", durationMs: 5 });
    const exec = cliJudgeExecutor({
      conn: fx.db.conn,
      agent: agentOf(ALIAS),
      remoteExecutorFor: remoteJudgeExecutorFor(fx.db.conn, fx.platform, { minTimeoutSecs: 10 }),
      spawnFn: async () => {
        throw new Error("本机 spawn 不应被调用");
      },
    });
    const out = await exec.run({ prompt: "判定这批", messageIds: ["om_1"] });
    expect(out.sessionId).toBe("sess-remote");
    expect(out.suggestions[0]).toMatchObject({ messageId: "om_1", action: "todo" });
    const script = execScriptOf(fx.scope.spawns);
    expect(script).toContain(`cd ${WORKDIR} || exit 1`);
    expect(script).toMatch(
      /exec \/usr\/local\/bin\/node \/usr\/local\/bin\/claude -p '判定这批' --session-id [0-9a-f-]{36}$/,
    );
  });

  it("远端非零退出：stderr 经家族链 outcome 透传进判定报错（不再只剩空详情）", async () => {
    fx.seedReadyDeployment();
    fx.scope.enqueueSpawn({ code: 1, stdout: "", stderr: "claude: not logged in\n", durationMs: 5 });
    const exec = cliJudgeExecutor({
      conn: fx.db.conn,
      agent: agentOf(ALIAS),
      remoteExecutorFor: remoteJudgeExecutorFor(fx.db.conn, fx.platform, { minTimeoutSecs: 10 }),
    });
    await expect(exec.run({ prompt: "p", messageIds: [] })).rejects.toThrow(/退出码 1：claude: not logged in/);
  });
});

describe("判定 CLI 解释形态（家族链——头部分类探测）", () => {
  it("原生二进制 CLI 不加 node 前缀（回归：claude-code ≥2.x npm bin 链到 bin/claude.exe ELF，node 直载报 ERR_UNKNOWN_FILE_EXTENSION）", async () => {
    fx.seedReadyDeployment();
    fx.scope.enqueueSpawn({ code: 0, stdout: '{"result":"ok"}', stderr: "", durationMs: 5 });
    fx.scope.remoteBins.set("claude", "/home/vscode/.local/bin/claude");
    fx.scope.files.set("/home/vscode/.local/bin/claude", "\u007fELF\u0002\u0001\u0001");
    const exec = cliJudgeExecutor({
      conn: fx.db.conn,
      agent: agentOf(ALIAS),
      remoteExecutorFor: remoteJudgeExecutorFor(fx.db.conn, fx.platform, { minTimeoutSecs: 10 }),
    });
    await exec.run({ prompt: "p", messageIds: [] });
    const script = execScriptOf(fx.scope.spawns);
    expect(script).toMatch(/exec \/home\/vscode\/\.local\/bin\/claude -p p --session-id [0-9a-f-]{36}$/);
    expect(script).not.toContain("/usr/local/bin/node");
  });

  it("node 脚本型 CLI（#!/usr/bin/env node shim）维持 node 前缀——部署 nodePath 承载运行时", async () => {
    fx.seedReadyDeployment();
    fx.scope.enqueueSpawn({ code: 0, stdout: '{"result":"ok"}', stderr: "", durationMs: 5 });
    fx.scope.remoteBins.set("claude", "/usr/local/bin/claude");
    fx.scope.files.set("/usr/local/bin/claude", "#!/usr/bin/env node\nrequire('cli');\n");
    const exec = cliJudgeExecutor({
      conn: fx.db.conn,
      agent: agentOf(ALIAS),
      remoteExecutorFor: remoteJudgeExecutorFor(fx.db.conn, fx.platform, { minTimeoutSecs: 10 }),
    });
    await exec.run({ prompt: "p", messageIds: [] });
    const script = execScriptOf(fx.scope.spawns);
    expect(script).toContain("exec /usr/local/bin/node /usr/local/bin/claude -p p");
  });
});

describe("执行世界落账（remote_host）", () => {
  const remoteFake: JudgeExecutor = {
    id: "claude",
    name: "远程CC",
    selfLanding: false,
    remoteHost: ALIAS,
    workdir: WORKDIR,
    run: async (batch) => ({
      suggestions: batch.messageIds.map((messageId) => ({ messageId, action: "none" as const, tags: [] })),
      sessionId: "sess-1",
    }),
  };

  it("编排成功/失败两态与捕捉账本行均带执行方 remoteHost", async () => {
    seedMessage(fx.db.conn, "om_1", {});
    await orchestrateBatch({ conn: fx.db.conn, executor: remoteFake }, ["om_1"]);
    expect(lastSession()).toMatchObject({ remote_host: ALIAS, kind: "classify", status: "ok", workdir: WORKDIR });

    seedMessage(fx.db.conn, "om_2", {});
    const failing: JudgeExecutor = {
      ...remoteFake,
      run: async () => {
        throw new Error("远端炸了");
      },
    };
    await orchestrateBatch({ conn: fx.db.conn, executor: failing }, ["om_2"]);
    expect(lastSession()).toMatchObject({ remote_host: ALIAS, kind: "classify", status: "error" });

    await captureTodo({ conn: fx.db.conn, executor: remoteFake }, "买牛奶");
    expect(lastSession()).toMatchObject({ remote_host: ALIAS, kind: "capture" });
  });
});

describe("判定工作目录随执行世界（部署实体 workdir 压过 agent 本机路径）", () => {
  it("agent.workdir 为本机路径（~/.choose-you/workspace）时，远端脚本 cd 到部署登记的工作区而非远端 home 子目录", async () => {
    fx.seedReadyDeployment();
    fx.scope.enqueueSpawn({ code: 0, stdout: '{"result":"ok","session_id":"s"}', stderr: "", durationMs: 5 });
    const exec = cliJudgeExecutor({
      conn: fx.db.conn,
      agent: { ...agentOf(ALIAS), workdir: "~/.choose-you/workspace" },
      remoteExecutorFor: remoteJudgeExecutorFor(fx.db.conn, fx.platform, { minTimeoutSecs: 10 }),
    });
    await exec.run({ prompt: "p", messageIds: [] });
    const script = execScriptOf(fx.scope.spawns);
    expect(script).toContain(`cd ${WORKDIR} || exit 1`);
    expect(script).not.toContain(".choose-you/workspace");
  });

  it("部署实体未登记工作区（空）→ 维持 agent.workdir 远端展开", async () => {
    const depId = fx.seedReadyDeployment();
    const map = listDeployments(fx.db.conn);
    map[depId] = { ...map[depId], workdir: "" };
    fx.db.conn
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(DEPLOYMENTS_KEY, JSON.stringify(map));
    fx.scope.enqueueSpawn({ code: 0, stdout: '{"result":"ok","session_id":"s"}', stderr: "", durationMs: 5 });
    const exec = cliJudgeExecutor({
      conn: fx.db.conn,
      agent: { ...agentOf(ALIAS), workdir: "~/proj" },
      remoteExecutorFor: remoteJudgeExecutorFor(fx.db.conn, fx.platform, { minTimeoutSecs: 10 }),
    });
    await exec.run({ prompt: "p", messageIds: [] });
    const script = execScriptOf(fx.scope.spawns);
    expect(script).toContain("cd ~/proj || exit 1");
  });
});
