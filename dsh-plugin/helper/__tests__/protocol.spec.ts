import { describe, expect, it } from "vitest";
import { parseLine, validateDownstream, validateUpstream, type ActiveTask } from "../src/bridge/protocol.ts";

const task: ActiveTask = {
  id: 7,
  title: "写周报",
  categoryPokemon: "pikachu",
  status: "active",
};

describe("parseLine（JSON 解析层）", () => {
  it("合法 JSON 对象通过", () => {
    const r = parseLine('{"type":"heartbeat","ts":1}');
    expect(r.ok).toBe(true);
  });
  it("空行 / 非 JSON / 非对象（数组、字面量）全部拒绝且给出原因", () => {
    expect(parseLine("").ok).toBe(false);
    expect(parseLine("   ").ok).toBe(false);
    expect(parseLine("not-json{{{").reason).toBe("bad-json");
    expect(parseLine("[1,2]").reason).toBe("not-an-object");
    expect(parseLine("42").reason).toBe("not-an-object");
  });
});

describe("validateDownstream（下行全集 + 拒绝面）", () => {
  it("task-state：全集字段（含 todayTasks 可选扩展）通过", () => {
    const msg = validateDownstream({
      type: "task-state",
      activeTask: task,
      badge: { pendingSuggestions: 2, failures: 0 },
      ts: 1,
      todayTasks: [task],
    });
    expect(msg).not.toBeNull();
    expect(msg?.type).toBe("task-state");
  });
});

describe("validateDownstream · 无进行中与全集", () => {
  it("task-state：activeTask=null（无进行中）通过", () => {
    const msg = validateDownstream({
      type: "task-state",
      activeTask: null,
      badge: { pendingSuggestions: 0, failures: 0 },
      ts: 1,
    });
    expect(msg?.type).toBe("task-state");
  });

  it("task-state：缺 badge / ts 非数 / activeTask 字段不全 → 拒绝", () => {
    expect(validateDownstream({ type: "task-state", activeTask: task, ts: 1 })).toBeNull();
    expect(
      validateDownstream({
        type: "task-state",
        activeTask: task,
        badge: { pendingSuggestions: "2", failures: 0 },
        ts: 1,
      }),
    ).toBeNull();
    expect(
      validateDownstream({
        type: "task-state",
        activeTask: { id: 1 },
        badge: { pendingSuggestions: 0, failures: 0 },
        ts: 1,
      }),
    ).toBeNull();
  });

  it("pomodoro-config / lang / sprites / heartbeat 全集通过", () => {
    expect(
      validateDownstream({ type: "pomodoro-config", durations: [15, 25], breakMin: 5, lang: "en" }),
    ).not.toBeNull();
    expect(validateDownstream({ type: "lang", lang: "zh-Hant" })).not.toBeNull();
    expect(
      validateDownstream({
        type: "sprites",
        builtin: [{ key: "pikachu", id: 25, name: { hans: "a", hant: "b", en: "c" } }],
        cdnBase: "https://x/",
        reducedMotion: true,
      }),
    ).not.toBeNull();
    expect(validateDownstream({ type: "heartbeat", ts: 123 })).not.toBeNull();
  });
});

describe("validateDownstream · 拒绝面", () => {
  it("lang 非枚举 / durations 空数组 / sprites builtin 条目缺 id → 拒绝", () => {
    expect(validateDownstream({ type: "lang", lang: "ja" })).toBeNull();
    expect(validateDownstream({ type: "pomodoro-config", durations: [], breakMin: 5, lang: "en" })).toBeNull();
    expect(
      validateDownstream({
        type: "sprites",
        builtin: [{ key: "pikachu", name: { hans: "a", hant: "b", en: "c" } }],
        cdnBase: "x",
      }),
    ).toBeNull();
  });

  it("heartbeat 缺 ts → 拒绝", () => {
    expect(validateDownstream({ type: "heartbeat" })).toBeNull();
  });

  it("未知 type → 拒绝", () => {
    expect(validateDownstream({ type: "bogus" })).toBeNull();
  });
});

describe("validateUpstream（上行全集 + 拒绝面）", () => {
  it("cmd：九个 op 全部通过（含可选字段）", () => {
    for (const op of ["start", "pause", "resume", "done", "switch", "capture", "hide", "open-page", "pet-interact"]) {
      const msg = validateUpstream({ type: "cmd", op, taskId: 3, text: "hi", pos: { x: 1, y: 2 } });
      expect(msg?.type).toBe("cmd");
      expect((msg as { op: string }).op).toBe(op);
    }
  });

  it("cmd：未知 op / pos 形状错 → 拒绝", () => {
    expect(validateUpstream({ type: "cmd", op: "fly" })).toBeNull();
    expect(validateUpstream({ type: "cmd", op: "start", pos: { x: "1", y: 2 } })).toBeNull();
  });

  it("focus-settle：字段齐全通过；缺 localSessionId / 负数分钟 → 拒绝", () => {
    expect(
      validateUpstream({ type: "focus-settle", taskId: 7, localSessionId: "ls-1", elapsedMin: 12 }),
    ).not.toBeNull();
    expect(validateUpstream({ type: "focus-settle", taskId: 7, elapsedMin: 12 })).toBeNull();
    expect(validateUpstream({ type: "focus-settle", taskId: 7, localSessionId: "ls-1", elapsedMin: -1 })).toBeNull();
  });

  it("hello / crash-diag 通过；能力位非字符串数组 / 诊断条目缺字段 → 拒绝", () => {
    expect(validateUpstream({ type: "hello", version: "0.1.0", caps: ["a"] })).not.toBeNull();
    expect(
      validateUpstream({
        type: "crash-diag",
        entries: [{ ts: 1, tag: "t", detail: "d" }],
      }),
    ).not.toBeNull();
    expect(validateUpstream({ type: "hello", version: "0.1.0", caps: [1] })).toBeNull();
    expect(validateUpstream({ type: "crash-diag", entries: [{ ts: 1 }] })).toBeNull();
  });
});
