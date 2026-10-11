/**
 * judge/adapters：命令行组装（{prompt}/stdin）、信封解包、库回读（pending 语义行/兜底行）、
 * fake/占位执行方、CLI 执行方（fake agent 脚本：stdin 落盘 + 信封输出 + 库回读口径）、
 * 会话账本（agent_sessions kind=classify）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAgentInvocation,
  cliJudgeExecutor,
  extractPayload,
  fakeSubagentExecutor,
  landedCount,
  loadSuggestionsFor,
  logJudgeSession,
  subagentExecutorPlaceholder,
  type JudgeExecutor,
} from "../src/host/judge/adapters";
import { PkyError } from "../src/host/storage/errors";
import { createTestDb, scalar, seedAgents, seedMessage, type TestDb } from "./helpers";
import { applySuggestion } from "../src/host/domain/suggest-apply";
import type { AgentConfig } from "../src/host/domain/settings";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

describe("buildAgentInvocation", () => {
  it("args 带 {prompt} → 替换进 argv；未出现 → prompt 走 stdin", () => {
    const slot = buildAgentInvocation({ command: "claude", args: "-p {prompt} --output-format json" }, "PROMPT");
    expect(slot.argv).toEqual(["-p", "PROMPT", "--output-format", "json"]);
    expect(slot.stdin).toBeUndefined();
    const viaStdin = buildAgentInvocation({ command: "pi", args: "--session-id x" }, "PROMPT");
    expect(viaStdin.argv).toEqual(["--session-id", "x"]);
    expect(viaStdin.stdin).toBe("PROMPT");
    expect(buildAgentInvocation({ command: "a", args: "" }, "P").stdin).toBe("P");
  });
});

describe("extractPayload / loadSuggestionsFor", () => {
  it("claude JSON 信封解 result + session_id；非 JSON 原文", () => {
    expect(extractPayload('{"result":"done","session_id":"s1"}')).toEqual({ content: "done", sessionId: "s1" });
    expect(extractPayload("plain output")).toEqual({ content: "plain output", sessionId: null });
    expect(extractPayload('{"other":1}').content).toBe('{"other":1}');
  });

  it("回读：已落库态映射 action；pending 语义行；缺失消息按 none 兜底", () => {
    seedMessage(db.conn, "om_t", {});
    seedMessage(db.conn, "om_p", {});
    applySuggestion(db.conn, { messageId: "om_t", action: "todo", title: "交周报", tags: [] }, "cli");
    const out = loadSuggestionsFor(db.conn, ["om_t", "om_p", "om_missing"]);
    expect(out[0]).toMatchObject({ messageId: "om_t", action: "todo", title: "交周报" });
    expect(out[0].tags).toEqual([]);
    expect(out[1].action).toBe("pending");
    expect(out[2].action).toBe("none");
    expect(landedCount(out)).toBe(2);
  });
});

describe("执行方形态", () => {
  it("fake subagent：内存结构化结果（selfLanding=false）", async () => {
    const exec = fakeSubagentExecutor("fake", (batch) => [
      { messageId: batch.messageIds[0], action: "none", reason: "闲聊", tags: [] },
    ]);
    const out = await exec.run({ prompt: "p", messageIds: ["om_1"] });
    expect(exec.selfLanding).toBe(false);
    expect(out.suggestions[0].action).toBe("none");
  });

  it("subagent 占位：调用即明确报错（不静默半工作）", async () => {
    await expect(subagentExecutorPlaceholder().run({ prompt: "p", messageIds: [] })).rejects.toThrow(/未装配/);
  });
});

/** 搭一个 fake agent 脚本（stdin 落盘到 marker、输出 JSON 信封），返回执行方与清理件 */
function stageFakeAgent(
  conn: TestDb["conn"],
  promptSink: { marker: string; bin: string },
): { exec: ReturnType<typeof cliJudgeExecutor> } {
  seedAgents(conn, [{ id: "a1", command: "/bin/sh" }]);
  const agents = JSON.parse(String(scalar(conn, "SELECT value FROM settings WHERE key='ai_agents'"))) as AgentConfig[];
  writeFileSync(
    promptSink.bin,
    `#!/bin/sh\ncat > ${promptSink.marker}\nprintf '%s' '{"result":"ok","session_id":"sess-1"}'\n`,
  );
  chmodSync(promptSink.bin, 0o755);
  return {
    exec: cliJudgeExecutor({
      conn,
      agent: { ...agents[0], args: "", workdir: "", command: promptSink.bin, timeoutSecs: 10 },
    }),
  };
}

