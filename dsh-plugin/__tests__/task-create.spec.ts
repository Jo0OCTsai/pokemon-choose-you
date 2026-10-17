/**
 * domain/tasks createTaskManual（FR-C1 / AD §4.1 taskCreate）：面板手动新建——
 * 标题 trim 非空校验 / 分类与标签存在性校验 / 默认值（第一个启用分类、normal、
 * 状态 = 排期?scheduled:inbox）/ 标签全量关联 / create 审计 / 校验失败 0 行变更
 * （单条 BEGIN IMMEDIATE 原子收口）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTaskManual } from "../src/host/domain/tasks";
import { PkyError } from "../src/host/storage/errors";
import { createTestDb, seedTag, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

function taskCount(): number {
  return Number((db.conn.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n);
}

function logsOf(taskId: number) {
  return db.conn
    .prepare("SELECT action, field, old_value, new_value, origin FROM task_logs WHERE task_id=? ORDER BY id")
    .all(taskId) as Array<{
    action: string;
    field: string;
    old_value: string | null;
    new_value: string | null;
    origin: string;
  }>;
}

describe("createTaskManual：最小新建（FR-C1 Gherkin「最小新建」逐句）", () => {
  it("仅填标题 → 创建成功：分类 = 第一个启用分类、优先级 normal、状态 inbox", () => {
    const t = createTaskManual(db.conn, { title: "写周报" });
    expect(t.title).toBe("写周报");
    expect(t.categoryId).toBe(1);
    expect(t.priority).toBe("normal");
    expect(t.status).toBe("inbox");
    expect(t.source).toBe("local");
    expect(t.tags).toEqual([]);
  });

  it("任务审计含 create 记录（origin 默认 panel）", () => {
    const t = createTaskManual(db.conn, { title: "写周报" });
    expect(logsOf(t.id)).toEqual([
      { action: "create", field: "title", old_value: null, new_value: "写周报", origin: "panel" },
    ]);
  });

  it("origin 可注入（审计行随调用方）", () => {
    const t = createTaskManual(db.conn, { title: "写周报" }, "dsh:sess-1");
    expect(logsOf(t.id)[0].origin).toBe("dsh:sess-1");
  });

  it("标题两侧空白 trim 后落库", () => {
    const t = createTaskManual(db.conn, { title: "  写周报  " });
    expect(t.title).toBe("写周报");
  });

  it("未指定分类落到第一个启用分类（id=1 停用时跳过）", () => {
    db.conn.prepare("UPDATE categories SET enabled=0 WHERE id=1").run();
    const t = createTaskManual(db.conn, { title: "任务" });
    expect(t.categoryId).toBe(2);
  });
});

describe("createTaskManual：校验拒绝", () => {
  it("空标题 / 纯空白标题拒绝（参数错「标题不能为空」）且 0 行变更", () => {
    for (const title of ["", "   "]) {
      expect(() => createTaskManual(db.conn, { title })).toThrowError(PkyError);
      try {
        createTaskManual(db.conn, { title });
      } catch (error) {
        expect((error as PkyError).code).toBe("INVALID_ARGUMENT");
        expect((error as PkyError).message).toBe("标题不能为空");
      }
    }
    expect(taskCount()).toBe(0);
  });

  it("categoryId 不存在拒绝（参数错，消息含分类 id）且 0 行变更", () => {
    expect(() => createTaskManual(db.conn, { title: "x", categoryId: 999 })).toThrowError(PkyError);
    try {
      createTaskManual(db.conn, { title: "x", categoryId: 999 });
    } catch (error) {
      expect((error as PkyError).code).toBe("INVALID_ARGUMENT");
      expect((error as PkyError).message).toContain("999");
    }
    expect(taskCount()).toBe(0);
  });

  it("tagIds 不存在拒绝（参数错，消息含缺失标签 id）且 0 行变更", () => {
    const good = seedTag(db.conn, "红");
    expect(() => createTaskManual(db.conn, { title: "x", tagIds: [good, 999] })).toThrowError(PkyError);
    try {
      createTaskManual(db.conn, { title: "x", tagIds: [good, 999] });
    } catch (error) {
      expect((error as PkyError).code).toBe("INVALID_ARGUMENT");
      expect((error as PkyError).message).toContain("999");
    }
    expect(taskCount()).toBe(0);
    const links = db.conn.prepare("SELECT COUNT(*) AS n FROM task_tags").get() as { n: number };
    expect(links.n).toBe(0);
  });
});

describe("createTaskManual：状态推导与字段落库", () => {
  it("scheduledFor 有值 → scheduled（排期值兜底落 due_at，草丛不变量下站得住）", () => {
    const t = createTaskManual(db.conn, { title: "排程任务", scheduledFor: "2026-10-20T09:00" });
    expect(t.status).toBe("scheduled");
    expect(t.dueAt).toBe("2026-10-20T09:00");
  });

  it("scheduledFor 无值 → inbox", () => {
    const t = createTaskManual(db.conn, { title: "收件任务" });
    expect(t.status).toBe("inbox");
    expect(t.dueAt).toBeNull();
  });

  it("due 显式给定时优先于 scheduledFor 落 due_at，状态仍 scheduled", () => {
    const t = createTaskManual(db.conn, {
      title: "x",
      due: "2026-10-21T18:00",
      scheduledFor: "2026-10-20T09:00",
    });
    expect(t.dueAt).toBe("2026-10-21T18:00");
    expect(t.status).toBe("scheduled");
  });

  it("due 空串归 NULL（不清空 scheduledFor 兜底语义之外的行为）", () => {
    const t = createTaskManual(db.conn, { title: "x", due: "   " });
    expect(t.dueAt).toBeNull();
    expect(t.status).toBe("inbox");
  });

  it("note / priority / remindAt 透传落库", () => {
    const t = createTaskManual(db.conn, {
      title: "x",
      note: "备注",
      priority: "urgent",
      remindAt: "2026-10-19T09:00",
    });
    expect(t.note).toBe("备注");
    expect(t.priority).toBe("urgent");
    expect(t.remindAt).toBe("2026-10-19T09:00");
  });
});

describe("createTaskManual：标签全量替换关联", () => {
  it("tagIds 建完整关联集，返回行 tags 带 dimension key", () => {
    const a = seedTag(db.conn, "红");
    const b = seedTag(db.conn, "蓝");
    const t = createTaskManual(db.conn, { title: "x", tagIds: [a, b] });
    expect(t.tags.map((x) => x.name).sort()).toEqual(["红", "蓝"]);
    expect(t.tags.every((x) => x.dimension === "topic")).toBe(true);
    const links = db.conn.prepare("SELECT tag_id FROM task_tags WHERE task_id=? ORDER BY tag_id").all(t.id) as Array<{
      tag_id: number;
    }>;
    expect(links.map((r) => Number(r.tag_id))).toEqual([a, b].sort((x, y) => x - y));
  });

  it("tagIds 空数组 = 无关联（建空关联集）", () => {
    const t = createTaskManual(db.conn, { title: "x", tagIds: [] });
    expect(t.tags).toEqual([]);
  });
});
