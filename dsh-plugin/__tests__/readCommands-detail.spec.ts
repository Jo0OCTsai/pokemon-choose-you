/**
 * 实体读命令 · 按需懒载面：taskDetail（全量 + 跟进流 + 派发可否 + 该任务 agent 时间线
 * join）/ taskSearch（pk search 语义）/ todayTasks / categoriesList——真实临时库种子 +
 * 载荷形状断言。panelSnapshot 聚合面见 readCommands.spec.ts。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { createHostCommands } from "../src/host/commands";
import type { HostCommandDeps } from "../src/host/commands";
import type { TaskDetail } from "../src/host/commands/readCommands";
import { open } from "../src/host/storage/db";
import { initConn } from "../src/host/storage/init";
import { commandDeps, createTestDb, type TestDb } from "./helpers";
import { seedFullTask } from "./readCommands.spec";

let db: TestDb;
let writes: number;
let deps: HostCommandDeps;

beforeEach(() => {
  db = createTestDb();
  writes = 0;
  deps = commandDeps(db.conn, { onWrites: () => (writes += 1) });
});

afterEach(() => {
  db.close();
});

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string } };

const call = <T>(name: string, params?: unknown): Promise<Envelope<T>> =>
  createHostCommands(deps)(name, params) as Promise<Envelope<T>>;

async function okData<T>(name: string, params?: unknown): Promise<T> {
  const result = await call<T>(name, params);
  expect(result.ok).toBe(true);
  return (result as { ok: true; data: T }).data;
}

/** 挂一个 topic 标签到任务（标签命中搜索的前提） */
function attachTag(taskId: number, name: string): void {
  db.conn
    .prepare("INSERT INTO tags (name, dimension_id, created_at) VALUES (?, 4, '2026-01-01T00:00:00+00:00')")
    .run(name);
  const tagRow = db.conn.prepare("SELECT id FROM tags WHERE name=?").get(name) as { id: number };
  db.conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(taskId, tagRow.id);
}

describe("taskDetail · 详情组装", () => {
  it("任务全量 + 跟进流 + 派发状态/可否派发 + 该任务 agent 时间线（升序 join）", async () => {
    const taskId = seedFullTask(db.conn, "详情目标", { status: "scheduled", dispatch: "done" });
    attachTag(taskId, "重要");
    db.conn.prepare("UPDATE tasks SET dispatched_session=? WHERE id=?").run("sess-1", taskId);
    for (const [content, source] of [
      ["第一条跟进", "manual"],
      ["第二条跟进", "agent"],
    ] as const) {
      db.conn
        .prepare("INSERT INTO task_notes (task_id, content, source, created_at) VALUES (?, ?, ?, ?)")
        .run(taskId, content, source, "2026-01-02T00:00:00+00:00");
    }
    const seedSession = (kind: string, command: string): number =>
      Number(
        db.conn
          .prepare(
            "INSERT INTO agent_sessions (task_id, kind, command, created_at) VALUES (?, ?, ?, '2026-01-01T00:00:00+00:00')",
          )
          .run(taskId, kind, command).lastInsertRowid,
      );
    const s1 = seedSession("dispatch_headless", "claude -p a");
    const s2 = seedSession("dispatch_interactive", "claude -p b");
    db.conn
      .prepare(
        "INSERT INTO agent_sessions (task_id, kind, created_at) VALUES (NULL, 'classify', '2026-01-01T00:00:00+00:00')",
      )
      .run(); // 无任务行：不进时间线

    const detail = await okData<TaskDetail>("taskDetail", { taskId });
    expect(detail.task).toMatchObject({ id: taskId, title: "详情目标", dispatchState: "done" });
    expect(detail.task.tags).toEqual([{ name: "重要", dimension: "topic" }]);
    expect(detail.followups.map((n) => n.content)).toEqual(["第一条跟进", "第二条跟进"]);
    expect(detail.followups[0]).toMatchObject({ taskId, source: "manual", createdAt: "2026-01-02T00:00:00+00:00" });
    expect(detail.dispatch).toEqual({ state: "done", dispatchedSession: "sess-1", dispatchable: true });
    expect(detail.timeline.map((s) => s.id)).toEqual([s1, s2]);
  });
});

describe("taskDetail · 可否派发与边界", () => {
  it("可否派发判定：open+未派发 true；running/queued 在途 false；done/cancelled false；failed 可重派", async () => {
    const cases: Array<[string, string | null, boolean]> = [
      ["未派发", null, true],
      ["在途", "running", false],
      ["排队", "queued", false],
      ["失败可重派", "failed", true],
    ];
    for (const [title, dispatch, expected] of cases) {
      const id = seedFullTask(db.conn, title, { dispatch });
      const detail = await okData<TaskDetail>("taskDetail", { taskId: id });
      expect([title, detail.dispatch.dispatchable]).toEqual([title, expected]);
    }
    for (const status of ["done", "cancelled"]) {
      const id = seedFullTask(db.conn, `已收口-${status}`, { status });
      const detail = await okData<TaskDetail>("taskDetail", { taskId: id });
      expect(detail.dispatch.dispatchable).toBe(false);
    }
  });

  it("不存在 → NOT_FOUND；非法 id → INVALID_ARGUMENT；空任务零跟进零时间线", async () => {
    const missing = await call("taskDetail", { taskId: 424242 });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.code).toBe("NOT_FOUND");
    }
    const bad = await call("taskDetail", { taskId: -1 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.code).toBe("INVALID_ARGUMENT");
    }
    const empty = seedFullTask(db.conn, "空详情");
    const detail = await okData<TaskDetail>("taskDetail", { taskId: empty });
    expect(detail.followups).toEqual([]);
    expect(detail.timeline).toEqual([]);
  });
});

