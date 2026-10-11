/**
 * dispatch/prompt：派发取数（prepareDispatchPrompt）——假名化（真名不随 prompt 出机）、
 * notes 取最新 3 条、上下文/空字段噪音控制、dispatched_session 续接线索。
 * 对齐 route.rs prepare_dispatch。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareDispatchPrompt } from "../src/host/dispatch/prompt";
import { createTestDb, seedTask, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

function seedAgent(agentId: string): void {
  db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_agents', ?)").run(
    JSON.stringify([
      {
        id: agentId,
        name: `Agent ${agentId}`,
        command: "claude",
        args: "-p {prompt}",
        historyArgs: "",
        workdir: "",
        timeoutSecs: 120,
        enabled: true,
      },
    ]),
  );
}

function seedProjectTask(title: string, meta: string | null = null): number {
  const taskId = seedTask(db.conn, title, { status: "scheduled" });
  const tagId = Number(
    (
      db.conn
        .prepare("INSERT INTO tags (name, dimension_id, meta, created_at) VALUES (?, 1, ?, 't')")
        .run(title, meta ?? JSON.stringify({ agentId: "ag-1" })) as { lastInsertRowid: number | bigint }
    ).lastInsertRowid,
  );
  db.conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(taskId, tagId);
  return taskId;
}

function addNote(taskId: number, content: string, at: string): void {
  db.conn.prepare("INSERT INTO task_notes (task_id, content, created_at) VALUES (?, ?, ?)").run(taskId, content, at);
}

describe("取数（prepareDispatchPrompt：假名化 + notes 取最新 3 条 + 续接线索）", () => {
  it("标题/跟进/上下文过假名化；空字段无噪音；续接线索", () => {
    seedAgent("ag-1");
    db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('feishu_my_names', '蔡乔蓉')").run();
    const taskId = seedProjectTask(
      "蔡乔蓉修登录 bug",
      JSON.stringify({ agentId: "ag-1", workdir: "/w", context: "蔡乔蓉的项目" }),
    );
    addNote(taskId, "第一条", "t1");
    addNote(taskId, "老板说周五前交", "t2");
    addNote(taskId, "蔡乔蓉补充了细节", "t3");
    addNote(taskId, "第四条超出最新3条窗口", "t4");
    const prep = prepareDispatchPrompt(db.conn, taskId);
    // 真名（我的称呼）不随派发 prompt 出机——替换为「我」
    expect(prep.prompt).not.toContain("蔡乔蓉");
    expect(prep.prompt).toContain("标题：我修登录 bug");
    expect(prep.prompt).toContain("项目备注：我的项目");
    // 跟进最新 3 条（DESC LIMIT 3 取 id 4/3/2，reverse 后时间正序：最旧的「第一条」不在）
    expect(prep.notes).toEqual(["老板说周五前交", "我补充了细节", "第四条超出最新3条窗口"]);
    expect(prep.prompt).not.toContain("第一条");
    expect(prep.prevSession).toBeNull();
    expect(prep.agent.id).toBe("ag-1");
    // 空字段无噪音（无 note/无跟进/无上下文）
    const bare = seedProjectTask("裸任务", JSON.stringify({ agentId: "ag-1" }));
    const barePrep = prepareDispatchPrompt(db.conn, bare);
    expect(barePrep.notes).toEqual([]);
    expect(barePrep.prompt).not.toContain("详情：");
    expect(barePrep.prompt).not.toContain("跟进记录");
    expect(barePrep.prompt).not.toContain("项目备注：");
    // dispatched_session 非空时作为续接线索带出
    db.conn.prepare("UPDATE tasks SET dispatched_session=' sess-9 ' WHERE id=?").run(taskId);
    expect(prepareDispatchPrompt(db.conn, taskId).prevSession).toBe("sess-9");
  });
});
