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
import { setupDispatchRemoteFx, ALIAS, WORKDIR } from "./dispatchRemoteFx";

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
    .prepare("SELECT remote_host, kind, session_id, status FROM agent_sessions ORDER BY id DESC LIMIT 1")
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
    const script = fx.scope.spawns.find((argv) => argv[0] === "/bin/sh")?.[2] ?? "";
    expect(script).toContain(`cd ${WORKDIR} || exit 1`);
    expect(script).toMatch(
      /exec \/usr\/local\/bin\/node \/usr\/local\/bin\/claude -p '判定这批' --session-id [0-9a-f-]{36}$/,
    );
  });
});

describe("执行世界落账（remote_host）", () => {
  const remoteFake: JudgeExecutor = {
    id: "claude",
    name: "远程CC",
    selfLanding: false,
    remoteHost: ALIAS,
    run: async (batch) => ({
      suggestions: batch.messageIds.map((messageId) => ({ messageId, action: "none" as const, tags: [] })),
      sessionId: "sess-1",
    }),
  };

  it("编排成功/失败两态与捕捉账本行均带执行方 remoteHost", async () => {
    seedMessage(fx.db.conn, "om_1", {});
    await orchestrateBatch({ conn: fx.db.conn, executor: remoteFake }, ["om_1"]);
    expect(lastSession()).toMatchObject({ remote_host: ALIAS, kind: "classify", status: "ok" });

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
