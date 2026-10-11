/**
 * domain/review：分诊 CAS（accept/applyUpdate/dismiss/restore 全守卫 + 幂等反馈）、
 * accept 事务内建任务回填 task_id、批量分诊逐条成败。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acceptMessage,
  applyUpdateMessage,
  batchReview,
  dismissMessage,
  getMessage,
  restoreMessage,
} from "../src/host/domain/review";
import { getTask } from "../src/host/domain/tasks";
import { PkyError } from "../src/host/storage/errors";
import { createTestDb, scalar, seedMessage, seedTask, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

describe("捕捉（accept）", () => {
  it("建任务回填 task_id：标题/备注/优先级/截止/标签齐全，有截止进路线", () => {
    db.conn.prepare("INSERT INTO tags (name, dimension_id, created_at) VALUES ('重要', 4, 't')").run();
    const mid = seedMessage(db.conn, "om_1", {
      content: "张三在群里安排",
      suggestedTitle: "参加周会",
      suggestedNote: "张三在群里安排",
      suggestedPriority: "high",
      suggestedDue: "2026-09-13T10:00",
      suggestedTags: '["重要"]',
      aiStatus: "todo",
    });
    const taskId = acceptMessage(db.conn, "om_1");
    const task = getTask(db.conn, taskId);
    expect(task.title).toBe("参加周会");
    expect(task.note).toBe("张三在群里安排");
    expect(task.priority).toBe("high");
    expect(task.dueAt).toBe("2026-09-13T10:00");
    expect(task.status).toBe("scheduled");
    expect(task.source).toBe("feishu");
    expect(task.tags).toEqual([{ name: "重要", dimension: "topic" }]);
    expect(scalar(db.conn, "SELECT task_id FROM chat_messages WHERE id=?", mid)).toBe(taskId);
    expect(scalar(db.conn, "SELECT review_status FROM chat_messages WHERE id=?", mid)).toBe("accepted");
    // 反馈落库
    expect(scalar(db.conn, "SELECT action FROM chat_feedback WHERE chat_message_id=?", mid)).toBe("accepted");
  });

  it("无建议字段时标题取正文前 40 字，无截止进草丛，未知分类回落第一个启用", () => {
    seedMessage(db.conn, "om_2", { content: "很长的消息".repeat(20), aiStatus: "none" });
    const taskId = acceptMessage(db.conn, "om_2");
    const task = getTask(db.conn, taskId);
    expect(Array.from(task.title).length).toBe(40);
    expect(task.status).toBe("inbox");
    expect(task.categoryId).toBe(1);
  });
});

describe("捕捉（accept）·下", () => {
  it("due 空串按无截止处理进草丛（suggested_due 落 NULL）", () => {
    seedMessage(db.conn, "om_b", { suggestedTitle: "交周报", suggestedDue: "", aiStatus: "todo" });
    const taskId = acceptMessage(db.conn, "om_b");
    const task = getTask(db.conn, taskId);
    expect(task.status).toBe("inbox");
    expect(task.dueAt).toBeNull();
  });

  it("CAS：已处置的消息再捕捉 → SUGGESTION_ALREADY_RESOLVED 且不建任务", () => {
    seedMessage(db.conn, "om_g", { aiStatus: "todo" });
    dismissMessage(db.conn, "om_g");
    const before = scalar(db.conn, "SELECT COUNT(*) FROM tasks");
    expect(() => acceptMessage(db.conn, "om_g")).toThrowError(PkyError);
    try {
      acceptMessage(db.conn, "om_g");
    } catch (e) {
      expect((e as PkyError).code).toBe("SUGGESTION_ALREADY_RESOLVED");
    }
    expect(scalar(db.conn, "SELECT COUNT(*) FROM tasks")).toBe(before);
  });

  it("已创建过待办的消息（task_id 已回填）拒绝重复捕捉", () => {
    seedMessage(db.conn, "om_d", { aiStatus: "todo" });
    acceptMessage(db.conn, "om_d");
    expect(() => acceptMessage(db.conn, "om_d")).toThrowError(/已创建过待办/);
  });

  it("本地捕捉消息（chat_type=local）任务来源 = capture", () => {
    seedMessage(db.conn, "om_c", { suggestedTitle: "手动记的", chatType: "local" });
    const taskId = acceptMessage(db.conn, "om_c");
    expect(getTask(db.conn, taskId).source).toBe("capture");
  });
});

describe("逃走（dismiss）", () => {
  it("pending → dismissed，原因码随消息行落库并记反馈", () => {
    const mid = seedMessage(db.conn, "om_1", { aiStatus: "todo" });
    dismissMessage(db.conn, "om_1", "duplicate");
    expect(scalar(db.conn, "SELECT review_status FROM chat_messages WHERE id=?", mid)).toBe("dismissed");
    expect(scalar(db.conn, "SELECT dismiss_reason FROM chat_messages WHERE id=?", mid)).toBe("duplicate");
    const fb = db.conn
      .prepare("SELECT action, reason_code FROM chat_feedback WHERE chat_message_id=?")
      .all(mid) as Array<{ action: string; reason_code: string }>;
    expect(fb).toEqual([{ action: "dismissed", reason_code: "duplicate" }]);
  });

  it("无原因码直接逃走也记反馈（reason 空串）；未知原因码拒绝", () => {
    const mid = seedMessage(db.conn, "om_p", { aiStatus: "todo" });
    expect(() => dismissMessage(db.conn, "om_p", "nope")).toThrowError(/未知逃走原因码/);
    dismissMessage(db.conn, "om_p");
    expect(scalar(db.conn, "SELECT action FROM chat_feedback WHERE chat_message_id=?", mid)).toBe("dismissed");
  });

  it("CAS：已捕捉的消息不能逃走 → SUGGESTION_ALREADY_RESOLVED，不落第二条反馈", () => {
    const mid = seedMessage(db.conn, "om_h", { aiStatus: "todo" });
    acceptMessage(db.conn, "om_h");
    expect(() => dismissMessage(db.conn, "om_h")).toThrowError(PkyError);
    expect(scalar(db.conn, "SELECT COUNT(*) FROM chat_feedback WHERE chat_message_id=?", mid)).toBe(1);
  });
});

describe("撤销逃走（restore）", () => {
  it("仅 dismissed → pending：清原因、删误操作反馈", () => {
    const mid = seedMessage(db.conn, "om_r", { aiStatus: "todo" });
    dismissMessage(db.conn, "om_r", "noise");
    restoreMessage(db.conn, "om_r");
    expect(scalar(db.conn, "SELECT review_status FROM chat_messages WHERE id=?", mid)).toBe("pending");
    expect(scalar(db.conn, "SELECT dismiss_reason FROM chat_messages WHERE id=?", mid)).toBe("");
    expect(scalar(db.conn, "SELECT COUNT(*) FROM chat_feedback WHERE chat_message_id=?", mid)).toBe(0);
  });

  it("非逃生态（pending / accepted）恢复 → SUGGESTION_ALREADY_RESOLVED", () => {
    const pending = seedMessage(db.conn, "om_p1", { aiStatus: "todo" });
    expect(() => restoreMessage(db.conn, "om_p1")).toThrowError(PkyError);
    try {
      restoreMessage(db.conn, "om_p1");
    } catch (e) {
      expect((e as PkyError).code).toBe("SUGGESTION_ALREADY_RESOLVED");
    }
    void pending;
    seedMessage(db.conn, "om_a1", { aiStatus: "todo" });
    acceptMessage(db.conn, "om_a1");
    expect(() => restoreMessage(db.conn, "om_a1")).toThrowError(PkyError);
  });
});

describe("应用更新（applyUpdate）", () => {
  it("只改 AI 明确给出的字段；分类只认启用中的同名；消息转已接受", () => {
    db.conn.prepare("INSERT INTO tags (name, dimension_id, created_at) VALUES ('重要', 4, 't')").run();
    const taskId = seedTask(db.conn, "参加周会");
    const mid = seedMessage(db.conn, "om_u", {
      suggestedTitle: "周会（改期）",
      suggestedDue: "2026-09-14T10:00",
      suggestedPriority: "high",
      suggestedTags: '["重要"]',
      aiStatus: "update",
      updateTaskId: taskId,
    });
    const patched = applyUpdateMessage(db.conn, "om_u");
    expect(patched).toBe(taskId);
    const task = getTask(db.conn, taskId);
    expect(task.title).toBe("周会（改期）");
    expect(task.dueAt).toBe("2026-09-14T10:00");
    expect(task.priority).toBe("high");
    expect(task.tags).toEqual([{ name: "重要", dimension: "topic" }]);
    expect(scalar(db.conn, "SELECT review_status FROM chat_messages WHERE id=?", mid)).toBe("accepted");
    // 字段级审计（origin=dsh）
    const fields = db.conn
      .prepare("SELECT field FROM task_logs WHERE task_id=? AND action='update'")
      .all(taskId) as Array<{ field: string }>;
    expect(fields.length).toBeGreaterThanOrEqual(3);
  });

  it("非 update 状态 / 缺目标 / 目标已删 / 无可应用字段 拒绝", () => {
    seedMessage(db.conn, "om_t", { aiStatus: "todo" });
    expect(() => applyUpdateMessage(db.conn, "om_t")).toThrowError(/不是待确认的更新建议/);
    seedMessage(db.conn, "om_n", { aiStatus: "update", updateTaskId: null });
    expect(() => applyUpdateMessage(db.conn, "om_n")).toThrowError(/缺少目标待办/);
    seedMessage(db.conn, "om_m", { aiStatus: "update", updateTaskId: 999, suggestedDue: "2026-09-15T09:00" });
    expect(() => applyUpdateMessage(db.conn, "om_m")).toThrowError(/已不存在/);
    const real = seedTask(db.conn, "真实任务");
    seedMessage(db.conn, "om_e", { aiStatus: "update", updateTaskId: real, suggestedTags: "[]" });
    expect(() => applyUpdateMessage(db.conn, "om_e")).toThrowError(/没有任何可应用的变更/);
  });
});

describe("应用更新（applyUpdate）·下", () => {
  it("CAS：已逃走的更新建议不能再应用（幂等拒绝、补丁不落目标）", () => {
    const taskId = seedTask(db.conn, "参加周会");
    const mid = seedMessage(db.conn, "om_c", {
      aiStatus: "update",
      updateTaskId: taskId,
      suggestedDue: "2026-09-14T10:00",
    });
    dismissMessage(db.conn, "om_c");
    expect(() => applyUpdateMessage(db.conn, "om_c")).toThrowError(/不是待确认的更新建议/);
    expect(getTask(db.conn, taskId).dueAt).toBeNull();
    void mid;
  });
});

describe("批量分诊", () => {
  it("accept 混合：todo 建待办 + update 应用更新 + 已处置的单独失败", () => {
    const taskId = seedTask(db.conn, "参加周会");
    seedMessage(db.conn, "om_b1", { suggestedTitle: "新待办", aiStatus: "todo" });
    seedMessage(db.conn, "om_b2", {
      aiStatus: "update",
      updateTaskId: taskId,
      suggestedDue: "2026-09-16T09:00",
    });
    seedMessage(db.conn, "om_b3", { aiStatus: "todo" });
    dismissMessage(db.conn, "om_b3");

    const result = batchReview(db.conn, ["om_b1", "om_b2", "om_b3"], "accept");
    expect(result.ok).toBe(2);
    expect(result.failed).toEqual([{ messageId: "om_b3", error: expect.stringContaining("处置") }]);
    expect(getTask(db.conn, taskId).dueAt).toBe("2026-09-16T09:00");
  });

  it("dismiss 批量：pending 全部标记，非 pending 进失败列表；原因逐条落反馈", () => {
    seedMessage(db.conn, "om_d1", { aiStatus: "todo" });
    seedMessage(db.conn, "om_d2", { aiStatus: "todo" });
    seedMessage(db.conn, "om_d3", { aiStatus: "todo" });
    acceptMessage(db.conn, "om_d1");
    const result = batchReview(db.conn, ["om_d1", "om_d2", "om_d3"], "dismiss", "noise");
    expect(result.ok).toBe(2);
    expect(result.failed.length).toBe(1);
    expect(result.failed[0].messageId).toBe("om_d1");
    const reasons = db.conn.prepare("SELECT reason_code FROM chat_feedback WHERE action='dismissed'").all() as Array<{
      reason_code: string;
    }>;
    expect(reasons.every((r) => r.reason_code === "noise")).toBe(true);
  });

  it("空选集拒绝；不存在的消息进失败列表", () => {
    expect(() => batchReview(db.conn, [], "accept")).toThrowError(/未选择任何消息/);
    const result = batchReview(db.conn, ["om_ghost"], "dismiss");
    expect(result.ok).toBe(0);
    expect(result.failed[0].messageId).toBe("om_ghost");
  });
});

describe("getMessage", () => {
  it("不存在的消息 NOT_FOUND", () => {
    expect(() => getMessage(db.conn, "om_none")).toThrowError(/不存在/);
  });
});
