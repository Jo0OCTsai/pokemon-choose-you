/**
 * dispatch/headless：无头链路集成（fake 执行器成功/失败/超时三态）——状态机流转 +
 * 槽生命周期（占槽/删槽/槽满）+ 账本落库（agent_sessions kind=dispatch_headless）+
 * 审计 + 会话续接（A14 session_flags / dispatched_session 预生成与信封回填）+
 * worktree 策略。对齐 headless.rs / auto.rs 行为。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatchHeadless, runQueuedHeadless } from "../src/host/dispatch/headless";
import { kindForCommand, logAgentSession, sessionFlags } from "../src/host/dispatch/sessions";
import { dispatchArgs } from "../src/host/dispatch/cmdline";
import { createFakeExecutor, type FakeExecutor } from "../src/host/dispatch/executor";
import { PkyError } from "../src/host/storage/errors";
import { createTestDb, seedTask, type TestDb } from "./helpers";

let db: TestDb;
let fake: FakeExecutor;
beforeEach(() => {
  db = createTestDb();
  fake = createFakeExecutor();
});
afterEach(() => {
  db.close();
});

function seedAgent(agentId: string, opts: { command?: string; args?: string } = {}): void {
  const agents = [
    {
      id: agentId,
      name: `Agent ${agentId}`,
      command: opts.command ?? "claude",
      args: opts.args ?? "-p {prompt}",
      historyArgs: "",
      workdir: "",
      timeoutSecs: 120,
      enabled: true,
    },
  ];
  db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_agents', ?)").run(JSON.stringify(agents));
}

function seedProjectTask(title: string, opts: { meta?: string | null; state?: string | null } = {}): number {
  const taskId = seedTask(db.conn, title, { status: "scheduled" });
  const tagId = Number(
    (
      db.conn
        .prepare("INSERT INTO tags (name, dimension_id, meta, created_at) VALUES (?, 1, ?, 't')")
        .run(title, opts.meta ?? JSON.stringify({ agentId: "ag-1" })) as { lastInsertRowid: number | bigint }
    ).lastInsertRowid,
  );
  db.conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(taskId, tagId);
  if (opts.state !== undefined && opts.state !== null) {
    db.conn.prepare("UPDATE tasks SET dispatch_state=? WHERE id=?").run(opts.state, taskId);
  }
  return taskId;
}

function sessionRow(taskId: number): Record<string, unknown> {
  return db.conn.prepare("SELECT * FROM agent_sessions WHERE task_id=? ORDER BY id DESC LIMIT 1").get(taskId) as Record<
    string,
    unknown
  >;
}

function slotCount(): number {
  return Number((db.conn.prepare("SELECT COUNT(*) AS n FROM dispatch_slots").get() as { n: number }).n);
}

function state(taskId: number): unknown {
  return (db.conn.prepare("SELECT dispatch_state FROM tasks WHERE id=?").get(taskId) as { dispatch_state: unknown })
    .dispatch_state;
}

const deps = (): { executorFor: () => FakeExecutor } => ({ executorFor: () => fake });

describe("session_flags（A14 / headless.rs 同构）", () => {
  it("claude：续接 --resume；首轮预生成 --session-id uuid v4", () => {
    const resume = sessionFlags("claude-code", " sess-9 ");
    expect(resume.flags).toBe("--resume sess-9");
    expect(resume.preSession).toBeNull();
    const first = sessionFlags("claude-code", null);
    expect(first.flags).toMatch(/^--session-id [0-9a-f-]{36}$/);
    expect(first.preSession).toBe(first.flags.split(" ")[1]);
  });

  it("pi：续接与首轮同旗标 --session-id；其他 agent 无续接", () => {
    expect(sessionFlags("pi", "sess-9").flags).toBe("--session-id sess-9");
    expect(sessionFlags("pi", null).preSession).toMatch(/^[0-9a-f-]{36}$/);
    expect(sessionFlags("opencode", "sess-9").flags).toBe("");
    expect(sessionFlags(null, "sess-9").flags).toBe("");
  });
});

describe("纯函数（kind_for_command / dispatch_args）", () => {
  it("kind 判定与预设白名单剔除", () => {
    expect(kindForCommand("/opt/homebrew/bin/claude")).toBe("claude-code");
    expect(kindForCommand("pi")).toBe("pi");
    expect(kindForCommand("my-agent")).toBeNull();
    expect(dispatchArgs("-p {prompt} --allowedTools Bash(pk:*) --output-format json")).toBe(
      "-p {prompt} --output-format json",
    );
    expect(dispatchArgs("-p {prompt} --allowedTools Bash(git:*) Bash(pk:*)")).toBe(
      "-p {prompt} --allowedTools Bash(git:*)",
    );
    expect(dispatchArgs("")).toBe("");
  });
});

describe("手动无头派发（fake 执行器三态）", () => {
  it("成功：定界 prompt + 状态 done + 账本 + 审计 + 删槽", async () => {
    seedAgent("ag-1");
    const taskId = seedProjectTask("修登录 bug");
    const outcome = await dispatchHeadless(db.conn, deps(), taskId);
    expect(outcome.state).toBe("done");
    expect(state(taskId)).toBe("done");
    expect(slotCount()).toBe(0); // 收口删槽
    // 执行器收到定界 prompt 与 PK_DISPATCH_TASK
    expect(fake.jobs[0]?.prompt).toContain("===== 待办数据开始 =====");
    expect(fake.jobs[0]?.prompt).toContain("标题：修登录 bug");
    expect(fake.jobs[0]?.env?.["PK_DISPATCH_TASK"]).toBe(String(taskId));
    // 账本（agent_sessions kind=dispatch_headless）
    const row = sessionRow(taskId);
    expect(row["kind"]).toBe("dispatch_headless");
    expect(row["status"]).toBe("ok");
    expect(row["exit_code"]).toBe(0);
    expect(row["agent_id"]).toBe("ag-1");
    expect(String(row["command"])).toContain("无头派发 ·");
    // 审计（状态机迁移留痕）
    const log = db.conn
      .prepare("SELECT new_value, origin FROM task_logs WHERE task_id=? AND field='dispatch_state'")
      .get(taskId) as { new_value: string; origin: string };
    expect(log.new_value).toBe("done");
    expect(log.origin).toBe("dsh:dispatch-headless");
  });

  it("失败：非零退出码 → failed + error 账本行", async () => {
    seedAgent("ag-1");
    const taskId = seedProjectTask("任务");
    fake.enqueue({ exitCode: 1, stdout: "" });
    const outcome = await dispatchHeadless(db.conn, deps(), taskId);
    expect(outcome.state).toBe("failed");
    expect(state(taskId)).toBe("failed");
    const row = sessionRow(taskId);
    expect(row["status"]).toBe("error");
    expect(row["exit_code"]).toBe(1);
    expect(slotCount()).toBe(0);
  });
});

describe("手动无头派发：超时态", () => {
  it("超时：timedOut → failed + 记原因（DISPATCH_TIMEOUT）+ exit_code null", async () => {
    seedAgent("ag-1");
    const taskId = seedProjectTask("任务");
    fake.enqueue({ exitCode: null, timedOut: true });
    const outcome = await dispatchHeadless(db.conn, deps(), taskId);
    expect(outcome.state).toBe("failed");
    expect(outcome.code).toBe("DISPATCH_TIMEOUT");
    expect(outcome.note).toMatch(/超时/);
    expect(sessionRow(taskId)["exit_code"]).toBeNull();
    expect(state(taskId)).toBe("failed");
  });
});

describe("手动无头派发：信封回填与会话续接", () => {
  it("信封 is_error / 成本字段回填 + dispatched_session 落库", async () => {
    seedAgent("ag-1");
    const taskId = seedProjectTask("任务");
    fake.enqueue({
      exitCode: 0,
      stdout: '{"session_id":"real-sess-1","total_cost_usd":0.42,"usage":{"input_tokens":10,"output_tokens":20}}',
    });
    const outcome = await dispatchHeadless(db.conn, deps(), taskId);
    expect(outcome.state).toBe("done");
    expect(outcome.sessionId).toBe("real-sess-1");
    expect(
      (db.conn.prepare("SELECT dispatched_session FROM tasks WHERE id=?").get(taskId) as { dispatched_session: string })
        .dispatched_session,
    ).toBe("real-sess-1");
    const row = sessionRow(taskId);
    expect(row["session_id"]).toBe("real-sess-1");
    expect(row["cost_usd"]).toBeCloseTo(0.42);
    expect(row["input_tokens"]).toBe(10);
    // 信封标记失败
    fake.enqueue({ exitCode: 0, stdout: '{"is_error":true}' });
    const bad = await dispatchHeadless(db.conn, deps(), seedProjectTask("任务2"));
    expect(bad.state).toBe("failed");
    expect(bad.note).toMatch(/is_error/);
  });

  it("续接：claude 上轮会话 → --resume；首轮预生成 uuid 落库（进程被杀也留续接线索）", async () => {
    seedAgent("ag-1", { command: "claude" });
    const taskId = seedProjectTask("任务");
    db.conn.prepare("UPDATE tasks SET dispatched_session='sess-9' WHERE id=?").run(taskId);
    await dispatchHeadless(db.conn, deps(), taskId);
    expect(fake.jobs[0]?.args).toContain("--resume sess-9");
    // 首轮：预生成 --session-id，无信封回传时预生成 id 即最终会话 id（落 dispatched_session）
    const firstId = seedProjectTask("首轮任务");
    const outcome = await dispatchHeadless(db.conn, deps(), firstId);
    expect(fake.jobs[1]?.args).toContain("--session-id ");
    expect(outcome.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      (
        db.conn.prepare("SELECT dispatched_session FROM tasks WHERE id=?").get(firstId) as {
          dispatched_session: string;
        }
      ).dispatched_session,
    ).toBe(outcome.sessionId);
  });
});

describe("手动无头派发：互斥与前置校验", () => {
  it("重复派发：running 中 → DISPATCH_ALREADY_ACTIVE；槽满 → DISPATCH_LAUNCH_FAILED", async () => {
    seedAgent("ag-1");
    const taskId = seedProjectTask("任务");
    db.conn.prepare("UPDATE tasks SET dispatch_state='running' WHERE id=?").run(taskId);
    await expect(dispatchHeadless(db.conn, deps(), taskId)).rejects.toMatchObject({
      code: "DISPATCH_ALREADY_ACTIVE",
    });
    // 槽满（maxConcurrent 缺省 1，手工占位）
    db.conn
      .prepare(
        "INSERT INTO dispatch_slots (host_key, task_id, owner, acquired_at, lease_expires_at) VALUES ('local', 999, 'app', 't', 't')",
      )
      .run();
    db.conn.prepare("UPDATE tasks SET dispatch_state=NULL WHERE id=?").run(taskId);
    await expect(dispatchHeadless(db.conn, deps(), taskId)).rejects.toMatchObject({
      code: "DISPATCH_LAUNCH_FAILED",
      message: /并发槽已满/,
    });
    expect(state(taskId)).toBeNull(); // 槽满时 claim 回滚，任务未领取
    expect(slotCount()).toBe(1);
  });

  it("无 project 标签 → 参数错（不进执行）", async () => {
    seedAgent("ag-1");
    const bare = seedTask(db.conn, "裸任务");
    await expect(dispatchHeadless(db.conn, deps(), bare)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(fake.jobs).toHaveLength(0);
  });
});

describe("排队任务无头执行（自动派发路径原语）", () => {
  it("queued → 领取占槽 → done → 删槽；槽满 → started:false 保持 queued", async () => {
    seedAgent("ag-1");
    const taskId = seedProjectTask("任务", { state: "queued" });
    const run = await runQueuedHeadless(db.conn, deps(), taskId);
    expect(run.started).toBe(true);
    if (run.started) {
      expect(run.outcome.state).toBe("done");
    }
    expect(state(taskId)).toBe("done");
    expect(slotCount()).toBe(0);
    // 槽满：另一 queued 任务领不到（保持 queued，下轮再试）
    const other = seedProjectTask("任务2", { state: "queued" });
    db.conn
      .prepare(
        "INSERT INTO dispatch_slots (host_key, task_id, owner, acquired_at, lease_expires_at) VALUES ('local', 999, 'app', 't', 't')",
      )
      .run();
    const blocked = await runQueuedHeadless(db.conn, deps(), other);
    expect(blocked.started).toBe(false);
    expect(state(other)).toBe("queued");
  });

  it("running 中不允许重复 claim（防重复派发）", async () => {
    seedAgent("ag-1");
    const taskId = seedProjectTask("任务", { state: "running" });
    const run = await runQueuedHeadless(db.conn, deps(), taskId);
    expect(run.started).toBe(false);
    expect(fake.jobs).toHaveLength(0);
  });
});

describe("agent_sessions 落账原语", () => {
  it("任务不存在 → 参数错；agent 名反查失败用 id 兜底", () => {
    expect(() => logAgentSession(db.conn, { agentId: "x", kind: "dispatch_headless", status: "ok" })).not.toThrow();
    const row = db.conn.prepare("SELECT agent_name FROM agent_sessions WHERE task_id IS NULL").get() as {
      agent_name: string;
    };
    expect(row.agent_name).toBe("x");
    // 名字空白的 agent 条目回落 id（agent_name_of 过滤空名）
    db.conn
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_agents', ?)")
      .run(JSON.stringify([{ id: "ag-blank", name: "  ", command: "claude" }]));
    logAgentSession(db.conn, { agentId: "ag-blank", kind: "dispatch_headless", status: "ok" });
    const blank = db.conn.prepare("SELECT agent_name FROM agent_sessions WHERE agent_id='ag-blank'").get() as {
      agent_name: string;
    };
    expect(blank.agent_name).toBe("ag-blank");
    // 任务不存在 → PkyError（INVALID_ARGUMENT 语义位）
    try {
      logAgentSession(db.conn, { taskId: 9999, agentId: "x", kind: "dispatch_headless", status: "ok" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PkyError);
      expect((e as PkyError).code).toBe("INVALID_ARGUMENT");
    }
  });
});
