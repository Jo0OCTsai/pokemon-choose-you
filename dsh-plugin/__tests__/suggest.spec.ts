/**
 * domain/suggest 提交期：六规则校验（整批原子、文案含 messageId）、批内 messageId
 * 判重、批内判重兜底、假名还原（提交前 restore）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertNoDuplicateMessageIds,
  dedupBatchTodos,
  restoreSuggestion,
  suggestBatch,
  type AiSuggestion,
} from "../src/host/domain/suggest";
import { PkyError } from "../src/host/storage/errors";
import { createTestDb, scalar, seedMessage, type TestDb } from "./helpers";

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

describe("提交期校验（六规则，整批原子）", () => {
  it("消息不存在 / 已人工确认过 → 整批拒绝，文案含序号与 messageId", () => {
    seedMessage(db.conn, "om_done", { reviewStatus: "accepted" });
    const cases: Array<[AiSuggestion, RegExp]> = [
      [suggestion({ messageId: "om_missing", action: "none" }), /消息不存在/],
      [suggestion({ messageId: "om_done", action: "none" }), /已人工确认过/],
    ];
    for (const [s, pattern] of cases) {
      expect(() => suggestBatch(db.conn, [s])).toThrowError(pattern);
    }
    let err: PkyError | undefined;
    try {
      suggestBatch(db.conn, [suggestion({ messageId: "om_x", action: "none" })]);
    } catch (e) {
      err = e as PkyError;
    }
    expect(err).toBeInstanceOf(PkyError);
    expect(err?.message).toContain("第 1 条");
    expect(err?.message).toContain("om_x");
  });

  it("action 枚举封闭 + 载荷匹配（todo 缺 title / update 缺目标 / followUp 目标不存在）", () => {
    seedMessage(db.conn, "om_1", {});
    seedMessage(db.conn, "om_2", {});
    seedMessage(db.conn, "om_3", {});
    seedMessage(db.conn, "om_4", {});
    expect(() => suggestBatch(db.conn, [suggestion({ messageId: "om_1", action: "todo", title: "  " })])).toThrowError(
      /action=todo 需要 title/,
    );
    expect(() =>
      suggestBatch(db.conn, [suggestion({ messageId: "om_2", action: "update", updateTaskId: null })]),
    ).toThrowError(/action=update 需要 updateTaskId/);
    expect(() =>
      suggestBatch(db.conn, [suggestion({ messageId: "om_2", action: "update", updateTaskId: 999 })]),
    ).toThrowError(/待办 No\.999 不存在/);
    expect(() =>
      suggestBatch(db.conn, [suggestion({ messageId: "om_3", action: "followUp", followUpTaskId: 42 })]),
    ).toThrowError(/待办 No\.42 不存在/);
    expect(() => suggestBatch(db.conn, [suggestion({ messageId: "om_4", action: "delete" })])).toThrowError(
      /action「delete」无效/,
    );
  });
});

describe("提交期校验（六规则，整批原子）·下", () => {
  it("priority / confidence 非空必须命中枚举", () => {
    seedMessage(db.conn, "om_p", {});
    seedMessage(db.conn, "om_c", {});
    expect(() =>
      suggestBatch(db.conn, [suggestion({ messageId: "om_p", action: "none", priority: "super" })]),
    ).toThrowError(/优先级「super」无效/);
    expect(() =>
      suggestBatch(db.conn, [suggestion({ messageId: "om_c", action: "none", confidence: "maybe" })]),
    ).toThrowError(/confidence「maybe」无效/);
  });

  it("category 非空必须命中启用分类（停用同名分类拒绝）", () => {
    seedMessage(db.conn, "om_k", {});
    db.conn.prepare("UPDATE categories SET enabled=0 WHERE id=1").run();
    expect(() =>
      suggestBatch(db.conn, [suggestion({ messageId: "om_k", action: "todo", title: "t", category: "工作" })]),
    ).toThrowError(/未找到启用中的分类「工作」/);
  });

  it("tags：非 isNew 词表外整批拒绝；isNew 维度配额满整批拒绝", () => {
    seedMessage(db.conn, "om_t", {});
    seedMessage(db.conn, "om_q", {});
    expect(() =>
      suggestBatch(db.conn, [
        suggestion({ messageId: "om_t", action: "todo", title: "t", tags: [{ name: "幻觉标签" }] }),
      ]),
    ).toThrowError(/未知标签「幻觉标签」/);
    // 场景维度种子上限 10：占满后 isNew 拒绝
    for (let i = 0; i < 10; i++) {
      db.conn.prepare("INSERT INTO tags (name, dimension_id, created_at) VALUES (?, 2, 't')").run(`场景${i}`);
    }
    expect(() =>
      suggestBatch(db.conn, [
        suggestion({
          messageId: "om_q",
          action: "todo",
          title: "t",
          tags: [{ name: "新场景", dimension: "context", isNew: true }],
        }),
      ]),
    ).toThrowError(/维度「context」标签已满/);
  });
});

describe("提交期校验（六规则，整批原子）·下", () => {
  it("批内 messageId 重复整批拒绝", () => {
    seedMessage(db.conn, "om_1", {});
    expect(() =>
      suggestBatch(db.conn, [
        suggestion({ messageId: "om_1", action: "none" }),
        suggestion({ messageId: "om_1", action: "none" }),
      ]),
    ).toThrowError(/messageId 重复/);
    expect(() =>
      assertNoDuplicateMessageIds([suggestion({ messageId: "a" }), suggestion({ messageId: "a" })]),
    ).toThrow();
  });

  it("整批原子：第 2 条违规时第 1 条也不落库", () => {
    seedMessage(db.conn, "om_1", {});
    seedMessage(db.conn, "om_bad", {});
    expect(() =>
      suggestBatch(db.conn, [
        suggestion({ messageId: "om_1", action: "todo", title: "好的" }),
        suggestion({ messageId: "om_bad", action: "wat" }),
      ]),
    ).toThrowError(/action「wat」无效/);
    expect(fieldOf("om_1", "ai_status")).toBe("pending");
  });

  it("空 results 拒绝", () => {
    expect(() => suggestBatch(db.conn, [])).toThrowError(/无可提交的建议/);
  });
});

describe("批内判重兜底", () => {
  it("规范化标题相同的 todo 只留首条，其余降级 none 且 reason 指向保留条", () => {
    const list = [
      suggestion({ messageId: "om_a", action: "todo", title: "  写季度报告  " }),
      suggestion({ messageId: "om_b", action: "todo", title: "写季度报告" }),
      suggestion({ messageId: "om_c", action: "todo", title: "别的事" }),
      suggestion({ messageId: "om_d", action: "none" }),
    ];
    const demoted = dedupBatchTodos(list);
    expect(demoted).toEqual(["om_b"]);
    expect(list[1].action).toBe("none");
    expect(list[1].title).toBeNull();
    expect(list[1].reason).toBe("与消息 [om_a] 同一件事");
    expect(list[0].action).toBe("todo");
    expect(list[2].action).toBe("todo");
  });
});

describe("假名还原（提交前 restore）", () => {
  it("title/note/reason/tags 的代号反向还原为真名；未知代号原样保留", () => {
    db.conn
      .prepare("INSERT INTO feishu_users (open_id, name, alias, updated_at) VALUES ('ou_z', '张三', '成员_00aa', 't')")
      .run();
    const restored = restoreSuggestion(
      db.conn,
      suggestion({
        messageId: "om_1",
        action: "todo",
        title: "找成员_00aa对齐",
        note: "成员_00aa 负责",
        reason: "成员_00aa 提到",
        tags: [{ name: "成员_00aa", dimension: "person" }],
      }),
    );
    expect(restored.title).toBe("找张三对齐");
    expect(restored.note).toBe("张三 负责");
    expect(restored.reason).toBe("张三 提到");
    expect(restored.tags?.[0]?.name).toBe("张三");
    const unknown = restoreSuggestion(db.conn, suggestion({ title: "成员_ffff 幻觉" }));
    expect(unknown.title).toBe("成员_ffff 幻觉");
  });
});
