/**
 * domain/suggest-apply / suggest-resolve / claim：落库（todo/update 覆盖写、followUp
 * 幂等、none）、接受期解析回落、claim 协议（抢占/守卫/回收）、捕捉建任务、逃走原因码。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { suggestBatch } from "../src/host/domain/suggest";
import { applySuggestion } from "../src/host/domain/suggest-apply";
import {
  createTaskFromMessage,
  normalizeDue,
  resolveCategory,
  resolveProposedTags,
  validPriority,
} from "../src/host/domain/suggest-resolve";
import { claimJudging, markAiError, reclaimStaleJudging } from "../src/host/domain/claim";
import { ESCAPE_REASONS, validEscapeReason, type AiSuggestion } from "../src/host/domain/suggest-types";
import { createTestDb, scalar, seedMessage, seedTask, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

function suggestion(partial: Partial<AiSuggestion>): AiSuggestion {
  return { messageId: "om_1", action: "none", tags: [], ...partial };
}

function fieldOf(messageId: string, column: string): unknown {
  return scalar(db.conn, `SELECT ${column} FROM chat_messages WHERE message_id=?`, messageId);
}

describe("落库（apply）", () => {
  it("todo：写建议列等用户确认（ai_status=todo，due 空白归 NULL）", () => {
    seedMessage(db.conn, "om_1", {});
    const outcome = suggestBatch(
      db.conn,
      [
        suggestion({
          messageId: "om_1",
          action: "todo",
          title: "交周报",
          note: "备注",
          category: "工作",
          priority: "high",
          due: "  ",
          tags: [{ name: "重要", dimension: "topic", isNew: true }],
          reason: "明确要求",
          confidence: "high",
        }),
      ],
      "ag1",
    );
    expect(outcome).toMatchObject({ submitted: 1, todo: 1, none: 0, agent: "ag1" });
    expect(fieldOf("om_1", "ai_status")).toBe("todo");
    expect(fieldOf("om_1", "suggested_title")).toBe("交周报");
    expect(fieldOf("om_1", "suggested_due")).toBeNull();
    expect(fieldOf("om_1", "ai_agent")).toBe("ag1");
    expect(JSON.parse(String(fieldOf("om_1", "suggested_tags")))).toEqual([
      { name: "重要", dimension: "topic", isNew: true },
    ]);
  });

  it("update：覆盖写 + update_task_id 回填", () => {
    seedTask(db.conn, "目标");
    seedMessage(db.conn, "om_2", {});
    suggestBatch(db.conn, [suggestion({ messageId: "om_2", action: "update", title: "改名", updateTaskId: 1 })]);
    expect(fieldOf("om_2", "ai_status")).toBe("update");
    expect(fieldOf("om_2", "update_task_id")).toBe(1);
  });
});

describe("落库（apply）·下", () => {
  it("followUp：直接挂跟进并入（content 原文为跟进正文），重放不重复挂", () => {
    seedTask(db.conn, "目标");
    seedMessage(db.conn, "om_3", { content: "周五交付确认了" });
    const s = suggestion({ messageId: "om_3", action: "followUp", followUpTaskId: 1, reason: "进展" });
    suggestBatch(db.conn, [s], "ag");
    expect(fieldOf("om_3", "ai_status")).toBe("followup");
    expect(fieldOf("om_3", "followup_task_id")).toBe(1);
    expect(fieldOf("om_3", "review_status")).toBe("accepted");
    expect(scalar(db.conn, "SELECT content FROM task_notes WHERE task_id=1")).toBe("周五交付确认了");
    expect(scalar(db.conn, "SELECT COUNT(*) FROM task_notes WHERE task_id=1")).toBe(1);
    // 重放（无 claim 守卫路径）幂等
    applySuggestion(db.conn, s, "ag");
    expect(scalar(db.conn, "SELECT COUNT(*) FROM task_notes WHERE task_id=1")).toBe(1);
  });

  it("none：只记 reason/confidence/agent 与状态", () => {
    seedMessage(db.conn, "om_4", {});
    suggestBatch(db.conn, [suggestion({ messageId: "om_4", action: "none", reason: "纯信息分享" })]);
    expect(fieldOf("om_4", "ai_status")).toBe("none");
    expect(fieldOf("om_4", "suggested_reason")).toBe("纯信息分享");
    expect(fieldOf("om_4", "suggested_title")).toBeNull();
  });

  it("重复提交同一消息 todo/none 为覆盖写（幂等）", () => {
    seedMessage(db.conn, "om_5", {});
    suggestBatch(db.conn, [suggestion({ messageId: "om_5", action: "none" })]);
    suggestBatch(db.conn, [suggestion({ messageId: "om_5", action: "todo", title: "改判" })]);
    expect(fieldOf("om_5", "ai_status")).toBe("todo");
    expect(fieldOf("om_5", "suggested_title")).toBe("改判");
  });
});

describe("接受期解析（非拒绝语义）", () => {
  it("resolveCategory：命中启用分类；停用/未知回落第一个启用", () => {
    db.conn.prepare("UPDATE categories SET enabled=0 WHERE id=1").run();
    expect(resolveCategory(db.conn, "学习")).toBe(2);
    expect(resolveCategory(db.conn, "工作")).toBe(2);
    expect(resolveCategory(db.conn, "不存在的")).toBe(2);
    expect(resolveCategory(db.conn, null)).toBe(2);
  });

  it("resolveProposedTags：维度+名精确 → 按名兜底 → isNew 创建（origin=ai）→ 词表外跳过", () => {
    db.conn.prepare("INSERT INTO tags (name, dimension_id, created_at) VALUES ('张三', 3, 't')").run();
    const { ids, skipped } = resolveProposedTags(db.conn, [
      { name: "张三", dimension: "person" }, // 精确命中
      { name: "张三", dimension: "topic" }, // 维度未中按名兜底
      { name: "新项目", dimension: "project", isNew: true }, // 词表外创建
      { name: "幻觉", dimension: "topic" }, // 未标 isNew 词表外 → 跳过
      { name: "  " }, // 空名跳过
    ]);
    expect(ids.length).toBe(3);
    expect(skipped).toEqual(["幻觉"]);
    const created = db.conn
      .prepare("SELECT t.origin, d.key FROM tags t JOIN tag_dimensions d ON d.id=t.dimension_id WHERE t.name='新项目'")
      .get() as { origin: string; key: string };
    expect(created).toEqual({ origin: "ai", key: "project" });
  });

  it("resolveProposedTags：配额满的 isNew 跳过（接受期不拒绝）", () => {
    for (let i = 0; i < 10; i++) {
      db.conn.prepare("INSERT INTO tags (name, dimension_id, created_at) VALUES (?, 2, 't')").run(`场景${i}`);
    }
    const { ids, skipped } = resolveProposedTags(db.conn, [{ name: "挤不进", dimension: "context", isNew: true }]);
    expect(ids).toEqual([]);
    expect(skipped).toEqual(["挤不进"]);
  });

  it("validPriority 非法回落 normal；normalizeDue 空白归 NULL", () => {
    expect(validPriority("urgent")).toBe("urgent");
    expect(validPriority("super-urgent")).toBe("normal");
    expect(validPriority(null)).toBe("normal");
    expect(normalizeDue("  ")).toBeNull();
    expect(normalizeDue("2026-09-13T10:00")).toBe("2026-09-13T10:00");
    expect(normalizeDue(null)).toBeNull();
  });
});

describe("claim 协议（A22/A5/A6）", () => {
  it("claimJudging：pending → judging 写令牌，只返回抢到的子集", () => {
    seedMessage(db.conn, "om_1", {});
    seedMessage(db.conn, "om_2", {});
    db.conn.prepare("UPDATE chat_messages SET ai_status='error' WHERE message_id='om_2'").run();
    const claimed = claimJudging(db.conn, ["om_1", "om_2"], "2026-01-15T09:00:00+00:00");
    expect(claimed).toEqual(["om_1"]);
    expect(fieldOf("om_1", "ai_status")).toBe("judging");
    expect(fieldOf("om_1", "judge_claimed_at")).toBe("2026-01-15T09:00:00+00:00");
  });

  it("落态 claim 守卫：judging+令牌匹配才落库；令牌失配丢弃（不污染新判定）", () => {
    seedMessage(db.conn, "om_1", {});
    claimJudging(db.conn, ["om_1"], "2026-01-15T09:00:00+00:00");
    // 令牌被并发回收重归属
    db.conn
      .prepare("UPDATE chat_messages SET judge_claimed_at='2026-01-15T09:05:00+00:00' WHERE message_id='om_1'")
      .run();
    const applied = applySuggestion(
      db.conn,
      suggestion({ messageId: "om_1", action: "todo", title: "迟到结果" }),
      "ag",
      { claimTs: "2026-01-15T09:00:00+00:00" },
    );
    expect(applied).toBe(false);
    expect(fieldOf("om_1", "ai_status")).toBe("judging");
    expect(fieldOf("om_1", "suggested_title")).toBeNull();
  });

  it("claim 守卫下的 followUp：失配令牌不挂跟进", () => {
    seedTask(db.conn, "目标");
    seedMessage(db.conn, "om_f", { content: "进展" });
    claimJudging(db.conn, ["om_f"], "2026-01-15T09:00:00+00:00");
    const applied = applySuggestion(
      db.conn,
      suggestion({ messageId: "om_f", action: "followUp", followUpTaskId: 1 }),
      "ag",
      { claimTs: "2026-01-15T09:30:00+00:00" },
    );
    expect(applied).toBe(false);
    expect(scalar(db.conn, "SELECT COUNT(*) FROM task_notes")).toBe(0);
  });
});

describe("claim 协议（A22/A5/A6）·下", () => {
  it("reclaimStaleJudging：超过 10 分钟的 judging 回 pending 清令牌；新鲜令牌保留", () => {
    seedMessage(db.conn, "om_old", {});
    seedMessage(db.conn, "om_new", {});
    db.conn
      .prepare(
        "UPDATE chat_messages SET ai_status='judging', judge_claimed_at='2026-01-15T08:00:00+00:00' WHERE message_id='om_old'",
      )
      .run();
    db.conn
      .prepare(
        "UPDATE chat_messages SET ai_status='judging', judge_claimed_at='2026-01-15T08:55:00+00:00' WHERE message_id='om_new'",
      )
      .run();
    const n = reclaimStaleJudging(db.conn, "2026-01-15T09:00:00+00:00");
    expect(n).toBe(1);
    expect(fieldOf("om_old", "ai_status")).toBe("pending");
    expect(fieldOf("om_old", "judge_claimed_at")).toBe("");
    expect(fieldOf("om_new", "ai_status")).toBe("judging");
  });

  it("markAiError：claim 口径只翻转本 claim 抢到的行（judging+令牌）", () => {
    seedMessage(db.conn, "om_1", {});
    seedMessage(db.conn, "om_2", {});
    claimJudging(db.conn, ["om_1", "om_2"], "2026-01-15T09:00:00+00:00");
    db.conn.prepare("UPDATE chat_messages SET judge_claimed_at='x' WHERE message_id='om_2'").run();
    const marked = markAiError(db.conn, ["om_1", "om_2"], "2026-01-15T09:00:00+00:00");
    expect(marked).toBe(1);
    expect(fieldOf("om_1", "ai_status")).toBe("error");
    expect(fieldOf("om_1", "suggested_title")).toBeNull();
    expect(fieldOf("om_2", "ai_status")).toBe("judging");
  });
});

describe("捕捉建任务（createTaskFromMessage）", () => {
  it("非法优先级回落 normal、未知分类回落第一个启用、未知标签丢弃、空串 due 归 NULL", () => {
    db.conn.prepare("INSERT INTO tags (name, dimension_id, created_at) VALUES ('重要', 4, 't')").run();
    const mid = seedMessage(db.conn, "om_x", {
      content: "周五之前交报告",
      suggestedTitle: "交报告",
      suggestedCategory: "不存在的分类",
      suggestedPriority: "super-urgent",
      suggestedTags: '["重要","不存在的标签"]',
      suggestedDue: "",
      aiStatus: "todo",
    });
    const taskId = createTaskFromMessage(db.conn, {
      id: mid,
      messageId: "om_x",
      content: "周五之前交报告",
      suggestedTitle: "交报告",
      suggestedNote: null,
      suggestedCategory: "不存在的分类",
      suggestedDue: "",
      suggestedPriority: "super-urgent",
      suggestedTags: '["重要","不存在的标签"]',
      aiStatus: "todo",
      reviewStatus: "pending",
      taskId: null,
      updateTaskId: null,
      followupTaskId: null,
      aiAgent: "",
      dismissReason: "",
      chatType: "",
    });
    const task = db.conn
      .prepare("SELECT priority, category_id, status, due_at FROM tasks WHERE id=?")
      .get(taskId) as Record<string, unknown>;
    expect(task.priority).toBe("normal");
    expect(task.category_id).toBe(1);
    expect(task.status).toBe("inbox");
    expect(task.due_at).toBeNull();
    const tags = db.conn
      .prepare("SELECT t.name FROM task_tags tt JOIN tags t ON t.id=tt.tag_id WHERE tt.task_id=?")
      .all(taskId) as Array<{ name: string }>;
    expect(tags).toEqual([{ name: "重要" }]);
  });
});

describe("逃走原因码白名单", () => {
  it("6 枚举；白名单外拒绝", () => {
    expect(ESCAPE_REASONS.length).toBe(6);
    expect(validEscapeReason(null)).toBe("");
    expect(validEscapeReason("noise")).toBe("noise");
    expect(() => validEscapeReason("nope")).toThrowError(/未知逃走原因码/);
  });
});