describe("taskSearch · 命中语义", () => {
  it("标题/备注/跟进/标签名命中（pk search 语义，id 倒序）", async () => {
    const t1 = seedFullTask(db.conn, "周会准备材料");
    const t2 = seedFullTask(db.conn, "普通任务");
    db.conn.prepare("UPDATE tasks SET note=? WHERE id=?").run("包含 周会 字样", t2);
    const t3 = seedFullTask(db.conn, "跟进命中");
    db.conn
      .prepare(
        "INSERT INTO task_notes (task_id, content, source, created_at) VALUES (?, ?, 'manual', '2026-01-01T00:00:00+00:00')",
      )
      .run(t3, "跟进里提到 周会");
    const t4 = seedFullTask(db.conn, "标签命中");
    attachTag(t4, "周会标签");

    const idsOf = async (query: string): Promise<number[]> =>
      (await okData<{ tasks: Array<{ id: number }> }>("taskSearch", { query })).tasks.map((t) => t.id);
    expect(await idsOf("周会准备")).toEqual([t1]);
    expect(await idsOf("字样")).toEqual([t2]);
    expect(await idsOf("跟进里")).toEqual([t3]);
    expect(await idsOf("周会标签")).toEqual([t4]);
  });
});

describe("todayTasks / categoriesList / 只读约束", () => {
  it("空查询与 LIKE 通配符转义：均空集", async () => {
    seedFullTask(db.conn, "任意任务");
    expect((await okData<{ tasks: unknown[] }>("taskSearch", { query: "  " })).tasks).toEqual([]);
    expect((await okData<{ tasks: unknown[] }>("taskSearch", { query: "%" })).tasks).toEqual([]);
    expect((await okData<{ tasks: unknown[] }>("taskSearch", { query: "_" })).tasks).toEqual([]);
  });

  it("todayTasks = listTasks('today') 口径：active/paused + 今日及以前到期", async () => {
    const active = seedFullTask(db.conn, "进行中", { status: "active", startedAt: "2026-01-02T00:00:00+00:00" });
    seedFullTask(db.conn, "未来排期", { status: "scheduled", dueAt: farDay(3) });
    const overdue = seedFullTask(db.conn, "过期仍在今天口径", { status: "scheduled", dueAt: farDay(-1) });
    const result = await okData<{ tasks: Array<{ id: number }> }>("todayTasks");
    expect(result.tasks.map((t) => t.id)).toEqual([active, overdue]);
  });

  it("categoriesList：种子分类全量（含 pokemon/sprite/enabled/description）", async () => {
    const result = await okData<{ categories: Array<{ name: string; pokemon: string; description: string }> }>(
      "categoriesList",
    );
    expect(result.categories).toHaveLength(5);
    expect(result.categories[1]).toMatchObject({
      name: "学习",
      pokemon: "可达鸭",
      sprite: "psyduck",
      enabled: true,
      description: expect.stringContaining("学习"),
    });
  });

  it("读命令不触发 onWrites（taskSearch/todayTasks/categoriesList/taskDetail 全只读）", async () => {
    const id = seedFullTask(db.conn, "只读验证");
    await okData("taskSearch", { query: "只读" });
    await okData("todayTasks");
    await okData("categoriesList");
    await okData("taskDetail", { taskId: id });
    expect(writes).toBe(0);
  });
});

/** 偏移日期串（本地口径 YYYY-MM-DDT09:00） */
function farDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}T09:00`;
}

// ---- 独立小库（openAndInit 冷启动路径的空面——不与上面种子互染） ----

describe("冷启动库（openAndInit）空面", () => {
  let dir: string;
  let conn: TestDb["conn"];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pky-read-cold-"));
    conn = open(join(dir, "cold.db"));
    initConn(conn);
    deps = commandDeps(conn);
  });

  afterEach(() => {
    conn.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("空库各读命令均空集/空段不报错（种子分类仍注入）", async () => {
    const result = await okData<{ categories: unknown[] }>("categoriesList");
    expect(result.categories).toHaveLength(5);
    expect((await okData<{ tasks: unknown[] }>("taskSearch", { query: "任何" })).tasks).toEqual([]);
    expect((await okData<{ tasks: unknown[] }>("todayTasks")).tasks).toEqual([]);
  });
});
