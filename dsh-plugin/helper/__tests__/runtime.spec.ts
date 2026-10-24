import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { createHelperRuntime, type UiEvent } from "../src/runtime/index.ts";

/**
 * runtime 装配测试（进程内 PassThrough 双工，虚拟时钟注入）：
 * 桥 → 状态机 → focus-settle 上报的完整接线（真 stdio 子进程链路见 runtime.headless.spec.ts）。
 */
function makeHarness() {
  const input = new PassThrough();
  const output = new PassThrough();
  let t = 1_000_000;
  let n = 0;
  const outLines: string[] = [];
  let buf = "";
  const events: UiEvent[] = [];
  output.setEncoding("utf8");
  output.on("data", (c: string) => {
    buf += c;
    for (;;) {
      const i = buf.indexOf("\n");
      if (i < 0) break;
      const l = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (l.trim()) outLines.push(l);
    }
  });
  const runtime = createHelperRuntime({
    input,
    output,
    now: () => t,
    uuid: () => `ls-${++n}`,
    onUiEvent: (ev) => events.push(ev),
  });
  return {
    runtime,
    events,
    outLines,
    input,
    write: (obj: object) => input.write(`${JSON.stringify(obj)}\n`),
    advance: (ms: number) => (t += ms),
    parsed: () => outLines.map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

const activeTask = (id: number) => ({
  id,
  title: `任务${id}`,
  categoryPokemon: "pikachu",
  status: "active",
});
const taskState = (task: object | null) => ({
  type: "task-state",
  activeTask: task,
  badge: { pendingSuggestions: 0, failures: 0 },
  ts: 0,
});

describe("createHelperRuntime 装配", () => {
  it("启动即 hello（版本+能力位）", () => {
    const h = makeHarness();
    const hello = h.parsed().find((m) => m.type === "hello");
    expect(hello).toMatchObject({ version: "0.1.0" });
    expect(hello!.caps).toEqual(expect.arrayContaining(["task-state", "pomodoro-local", "focus-settle"]));
    h.runtime.dispose();
  });

  it("task-state 驱动：working 底态 + 出发台词双气泡时序（就决定是你了 → {p}正在捕捉：{t}）", async () => {
    const h = makeHarness();
    h.write(taskState(activeTask(9)));
    expect(h.events.find((e) => e.kind === "pet-state")?.state.base).toBe("working");
    const bubbles = h.events.filter((e) => e.kind === "bubble");
    expect(bubbles[0]).toMatchObject({ text: "就决定是你了！", tone: "event" });
    // 第二条 900ms 后到（真实 setTimeout）
    await new Promise((r) => setTimeout(r, 1_100));
    const after = h.events.filter((e) => e.kind === "bubble");
    expect(after[1]).toMatchObject({ text: "皮卡丘正在捕捉：任务9" });
    h.runtime.dispose();
  });

  it("focus-settle 接线：61 秒专注后任务离开 → 整分钟上报（虚拟时钟推进）", () => {
    const h = makeHarness();
    h.write(taskState(activeTask(9)));
    h.advance(61_000);
    h.write(taskState(null));
    const settle = h.parsed().find((m) => m.type === "focus-settle");
    expect(settle).toMatchObject({ taskId: 9, elapsedMin: 1 });
    expect(typeof settle!.localSessionId).toBe("string");
    h.runtime.dispose();
  });
});

describe("createHelperRuntime · 番茄上行", () => {
  it("pomo-state 上行：hello 后首发 null 相位；专注/休息迁移即发（带 activeTask 归属）；到期置空再发", async () => {
    const h = makeHarness();
    const states = () => h.parsed().filter((m) => m.type === "pomo-state");
    expect(states()).toHaveLength(1);
    expect(states()[0]).toMatchObject({ phase: null, taskId: null, ts: 1_000_000 });
    h.write(taskState(activeTask(9)));
    h.runtime.pomo.beginFocus(25);
    expect(states().at(-1)).toMatchObject({
      taskId: 9,
      phase: { kind: "focus", durationMin: 25, endAt: 1_000_000 + 25 * 60_000 },
    });
    h.runtime.pomo.beginBreak();
    expect(states().at(-1)!.phase).toMatchObject({ kind: "break", endAt: 1_000_000 + 5 * 60_000 });
    // 到期由 ticker 真 1s tick 判定（虚拟时钟越过 endAt 后等一拍）
    h.advance(10 * 60_000);
    await new Promise((r) => setTimeout(r, 1_100));
    expect(states().at(-1)).toMatchObject({ phase: null, taskId: 9 });
    h.runtime.dispose();
  });
});

describe("createHelperRuntime · 上行与存亡", () => {
  it("sendCmd / completeTask 上行接线（cmd done + celebrating；仪式等 host 收官单推）", () => {
    const h = makeHarness();
    h.write(taskState(activeTask(4)));
    h.runtime.completeTask();
    const ops = h
      .parsed()
      .filter((m) => m.type === "cmd")
      .map((m) => m.op);
    expect(ops).toContain("done");
    expect(h.runtime.petState.transient).toBe("celebrating");
    expect(h.events.filter((e) => e.kind === "bubble" && e.text.includes("捕捉成功"))).toHaveLength(0);
    // host 收官单推 → 捕捉成功台词 + plain 演出
    h.write(taskState(null));
    expect(h.events.find((e) => e.kind === "bubble" && e.text.includes("捕捉成功"))).toBeTruthy();
    expect(h.events.find((e) => e.kind === "catch-scene")).toMatchObject({ scene: "plain" });
    // 未知 op 拒发（校验在 runtime.sendCmd）
    expect(h.runtime.sendCmd("fly" as never)).toBe(false);
    h.runtime.dispose();
  });

  it("外部收尾（跨形态打断 D16）→ 一次性中性气泡", () => {
    const h = makeHarness();
    h.write(taskState(activeTask(5)));
    h.write(taskState(null));
    const bubbles = h.events.filter((e) => e.kind === "bubble");
    expect(bubbles.some((b) => b.kind === "bubble" && b.text.includes("已在别处收工"))).toBe(true);
    h.runtime.dispose();
  });

  it("宿主死亡：stdin end → quit UiEvent（headless main 据此 process.exit）", async () => {
    const h = makeHarness();
    h.input.end();
    // 'end' 异步送达（PassThrough flush）
    await new Promise((r) => setTimeout(r, 50));
    expect(h.events.find((e) => e.kind === "quit")).toMatchObject({ reason: "stdin-end" });
    h.runtime.dispose();
  });
});
