/**
 * domain/dispatch：五态机迁移矩阵、claim CAS、CAS 失配仲裁（幂等/第三态）、
 * 槽表（acquire/release/reclaimExpired/hostKey 归一）、queue_due 过滤、双连接并发。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  casDispatchState,
  claimDispatch,
  dispatchTransition,
  DS_DONE,
  DS_FAILED,
  DS_QUEUED,
  DS_RUNNING,
  markDispatchIdle,
  parseTagMeta,
  parseTime,
  pickQueued,
  queueDueTasks,
  transitionAllowed,
  transitionOrAlready,
} from "../src/host/domain/dispatch";
import {
  acquireSlot,
  dispatchHostKey,
  reclaimExpiredSlots,
  releaseSlot,
  slotLeaseSecs,
} from "../src/host/domain/dispatch-slots";
import { createTestDb, scalar, seedAgents, seedTask, type TestDb } from "./helpers";

let db: TestDb;
const PAST = "2026-01-15T07:00:00+00:00";
const NOW = new Date("2026-01-15T09:00:00+00:00");
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

function seedQueued(due: string, meta: string | null, title = "任务"): number {
  const id = seedTask(db.conn, title, { status: "scheduled", dueAt: due });
  const tagId = (
    db.conn
      .prepare("INSERT INTO tags (name, dimension_id, meta, created_at) VALUES (?, 1, ?, 't')")
      .run(title, meta) as { lastInsertRowid: number | bigint }
  ).lastInsertRowid;
  db.conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(id, Number(tagId));
  return id;
}

describe("transition_allowed 矩阵（state.rs 逐字对齐）", () => {
  it("全部合法迁移与非法拒绝", () => {
    // NULL → running / queued
    expect(transitionAllowed(null, DS_RUNNING)).toBe(true);
    expect(transitionAllowed(null, DS_QUEUED)).toBe(true);
    expect(transitionAllowed(null, DS_DONE)).toBe(false);
    // queued → running / 重置
    expect(transitionAllowed(DS_QUEUED, DS_RUNNING)).toBe(true);
    expect(transitionAllowed(DS_QUEUED, null)).toBe(true);
    expect(transitionAllowed(DS_QUEUED, DS_DONE)).toBe(false);
    // running → done / failed / 重置
    expect(transitionAllowed(DS_RUNNING, DS_DONE)).toBe(true);
    expect(transitionAllowed(DS_RUNNING, DS_FAILED)).toBe(true);
    expect(transitionAllowed(DS_RUNNING, null)).toBe(true);
    expect(transitionAllowed(DS_RUNNING, DS_QUEUED)).toBe(false);
    // done/failed → running（重派/重试）
    expect(transitionAllowed(DS_DONE, DS_RUNNING)).toBe(true);
    expect(transitionAllowed(DS_FAILED, DS_RUNNING)).toBe(true);
    expect(transitionAllowed(DS_DONE, DS_DONE)).toBe(false);
    // 未知状态拒绝一切
    expect(transitionAllowed("weird", DS_RUNNING)).toBe(false);
  });
});

describe("claim_dispatch（OR 守卫式抢占）", () => {
  it("NULL 口径抢到；running 重复抢失败；不允许 NULL 的口径抢不到 NULL 行", () => {
    const id = seedTask(db.conn, "t");
    expect(claimDispatch(db.conn, id, { allowNull: true, states: [DS_DONE, DS_FAILED, DS_QUEUED] })).toBe(true);
    expect(claimDispatch(db.conn, id, { allowNull: true, states: [DS_DONE, DS_FAILED, DS_QUEUED] })).toBe(false);
    db.conn.prepare("UPDATE tasks SET dispatch_state=NULL").run();
    expect(claimDispatch(db.conn, id, { allowNull: false, states: [DS_QUEUED] })).toBe(false);
    db.conn.prepare("UPDATE tasks SET dispatch_state='queued'").run();
    expect(claimDispatch(db.conn, id, { allowNull: false, states: [DS_QUEUED] })).toBe(true);
  });
});

describe("CAS 迁移与审计", () => {
  it("NULL → done 非法拒绝；running → done 带备注并入审计 new_value", () => {
    const id = seedTask(db.conn, "t");
    expect(() => dispatchTransition(db.conn, id, DS_DONE, null)).toThrowError(/不能迁移到/);
    db.conn.prepare("UPDATE tasks SET dispatch_state='running'").run();
    dispatchTransition(db.conn, id, DS_DONE, "修复完成，含回归", "dsh");
    expect(scalar(db.conn, "SELECT dispatch_state FROM tasks WHERE id=?", id)).toBe("done");
    const log = db.conn
      .prepare("SELECT new_value, old_value, origin FROM task_logs WHERE task_id=? AND field='dispatch_state'")
      .all(id) as Array<{ new_value: string; old_value: string; origin: string }>;
    expect(log[0].new_value).toBe("done：修复完成，含回归");
    expect(log[0].old_value).toBe("running");
    expect(log[0].origin).toBe("dsh");
  });

  it("重置（to=null）：new_value = 重置 / 重置：备注", () => {
    const id = seedTask(db.conn, "t");
    db.conn.prepare("UPDATE tasks SET dispatch_state='running'").run();
    dispatchTransition(db.conn, id, null, "卡死救援", "dsh");
    expect(scalar(db.conn, "SELECT dispatch_state FROM tasks WHERE id=?", id)).toBeNull();
    const log = db.conn
      .prepare("SELECT new_value FROM task_logs WHERE task_id=? AND field='dispatch_state'")
      .get(id) as { new_value: string };
    expect(log.new_value).toBe("重置：卡死救援");
  });

  it("并发失配·目标态已达成 → 幂等成功（不写审计）；第三态 → 重读值入文案报错", () => {
    const id = seedTask(db.conn, "t");
    expect(casDispatchState(db.conn, id, null, DS_RUNNING)).toBe(true);
    // 行被并发翻到 done，迟到方仍按 running→done CAS → 幂等成功
    db.conn.prepare("UPDATE tasks SET dispatch_state='done'").run();
    expect(casDispatchState(db.conn, id, DS_RUNNING, DS_DONE)).toBe(false);
    expect(scalar(db.conn, "SELECT COUNT(*) FROM task_logs WHERE field='dispatch_state'")).toBe(0);
    // 行被并发重置回 NULL → 第三态报错（重读值「未派发」入文案）
    db.conn.prepare("UPDATE tasks SET dispatch_state=NULL").run();
    expect(() => casDispatchState(db.conn, id, DS_RUNNING, DS_DONE)).toThrowError(/未派发/);
    // 双重重置并发：第二个 CAS 落空，重读已是 NULL → 幂等成功
    db.conn.prepare("UPDATE tasks SET dispatch_state='running'").run();
    expect(casDispatchState(db.conn, id, DS_RUNNING, null)).toBe(true);
    expect(casDispatchState(db.conn, id, DS_RUNNING, null)).toBe(false);
  });
});

describe("CAS 迁移与审计·下", () => {
  it("transitionOrAlready：目标态已达成直接成功；否则走状态机", () => {
    const id = seedTask(db.conn, "t");
    db.conn.prepare("UPDATE tasks SET dispatch_state='done'").run();
    expect(() => transitionOrAlready(db.conn, id, DS_DONE)).not.toThrow();
    db.conn.prepare("UPDATE tasks SET dispatch_state='running'").run();
    transitionOrAlready(db.conn, id, DS_DONE);
    expect(scalar(db.conn, "SELECT dispatch_state FROM tasks WHERE id=?", id)).toBe("done");
  });

  it("markDispatchIdle：done 状态也能直接重置（救援语义）；不存在 NOT_FOUND", () => {
    const id = seedTask(db.conn, "t");
    db.conn.prepare("UPDATE tasks SET dispatch_state='done'").run();
    markDispatchIdle(db.conn, id);
    expect(scalar(db.conn, "SELECT dispatch_state FROM tasks WHERE id=?", id)).toBeNull();
    expect(() => markDispatchIdle(db.conn, 999)).toThrowError(/不存在/);
  });

  it("不存在的任务 NOT_FOUND", () => {
    expect(() => dispatchTransition(db.conn, 99, DS_DONE, null)).toThrowError(/不存在/);
  });
});

describe("机器级并发槽表", () => {
  it("host_key 归一：本机 local / 远程 ssh:user@host / 空白 host 视同本机", () => {
    expect(dispatchHostKey(null)).toBe("local");
    expect(dispatchHostKey(undefined)).toBe("local");
    expect(dispatchHostKey({ host: "  " })).toBe("local");
    expect(dispatchHostKey({ host: " user@host:2222 " })).toBe("ssh:user@host:2222");
  });

  it("租约时长 = 无头超时（600 下限）+ 5 分钟余量", () => {
    expect(slotLeaseSecs(60)).toBe(600 + 300);
    expect(slotLeaseSecs(1200)).toBe(1200 + 300);
  });

  it("acquire 上限闸门：满槽拒绝；release 后额度复用", () => {
    const a = seedTask(db.conn, "A");
    const b = seedTask(db.conn, "B");
    db.conn.prepare("UPDATE tasks SET dispatch_state='queued'").run();
    expect(acquireSlot(db.conn, { taskId: a, hostKey: "local", maxConcurrent: 1, leaseSecs: 900 })).toBe(true);
    expect(acquireSlot(db.conn, { taskId: b, hostKey: "local", maxConcurrent: 1, leaseSecs: 900 })).toBe(false);
    // 不同机器的槽互不影响（跨形态合计按 host_key 分桶）
    expect(acquireSlot(db.conn, { taskId: b, hostKey: "ssh:u@h", maxConcurrent: 1, leaseSecs: 900 })).toBe(true);
    releaseSlot(db.conn, "local", a);
    db.conn.prepare("UPDATE tasks SET dispatch_state='queued' WHERE id=?").run(b);
    expect(acquireSlot(db.conn, { taskId: b, hostKey: "local", maxConcurrent: 1, leaseSecs: 900 })).toBe(true);
    expect(scalar(db.conn, "SELECT dispatch_state FROM tasks WHERE id=?", b)).toBe("running");
  });

  it("acquire 内含 claim：任务不在 queued 态领不到（不占槽）", () => {
    const a = seedTask(db.conn, "A"); // dispatch_state NULL
    expect(acquireSlot(db.conn, { taskId: a, hostKey: "local", maxConcurrent: 1, leaseSecs: 900 })).toBe(false);
    expect(scalar(db.conn, "SELECT COUNT(*) FROM dispatch_slots")).toBe(0);
  });
});

describe("机器级并发槽表·下", () => {
  it("reclaimExpired：过期租约被扫掉（崩溃自愈），新鲜租约保留", () => {
    db.conn
      .prepare(
        "INSERT INTO dispatch_slots (host_key, task_id, owner, acquired_at, lease_expires_at) VALUES ('local', 1, 'dsh', 't', ?)",
      )
      .run("2000-01-01T00:00:00+00:00");
    expect(reclaimExpiredSlots(db.conn)).toBe(1);
    db.conn
      .prepare(
        "INSERT INTO dispatch_slots (host_key, task_id, owner, acquired_at, lease_expires_at) VALUES ('local', 2, 'dsh', 't', ?)",
      )
      .run("2999-01-01T00:00:00+00:00");
    expect(reclaimExpiredSlots(db.conn)).toBe(0);
    expect(scalar(db.conn, "SELECT COUNT(*) FROM dispatch_slots")).toBe(1);
  });

  it("双连接并发占槽：max=1 时第二条落空（COUNT+INSERT 同事务原子）", () => {
    const conn2 = db.secondConn();
    const a = seedTask(db.conn, "A");
    const b = seedTask(db.conn, "B");
    for (const t of [a, b]) {
      db.conn.prepare("UPDATE tasks SET dispatch_state='queued' WHERE id=?").run(t);
    }
    const got1 = acquireSlot(db.conn, { taskId: a, hostKey: "local", maxConcurrent: 1, leaseSecs: 900 });
    const got2 = acquireSlot(conn2, { taskId: b, hostKey: "local", maxConcurrent: 1, leaseSecs: 900 });
    expect(got1).toBe(true);
    expect(got2).toBe(false);
    expect(scalar(db.conn, "SELECT COUNT(*) FROM dispatch_slots WHERE host_key='local'")).toBe(1);
  });
});

describe("queue_due（到期排队，auto.rs 同构）", () => {
  it("到期 + meta 指定可用 agent → 排队；重复轮次不重复排", () => {
    seedAgents(db.conn, [{ id: "ag-1" }]);
    seedQueued(PAST, '{"agentId":"ag-1","workdir":"~/app"}', "到期该排");
    expect(queueDueTasks(db.conn, { now: NOW })).toBe(1);
    expect(scalar(db.conn, "SELECT dispatch_state FROM tasks WHERE title='到期该排'")).toBe(DS_QUEUED);
    expect(queueDueTasks(db.conn, { now: NOW })).toBe(0);
    expect(pickQueued(db.conn)).toEqual([{ taskId: 1, agentId: "ag-1" }]);
  });

  it("done/failed 不重入（只动 NULL 行）", () => {
    seedAgents(db.conn, [{ id: "ag-1" }]);
    seedQueued(PAST, '{"agentId":"ag-1"}', "已完成");
    db.conn.prepare("UPDATE tasks SET dispatch_state='done'").run();
    expect(queueDueTasks(db.conn, { now: NOW })).toBe(0);
  });
});

describe("queue_due（到期排队，auto.rs 同构）·下", () => {
  it("meta 无 agentId / agent 不可用 / 未到期 / 无截止 全部不排", () => {
    seedAgents(db.conn, [{ id: "ag-1" }]);
    seedQueued(PAST, '{"workdir":"~/x"}', "无 agent 配置");
    seedQueued(PAST, '{"agentId":"ag-9"}', "agent 不可用");
    seedQueued("2026-06-01T00:00:00+00:00", '{"agentId":"ag-1"}', "未到期");
    const noDue = seedTask(db.conn, "无截止", { status: "inbox" });
    const tagId = (
      db.conn
        .prepare("INSERT INTO tags (name, dimension_id, meta, created_at) VALUES ('p2', 1, ?, 't')")
        .run('{"agentId":"ag-1"}') as { lastInsertRowid: number | bigint }
    ).lastInsertRowid;
    db.conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(noDue, Number(tagId));
    // 非 project 维度标签的 meta 不算
    const other = seedTask(db.conn, "非项目标签", { status: "inbox", dueAt: PAST });
    const topicTag = (
      db.conn
        .prepare("INSERT INTO tags (name, dimension_id, meta, created_at) VALUES ('话题', 4, ?, 't')")
        .run('{"agentId":"ag-1"}') as { lastInsertRowid: number | bigint }
    ).lastInsertRowid;
    db.conn.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(other, Number(topicTag));
    // 缺省 agentAvailable 从 ai_agents 设置解析：ag-1 已 seed 但上述行各自被前置条件拦下
    expect(queueDueTasks(db.conn, { now: NOW })).toBe(0);
  });

  it("agentAvailable 回调：停用 agent 不排（dsh 侧可用性注入）", () => {
    seedQueued(PAST, '{"agentId":"ag-x"}', "agent 停用");
    expect(
      queueDueTasks(db.conn, { now: NOW, agentAvailable: (id) => ({ enabled: id === "ag-x" ? false : true }) }),
    ).toBe(0);
  });
});

describe("工具函数", () => {
  it("parseTime：RFC3339 带时区 / 本地无时区 / 非法串", () => {
    expect(parseTime("2026-01-15T09:00:00+08:00")?.toISOString()).toBe("2026-01-15T01:00:00.000Z");
    expect(parseTime("2026-01-15T09:00")?.getTime()).not.toBeNaN();
    expect(parseTime("garbage")).toBeNull();
  });

  it("parseTagMeta：空/坏数据按无元数据处理", () => {
    expect(parseTagMeta(null)).toBeNull();
    expect(parseTagMeta("  ")).toBeNull();
    expect(parseTagMeta("{bad json")).toBeNull();
    expect(parseTagMeta('{"agentId":"a"}')).toEqual({ agentId: "a" });
  });
});
