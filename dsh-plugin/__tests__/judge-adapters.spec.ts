/**
 * judge/adapters：命令行组装（{prompt}/stdin）、信封解包、库回读（pending 语义行/兜底行）、
 * fake/占位执行方、CLI 执行方（fake agent 脚本：stdin 落盘 + 信封输出 + 库回读口径）、
 * 会话账本（agent_sessions kind=classify）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

/** 最小 agent 配置（覆盖式） */
function judgeAgent(over: Partial<AgentConfig>): AgentConfig {
  return {
    id: "a1",
    name: "A1",
    command: "/bin/sh",
    args: "",
    historyArgs: "",
    workdir: "",
    timeoutSecs: 10,
    enabled: true,
    ...over,
  };
}

/** 造 dsh 形态的裸名 agent：临时 home 的 ~/.local/bin 下放 node 软链 + #!/usr/bin/env node 脚本（信封输出） */
function stageEnvNodeAgent(): { home: string } {
  const home = mkdtempSync(join(tmpdir(), "pky-judge-home-"));
  const binDir = join(home, ".local", "bin");
  mkdirSync(binDir, { recursive: true });
  symlinkSync(process.execPath, join(binDir, "node"));
  const bin = join(binDir, "pky-judge-agent");
  writeFileSync(
    bin,
    "#!/usr/bin/env node\n" +
      'let sink = "";\n' +
      'process.stdin.on("data", (c) => (sink += c));\n' +
      'process.stdin.on("end", () => process.stdout.write(JSON.stringify({ result: "ok", session_id: "sess-gui" })));\n',
  );
  chmodSync(bin, 0o755);
  return { home };
}

/** GUI 精简 PATH（Dock/Finder 启动形态）+ 指定 HOME 下执行；结束恢复进程环境 */
async function withGuiEnv<T>(home: string, run: () => Promise<T>): Promise<T> {
  const oldPath = process.env.PATH;
  const oldHome = process.env.HOME;
  process.env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
  process.env.HOME = home;
  try {
    return await run();
  } finally {
    process.env.PATH = oldPath;
    process.env.HOME = oldHome;
  }
}

describe("cliJudgeExecutor × 本地环境解析（GUI 精简 PATH——which.rs/runner.rs 基准，经 dispatch/localEnv）", () => {
  it("裸名 + #!/usr/bin/env node 脚本（nvm/.local 形态）：补扫解析 + 子进程 PATH 前插后在精简 PATH 下可执行", async () => {
    const { home } = stageEnvNodeAgent();
    seedMessage(db.conn, "om_1", {});
    applySuggestion(db.conn, { messageId: "om_1", action: "todo", title: "交周报", tags: [] }, "a1");
    await withGuiEnv(home, async () => {
      const exec = cliJudgeExecutor({ conn: db.conn, agent: judgeAgent({ command: "pky-judge-agent" }) });
      const out = await exec.run({ prompt: "判定这批", messageIds: ["om_1"] });
      expect(out.sessionId).toBe("sess-gui");
      expect(out.suggestions[0]).toMatchObject({ messageId: "om_1", action: "todo" });
    });
    rmSync(home, { recursive: true, force: true });
  });

  it("workdir ~/ 前缀按 HOME 展开（agent_workdir 同构），cwd 不落字面 ~ 目录", async () => {
    const home = mkdtempSync(join(tmpdir(), "pky-judge-home-"));
    const wrk = join(home, "wrk");
    mkdirSync(wrk);
    const dir = mkdtempSync(join(tmpdir(), "pky-agent-"));
    const bin = join(dir, "fake-agent.sh");
    writeFileSync(bin, `#!/bin/sh\npwd > ${join(dir, "pwd.txt")}\nprintf '%s' '{"result":"ok","session_id":"s1"}'\n`);
    chmodSync(bin, 0o755);
    seedMessage(db.conn, "om_1", {});
    applySuggestion(db.conn, { messageId: "om_1", action: "todo", title: "交周报", tags: [] }, "a1");
    const oldHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const exec = cliJudgeExecutor({ conn: db.conn, agent: judgeAgent({ command: bin, workdir: "~/wrk" }) });
      const out = await exec.run({ prompt: "p", messageIds: ["om_1"] });
      expect(out.sessionId).toBe("s1");
      expect(readFileSync(join(dir, "pwd.txt"), "utf8").trim()).toBe(realpathSync(wrk));
    } finally {
      process.env.HOME = oldHome;
      rmSync(home, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("cliJudgeExecutor × 本地环境报错口径", () => {
  it("找不到命令：ENOENT 文案附可操作指引（spawnErrorHint 同款）", async () => {
    const exec = cliJudgeExecutor({ conn: db.conn, agent: judgeAgent({ command: "pky-no-such-agent-xyz" }) });
    await expect(exec.run({ prompt: "p", messageIds: [] })).rejects.toThrow(
      /执行失败.*ENOENT（找不到命令或工作目录不存在.*绝对路径/,
    );
  });

  it("workdir 不存在：独立报错，不落到 ENOENT 与「命令找不到」混淆（runner.rs 预检同构）", async () => {
    const exec = cliJudgeExecutor({ conn: db.conn, agent: judgeAgent({ workdir: "/no/such/pky-judge-dir" }) });
    await expect(exec.run({ prompt: "p", messageIds: [] })).rejects.toThrow(/Agent 工作目录不存在/);
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
