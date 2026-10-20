/**
 * judge/orchestrator · 失败路径的会话回链 + 30s 迟到判定回看（judge.rs
 * spawn_late_judgment_recheck / LATE_JUDGMENT_GRACE_SECS 同构）：
 * - 失败账本行 session_id 取执行方挂在错误上的会话 id（不再硬编码 null）
 * - selfLanding 失败挽救标 error 的行，30s 后回查：孤儿 pk suggest 翻正 → onWrites 一次；
 *   未翻正不通知；无 onWrites 不调度；非 selfLanding 失败不调度；连接已关不炸
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { orchestrateBatch, type OrchestrateDeps } from "../src/host/judge/orchestrator";
import { LATE_JUDGMENT_GRACE_MS } from "../src/host/judge/lateRecheck";
import { fakeSubagentExecutor, withSessionId, type JudgeExecutor } from "../src/host/judge/adapters";
import { createTestDb, scalar, seedMessage, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
  seedMessage(db.conn, "om_1", {});
  seedMessage(db.conn, "om_2", {});
});
afterEach(() => {
  db.close();
});

/** selfLanding 执行方：恒失败（错误携带会话 id）——pk suggest 由「孤儿」在回看前落库 */
function failingCli(sessionId: string | null): JudgeExecutor {
  return {
    id: "cli",
    name: "CLI",
    selfLanding: true,
    run: async () => {
      throw withSessionId(new Error("agent 超时被杀"), sessionId);
    },
  };
}

/** 调度 fake：捕获回看闭包与延迟，由用例手动触发 */
interface Scheduler {
  schedule(fn: () => void, delayMs: number): void;
  fire(): void;
  delays: number[];
  count(): number;
}

function capturedScheduler(): Scheduler {
  const fns: Array<() => void> = [];
  const delays: number[] = [];
  return {
    delays,
    schedule: (fn, delayMs) => {
      fns.push(fn);
      delays.push(delayMs);
    },
    count: () => fns.length,
    fire: () => {
      for (const fn of fns.splice(0)) fn();
    },
  };
}

function statusOf(mid: string): string {
  return String(scalar(db.conn, "SELECT ai_status FROM chat_messages WHERE message_id=?", mid));
}

/** 回看用例的编排依赖：恒失败 selfLanding 执行方 + 记录 onWrites + 注入调度 */
function depsOf(sched: Scheduler, writes: number[]): OrchestrateDeps {
  return {
    conn: db.conn,
    executor: failingCli("s"),
    onWrites: () => writes.push(1),
    scheduleLateRecheck: (fn, delayMs) => sched.schedule(fn, delayMs),
  };
}

describe("失败账本行的会话 id 回链", () => {
  it("selfLanding 与内存态执行方失败：agent_sessions.session_id = 错误携带的会话 id；未携带仍 null", async () => {
    await orchestrateBatch({ conn: db.conn, executor: failingCli("sess-cli-1") }, ["om_1"]);
    expect(scalar(db.conn, "SELECT session_id FROM agent_sessions WHERE status='error' ORDER BY id DESC LIMIT 1")).toBe(
      "sess-cli-1",
    );
    seedMessage(db.conn, "om_3", {});
    const memory = fakeSubagentExecutor("mem", () => {
      throw withSessionId(new Error("通道断"), "pky-judge-9");
    });
    await orchestrateBatch({ conn: db.conn, executor: memory }, ["om_3"]);
    expect(scalar(db.conn, "SELECT session_id FROM agent_sessions WHERE status='error' ORDER BY id DESC LIMIT 1")).toBe(
      "pky-judge-9",
    );
    await orchestrateBatch({ conn: db.conn, executor: failingCli(null) }, ["om_2"]);
    expect(
      scalar(db.conn, "SELECT session_id FROM agent_sessions WHERE status='error' ORDER BY id DESC LIMIT 1"),
    ).toBeNull();
  });
});

describe("30s 迟到判定回看 · 翻正通知", () => {
  it("挽救标 error 后按 30s 宽限调度一次；孤儿落库翻正 → onWrites；回看不写库", async () => {
    const sched = capturedScheduler();
    const writes: number[] = [];
    const out = await orchestrateBatch(depsOf(sched, writes), ["om_1", "om_2"]);
    expect(out.markedError).toBe(2);
    expect(statusOf("om_1")).toBe("error");
    expect(sched.count()).toBe(1);
    expect(sched.delays).toEqual([LATE_JUDGMENT_GRACE_MS]);
    expect(LATE_JUDGMENT_GRACE_MS).toBe(30_000);
    expect(writes).toHaveLength(0);
    // 孤儿 pk suggest 在宽限内把 om_1 翻正为落库态
    db.conn.prepare("UPDATE chat_messages SET ai_status='todo' WHERE message_id='om_1'").run();
    sched.fire();
    expect(writes).toHaveLength(1);
    expect(statusOf("om_2")).toBe("error"); // 回看只查不改
  });

  it("回看触发时连接已关闭：吞错不炸宿主", async () => {
    const sched = capturedScheduler();
    const writes: number[] = [];
    await orchestrateBatch(depsOf(sched, writes), ["om_1"]);
    db.close();
    expect(() => sched.fire()).not.toThrow();
    expect(writes).toHaveLength(0);
    db = createTestDb(); // afterEach 再关一次
  });
});

describe("30s 迟到判定回看 · 不调度 / 不通知的边界", () => {
  it("无翻正（仍 error/pending/judging）不通知；无 onWrites 不调度；非 selfLanding 失败不调度", async () => {
    const sched = capturedScheduler();
    const writes: number[] = [];
    await orchestrateBatch(depsOf(sched, writes), ["om_1"]);
    db.conn.prepare("UPDATE chat_messages SET ai_status='judging' WHERE message_id='om_1'").run();
    sched.fire();
    expect(writes).toHaveLength(0);

    const silent = capturedScheduler();
    await orchestrateBatch(
      { conn: db.conn, executor: failingCli("s"), scheduleLateRecheck: (fn, ms) => silent.schedule(fn, ms) },
      ["om_2"],
    );
    expect(silent.count()).toBe(0);

    seedMessage(db.conn, "om_3", {});
    const memorySched = capturedScheduler();
    const memory = fakeSubagentExecutor("mem", () => {
      throw new Error("通道断");
    });
    await orchestrateBatch(
      {
        conn: db.conn,
        executor: memory,
        onWrites: () => writes.push(1),
        scheduleLateRecheck: (fn, ms) => memorySched.schedule(fn, ms),
      },
      ["om_3"],
    );
    expect(memorySched.count()).toBe(0);
  });
});
