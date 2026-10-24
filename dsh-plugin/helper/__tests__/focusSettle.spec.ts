import { describe, expect, it } from "vitest";
import { FocusAccumulator } from "../src/state/focusSettle.ts";
import type { ActiveTask } from "../src/bridge/protocol.ts";

const task = (id: number, status: string): ActiveTask => ({
  id,
  title: `t${id}`,
  categoryPokemon: "pikachu",
  status,
});

/** 虚拟时钟 */
function makeClock() {
  let t = 0;
  let n = 0;
  return {
    now: () => t,
    uuid: () => `ls-${++n}`,
    advance: (ms: number) => (t += ms),
  };
}

describe("focus-settle 纯逻辑（D16：离开进行中时整分钟入账，短休息取消）", () => {
  it("任务完成/离开：active 段时长向下取整分钟上报；不足 1 分钟为 null", () => {
    const clock = makeClock();
    const acc = new FocusAccumulator(clock);
    // 61 秒 active 后离开 → 1 分钟
    let r = acc.onTaskState(null, task(1, "active"));
    clock.advance(61_000);
    r = acc.onTaskState(task(1, "active"), null);
    expect(r.settle).toEqual({ taskId: 1, localSessionId: "ls-1", elapsedMin: 1 });
    // 59 秒 → 不足 1 分钟，不上报
    acc.onTaskState(null, task(2, "active"));
    clock.advance(59_000);
    r = acc.onTaskState(task(2, "active"), null);
    expect(r.settle).toBeNull();
  });
});

describe("focus-settle · 挂起/切任务/收口", () => {
  it("paused 挂起不累计：active→paused→active 只有 active 段计入", () => {
    const clock = makeClock();
    const acc = new FocusAccumulator(clock);
    acc.onTaskState(null, task(3, "active"));
    clock.advance(60_000);
    acc.onTaskState(task(3, "active"), task(3, "paused")); // 挂起
    clock.advance(60_000); // 暂停中的 60s 不计
    acc.onTaskState(task(3, "paused"), task(3, "active")); // 恢复
    clock.advance(60_000);
    const r = acc.onTaskState(task(3, "active"), null);
    expect(r.settle).toMatchObject({ taskId: 3, elapsedMin: 2 });
  });

  it("切任务：旧会话结账 + 新会话新 localSessionId（幂等键各不相同）", () => {
    const clock = makeClock();
    const acc = new FocusAccumulator(clock);
    acc.onTaskState(null, task(4, "active"));
    clock.advance(120_000);
    const r = acc.onTaskState(task(4, "active"), task(5, "active"));
    expect(r.settle).toMatchObject({ taskId: 4, elapsedMin: 2 });
    expect(r.session).toMatchObject({ taskId: 5, localSessionId: "ls-2" });
  });

  it("同任务驻留（paused↔active 切换）不结账、会话延续", () => {
    const clock = makeClock();
    const acc = new FocusAccumulator(clock);
    acc.onTaskState(null, task(6, "active"));
    clock.advance(30_000);
    let r = acc.onTaskState(task(6, "active"), task(6, "paused"));
    expect(r.settle).toBeNull();
    expect(r.session).toMatchObject({ taskId: 6, localSessionId: "ls-1" });
    clock.advance(30_000);
    r = acc.onTaskState(task(6, "paused"), task(6, "active"));
    expect(r.settle).toBeNull();
    expect(r.session?.focusMs).toBe(30_000);
  });

  it("settleNow 主动收口：结账后会话清空（重复调用幂等）", () => {
    const clock = makeClock();
    const acc = new FocusAccumulator(clock);
    acc.onTaskState(null, task(7, "active"));
    clock.advance(90_000);
    expect(acc.settleNow()).toMatchObject({ taskId: 7, elapsedMin: 1 });
    expect(acc.settleNow()).toBeNull();
  });
});
