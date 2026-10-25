/**
 * pet/pomoState · 番茄相位最新帧（helper pomo-state 上行 → 宿主内存 → petStatus 随行）：
 * 到期判空、RFC3339 投影、petHandlers 接线、petStatus 命令随行与 helper 未运行归 null。
 */
import { describe, expect, it } from "vitest";
import { PomoStateStore } from "../src/host/pet/pomoState";
import { petHandlers, type PluginSlots } from "../src/host/petSection";
import { HealthState } from "../src/host/health/snapshot";
import { createTestDb } from "./helpers";

describe("PomoStateStore", () => {
  it("无帧 / null 相位 / 到期相位 → null；活跃相位投影 RFC3339 + durationMin 归 null 兜底", () => {
    const store = new PomoStateStore();
    expect(store.view(1_000)).toBeNull();
    store.set({ type: "pomo-state", phase: null, taskId: 3, ts: 1 });
    expect(store.view(1_000)).toBeNull();
    store.set({ type: "pomo-state", phase: { kind: "focus", endAt: 60_000, durationMin: 25 }, taskId: 3, ts: 1 });
    expect(store.view(1_000)).toEqual({
      kind: "focus",
      endAt: new Date(60_000).toISOString(),
      durationMin: 25,
      taskId: 3,
    });
    expect(store.view(60_000)).toBeNull(); // 到期一刻即空（helper 置空消息可迟到一拍）
    store.set({ type: "pomo-state", phase: { kind: "break", endAt: 90_000 }, taskId: null, ts: 2 });
    expect(store.view(1_000)).toEqual({
      kind: "break",
      endAt: new Date(90_000).toISOString(),
      durationMin: null,
      taskId: null,
    });
    store.reset();
    expect(store.view(1_000)).toBeNull();
  });
});

describe("petHandlers · onPomoState 接线", () => {
  it("上行帧落 slots.pomo（最新帧覆盖）", () => {
    const db = createTestDb();
    const slots: PluginSlots = { feed: null, supervisor: null, pomo: new PomoStateStore() };
    const h = petHandlers({
      conn: db.conn,
      health: new HealthState(),
      log: () => undefined,
      slots,
      openPage: () => undefined,
      newExecutor: () => null,
    });
    h.onPomoState?.({ type: "pomo-state", phase: { kind: "trial", endAt: 5_000 }, taskId: "t-1", ts: 1 });
    expect(slots.pomo.view(1_000)).toMatchObject({ kind: "trial", taskId: "t-1" });
    h.onPomoState?.({ type: "pomo-state", phase: null, taskId: "t-1", ts: 2 });
    expect(slots.pomo.view(1_000)).toBeNull();
    db.close();
  });
});
