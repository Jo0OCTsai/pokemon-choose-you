/**
 * 实体读命令 · panelSnapshot 聚合面：任务四段归属 / 收音机消息五分组与代号还原 /
 * 会话账本投影 / 健康四元组——真实临时库种子 + 载荷形状断言（camelCase、空库不报错、
 * 只读不触发 onWrites）。taskDetail/taskSearch/todayTasks/categoriesList 见
 * readCommands-detail.spec.ts。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHostCommands } from "../src/host/commands";
import type { PanelSnapshot } from "../src/host/commands/readCommands";
import { commandDeps, createTestDb, seedMessage, type TestDb } from "./helpers";
import type { HostCommandDeps } from "../src/host/commands";

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

async function okData<T>(name: string, params?: unknown): Promise<T> {
  const result = (await createHostCommands(deps)(name, params)) as Envelope<T>;
  expect(result.ok).toBe(true);
  return (result as { ok: true; data: T }).data;
}

/** 本地今天/昨天/明天的日期串（YYYY-MM-DDT09:00 形态——与库里 due_at 同口径） */
function dayString(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}T09:00`;
}

/** 直插任务（带派发态与截止） */
export function seedFullTask(
  conn: TestDb["conn"],
  title: string,
  opts: { status?: string; dueAt?: string | null; dispatch?: string | null; startedAt?: string | null } = {},
): number {
  const r = conn
    .prepare(
      "INSERT INTO tasks (title, status, due_at, dispatch_state, started_at, created_at) " +
        "VALUES (?, ?, ?, ?, ?, '2026-01-01T00:00:00+00:00')",
    )
    .run(title, opts.status ?? "inbox", opts.dueAt ?? null, opts.dispatch ?? null, opts.startedAt ?? null);
  return Number(r.lastInsertRowid);
}

describe("panelSnapshot · 任务四段落位", () => {
  it("active/paused → adventure.active；今日到期/逾期/scheduled/inbox 各归各段", async () => {
    const active = seedFullTask(db.conn, "进行中", { status: "active", startedAt: "2026-01-02T00:00:00+00:00" });
    const paused = seedFullTask(db.conn, "暂停中", { status: "paused", startedAt: "2026-01-02T00:00:00+00:00" });
    const dueToday = seedFullTask(db.conn, "今日到期", { status: "scheduled", dueAt: dayString(0) });
    const overdue = seedFullTask(db.conn, "逾期目标", { status: "scheduled", dueAt: dayString(-2) });
    const future = seedFullTask(db.conn, "未来路线", { status: "scheduled", dueAt: dayString(2) });
    const grass = seedFullTask(db.conn, "草丛待办");

    const snap = await okData<PanelSnapshot>("panelSnapshot");
    expect(snap.adventure.active.map((t) => t.id)).toEqual([active, paused]);
    expect(snap.adventure.dueToday.map((t) => t.id)).toEqual([dueToday]);
    expect(snap.adventure.overdue.map((t) => t.id)).toEqual([overdue]);
    expect(snap.grass.map((t) => t.id)).toEqual([grass]);
    // 路线平铺按截止升序（client routeGroups 按日分组不重排序内顺序）
    expect(snap.route.map((t) => t.id)).toEqual([overdue, dueToday, future]);
    expect(snap.currentTask?.id).toBe(active);
    // 载荷是 camelCase 全量 Task（含 tags 数组）
    expect(snap.adventure.active[0]).toMatchObject({ id: active, title: "进行中", status: "active", tags: [] });
  });

  it("dex 分段 + 全量 stats（不受列表 LIMIT 截断）+ 分类随快照", async () => {
    const done = seedFullTask(db.conn, "已捕捉", { status: "done" });
    const cancelled = seedFullTask(db.conn, "已逃走", { status: "cancelled" });
    db.conn.prepare("UPDATE tasks SET completed_at=? WHERE id=?").run("2026-01-03T00:00:00+00:00", done);
    db.conn.prepare("UPDATE tasks SET cancelled_at=? WHERE id=?").run("2026-01-04T00:00:00+00:00", cancelled);

    const snap = await okData<PanelSnapshot>("panelSnapshot");
    expect(snap.dex.done.map((t) => t.id)).toEqual([done]);
    expect(snap.dex.cancelled.map((t) => t.id)).toEqual([cancelled]);
    expect(snap.dex.stats).toEqual({ caught: 1, escaped: 1 });
    // 分类随快照（任务卡精灵渲染）：种子 5 分类
    expect(snap.categories.map((c) => c.name)).toEqual(["工作", "学习", "生活", "健康", "兴趣"]);
    expect(snap.categories[0]).toMatchObject({ pokemon: "皮卡丘", sprite: "pikachu", enabled: true });
    expect(snap.now).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("panelSnapshot · 空库与只读约束", () => {
  it("空库冷启动：各段空数组 + currentTask null（feishu 未启用 → warn 与 diagnostics 口径一致）", async () => {
    const snap = await okData<PanelSnapshot>("panelSnapshot");
    expect(snap.adventure).toEqual({ active: [], dueToday: [], overdue: [] });
    expect(snap.grass).toEqual([]);
    expect(snap.route).toEqual([]);
    expect(snap.dex).toEqual({ done: [], cancelled: [], stats: { caught: 0, escaped: 0 } });
    // feishu_enabled 无行 → level paused → warn（diagnosticsSnapshot 同口径，非本命令特判）
    expect(snap.radio).toMatchObject({
      pending: [],
      none: [],
      error: [],
      escaped: [],
      accepted: [],
      health: { level: "warn", consecutiveFailures: 0, pendingCount: 0 },
    });
    expect(snap.logs).toEqual([]);
    expect(snap.currentTask).toBe(null);
  });

  it("只读：panelSnapshot 全程不触发 onWrites", async () => {
    await okData<PanelSnapshot>("panelSnapshot");
    expect(writes).toBe(0);
  });
});

describe("panelSnapshot · 消息五分组归属", () => {
  it("消息按 review/ai 状态归五组（倒序），skipped 上下文消息不进面板", async () => {
    seedMessage(db.conn, "om_todo", { aiStatus: "todo", suggestedTitle: "参加周会" });
    seedMessage(db.conn, "om_judging", { aiStatus: "judging" });
    seedMessage(db.conn, "om_pending", { aiStatus: "pending" });
    seedMessage(db.conn, "om_none", { aiStatus: "none" });
    seedMessage(db.conn, "om_err", { aiStatus: "error" });
    seedMessage(db.conn, "om_acc", { aiStatus: "todo", reviewStatus: "accepted" });
    seedMessage(db.conn, "om_dis", { aiStatus: "none", reviewStatus: "dismissed" });
    seedMessage(db.conn, "om_ctx", { aiStatus: "skipped" });

    const snap = await okData<PanelSnapshot>("panelSnapshot");
    // 倒序（id DESC——list_chat_messages 同构：最新在前）
    expect(snap.radio.pending.map((m) => m.messageId)).toEqual(["om_pending", "om_judging", "om_todo"]);
    expect(snap.radio.none.map((m) => m.messageId)).toEqual(["om_none"]);
    expect(snap.radio.error.map((m) => m.messageId)).toEqual(["om_err"]);
    expect(snap.radio.accepted.map((m) => m.messageId)).toEqual(["om_acc"]);
    expect(snap.radio.escaped.map((m) => m.messageId)).toEqual(["om_dis"]);
    const all = [
      ...snap.radio.pending,
      ...snap.radio.none,
      ...snap.radio.error,
      ...snap.radio.accepted,
      ...snap.radio.escaped,
    ];
    expect(all.map((m) => m.messageId)).not.toContain("om_ctx");
  });
});

describe("panelSnapshot · 建议载荷投影与代号还原", () => {
  it("建议载荷字段全量投影（置信/理由/新标签/目标待办）", async () => {
    const target = seedFullTask(db.conn, "更新目标", { status: "scheduled", dueAt: dayString(1) });
    seedMessage(db.conn, "om_full", {
      content: "原始内容",
      suggestedTitle: "找成员_00aa 对齐材料",
      suggestedNote: "备注",
      suggestedCategory: "工作",
      suggestedDue: "2026-06-01T09:00",
      suggestedPriority: "high",
      suggestedTags: JSON.stringify([{ name: "重要", dimension: "topic", isNew: true }]),
      aiStatus: "update",
      reviewStatus: "pending",
      updateTaskId: target,
      aiAgent: "ag-1",
    });
    db.conn
      .prepare(
        "UPDATE chat_messages SET suggested_reason='提到周会', suggested_confidence='high' WHERE message_id='om_full'",
      )
      .run();

    const snap = await okData<PanelSnapshot>("panelSnapshot");
    expect(snap.radio.pending[0]).toMatchObject({
      messageId: "om_full",
      content: "原始内容",
      suggestedTitle: "找成员_00aa 对齐材料",
      suggestedCategory: "工作",
      suggestedDue: "2026-06-01T09:00",
      suggestedPriority: "high",
      suggestedTags: [{ name: "重要", dimension: "topic", isNew: true }],
      confidence: "high",
      reason: "提到周会",
      dismissReason: "",
      taskId: null,
      updateTaskId: target,
      aiStatus: "update",
      reviewStatus: "pending",
    });
  });
});

describe("panelSnapshot · 代号还原", () => {
  it("代号还原到真名（正文/建议标题/备注/理由）；非三档置信归 null", async () => {
    db.conn
      .prepare("INSERT INTO feishu_users (open_id, name, alias, updated_at) VALUES (?, ?, ?, '')")
      .run("ou_1", "王晓明", "成员_00aa");
    seedMessage(db.conn, "om_anon", {
      content: "成员_00aa 说明的内容",
      suggestedTitle: "找成员_00aa 对齐材料",
      suggestedNote: "备注成员_00aa",
      aiStatus: "todo",
    });
    db.conn
      .prepare(
        "UPDATE chat_messages SET suggested_reason='成员_00aa 提到周会', suggested_confidence='sure' WHERE message_id='om_anon'",
      )
      .run();

    const snap = await okData<PanelSnapshot>("panelSnapshot");
    expect(snap.radio.pending[0]).toMatchObject({
      content: "王晓明 说明的内容",
      suggestedTitle: "找王晓明 对齐材料",
      suggestedNote: "备注王晓明",
      reason: "王晓明 提到周会",
      confidence: null, // 坏数据不进 UI 枚举面
    });
  });
});

describe("panelSnapshot · 健康四元组", () => {
  it("连续失败 3 次 → fail；nextPollAt epoch 毫秒 → RFC3339 串", async () => {
    db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('feishu_enabled', 'true')").run();
    deps.health.recordFailure("feishu", "boom", "2026-10-11T08:00:00+00:00");
    deps.health.recordFailure("feishu", "boom", "2026-10-11T08:01:00+00:00");
    deps.health.recordFailure("feishu", "boom", "2026-10-11T08:02:00+00:00");
    deps.health.setNextRun("feishu", 1760145600000);
    seedMessage(db.conn, "om_p1", { aiStatus: "todo" });
    seedMessage(db.conn, "om_p2", { aiStatus: "update" });
    const snap = await okData<PanelSnapshot>("panelSnapshot");
    expect(snap.radio.health).toEqual({
      level: "fail",
      lastSuccessAt: null,
      nextPollAt: new Date(1760145600000).toISOString(),
      consecutiveFailures: 3,
      pendingCount: 2,
    });
  });
});

describe("panelSnapshot · 会话账本 logs", () => {
  it("agent_sessions 倒序 limit 500，kind 空/未知归 legacy，summary = 命令快照", async () => {
    const seedSession = (opts: { taskId?: number; kind?: string; agentId?: string; command?: string }): number =>
      Number(
        db.conn
          .prepare(
            "INSERT INTO agent_sessions (task_id, agent_id, kind, command, duration_ms, exit_code, created_at) " +
              "VALUES (?, ?, ?, ?, 1500, 0, '2026-01-01T00:00:00+00:00')",
          )
          .run(opts.taskId ?? null, opts.agentId ?? "ag-1", opts.kind ?? "classify", opts.command ?? null)
          .lastInsertRowid,
      );
    seedSession({ kind: "classify" });
    seedSession({ taskId: 9, kind: "dispatch_headless", agentId: "ag-2", command: "claude -p x" });
    seedSession({ kind: "" });
    seedSession({ kind: "mystery" });

    const snap = await okData<PanelSnapshot>("panelSnapshot");
    expect(snap.logs.map((s) => s.kind)).toEqual(["legacy", "legacy", "dispatch_headless", "classify"]);
    expect(snap.logs[2]).toMatchObject({
      taskId: 9,
      agentId: "ag-2",
      durationMs: 1500,
      exitCode: 0,
      summary: "claude -p x",
    });
    expect(snap.logs[3].summary).toBe(null);
    expect(snap.logs[3].sessionId).toBe(null);
  });
});
