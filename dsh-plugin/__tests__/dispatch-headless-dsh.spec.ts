/**
 * dsh headless 会话续接（先捕获后使用）：dispatch/dshSession 纯函数（`--json` 旗标补齐、
 * 事件流 session 事件解析）+ sessionFlags dsh 分支（adopt 语义不预生成）+ 无头派发链路
 * 集成（首轮自动 `--json` 并从事件流捕获会话 id 落 dispatched_session/账本；次轮
 * `--session-id <prev>` adopt；用户已配 `--json` 不重复）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatchHeadless } from "../src/host/dispatch/headless";
import { dshJsonFlag, parseDshSessionId } from "../src/host/dispatch/dshSession";
import { parseHeadlessEnvelope, createFakeExecutor, type FakeExecutor } from "../src/host/dispatch/executor";
import { sessionFlags } from "../src/host/dispatch/sessions";
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

const STREAM =
  '{"type":"session","sessionId":"session-aaaa-1111","cwd":"/w"}\n' +
  '{"type":"text","text":"处理中"}\n{"type":"final","text":"done"}\n';

/** dsh agent 配置（ai_agents 设置键）+ 一个经项目标签绑定到该 agent 的 scheduled 任务 */
function seedDshTask(args: string, title: string): number {
  const agent = {
    id: "ag-1",
    name: "dsh",
    command: "dsh",
    args,
    historyArgs: "",
    workdir: "",
    timeoutSecs: 120,
    enabled: true,
  };
  db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_agents', ?)").run(JSON.stringify([agent]));
  const taskId = seedTask(db.conn, title, { status: "scheduled" });
  const tag = db.conn
    .prepare("INSERT INTO tags (name, dimension_id, meta, created_at) VALUES (?, 1, ?, 't')")
    .run(title, JSON.stringify({ agentId: "ag-1" })) as { lastInsertRowid: number | bigint };
  db.conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(taskId, Number(tag.lastInsertRowid));
  return taskId;
}

function dispatchedSession(taskId: number): string | null {
  return (
    db.conn.prepare("SELECT dispatched_session FROM tasks WHERE id=?").get(taskId) as {
      dispatched_session: string | null;
    }
  ).dispatched_session;
}

describe("dshSession 纯函数", () => {
  it("dshJsonFlag：dsh 补 --json（用户已配不重复）；其他 kind 空串", () => {
    expect(dshJsonFlag("dsh", "--profile headless")).toBe("--json");
    expect(dshJsonFlag("dsh", "--profile headless --json")).toBe("");
    expect(dshJsonFlag("claude-code", "-p {prompt}")).toBe("");
    expect(dshJsonFlag(null, "")).toBe("");
  });

  it("parseDshSessionId：按行扫 type=session；claude 信封 / 纯文本 / 缺字段 → undefined；与信封解析互不干扰", () => {
    expect(parseDshSessionId(STREAM)).toBe("session-aaaa-1111");
    // 整段 NDJSON 不是单个 JSON 对象：claude 信封解析恒空（不会误读 dsh 流）
    expect(parseHeadlessEnvelope(STREAM).sessionId).toBeUndefined();
    expect(parseDshSessionId('{"session_id":"abc-1","is_error":false}')).toBeUndefined();
    expect(parseDshSessionId("处理完成")).toBeUndefined();
    expect(parseDshSessionId('{"type":"session","cwd":"/w"}')).toBeUndefined();
    expect(parseDshSessionId('{"type":"session","sessionId":""}')).toBeUndefined();
    expect(parseDshSessionId('noise\n{"type":"session","sessionId":"session-2"}')).toBe("session-2");
  });

  it("sessionFlags dsh：adopt 语义不预生成——首轮无旗标；上轮有 id → --session-id <prev>", () => {
    expect(sessionFlags("dsh", null)).toEqual({ flags: "", preSession: null });
    expect(sessionFlags("dsh", "  ")).toEqual({ flags: "", preSession: null });
    expect(sessionFlags("dsh", " session-abc ")).toEqual({ flags: "--session-id session-abc", preSession: null });
  });
});

describe("无头派发 × dsh 续接链路", () => {
  const deps = () => ({ executorFor: () => fake });

  it("首轮：无会话旗标 + 自动 --json，会话 id 自事件流捕获落 dispatched_session 与账本", async () => {
    const taskId = seedDshTask("--profile headless", "任务");
    fake.enqueue({ exitCode: 0, stdout: STREAM });
    const out = await dispatchHeadless(db.conn, deps(), taskId);
    expect(fake.jobs[0]?.args).toBe("--profile headless --json");
    expect(out.state).toBe("done");
    expect(out.sessionId).toBe("session-aaaa-1111");
    expect(dispatchedSession(taskId)).toBe("session-aaaa-1111");
    const row = db.conn.prepare("SELECT session_id FROM agent_sessions WHERE task_id=?").get(taskId) as {
      session_id: string;
    };
    expect(row.session_id).toBe("session-aaaa-1111");
  });

  it("次轮：--session-id <prev> adopt（无事件流回传时沿用上一轮 id）；用户已配 --json 不重复", async () => {
    const nextId = seedDshTask("--profile headless", "任务2");
    db.conn.prepare("UPDATE tasks SET dispatched_session='session-aaaa-1111' WHERE id=?").run(nextId);
    const second = await dispatchHeadless(db.conn, deps(), nextId);
    expect(fake.jobs[0]?.args).toBe("--profile headless --session-id session-aaaa-1111 --json");
    expect(second.sessionId).toBe("session-aaaa-1111");

    const thirdId = seedDshTask("--profile headless --json", "任务3");
    await dispatchHeadless(db.conn, deps(), thirdId);
    expect(fake.jobs[1]?.args).toBe("--profile headless --json");
  });
});
