/**
 * judge/adapters · cliJudgeExecutor 执行世界（agent 绑定部署——judge.rs resolve_remote_target
 * 同构）：绑定部署经注入的远端 DispatchExecutor 执行（本机 spawn 不触碰）、远端结果折算判定
 * 口径（JUDGE_TIMEOUT / 错误 / 非零退出）、远端执行面缺席明确拒绝不回落本机、未绑定走本机；
 * 会话账本 remote_host 执行世界快照。真实部署路由选型见 remote/judgeRemote.spec。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cliJudgeExecutor, logJudgeSession } from "../src/host/judge/adapters";
import { createFakeExecutor } from "../src/host/dispatch/executor";
import { applySuggestion } from "../src/host/domain/suggest-apply";
import type { AgentConfig } from "../src/host/domain/settings";
import { createTestDb, seedMessage, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

function judgeAgent(over: Partial<AgentConfig>): AgentConfig {
  return {
    id: "a1",
    name: "A1",
    command: "claude",
    args: "",
    historyArgs: "",
    workdir: "",
    timeoutSecs: 10,
    enabled: true,
    ...over,
  };
}

describe("cliJudgeExecutor × 执行世界 · 远端路径", () => {
  it("绑定部署 → 经远端执行器执行（会话旗标以模板尾缀交执行器，本机 spawn 不触碰）；remoteHost = alias；信封 session_id 采纳", async () => {
    seedMessage(db.conn, "om_1", {});
    applySuggestion(db.conn, { messageId: "om_1", action: "todo", title: "交周报", tags: [] }, "a1");
    const fake = createFakeExecutor();
    fake.enqueue({ exitCode: 0, stdout: '{"result":"ok","session_id":"sess-remote"}' });
    const exec = cliJudgeExecutor({
      conn: db.conn,
      agent: judgeAgent({ args: "-p {prompt} --output-format json", workdir: "/srv/app", deployment: "dev-box" }),
      remoteExecutorFor: () => fake,
      spawnFn: async () => {
        throw new Error("本机 spawn 不应被调用");
      },
    });
    expect(exec.remoteHost).toBe("dev-box");
    const out = await exec.run({ prompt: "判定这批", messageIds: ["om_1"] });
    expect(out.sessionId).toBe("sess-remote");
    expect(out.suggestions[0]).toMatchObject({ messageId: "om_1", action: "todo" });
    expect(fake.jobs).toHaveLength(1);
    expect(fake.jobs[0]).toMatchObject({ command: "claude", prompt: "判定这批", workdir: "/srv/app", timeoutSecs: 10 });
    expect(fake.jobs[0]?.args).toMatch(/^-p \{prompt\} --output-format json --session-id [0-9a-f-]{36}$/);
  });

  it("远端超时 → JUDGE_TIMEOUT；执行错误 / 非零退出带详情抛错（与本机口径同形）", async () => {
    const agent = judgeAgent({ deployment: "dev-box" });
    const run = (fake: ReturnType<typeof createFakeExecutor>) =>
      cliJudgeExecutor({ conn: db.conn, agent, remoteExecutorFor: () => fake }).run({ prompt: "p", messageIds: [] });
    const timeout = createFakeExecutor();
    timeout.enqueue({ timedOut: true });
    await expect(run(timeout)).rejects.toMatchObject({ code: "JUDGE_TIMEOUT" });
    const broken = createFakeExecutor();
    broken.enqueue({ error: "远端连接不可用（部署 dev-box）" });
    await expect(run(broken)).rejects.toThrow(/远端执行失败.*远端连接不可用/);
    const nonzero = createFakeExecutor();
    nonzero.enqueue({ exitCode: 3, stdout: "agent exploded" });
    await expect(run(nonzero)).rejects.toThrow(/退出码 3.*agent exploded/);
  });
});

describe("cliJudgeExecutor × 执行世界 · 拒绝与本机", () => {
  it("绑定部署但远端执行面缺席（工厂缺席 / 返回 null）→ DEPLOYMENT_NOT_READY，绝不回落本机 spawn", async () => {
    let spawned = 0;
    const spawnFn = async () => {
      spawned++;
      return { stdout: "", stderr: "" };
    };
    const agent = judgeAgent({ command: "/bin/sh", deployment: "dev-box" });
    const batch = { prompt: "p", messageIds: [] };
    await expect(cliJudgeExecutor({ conn: db.conn, agent, spawnFn }).run(batch)).rejects.toMatchObject({
      code: "DEPLOYMENT_NOT_READY",
    });
    await expect(
      cliJudgeExecutor({ conn: db.conn, agent, spawnFn, remoteExecutorFor: () => null }).run(batch),
    ).rejects.toMatchObject({ code: "DEPLOYMENT_NOT_READY" });
    expect(spawned).toBe(0);
  });

  it("未绑定部署（空白 alias）走本机 spawn，remoteHost 为 null，工厂不被调用", async () => {
    const exec = cliJudgeExecutor({
      conn: db.conn,
      agent: judgeAgent({ command: "/bin/sh", deployment: "  " }),
      spawnFn: async () => ({ stdout: '{"result":"ok","session_id":"s-local"}', stderr: "" }),
      remoteExecutorFor: () => {
        throw new Error("未绑定部署不应解析远端执行器");
      },
    });
    expect(exec.remoteHost).toBeNull();
    expect((await exec.run({ prompt: "p", messageIds: [] })).sessionId).toBe("s-local");
  });
});

describe("会话账本 remote_host（执行世界快照）", () => {
  it("部署 alias 落 remote_host；缺省/null 落空串——派发行 executionWorld 同口径；capture kind 同样随行", () => {
    const base = { agentId: "a1", agentName: "Claude", sessionId: null, durationMs: 1, status: "ok" as const };
    logJudgeSession(db.conn, { ...base, remoteHost: "dev-box" });
    logJudgeSession(db.conn, { ...base, remoteHost: null });
    logJudgeSession(db.conn, { ...base, kind: "capture" });
    const rows = db.conn.prepare("SELECT remote_host, kind FROM agent_sessions ORDER BY id").all() as Array<{
      remote_host: string;
      kind: string;
    }>;
    expect(rows.map((r) => r.remote_host)).toEqual(["dev-box", "", ""]);
    expect(rows[2]?.kind).toBe("capture");
  });
});
