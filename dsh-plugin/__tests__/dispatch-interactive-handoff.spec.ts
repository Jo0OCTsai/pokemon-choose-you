/**
 * dispatch/interactive · 本机 handoff 终端（debt ③ 诚实化，从 dispatch-interactive.spec
 * 拆出——棘轮 max-lines）：dsh 宿主无第三方可驱动的终端面板，本机交互派发命令行
 * 回传客户端复制执行；session_id 如实落 NULL（fake 终端 pane-N 假句柄清零）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatchInteractive } from "../src/host/dispatch/interactive";
import { createHandoffTerminal } from "../src/host/dispatch/terminalAdapters";
import { createTestDb, seedTask, type TestDb } from "./helpers";

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

/** 项目标签任务（agent 路由 ag-1） */
function seedProjectTask(title: string): number {
  const taskId = seedTask(db.conn, title);
  const tagId = Number(
    (
      db.conn
        .prepare("INSERT INTO tags (name, dimension_id, meta, created_at) VALUES (?, 1, ?, 't')")
        .run(title, JSON.stringify({ agentId: "ag-1" })) as { lastInsertRowid: number | bigint }
    ).lastInsertRowid,
  );
  db.conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(taskId, tagId);
  return taskId;
}

describe("本机 handoff 终端（dsh 宿主无第三方终端面板——debt ③ 诚实化）", () => {
  it("createHandoffTerminal：不注入任何终端，note 携带完整命令行，无 sessionRef（不落假句柄）", async () => {
    const terminal = createHandoffTerminal("dsh 宿主无插件终端面板");
    const agent = {
      id: "ag-1",
      name: "Claude",
      command: "claude",
      args: "",
      historyArgs: "",
      workdir: "",
      timeoutSecs: 60,
      enabled: true,
    };
    const out = await terminal.inject({ line: "claude '干活'", agent, taskId: 1, workdir: null });
    expect(out.terminal).toBe("copy-line");
    expect(out.note).toContain("claude '干活'");
    expect(out.sessionRef).toBeUndefined();
  });

  it("交互派发 handoff：状态 running 等回传 + session_id 落 NULL（pane 假句柄清零）+ outcome 带 line", async () => {
    const taskId = seedProjectTask("handoff 派发");
    const outcome = await dispatchInteractive(db.conn, { terminal: createHandoffTerminal("无面板") }, taskId);
    expect(outcome.state).toBe("running");
    expect(outcome.terminal).toBe("copy-line");
    expect(outcome.note).toContain("复制");
    expect(outcome.line).toContain("claude");
    const row = db.conn.prepare("SELECT session_id FROM agent_sessions WHERE task_id=?").get(taskId) as Record<
      string,
      unknown
    >;
    expect(row["session_id"]).toBeNull();
  });
});
