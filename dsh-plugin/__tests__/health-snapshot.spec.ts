/**
 * health/snapshot：六态归并、失败累积/成功清零/300 字符截断、诊断快照字段集、四元组。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AI, diagnosticsSnapshot, FEISHU, HealthState, level, radioHealth } from "../src/host/health/snapshot";
import { createTestDb, seedAgents, seedMessage, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

describe("level 六态归并（health.rs 同构）", () => {
  it("off / paused / idle / ok / degraded / down", () => {
    expect(level(false, false, false, 0)).toBe("off");
    expect(level(true, false, false, 0)).toBe("paused");
    expect(level(true, true, false, 0)).toBe("idle");
    expect(level(true, true, true, 0)).toBe("ok");
    expect(level(true, true, true, 1)).toBe("degraded");
    expect(level(true, true, true, 2)).toBe("degraded");
    expect(level(true, true, true, 3)).toBe("down");
  });
});

describe("HealthState 记录语义", () => {
  it("失败累积、成功清零；历史错误保留供回看；错误截断 300 字符", () => {
    const state = new HealthState();
    for (let i = 0; i < 3; i++) {
      state.recordFailure(FEISHU, `第${i}次失败`, `2026-10-11T00:00:0${i}+00:00`);
    }
    const h = state.snapshot(FEISHU);
    expect(h.consecutiveFailures).toBe(3);
    expect(h.lastError).toBe("第2次失败");
    expect(h.lastErrorAt).toBe("2026-10-11T00:00:02+00:00");
    expect(h.lastSuccessAt).toBeNull();
    state.recordSuccess(FEISHU, "2026-10-11T00:01:00+00:00");
    const after = state.snapshot(FEISHU);
    expect(after.consecutiveFailures).toBe(0);
    expect(after.lastError).toBe("第2次失败");
    expect(after.lastSuccessAt).toBe("2026-10-11T00:01:00+00:00");
    state.recordFailure(AI, "痛".repeat(1000));
    expect(Array.from(state.snapshot(AI).lastError ?? "").length).toBe(300);
  });

  it("nextRunAt 仅登记；未记录的 provider 快照安全退化为默认值", () => {
    const state = new HealthState();
    state.setNextRun(FEISHU, 1_789_000_000_000);
    expect(state.snapshot(FEISHU).nextRunAt).toBe(1_789_000_000_000);
    expect(state.snapshot(AI)).toEqual({
      lastSuccessAt: null,
      lastError: null,
      lastErrorAt: null,
      consecutiveFailures: 0,
      nextRunAt: null,
    });
  });
});

describe("diagnosticsSnapshot（两链路完整字段）", () => {
  it("未配置时 off；配置后按运行记录归并；积压只计 todo/update", () => {
    const state = new HealthState();
    let infos = diagnosticsSnapshot(db.conn, state, { feishuConfigured: false });
    expect(infos.map((h) => h.status)).toEqual(["off", "off"]);
    seedAgents(db.conn, [{ id: "a1", command: "claude" }]);
    db.conn.prepare("INSERT INTO settings (key, value) VALUES ('feishu_enabled', 'true')").run();
    state.recordFailure(FEISHU, "boom", "2026-10-11T00:00:00+00:00");
    state.recordSuccess(AI, "2026-10-11T00:00:01+00:00");
    infos = diagnosticsSnapshot(db.conn, state, { feishuConfigured: true });
    const feishu = infos.find((h) => h.provider === FEISHU);
    const ai = infos.find((h) => h.provider === AI);
    expect(feishu?.status).toBe("degraded");
    expect(feishu?.lastError).toBe("boom");
    expect(feishu?.enabled).toBe(true);
    expect(ai?.status).toBe("ok");
    expect(ai?.primaryAgent).toBe("a1");
    // 积压：只有 review_status=pending 且 ai_status ∈ {todo,update} 计入
    seedMessage(db.conn, "om_1", { aiStatus: "todo", reviewStatus: "pending" });
    seedMessage(db.conn, "om_2", { aiStatus: "none", reviewStatus: "pending" });
    seedMessage(db.conn, "om_3", { aiStatus: "todo", reviewStatus: "accepted" });
    seedMessage(db.conn, "om_4", { aiStatus: "update", reviewStatus: "pending" });
    expect(
      diagnosticsSnapshot(db.conn, state, { feishuConfigured: true }).find((h) => h.provider === FEISHU)?.pendingCount,
    ).toBe(2);
  });

  it("radioHealth 四元组（上次成功/下次轮询/连续失败/待处理积压）", () => {
    const state = new HealthState();
    state.recordSuccess(FEISHU, "2026-10-11T00:00:00+00:00");
    state.setNextRun(FEISHU, 1_789_000_120_000);
    seedMessage(db.conn, "om_1", { aiStatus: "todo", reviewStatus: "pending" });
    expect(radioHealth(db.conn, state)).toEqual({
      lastSuccessAt: "2026-10-11T00:00:00+00:00",
      nextPollAt: 1_789_000_120_000,
      consecutiveFailures: 0,
      pendingCount: 1,
    });
  });
});
