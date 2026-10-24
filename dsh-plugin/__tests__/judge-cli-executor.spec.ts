/**
 * judge/adapters · cliJudgeExecutor 真实子进程链（从 judge-adapters.spec 拆出——棘轮
 * max-lines，等量迁移）：fake agent 脚本（stdin 落盘 + 信封输出 + 库回读口径）·
 * 整批 none 落库不判「全部遗漏」· 全部遗漏/非零退出码失败口径 · 超时映射。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cliJudgeExecutor, type JudgeExecutor } from "../src/host/judge/adapters";
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

describe("cliJudgeExecutor · fake agent 脚本链", () => {
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

  it("整批 none 落库不判「全部遗漏」：回读 action=none（agent 经 pk 写回是真实落库）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pky-agent-none-"));
    try {
      const { exec } = stageFakeAgent(db.conn, { marker: join(dir, "prompt.txt"), bin: join(dir, "fake-agent.sh") });
      seedMessage(db.conn, "om_1", {});
      // 预落 none 判定（模拟 agent 期间经 pk suggest batch 写回——真实事故形态：
      // 整批恰好全判 none 时不能误报「没有任何判定落库」）
      applySuggestion(
        db.conn,
        { messageId: "om_1", action: "none", reason: "在@群智能体提问，非指派用户", confidence: "medium", tags: [] },
        "a1",
      );
      const out = await exec.run({ prompt: "判定这批", messageIds: ["om_1"] });
      expect(out.suggestions[0]).toMatchObject({ messageId: "om_1", action: "none" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("cliJudgeExecutor · 失败与超时口径", () => {
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
