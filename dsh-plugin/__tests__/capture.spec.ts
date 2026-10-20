/**
 * judge/capture：快速捕捉（输入校验/local 消息入库/同一判定管线/todo 建任务/
 * 判重命中留更新卡不重复建/失败标 error）与 5 秒撤销（删任务 + 回 pending + 清反馈）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureTodo, undoCapture, MAX_CAPTURE_CHARS, type CaptureDeps } from "../src/host/judge/capture";
import { fakeSubagentExecutor, withSessionId } from "../src/host/judge/adapters";
import { HealthState, AI } from "../src/host/health/snapshot";
import { createTestDb, scalar, seedAgents, seedTask, type TestDb } from "./helpers";
import type { AiSuggestion } from "../src/host/domain/suggest";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

function depsWith(
  fn: (batch: { prompt: string }) => AiSuggestion[] | Promise<AiSuggestion[]>,
  health = new HealthState(),
): CaptureDeps {
  return { conn: db.conn, executor: fakeSubagentExecutor("fake", (batch) => fn(batch)), health };
}

function statusOf(mid: string): string {
  return String(scalar(db.conn, "SELECT ai_status FROM chat_messages WHERE message_id=?", mid));
}

describe("输入校验", () => {
  it("空输入 / 超长输入拒绝且不落消息", async () => {
    for (const bad of ["  ", "x".repeat(MAX_CAPTURE_CHARS + 1)]) {
      await expect(
        captureTodo(
          depsWith(() => []),
          bad,
        ),
      ).rejects.toThrow(/请输入待办内容|太长/);
    }
    expect(scalar(db.conn, "SELECT COUNT(*) FROM chat_messages")).toBe(0);
  });
});

describe("todo 主路径", () => {
  it("local 消息入库（content_anon 代号化）→ 判定 todo → 直接建待办 + accepted 反馈", async () => {
    db.conn
      .prepare("INSERT INTO feishu_users (open_id, name, alias, updated_at) VALUES ('ou_z', '张三', '成员_00aa', 't')")
      .run();
    let seenPrompt = "";
    const okDeps = depsWith((batch) => {
      seenPrompt = batch.prompt;
      const id = [...batch.prompt.matchAll(/\[(cap_[0-9a-f-]+)\]/g)][0][1];
      return [{ messageId: id, action: "todo", title: "给成员_00aa 发合同", priority: "high", tags: [] }];
    });
    const out = await captureTodo(okDeps, "给张三发合同，今天下班前");
    expect(out.outcome).toBe("task");
    expect(out.taskId).not.toBeNull();
    const row = db.conn
      .prepare(
        "SELECT chat_type, sender, is_self, content, content_anon, ai_status, review_status, task_id FROM chat_messages WHERE message_id=?",
      )
      .get(out.messageId) as Record<string, unknown>;
    expect(row.chat_type).toBe("local");
    expect(row.sender).toBe("我");
    expect(row.is_self).toBe(1);
    expect(row.content).toBe("给张三发合同，今天下班前");
    expect(row.content_anon).toBe("给成员_00aa发合同，今天下班前");
    expect(row.ai_status).toBe("todo");
    expect(row.review_status).toBe("accepted");
    expect(row.task_id).toBe(out.taskId);
    expect(seenPrompt).toContain("待办事项录入助手");
    expect(seenPrompt).toContain("手动输入·快速捕捉");
    expect(seenPrompt).not.toContain("张三");
    const task = db.conn.prepare("SELECT title, priority, source FROM tasks WHERE id=?").get(out.taskId) as Record<
      string,
      unknown
    >;
    expect(task.title).toBe("给张三 发合同");
    expect(task.priority).toBe("high");
    expect(task.source).toBe("capture");
    expect(scalar(db.conn, "SELECT COUNT(*) FROM chat_feedback WHERE action='accepted'")).toBe(1);
    expect(scalar(db.conn, "SELECT COUNT(*) FROM agent_sessions WHERE kind='capture' AND status='ok'")).toBe(1);
  });
});

describe("判重命中现有待办（生成更新卡不重复建）", () => {
  it("判定 update → 留收音机待确认，不建任务", async () => {
    const taskId = seedTask(db.conn, "参加周会", { status: "scheduled", dueAt: "2026-11-01T09:00" });
    const deps = depsWith((batch) => {
      const id = [...batch.prompt.matchAll(/\[(cap_[0-9a-f-]+)\]/g)][0][1];
      return [
        {
          messageId: id,
          action: "update",
          updateTaskId: taskId,
          title: "参加周会（改期）",
          due: "2026-11-05T10:00",
          tags: [],
        },
      ];
    });
    const out = await captureTodo(deps, "周会改到周四上午10点");
    expect(out.outcome).toBe("suggestion");
    expect(out.taskId).toBeNull();
    expect(scalar(db.conn, "SELECT COUNT(*) FROM tasks")).toBe(1);
    const msg = db.conn
      .prepare("SELECT ai_status, suggested_title, update_task_id, review_status FROM chat_messages WHERE message_id=?")
      .get(out.messageId) as Record<string, unknown>;
    expect(msg.ai_status).toBe("update");
    expect(msg.suggested_title).toBe("参加周会（改期）");
    expect(msg.update_task_id).toBe(taskId);
    expect(msg.review_status).toBe("pending");
  });

  it("判定 none（纯重复提及）→ 留收音机", async () => {
    const deps = depsWith((batch) => {
      const id = [...batch.prompt.matchAll(/\[(cap_[0-9a-f-]+)\]/g)][0][1];
      return [{ messageId: id, action: "none", reason: "与待办 No.1 本质相同", tags: [] }];
    });
    const out = await captureTodo(deps, "还是周会那件事");
    expect(out.outcome).toBe("suggestion");
    expect(statusOf(out.messageId)).toBe("none");
  });
});

describe("失败路径", () => {
  it("执行方失败 → 消息标 error 留档（可强制捕捉/逃走）+ 健康记失败 + 会话账本 error（session_id 回链错误携带的会话）", async () => {
    seedAgents(db.conn, [{ id: "a1" }]);
    const health = new HealthState();
    const deps: CaptureDeps = {
      conn: db.conn,
      health,
      executor: {
        id: "boom",
        name: "boom",
        selfLanding: false,
        run: async () => {
          throw withSessionId(new Error("agent exploded"), "pky-judge-boom");
        },
      },
    };
    const err = (await captureTodo(deps, "明天交周报").catch((e: unknown) => e)) as Error;
    expect(err.message).toBe("agent exploded");
    const mid = String(scalar(db.conn, "SELECT message_id FROM chat_messages"));
    expect(statusOf(mid)).toBe("error");
    expect(health.snapshot(AI).consecutiveFailures).toBe(1);
    expect(scalar(db.conn, "SELECT COUNT(*) FROM agent_sessions WHERE kind='capture' AND status='error'")).toBe(1);
    expect(scalar(db.conn, "SELECT session_id FROM agent_sessions WHERE kind='capture' AND status='error'")).toBe(
      "pky-judge-boom",
    );
  });

  it("执行方未返回判定 → 失败留档 error", async () => {
    const deps = depsWith(() => []);
    await expect(captureTodo(deps, "记一件事")).rejects.toThrow(/未返回捕捉判定/);
    const mid = String(scalar(db.conn, "SELECT message_id FROM chat_messages"));
    expect(statusOf(mid)).toBe("error");
  });
});

describe("5 秒撤销（undoCapture）", () => {
  async function captureAsTask(): Promise<string> {
    const deps = depsWith((batch) => {
      const id = [...batch.prompt.matchAll(/\[(cap_[0-9a-f-]+)\]/g)][0][1];
      return [{ messageId: id, action: "todo", title: "买咖啡", tags: [] }];
    });
    return (await captureTodo(deps, "买咖啡")).messageId;
  }

  it("删任务 + 消息回 pending + 清掉 accepted 反馈", async () => {
    const mid = await captureAsTask();
    expect(scalar(db.conn, "SELECT COUNT(*) FROM tasks")).toBe(1);
    undoCapture(db.conn, mid);
    expect(scalar(db.conn, "SELECT COUNT(*) FROM tasks")).toBe(0);
    const msg = db.conn
      .prepare("SELECT review_status, task_id FROM chat_messages WHERE message_id=?")
      .get(mid) as Record<string, unknown>;
    expect(msg.review_status).toBe("pending");
    expect(msg.task_id).toBeNull();
    expect(scalar(db.conn, "SELECT COUNT(*) FROM chat_feedback")).toBe(0);
  });

  it("非 accepted / 无任务 / 任务 id 被复用（source 不符）拒绝撤销", async () => {
    db.conn
      .prepare(
        "INSERT INTO chat_messages (message_id, content, ai_status, review_status, created_at) VALUES ('om_p', 'x', 'none', 'pending', 't')",
      )
      .run();
    expect(() => undoCapture(db.conn, "om_p")).toThrow(/不是已接受状态/);
    db.conn
      .prepare(
        "INSERT INTO chat_messages (message_id, content, ai_status, review_status, created_at) VALUES ('om_acc', 'x', 'none', 'accepted', 't')",
      )
      .run();
    expect(() => undoCapture(db.conn, "om_acc")).toThrow(/没有可撤销的待办/);
    // id 被复用：消息指向一个非 feishu/capture 来源的任务 → 拒删保安全
    const taskId = seedTask(db.conn, "手工任务");
    db.conn.prepare("UPDATE chat_messages SET task_id=? WHERE message_id='om_acc'").run(taskId);
    db.conn.prepare("UPDATE tasks SET source='manual' WHERE id=?").run(taskId);
    expect(() => undoCapture(db.conn, "om_acc")).toThrow(/拒绝删除/);
    expect(scalar(db.conn, "SELECT COUNT(*) FROM tasks WHERE id=?", taskId)).toBe(1);
  });

  it("任务已被手动删（source 行缺失）→ 只回消息状态不报错", async () => {
    const mid = await captureAsTask();
    db.conn.prepare("DELETE FROM tasks").run();
    expect(() => undoCapture(db.conn, mid)).not.toThrow();
    expect(scalar(db.conn, "SELECT review_status FROM chat_messages WHERE message_id=?", mid)).toBe("pending");
  });
});