/** fake agent 断言：prompt 经 stdin 落盘、信封 session_id、库回读建议形态 */
async function assertFakeAgentRun(exec: JudgeExecutor, marker: string): Promise<void> {
  const out = await exec.run({ prompt: "判定这批", messageIds: ["om_1"] });
  expect(readFileSync(marker, "utf8")).toContain("判定这批");
  expect(out.sessionId).toBe("sess-1");
  expect(out.suggestions[0]).toMatchObject({ messageId: "om_1", action: "todo" });
}

describe("cliJudgeExecutor（真实子进程 + fake agent 脚本）", () => {
  it("prompt 经 stdin 送达；输出信封 session_id 采纳；库回读组装建议", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pky-agent-"));
    try {
      const { exec } = stageFakeAgent(db.conn, { marker: join(dir, "prompt.txt"), bin: join(dir, "fake-agent.sh") });
      seedMessage(db.conn, "om_1", {});
      // 预落一条判定（模拟 agent 期间经 pk suggest batch 写回）
      applySuggestion(db.conn, { messageId: "om_1", action: "todo", title: "交周报", tags: [] }, "a1");
      await assertFakeAgentRun(exec, join(dir, "prompt.txt"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("全部遗漏（无落库）判失败；非零退出码携带输出详情", async () => {
    seedAgents(db.conn, [{ id: "a1", command: "/usr/bin/true" }]);
    const agents = JSON.parse(
      String(scalar(db.conn, "SELECT value FROM settings WHERE key='ai_agents'")),
    ) as AgentConfig[];
    seedMessage(db.conn, "om_1", {});
    const base = { ...agents[0], args: "", workdir: "" };
    const exec = cliJudgeExecutor({ conn: db.conn, agent: base });
    await expect(exec.run({ prompt: "p", messageIds: ["om_1"] })).rejects.toThrow(/全部遗漏/);
    const dir = mkdtempSync(join(tmpdir(), "pky-agent-boom-"));
    const bin = join(dir, "boom.sh");
    writeFileSync(bin, "#!/bin/sh\necho 'agent exploded' >&2\nexit 3\n");
    chmodSync(bin, 0o755);
    try {
      const boom = cliJudgeExecutor({ conn: db.conn, agent: { ...base, command: bin } });
      await expect(boom.run({ prompt: "p", messageIds: [] })).rejects.toThrow(/退出码 3.*agent exploded/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("超时映射 JUDGE_TIMEOUT（注入 spawn 抛 PkyError 透传）", async () => {
    seedAgents(db.conn, [{ id: "a1" }]);
    const agents = JSON.parse(
      String(scalar(db.conn, "SELECT value FROM settings WHERE key='ai_agents'")),
    ) as Array<AgentConfig>;
    const exec = cliJudgeExecutor({
      conn: db.conn,
      agent: { ...agents[0], args: "", workdir: "" },
      spawnFn: async () => {
        throw new PkyError("JUDGE_TIMEOUT", "Agent 执行超时（10 秒）");
      },
    });
    await expect(exec.run({ prompt: "p", messageIds: [] })).rejects.toMatchObject({ code: "JUDGE_TIMEOUT" });
  });
});

describe("会话账本（agent_sessions）", () => {
  it("logJudgeSession 落 kind=classify 行（成败两态）", () => {
    logJudgeSession(db.conn, { agentId: "a1", agentName: "Claude", sessionId: "s1", durationMs: 1200, status: "ok" });
    logJudgeSession(db.conn, { agentId: "a1", agentName: "Claude", sessionId: null, durationMs: 50, status: "error" });
    const rows = db.conn
      .prepare("SELECT session_id, status, duration_ms, kind FROM agent_sessions ORDER BY id")
      .all() as Array<{ session_id: string | null; status: string; duration_ms: number | null; kind: string }>;
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.kind === "classify")).toBe(true);
    expect(rows[0]).toMatchObject({ session_id: "s1", status: "ok", duration_ms: 1200 });
    expect(rows[1]).toMatchObject({ session_id: null, status: "error" });
  });
});
