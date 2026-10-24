/**
 * dispatch/interactive · 交互会话旗标（从 dispatch-interactive.spec 拆出——棘轮
 * max-lines）：claude/pi 交互派发预生成 `--session-id <uuid>`（sessionFlags 单源）落
 * agent_sessions.session_id + 回写 tasks.dispatched_session（回放精确 --resume）；
 * dsh/其余 agent 无旗标（回放走 picker 兜底）。PTY 句柄优先级见 sshExecutorTerminal 侧。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatchInteractive } from "../src/host/dispatch/interactive";
import { createFakeTerminal } from "../src/host/dispatch/terminalAdapters";
import { createTestDb, seedAgents, seedTask, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
  db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_agents', ?)").run(
    JSON.stringify([
      {
        id: "ag-1",
        name: "Claude",
        command: "claude",
        args: "",
        historyArgs: "--resume",
        workdir: "",
        timeoutSecs: 120,
        enabled: true,
      },
    ]),
  );
});
afterEach(() => {
  db.close();
});

/** 项目标签挂任务（meta 指定 agentId——路由级联的 tag meta 面） */
function seedProjectTask(title: string, opts: { meta?: string | null } = {}): number {
  const taskId = seedTask(db.conn, title);
  const tagId = Number(
    (
      db.conn
        .prepare("INSERT INTO tags (name, dimension_id, meta, created_at) VALUES (?, 1, ?, 't')")
        .run(title, opts.meta ?? JSON.stringify({ agentId: "ag-1" })) as { lastInsertRowid: number | bigint }
    ).lastInsertRowid,
  );
  db.conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(taskId, tagId);
  return taskId;
}

describe("交互会话旗标（claude/pi 预生成 --session-id；dsh/其余无旗标走 picker 兜底）", () => {
  /** 无句柄终端（外部终端 / ssh 窗口形态——不回 sessionRef） */
  const bareTerminal = {
    async inject() {
      return { terminal: "external-Ghostty" };
    },
  };

  it("无句柄终端：预生成 id 落 session_id（回放精确 --resume）+ 回写 dispatched_session", async () => {
    const taskId = seedProjectTask("外部终端派发");
    const outcome = await dispatchInteractive(db.conn, { terminal: bareTerminal }, taskId);
    expect(outcome.terminal).toBe("external-Ghostty");
    const row = db.conn.prepare("SELECT session_id FROM agent_sessions WHERE task_id=?").get(taskId) as {
      session_id: string | null;
    };
    expect(row.session_id).toMatch(/^[0-9a-f-]{36}$/);
    const task = db.conn.prepare("SELECT dispatched_session FROM tasks WHERE id=?").get(taskId) as {
      dispatched_session: string | null;
    };
    expect(task.dispatched_session).toBe(row.session_id);
  });

  it("pi 同型预生成 --session-id", async () => {
    seedAgents(db.conn, [{ id: "ag-pi", command: "pi" }]);
    const taskId = seedProjectTask("pi 任务", { meta: JSON.stringify({ agentId: "ag-pi" }) });
    const terminal = createFakeTerminal();
    await dispatchInteractive(db.conn, { terminal }, taskId);
    expect(terminal.injections[0]?.line).toMatch(/^pi .*--session-id [0-9a-f-]{36}/);
  });

  it("dsh 类走 dst：无会话旗标，session_id 与 dispatched_session 均不动（回放 picker 兜底）", async () => {
    seedAgents(db.conn, [{ id: "ag-dsh", command: "dst" }]);
    const taskId = seedProjectTask("dst 任务", { meta: JSON.stringify({ agentId: "ag-dsh" }) });
    const terminal = createFakeTerminal();
    await dispatchInteractive(db.conn, { terminal }, taskId);
    expect(terminal.injections[0]?.line).toMatch(/^dst -- '/);
    expect(terminal.injections[0]?.line).not.toContain("--session-id");
    const taskId2 = seedProjectTask("dst 任务·无句柄终端", { meta: JSON.stringify({ agentId: "ag-dsh" }) });
    const outcome = await dispatchInteractive(db.conn, { terminal: bareTerminal }, taskId2);
    expect(outcome.state).toBe("running");
    const row = db.conn
      .prepare("SELECT session_id FROM agent_sessions WHERE task_id=? ORDER BY id DESC")
      .get(taskId2) as { session_id: string | null };
    expect(row.session_id).toBeNull();
    const task = db.conn.prepare("SELECT dispatched_session FROM tasks WHERE id=?").get(taskId2) as {
      dispatched_session: string | null;
    };
    expect(task.dispatched_session).toBeNull();
  });
});
