/**
 * dispatch/autoDispatch：自动派发扫描——到期入队（queue_due 过滤）/ 并发上限（槽满
 * 保持 queued）/ 不重派（queued/done/failed 不重入）/ agent 不可用撤销（重置）/
 * 开关关闭 no-op / 60s 循环（timer 注入）。对齐 auto.rs dispatch_tick。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autoDispatchTick, startAutoDispatchLoop, systemTimer } from "../src/host/dispatch/autoDispatch";
import { createFakeExecutor, type FakeExecutor } from "../src/host/dispatch/executor";
import { createTestDb, seedTask, type TestDb } from "./helpers";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let db: TestDb;
let fake: FakeExecutor;
beforeEach(() => {
  db = createTestDb();
  fake = createFakeExecutor();
  db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_agents', ?)").run(
    JSON.stringify([
      {
        id: "ag-1",
        name: "Claude",
        command: "claude",
        args: "",
        historyArgs: "",
        workdir: "",
        timeoutSecs: 120,
        enabled: true,
      },
    ]),
  );
  db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dispatch_auto_enabled', 'true')").run();
});
afterEach(() => {
  db.close();
});

const META = JSON.stringify({ agentId: "ag-1" });

function dueTask(title: string, opts: { due?: string; meta?: string | null; state?: string | null } = {}): number {
  const taskId = seedTask(db.conn, title, {
    status: "scheduled",
    dueAt: opts.due ?? "2026-01-15T07:00:00+00:00",
  });
  const tagId = Number(
    (
      db.conn
        .prepare("INSERT INTO tags (name, dimension_id, meta, created_at) VALUES (?, 1, ?, 't')")
        .run(title, opts.meta ?? META) as { lastInsertRowid: number | bigint }
    ).lastInsertRowid,
  );
  db.conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(taskId, tagId);
  if (opts.state !== undefined && opts.state !== null) {
    db.conn.prepare("UPDATE tasks SET dispatch_state=? WHERE id=?").run(opts.state, taskId);
  }
  return taskId;
}

function state(taskId: number): unknown {
  return (db.conn.prepare("SELECT dispatch_state FROM tasks WHERE id=?").get(taskId) as { dispatch_state: unknown })
    .dispatch_state;
}

const NOW = new Date("2026-01-15T09:00:00+00:00");

describe("autoDispatchTick（dispatch_tick 同构）", () => {
  it("到期入队并执行到 done；重复轮次不重复派（queued 非 NULL 不重排）", async () => {
    const taskId = dueTask("到期任务");
    const r1 = await autoDispatchTick(db.conn, { executorFor: () => fake }, NOW);
    expect(r1.autoOn).toBe(true);
    expect(r1.queued).toBe(1);
    expect(r1.dispatched).toBe(1);
    expect(state(taskId)).toBe("done");
    expect(fake.jobs).toHaveLength(1);
    // 第二轮：done 不重派、无新到期
    const r2 = await autoDispatchTick(db.conn, { executorFor: () => fake }, NOW);
    expect(r2.queued).toBe(0);
    expect(r2.dispatched).toBe(0);
    expect(fake.jobs).toHaveLength(1);
  });
});

describe("autoDispatchTick 排队语义", () => {
  it("未到期 / 无 agent 配置 / agent 不可用 的标签不排队", async () => {
    dueTask("未到期", { due: "2026-01-20T00:00:00+00:00" });
    dueTask("无agent", { meta: JSON.stringify({ workdir: "~/x" }) });
    dueTask("agent失踪", { meta: JSON.stringify({ agentId: "ag-9" }) });
    const r = await autoDispatchTick(db.conn, { executorFor: () => fake }, NOW);
    expect(r.queued).toBe(0);
    expect(fake.jobs).toHaveLength(0);
  });
});

describe("autoDispatchTick 过滤与撤销", () => {
  it("done/failed/queued 状态不自动重派（失败循环防线）", async () => {
    dueTask("已收口", { state: "done" });
    dueTask("已失败", { state: "failed" });
    const r = await autoDispatchTick(db.conn, { executorFor: () => fake }, NOW);
    expect(r.queued).toBe(0);
    expect(r.dispatched).toBe(0);
  });

  it("并发上限：槽满领不到 → 保持 queued（skipped），槽释放后下轮补派", async () => {
    const taskId = dueTask("排队任务");
    db.conn
      .prepare(
        "INSERT INTO dispatch_slots (host_key, task_id, owner, acquired_at, lease_expires_at) " +
          "VALUES ('local', 999, 'app', '2026-01-15T08:00:00+00:00', '2999-01-01T00:00:00+00:00')",
      )
      .run();
    const r1 = await autoDispatchTick(db.conn, { executorFor: () => fake }, NOW);
    expect(r1.queued).toBe(1);
    expect(r1.skipped).toBe(1);
    expect(r1.dispatched).toBe(0);
    expect(state(taskId)).toBe("queued");
    // 释放（过期回收也行：A6 崩溃自愈）→ 下轮领取执行
    db.conn.prepare("DELETE FROM dispatch_slots").run();
    const r2 = await autoDispatchTick(db.conn, { executorFor: () => fake }, NOW);
    expect(r2.dispatched).toBe(1);
    expect(state(taskId)).toBe("done");
  });
});

describe("autoDispatchTick 槽与撤销", () => {
  it("过期槽租约每轮开头回收（A6 崩溃自愈）", async () => {
    db.conn
      .prepare(
        "INSERT INTO dispatch_slots (host_key, task_id, owner, acquired_at, lease_expires_at) " +
          "VALUES ('local', 998, 'app', 't', '2000-01-01T00:00:00+00:00')",
      )
      .run();
    const r = await autoDispatchTick(db.conn, { executorFor: () => fake }, NOW);
    expect(r.reclaimed).toBe(1);
    expect(Number((db.conn.prepare("SELECT COUNT(*) AS n FROM dispatch_slots").get() as { n: number }).n)).toBe(0);
  });

  it("排队后 agent 不可用 → 撤销排队（重置，不留在 queued 卡死）", async () => {
    const taskId = dueTask("撤排队");
    // 第一轮只排队不执行：执行器挂起占住领取（用槽满路径使任务停在 queued）
    db.conn
      .prepare(
        "INSERT INTO dispatch_slots (host_key, task_id, owner, acquired_at, lease_expires_at) " +
          "VALUES ('local', 999, 'app', '2026-01-15T08:00:00+00:00', '2999-01-01T00:00:00+00:00')",
      )
      .run();
    await autoDispatchTick(db.conn, { executorFor: () => fake }, NOW);
    expect(state(taskId)).toBe("queued");
    // agent 被删除 → 下一轮撤销
    db.conn.prepare("DELETE FROM settings WHERE key='ai_agents'").run();
    const r = await autoDispatchTick(db.conn, { executorFor: () => fake }, NOW);
    expect(r.cancelled).toBe(1);
    expect(state(taskId)).toBeNull();
    const log = db.conn
      .prepare("SELECT new_value, origin FROM task_logs WHERE task_id=? AND field='dispatch_state' ORDER BY id DESC")
      .get(taskId) as { new_value: string; origin: string };
    expect(log.new_value).toBe("重置：排队后 agent 不可用，自动撤销");
    expect(log.origin).toBe("dsh:dispatch-auto");
  });

  it("开关关闭 → no-op（不动库）", async () => {
    db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dispatch_auto_enabled', 'false')").run();
    dueTask("到期任务");
    const r = await autoDispatchTick(db.conn, { executorFor: () => fake }, NOW);
    expect(r.autoOn).toBe(false);
    expect(r.queued).toBe(0);
    expect(fake.jobs).toHaveLength(0);
  });
});

describe("系统 timer（真 setInterval 路径）", () => {
  it("every/cancel：注册与停扫", async () => {
    let fired = 0;
    const handle = systemTimer.every(30, () => fired++);
    await sleep(100);
    systemTimer.cancel(handle);
    const atStop = fired;
    await sleep(80);
    expect(fired).toBe(atStop);
    expect(atStop).toBeGreaterThan(0);
  });
});

describe("扫描循环（timer 注入）", () => {
  it("60 秒注册一轮；tick 异常被吞（onError 收到）不中断；stop 取消", async () => {
    const callbacks: Array<() => void> = [];
    const timer = {
      every: (ms: number, fn: () => void) => {
        expect(ms).toBe(60_000);
        callbacks.push(fn);
        return 1;
      },
      cancel: vi.fn(),
    };
    const errors: unknown[] = [];
    const loop = startAutoDispatchLoop(db.conn, { executorFor: () => fake }, { timer, onError: (e) => errors.push(e) });
    expect(callbacks).toHaveLength(1);
    // 第一轮：到期任务被派发（回调 fire-and-forget，等微任务落定）
    dueTask("循环任务");
    callbacks[0]!();
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.jobs).toHaveLength(1);
    expect(errors).toHaveLength(0);
    // 第二轮：库故障（连接已关）→ tick 拒绝但循环不中断（onError 收到）
    const broken = createTestDb();
    broken.close();
    const loop2 = startAutoDispatchLoop(
      broken.conn,
      { executorFor: () => fake },
      { timer, onError: (e) => errors.push(e) },
    );
    callbacks[1]!();
    await new Promise((r) => setTimeout(r, 20));
    expect(errors).toHaveLength(1);
    loop.stop();
    loop2.stop();
    expect(timer.cancel).toHaveBeenCalledTimes(2);
  });
});
