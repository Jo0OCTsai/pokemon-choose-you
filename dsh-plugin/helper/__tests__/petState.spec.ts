import { describe, expect, it } from "vitest";
import { PET_IDLE_STATE, baseFromTask, reduce, shouldSleep, type PetState } from "../src/state/petState.ts";
import type { ActiveTask } from "../src/bridge/protocol.ts";

const task = (status: string, id = 7): ActiveTask => ({
  id,
  title: "写周报",
  categoryPokemon: "pikachu",
  status,
});

describe("petState 状态机（UIUX §3.4 矩阵）", () => {
  it("task-state 驱动底态：null → idle；active → working；paused → paused；其他状态 → idle", () => {
    expect(baseFromTask(null)).toBe("idle");
    expect(baseFromTask(task("active"))).toBe("working");
    expect(baseFromTask(task("paused"))).toBe("paused");
    expect(baseFromTask(task("done"))).toBe("idle");
    expect(baseFromTask(task("inbox"))).toBe("idle");
  });

  it("task-state 事件切换 idle/working/paused（渲染层状态转移表主路径）", () => {
    let s: PetState = PET_IDLE_STATE;
    s = reduce(s, { kind: "task-state", task: task("active") });
    expect(s).toEqual({ base: "working", transient: null, asleep: false });
    s = reduce(s, { kind: "task-state", task: task("paused") });
    expect(s.base).toBe("paused");
    s = reduce(s, { kind: "task-state", task: null });
    expect(s.base).toBe("idle");
  });

  it("celebrating 一次性：task-done 进入，celebrate-end 回落底态且不重复", () => {
    let s: PetState = reduce(PET_IDLE_STATE, { kind: "task-state", task: task("active") });
    s = reduce(s, { kind: "task-done" });
    expect(s.transient).toBe("celebrating");
    s = reduce(s, { kind: "celebrate-end" });
    expect(s.transient).toBeNull();
    expect(s.base).toBe("working");
    // 再来一次 celebrate-end 幂等
    expect(reduce(s, { kind: "celebrate-end" })).toEqual(s);
  });

  it("新任务出发清演出态并唤醒（就决定是你了由气泡层接棒）", () => {
    let s: PetState = { base: "idle", transient: "celebrating", asleep: false };
    s = reduce(s, { kind: "task-state", task: task("active", 8) });
    expect(s).toEqual({ base: "working", transient: null, asleep: false });
  });
});

describe("petState · 瞬态与睡醒", () => {
  it("petting：celebrating 期间拒绝；dragging 优先；pet-end 回落", () => {
    let s: PetState = { base: "idle", transient: "celebrating", asleep: false };
    expect(reduce(s, { kind: "pet-start" }).transient).toBe("celebrating");
    s = { base: "idle", transient: null, asleep: false };
    s = reduce(s, { kind: "pet-start" });
    expect(s.transient).toBe("petting");
    s = reduce(s, { kind: "drag-start" });
    expect(s.transient).toBe("dragging");
    s = reduce(s, { kind: "pet-end" });
    expect(s.transient).toBe("dragging");
    s = reduce(s, { kind: "drag-end" });
    expect(s.transient).toBeNull();
  });

  it("rest：break-start 进入 / break-end 回落；celebrating/dragging 期间不进", () => {
    let s: PetState = { base: "working", transient: null, asleep: false };
    s = reduce(s, { kind: "break-start" });
    expect(s.transient).toBe("rest");
    s = reduce(s, { kind: "break-end" });
    expect(s.transient).toBeNull();
    expect(reduce({ ...s, transient: "celebrating" }, { kind: "break-start" }).transient).toBe("celebrating");
  });

  it("asleep：idle + 5min 无交互入睡；任意交互（interact/task-state 带 task）醒来", () => {
    const now = 10 * 60_000;
    expect(shouldSleep(PET_IDLE_STATE, 0, now)).toBe(true);
    expect(shouldSleep(PET_IDLE_STATE, now - 4 * 60_000, now)).toBe(false);
    // working 不睡
    expect(shouldSleep({ base: "working", transient: null, asleep: false }, 0, now)).toBe(false);
    let s: PetState = { ...PET_IDLE_STATE, asleep: true };
    s = reduce(s, { kind: "interact" });
    expect(s.asleep).toBe(false);
    s = { ...PET_IDLE_STATE, asleep: true };
    s = reduce(s, { kind: "task-state", task: task("active") });
    expect(s.asleep).toBe(false);
    // 无任务时保持睡态
    s = reduce(s, { kind: "task-state", task: null });
    expect(s.asleep).toBe(false); // 已醒不来回抖动（幂等）
  });
});
