/**
 * domain/tasks：六态状态机（对齐 commands/tasks.rs）——出发 demote、撤销分流、
 * 「路线无截止从未出发强制回草丛」不变量、放生级联墓碑、改期联动、跟进追加、
 * 双连接并发出发终态 active ≤ 1。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTask, getCurrentTask, getTask, listTasks, updateTask } from "../src/host/domain/tasks";
import {
  addTaskNote,
  completeTask,
  deleteTask,
  escapeTask,
  listTaskNotes,
  pauseCurrentTask,
  rescheduleTask,
  startTask,
  undoneTask,
} from "../src/host/domain/task-lifecycle";
import { PkyError } from "../src/host/storage/errors";
import { createTestDb, seedTask, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

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

describe("创建", () => {
  it("默认 inbox + normal + 第一个启用分类 + source=local，审计记 create（origin=dsh）", () => {
    const t = createTask(db.conn, { title: "写周报" });
    expect(t.status).toBe("inbox");
    expect(t.priority).toBe("normal");
    expect(t.categoryId).toBe(1);
    expect(t.source).toBe("local");
    expect(t.focusSeconds).toBe(0);
    const logs = logsOf(t.id);
    expect(logs).toEqual([{ action: "create", field: "title", old_value: null, new_value: "写周报", origin: "dsh" }]);
  });

  it("scheduled + 有截止 → scheduled；scheduled 标志但无截止被不变量兜底归草丛", () => {
    const t = createTask(db.conn, { title: "开会", scheduled: true, dueAt: "2026-09-13T09:00" });
    expect(t.status).toBe("scheduled");
    const noDue = createTask(db.conn, { title: "没时间", scheduled: true });
    expect(noDue.status).toBe("inbox");
  });

  it("空白标题拒绝（参数错）", () => {
    expect(() => createTask(db.conn, { title: "  " })).toThrowError(PkyError);
  });

  it("未指定分类落到第一个启用分类（id=1 停用时跳过）", () => {
    db.conn.prepare("UPDATE categories SET enabled=0 WHERE id=1").run();
    const t = createTask(db.conn, { title: "任务" });
    expect(t.categoryId).toBe(2);
  });
});

describe("出发（全局唯一进行中 + 顶下 demote）", () => {
  it("切换后旧 active 回 scheduled，本任务 active 并记首次开始时间", () => {
    const a = createTask(db.conn, { title: "A" });
    const b = createTask(db.conn, { title: "B" });
    startTask(db.conn, a.id);
    const current = startTask(db.conn, b.id);
    expect(current.status).toBe("active");
    expect(getTask(db.conn, a.id).status).toBe("scheduled");
    expect(getTask(db.conn, b.id).startedAt).not.toBeNull();
  });

  it("审计时序照抄 Rust：demote 快照提交后补写 + start 日志（origin 传递）", () => {
    const a = createTask(db.conn, { title: "A" }, "dsh:sess1");
    const b = createTask(db.conn, { title: "B" }, "dsh:sess1");
    startTask(db.conn, a.id, "dsh:sess1");
    startTask(db.conn, b.id, "dsh:sess1");
    const aLogs = logsOf(a.id);
    expect(aLogs.some((l) => l.action === "start" && l.new_value === "active")).toBe(true);
    expect(aLogs.some((l) => l.action === "demote" && l.new_value === "scheduled")).toBe(true);
    expect(aLogs.every((l) => l.origin === "dsh:sess1")).toBe(true);
  });
});

describe("出发（全局唯一进行中 + 顶下 demote）·下", () => {
  it("paused 任务也被顶下（demote 覆盖 active/paused 全部）", () => {
    const a = createTask(db.conn, { title: "A" });
    const b = createTask(db.conn, { title: "B" });
    startTask(db.conn, a.id);
    pauseCurrentTask(db.conn);
    startTask(db.conn, b.id);
    expect(getTask(db.conn, a.id).status).toBe("scheduled");
  });

  it("不存在的任务报 NOT_FOUND（demote 已提交——Rust 同款行为）", () => {
    expect(() => startTask(db.conn, 999)).toThrowError(/不存在/);
  });

  it("双连接并发出发两个任务：任一时刻 active ≤ 1（写锁串行化 + demote 原语）", () => {
    const conn2 = db.secondConn();
    const a = seedTask(db.conn, "A");
    const b = seedTask(db.conn, "B");
    // 交错出发：conn1 出发 A → conn2 出发 B → 反复，双连接各 10 轮
    for (let i = 0; i < 10; i++) {
      startTask(db.conn, a);
      startTask(conn2, b);
      const active1 = db.conn.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status='active'").get();
      expect(active1).toEqual({ n: 1 });
    }
    // 终态：最后出发的是 active，另一个被顶下
    const finalActive = db.conn.prepare("SELECT id FROM tasks WHERE status='active'").all() as Array<{ id: number }>;
    expect(finalActive.length).toBeLessThanOrEqual(1);
    expect(finalActive[0]?.id).toBe(b);
  });
});

describe("暂停 / 完成 / 撤销分流 / 逃走", () => {
  it("暂停后无 active，列表首项 paused；日志记 pause", () => {
    const t = createTask(db.conn, { title: "专注" });
    startTask(db.conn, t.id);
    const paused = pauseCurrentTask(db.conn);
    expect(paused?.id).toBe(t.id);
    expect(getCurrentTask(db.conn)).toBeNull();
    expect(listTasks(db.conn, "open")[0].status).toBe("paused");
    expect(logsOf(t.id).some((l) => l.action === "pause")).toBe(true);
  });

  it("taskId 指定但不在进行中 → 参数错", () => {
    const t = createTask(db.conn, { title: "非进行中" });
    expect(() => pauseCurrentTask(db.conn, "dsh", undefined, t.id)).toThrowError(/不在进行中/);
  });

  it("完成写 completed_at，进 done 列表；撤销分流：有截止 → scheduled", () => {
    const t = createTask(db.conn, { title: "开会", scheduled: true, dueAt: "2026-09-13T09:00" });
    const done = completeTask(db.conn, t.id);
    expect(done.status).toBe("done");
    expect(done.completedAt).not.toBeNull();
    expect(listTasks(db.conn, "done").length).toBe(1);
    const undone = undoneTask(db.conn, t.id);
    expect(undone.status).toBe("scheduled");
  });

  it("撤销分流：无截止且从未出发 → inbox（「路线无截止从未出发强制回草丛」不变量）", () => {
    const t = createTask(db.conn, { title: "草丛任务" });
    completeTask(db.conn, t.id);
    const undone = undoneTask(db.conn, t.id);
    expect(undone.status).toBe("inbox");
  });

  it("撤销分流：无截止但曾出发 → scheduled（开始过的任务可停留在路线）", () => {
    const t = createTask(db.conn, { title: "开始过" });
    startTask(db.conn, t.id);
    completeTask(db.conn, t.id);
    const undone = undoneTask(db.conn, t.id);
    expect(undone.status).toBe("scheduled");
  });

  it("逃走：cancelled + cancelled_at，出现在图鉴（done 列表）", () => {
    const t = createTask(db.conn, { title: "不做了" });
    const escaped = escapeTask(db.conn, t.id);
    expect(escaped.status).toBe("cancelled");
    expect(escaped.cancelledAt).not.toBeNull();
    expect(listTasks(db.conn, "done").length).toBe(1);
  });
});

describe("更新与改期", () => {
  it("字段级 patch：只动给出的字段；提醒时间变化重置 reminded", () => {
    const t = createTask(db.conn, { title: "原标题" });
    db.conn.prepare("UPDATE tasks SET reminded=1 WHERE id=?").run(t.id);
    const updated = updateTask(db.conn, {
      id: t.id,
      title: "新标题",
      priority: "high",
      remindAt: "2026-10-01T09:00",
    });
    expect(updated.title).toBe("新标题");
    expect(updated.priority).toBe("high");
    expect(updated.reminded).toBe(false);
    expect(updated.remindAt).toBe("2026-10-01T09:00");
  });

  it("dueAt 三态：缺失不改 / null 清空 / 字符串设置", () => {
    const t = createTask(db.conn, { title: "t", dueAt: "2026-09-10T09:00", scheduled: true });
    expect(updateTask(db.conn, { id: t.id, priority: "low" }).dueAt).toBe("2026-09-10T09:00");
    const cleared = updateTask(db.conn, { id: t.id, dueAt: null });
    expect(cleared.dueAt).toBeNull();
    expect(cleared.status).toBe("inbox");
    const set = updateTask(db.conn, { id: t.id, dueAt: "2026-09-11T09:00" });
    expect(set.dueAt).toBe("2026-09-11T09:00");
  });
});

describe("更新与改期·下", () => {
  it("无变化不写审计日志；变化逐字段记 update", () => {
    const t = createTask(db.conn, { title: "无变化" });
    updateTask(db.conn, { id: t.id, title: "无变化" });
    expect(logsOf(t.id).length).toBe(1);
    updateTask(db.conn, { id: t.id, title: "改名", priority: "high" });
    const logs = logsOf(t.id);
    expect(logs.filter((l) => l.action === "update").map((l) => l.field)).toEqual(["title", "priority"]);
  });

  it("改期：due 空串清空截止并联动草丛；有值落 scheduled", () => {
    const t = createTask(db.conn, { title: "改期" });
    const scheduled = rescheduleTask(db.conn, t.id, "2026-09-13T10:00");
    expect(scheduled.status).toBe("scheduled");
    expect(scheduled.dueAt).toBe("2026-09-13T10:00");
    const cleared = rescheduleTask(db.conn, t.id, "");
    expect(cleared.dueAt).toBeNull();
    expect(cleared.status).toBe("inbox");
  });

  it("历史脏数据兜底：due_at 空串的 scheduled 任务任意写路径后归草丛", () => {
    const t = seedTask(db.conn, "空串脏数据", { status: "scheduled", dueAt: "" });
    const got = updateTask(db.conn, { id: t, priority: "high" });
    expect(got.status).toBe("inbox");
  });

  it("不存在的任务：NOT_FOUND", () => {
    expect(() => updateTask(db.conn, { id: 9999, title: "幽灵" })).toThrowError(/不存在/);
  });
});

describe("放生（级联删除 + 墓碑）", () => {
  it("tasks/task_tags/task_notes 删除，task_logs 墓碑保留标题快照", () => {
    const tagId = (
      db.conn.prepare("INSERT INTO tags (name, dimension_id, created_at) VALUES ('标签', 4, 't')").run() as {
        lastInsertRowid: number | bigint;
      }
    ).lastInsertRowid;
    const t = createTask(db.conn, { title: "待删", tagIds: [Number(tagId)] });
    addTaskNote(db.conn, t.id, "有跟进");
    deleteTask(db.conn, t.id, "dsh");
    expect(db.conn.prepare("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({ n: 0 });
    expect(db.conn.prepare("SELECT COUNT(*) AS n FROM task_tags").get()).toEqual({ n: 0 });
    expect(db.conn.prepare("SELECT COUNT(*) AS n FROM task_notes").get()).toEqual({ n: 0 });
    const tombstone = db.conn
      .prepare("SELECT action, old_value, new_value, origin FROM task_logs WHERE task_id=?")
      .all(t.id) as Array<{ action: string; old_value: string | null; new_value: string | null; origin: string }>;
    expect(tombstone.some((l) => l.action === "delete" && l.old_value === "待删" && l.new_value === null)).toBe(true);
  });
});

describe("跟进记录", () => {
  it("追加 + 列表；空内容拒绝；不存在的任务 NOT_FOUND；source 归一 manual/ai", () => {
    const t = createTask(db.conn, { title: "有跟进" });
    expect(() => addTaskNote(db.conn, t.id, "  ")).toThrowError(/不能为空/);
    addTaskNote(db.conn, t.id, "对方确认周五交付");
    addTaskNote(db.conn, t.id, "AI 补充", "whatever");
    const notes = listTaskNotes(db.conn, t.id);
    expect(notes.length).toBe(2);
    expect(notes.map((n) => n.source)).toEqual(["manual", "manual"]);
    expect(() => addTaskNote(db.conn, 999, "x")).toThrowError(/不存在/);
  });
});

describe("列表口径（open 排序：active 最前）", () => {
  it("open 列表 active 优先，其后按状态档", () => {
    const a = createTask(db.conn, { title: "A" });
    const b = createTask(db.conn, { title: "B" });
    startTask(db.conn, b.id);
    const open = listTasks(db.conn, "open");
    expect(open[0].id).toBe(b.id);
    expect(open[1].id).toBe(a.id);
  });
});
