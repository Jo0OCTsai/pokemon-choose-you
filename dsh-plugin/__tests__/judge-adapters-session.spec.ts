/**
 * judge/adapters · CLI 执行方的会话 id 三源与失败回链（judge.rs pregen_session_id /
 * inject_pregen_args 同构）：claude/pi 预生成 `--session-id` 追加 argv 且失败路径错误携带
 * 该 id；dsh 自动补 `--json` 并从事件流捕获 sessionId（adopt 语义不预生成）；信封回填
 * 优先于预生成；未知 kind 不加任何会话旗标。spawn 全走注入 fake（不起子进程）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cliJudgeExecutor, sessionIdOfError, withSessionId, type AgentSpawn } from "../src/host/judge/adapters";
import { applySuggestion } from "../src/host/domain/suggest-apply";
import type { AgentConfig } from "../src/host/domain/settings";
import { createTestDb, seedMessage, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
  seedMessage(db.conn, "om_1", {});
  // 预落一条判定（模拟 agent 期间经 pk suggest batch 写回）——成功路径不触发「全部遗漏」
  applySuggestion(db.conn, { messageId: "om_1", action: "todo", title: "交周报", tags: [] }, "a1");
});
afterEach(() => {
  db.close();
});

function agentOf(over: Partial<AgentConfig>): AgentConfig {
  return {
    id: "a1",
    name: "A1",
    command: "claude",
    args: "-p {prompt}",
    historyArgs: "",
    workdir: "",
    timeoutSecs: 10,
    enabled: true,
    ...over,
  };
}

/** 记录 argv 的 fake spawn（stdout 可编程；抛错可编程） */
function recordingSpawn(stdout = "", fail?: Error): { spawnFn: AgentSpawn; argv: string[][] } {
  const argv: string[][] = [];
  return {
    argv,
    spawnFn: async (_program, args) => {
      argv.push(args);
      if (fail !== undefined) {
        throw fail;
      }
      return { stdout, stderr: "" };
    },
  };
}

describe("cliJudgeExecutor · 预生成会话 id（claude / pi）", () => {
  it("claude：argv 末尾追加 --session-id <uuid>；无信封时 sessionId = 预生成", async () => {
    const rec = recordingSpawn("plain text, no envelope");
    const exec = cliJudgeExecutor({ conn: db.conn, agent: agentOf({ command: "claude" }), spawnFn: rec.spawnFn });
    const out = await exec.run({ prompt: "P", messageIds: ["om_1"] });
    const argv = rec.argv[0];
    expect(argv.slice(0, 2)).toEqual(["-p", "P"]);
    expect(argv[2]).toBe("--session-id");
    expect(argv[3]).toMatch(/^[0-9a-f-]{36}$/);
    expect(argv).toHaveLength(4);
    expect(out.sessionId).toBe(argv[3]);
  });

  it("信封 session_id 回填优先于预生成；pi 同样预生成", async () => {
    const rec = recordingSpawn('{"result":"ok","session_id":"from-envelope"}');
    const exec = cliJudgeExecutor({ conn: db.conn, agent: agentOf({ command: "pi", args: "" }), spawnFn: rec.spawnFn });
    const out = await exec.run({ prompt: "P", messageIds: ["om_1"] });
    expect(rec.argv[0][0]).toBe("--session-id");
    expect(out.sessionId).toBe("from-envelope");
  });

  it("失败路径（spawn 抛错 / 全部遗漏）：错误携带预生成 id——账本失败行可回链", async () => {
    const boom = recordingSpawn("", new Error("Agent「claude」退出码 1：boom"));
    const exec = cliJudgeExecutor({ conn: db.conn, agent: agentOf({}), spawnFn: boom.spawnFn });
    const failure = await exec.run({ prompt: "P", messageIds: ["om_1"] }).catch((e: unknown) => e);
    expect((failure as Error).message).toMatch(/boom/);
    expect(sessionIdOfError(failure)).toBe(boom.argv[0][3]);

    seedMessage(db.conn, "om_2", {});
    const missed = recordingSpawn("");
    const exec2 = cliJudgeExecutor({ conn: db.conn, agent: agentOf({}), spawnFn: missed.spawnFn });
    const failure2 = await exec2.run({ prompt: "P", messageIds: ["om_2"] }).catch((e: unknown) => e);
    expect((failure2 as Error).message).toMatch(/全部遗漏/);
    expect(sessionIdOfError(failure2)).toBe(missed.argv[0][3]);
  });
});

describe("cliJudgeExecutor · dsh（adopt 语义：不预生成，--json 事件流捕获）", () => {
  const stream = '{"type":"session","sessionId":"session-ab12","cwd":"/w"}\n{"type":"final","text":"done"}\n';

  it("argv 自动补 --json（无 --session-id 预生成）；sessionId 自事件流首行捕获", async () => {
    const rec = recordingSpawn(stream);
    const exec = cliJudgeExecutor({
      conn: db.conn,
      agent: agentOf({ command: "dsh", args: "--profile headless" }),
      spawnFn: rec.spawnFn,
    });
    const out = await exec.run({ prompt: "P", messageIds: ["om_1"] });
    expect(rec.argv[0]).toEqual(["--profile", "headless", "--json"]);
    expect(out.sessionId).toBe("session-ab12");
  });

  it("用户 args 已含 --json 不重复；无事件流回传 → sessionId null", async () => {
    const rec = recordingSpawn("plain");
    const exec = cliJudgeExecutor({
      conn: db.conn,
      agent: agentOf({ command: "dsh", args: "--profile headless --json" }),
      spawnFn: rec.spawnFn,
    });
    const out = await exec.run({ prompt: "P", messageIds: ["om_1"] });
    expect(rec.argv[0]).toEqual(["--profile", "headless", "--json"]);
    expect(out.sessionId).toBeNull();
  });

  it("未知 kind：不加任何会话旗标（argv 原样）", async () => {
    const rec = recordingSpawn("");
    const exec = cliJudgeExecutor({
      conn: db.conn,
      agent: agentOf({ command: "/bin/sh", args: "-c x" }),
      spawnFn: rec.spawnFn,
    });
    await exec.run({ prompt: "P", messageIds: ["om_1"] });
    expect(rec.argv[0]).toEqual(["-c", "x"]);
  });
});

describe("withSessionId / sessionIdOfError（失败回链原语）", () => {
  it("对象错误挂 id 可回读；null id 不挂；非对象错误与空串安全归 null", () => {
    const err = new Error("x");
    expect(sessionIdOfError(withSessionId(err, "s-1"))).toBe("s-1");
    expect(sessionIdOfError(withSessionId(new Error("y"), null))).toBeNull();
    expect(withSessionId("plain", "s-2")).toBe("plain");
    expect(sessionIdOfError("plain")).toBeNull();
    expect(sessionIdOfError(undefined)).toBeNull();
    expect(sessionIdOfError({ sessionId: "" })).toBeNull();
  });
});
