/**
 * judge/orchestrator · 重判与判重兜底：retryJudge（error 重置→重判、非 error 逐条汇报）、
 * 批内判重降级 none、判定 prompt 假名化（真名零出现）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { orchestrateBatch, retryJudge, type OrchestrateDeps } from "../src/host/judge/orchestrator";
import { fakeSubagentExecutor } from "../src/host/judge/adapters";
import { AnonRules } from "../src/host/domain/anonymize";
import { HealthState } from "../src/host/health/snapshot";
import { createTestDb, scalar, type TestDb } from "./helpers";
import type { AiSuggestion } from "../src/host/domain/suggest";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

/** 代号还原链路的种子：张三(ou_z)→成员_00aa，消息 content_anon 用代号 */
function seedAliasMessage(mid: string): void {
  db.conn
    .prepare(
      "INSERT INTO feishu_users (open_id, name, alias, updated_at) VALUES ('ou_z', '张三', '成员_00aa', 't') ON CONFLICT(open_id) DO NOTHING",
    )
    .run();
  db.conn
    .prepare(
      "INSERT INTO chat_messages (message_id, chat_id, chat_type, chat_name, sender, sender_id, content, content_anon, sent_at, ai_status, review_status, created_at) " +
        "VALUES (?, 'oc_g', 'group', '项目群', '张三', 'ou_z', '张三提醒交周报', '成员_00aa 提醒交周报', 1789200000000, 'pending', 'pending', '2026-10-11T00:00:00+00:00')",
    )
    .run(mid);
}

function depsWith(
  fn: (batch: { prompt: string; feedback?: string }) => AiSuggestion[] | Promise<AiSuggestion[]>,
): OrchestrateDeps {
  return { conn: db.conn, executor: fakeSubagentExecutor("fake", (batch) => fn(batch)), health: new HealthState() };
}

function statusOf(mid: string): string {
  return String(scalar(db.conn, "SELECT ai_status FROM chat_messages WHERE message_id=?", mid));
}

describe("重判（retryJudge）", () => {
  it("error 且未分诊的重置后重新判定；非 error/已分诊逐条汇报", async () => {
    seedAliasMessage("om_err");
    seedAliasMessage("om_todo");
    seedAliasMessage("om_dismissed");
    db.conn.prepare("UPDATE chat_messages SET ai_status='error' WHERE message_id='om_err'").run();
    db.conn.prepare("UPDATE chat_messages SET ai_status='todo', suggested_title='x' WHERE message_id='om_todo'").run();
    db.conn
      .prepare("UPDATE chat_messages SET ai_status='error', review_status='dismissed' WHERE message_id='om_dismissed'")
      .run();
    const deps = depsWith(() => [{ messageId: "om_err", action: "todo", title: "重判成功", tags: [] }]);
    const out = await retryJudge(deps, ["om_err", "om_todo", "om_dismissed"]);
    expect(out.todo).toBe(1);
    expect(statusOf("om_err")).toBe("todo");
    expect(scalar(db.conn, "SELECT suggested_title FROM chat_messages WHERE message_id='om_err'")).toBe("重判成功");
    expect(out.dropped).toEqual(["om_todo", "om_dismissed"]);
    expect(statusOf("om_todo")).toBe("todo");
  });

  it("批内判重兜底：同标题 todo 只留首条，其余降级 none（reason 指向保留条）", async () => {
    seedAliasMessage("om_1");
    seedAliasMessage("om_2");
    const deps = depsWith(() => [
      { messageId: "om_1", action: "todo", title: "发周报", tags: [] },
      { messageId: "om_2", action: "todo", title: " 发周报 ", tags: [] },
    ]);
    const out = await orchestrateBatch(deps, ["om_1", "om_2"]);
    expect(out.todo).toBe(1);
    expect(statusOf("om_1")).toBe("todo");
    expect(statusOf("om_2")).toBe("none");
    expect(String(scalar(db.conn, "SELECT suggested_reason FROM chat_messages WHERE message_id='om_2'"))).toContain(
      "om_1",
    );
  });

  it("判定 prompt 假名化：真名不进 prompt（anon 列驱动）", async () => {
    seedAliasMessage("om_1");
    const rules = AnonRules.build(db.conn);
    expect(rules.scrub("张三")).toBe("成员_00aa");
    let seen = "";
    const deps = depsWith((batch) => {
      seen = batch.prompt;
      return [{ messageId: "om_1", action: "none", reason: "闲聊", tags: [] }];
    });
    await orchestrateBatch(deps, ["om_1"]);
    expect(seen).toContain("成员_00aa");
    expect(seen).not.toContain("张三");
    expect(seen).toContain("项目群");
  });
});
