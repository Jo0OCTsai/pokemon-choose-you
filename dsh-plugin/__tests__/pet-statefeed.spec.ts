/**
 * pet/stateFeed：任务状态快照（activeTask + 分类精灵 key + badge 口径）、A17 变更
 * 标记轮询（合取单查询）、写后直推、位置持久化 dsh:pet_pos、lang/sprites/
 * pomodoro-config 下发组装（六只内置 + cdnBase 单源）。
 */
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildPomodoroConfig,
  buildSpritesMsg,
  changeMark,
  getPetPos,
  PET_POS_KEY,
  resolveLang,
  setPetPos,
  snapshotBadge,
  snapshotTaskState,
  StateFeed,
  type FeedTimerApi,
} from "../src/host/pet/stateFeed";
import { BridgeClient } from "../src/host/pet/bridge";
import { DEFAULT_BUILTIN } from "../helper/src/sprites";
import { getSetting } from "../src/host/domain/settings";
import { createTestDb, seedMessage, seedTask, type TestDb } from "./helpers";
import { markDispatchIdle } from "../src/host/domain/dispatch";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

/** 记录型输出端（替身 helper 管道） */
class SinkOutput {
  readonly sent: Array<Record<string, unknown>> = [];
  write(line: string): boolean {
    this.sent.push(JSON.parse(line) as Record<string, unknown>);
    return true;
  }
}

function makeFeed(): { feed: StateFeed; sent: Array<Record<string, unknown>> } {
  const sink = new SinkOutput();
  const bridge = new BridgeClient({ handlers: { onCmd: () => undefined, onFocusSettle: () => undefined } });
  bridge.attach(new PassThrough(), sink as unknown as NodeJS.WritableStream);
  const feed = new StateFeed(db.conn, { bridgeProvider: () => bridge });
  return { feed, sent: sink.sent };
}

describe("快照组装", () => {
  it("activeTask：active 优先于 paused，分类精灵 key 随行（categories.sprite 列）", () => {
    const active = seedTask(db.conn, "进行中", { status: "active", startedAt: "2026-01-15T08:00:00+00:00" });
    const paused = seedTask(db.conn, "暂停中", { status: "paused", startedAt: "2026-01-15T07:00:00+00:00" });
    const snap = snapshotTaskState(db.conn);
    expect(snap.activeTask?.id).toBe(active);
    expect(snap.activeTask?.categoryPokemon).toBe("pikachu"); // 工作分类（种子 id=1）绑定皮卡丘
    expect(snap.todayTasks.map((t) => t.id)).toContain(paused);
    db.conn.prepare("UPDATE tasks SET status='inbox' WHERE status IN ('active','paused')").run();
    expect(snapshotTaskState(db.conn).activeTask).toBeNull();
  });

  it("badge：pendingSuggestions = 待处理 todo/update；failures = error 组（主应用 getter 口径）", () => {
    seedMessage(db.conn, "om_1", { aiStatus: "todo", reviewStatus: "pending" });
    seedMessage(db.conn, "om_2", { aiStatus: "update", reviewStatus: "pending" });
    seedMessage(db.conn, "om_3", { aiStatus: "todo", reviewStatus: "accepted" });
    seedMessage(db.conn, "om_4", { aiStatus: "followup", reviewStatus: "pending" });
    seedMessage(db.conn, "om_5", { aiStatus: "error" });
    seedMessage(db.conn, "om_6", { aiStatus: "pending" });
    expect(snapshotBadge(db.conn)).toEqual({ pendingSuggestions: 2, failures: 1 });
  });
});

describe("A17 变更标记（合取单查询）", () => {
  it("task_logs / active 聚合 / chat_messages 任一轴变化 → 标记变化", () => {
    const taskId = seedTask(db.conn, "任务");
    const m0 = changeMark(db.conn);
    // 轴 1：task_logs（domain 写路径补审计；不动 status/chat）
    markDispatchIdle(db.conn, taskId, "dsh:test");
    const m1 = changeMark(db.conn);
    expect(m1).not.toBe(m0); // task_logs 变化
    // 轴 2：active 聚合（外部形态直改、无 task_logs 写入）
    db.conn.prepare("UPDATE tasks SET status='active' WHERE id=?").run(taskId);
    const m2 = changeMark(db.conn);
    expect(m2).not.toBe(m1); // active 聚合变化
    // 轴 3：chat_messages 计数
    seedMessage(db.conn, "om_x");
    expect(changeMark(db.conn)).not.toBe(m2); // chat_messages 计数变化
    expect(changeMark(db.conn)).toBe(changeMark(db.conn)); // 无变化稳定
  });
});

describe("位置持久化（dsh:pet_pos）", () => {
  it("写入读取（取整）；坏数据按 null 处理", () => {
    expect(getPetPos(db.conn)).toBeNull();
    setPetPos(db.conn, { x: 12.4, y: -8.6 });
    expect(getPetPos(db.conn)).toEqual({ x: 12, y: -9 });
    expect(getSetting(db.conn, PET_POS_KEY)).toBe('{"x":12,"y":-9}');
    db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, 'not json')").run(PET_POS_KEY);
    expect(getPetPos(db.conn)).toBeNull();
  });
});

describe("配置下发组装", () => {
  it("lang 三态归一；sprites 六只内置 + cdnBase（helper 单源）+ reducedMotion", () => {
    expect(resolveLang(db.conn)).toBe("zh-Hans"); // 缺省
    db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('language', 'zh-Hant')").run();
    expect(resolveLang(db.conn)).toBe("zh-Hant");
    const sprites = buildSpritesMsg(db.conn);
    expect(sprites.builtin).toEqual(DEFAULT_BUILTIN);
    expect(sprites.builtin).toHaveLength(6); // 六只内置
    expect(sprites.cdnBase).toMatch(/PokeAPI/i);
    expect(sprites.reducedMotion).toBeUndefined(); // reduce_motion 未设时不覆盖（跟系统偏好）
    db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('reduce_motion', 'true')").run();
    expect(buildSpritesMsg(db.conn).reducedMotion).toBe(true);
  });

  it("pomodoro-config：档位 [15,25,45,60] 固定 + breakMin 读共享设置缺省 5 + enabled 缺省 false", () => {
    expect(buildPomodoroConfig(db.conn)).toEqual({
      durations: [15, 25, 45, 60],
      breakMin: 5,
      enabled: false,
      lang: "zh-Hans",
    });
    db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('break_minutes', '10')").run();
    expect(buildPomodoroConfig(db.conn).breakMin).toBe(10);
  });

  it("pomodoro-config：enabled 读共享设置 pomodoro_enabled（主应用同键同语义）", () => {
    db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('pomodoro_enabled', 'true')").run();
    expect(buildPomodoroConfig(db.conn).enabled).toBe(true);
    db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('pomodoro_enabled', 'false')").run();
    expect(buildPomodoroConfig(db.conn).enabled).toBe(false);
  });
});

describe("StateFeed（推送与轮询）", () => {
  it("写后直推（notifyLocalWrite）即时送 task-state；helper 不在时丢弃不炸", () => {
    const { feed, sent } = makeFeed();
    const taskId = seedTask(db.conn, "进行中", { status: "active" });
    feed.notifyLocalWrite();
    const last = sent.at(-1);
    expect(last?.["type"]).toBe("task-state");
    expect((last?.["activeTask"] as { id: number }).id).toBe(taskId);
    const noBridge = new StateFeed(db.conn, { bridgeProvider: () => null });
    expect(() => noBridge.notifyLocalWrite()).not.toThrow();
  });

  it("轮询：库被外部形态改写 → 推送；无变化不推（≤2s 上界的机制面）", () => {
    const { feed, sent } = makeFeed();
    expect(feed.pollOnce()).toBe(true); // 首轮基线推送
    expect(sent).toHaveLength(1);
    expect(feed.pollOnce()).toBe(false); // 无变化不推
    // 外部形态写入（真实写路径必落 task_logs / 改 active；这里用 domain 审计写模拟）
    const external = seedTask(db.conn, "跨形态新任务");
    markDispatchIdle(db.conn, external, "dsh:test");
    expect(feed.pollOnce()).toBe(true); // 外部写入被侦见
    expect(sent).toHaveLength(2);
    expect(sent.at(-1)?.["type"]).toBe("task-state");
  });

  it("republishAll：lang + sprites + pomodoro-config + task-state 四连发（重启恢复）", () => {
    const { feed, sent } = makeFeed();
    feed.republishAll();
    expect(sent.map((m) => m["type"])).toEqual(["lang", "sprites", "pomodoro-config", "task-state"]);
  });
});

describe("StateFeed 轮询循环（start/stop 与真实 timer）", () => {
  it("真实 timer 自动轮询：外部写入后 ≤pollMs 推送（A17 机制闭环）", async () => {
    const sink = new SinkOutput();
    const bridge = new BridgeClient({ handlers: { onCmd: () => undefined, onFocusSettle: () => undefined } });
    bridge.attach(new PassThrough(), sink as unknown as NodeJS.WritableStream);
    const feed = new StateFeed(db.conn, { bridgeProvider: () => bridge, pollMs: 40 });
    const sent = sink.sent;
    feed.start();
    await sleep(120);
    expect(sent).toHaveLength(0); // start 记录基线标记：无变化不推（初始态由装配层 republishAll 下发）
    markDispatchIdle(db.conn, seedTask(db.conn, "外部任务"), "dsh:test");
    await sleep(120);
    expect(sent.length).toBeGreaterThanOrEqual(1); // 变化后 ≤pollMs 推送 task-state
    expect(sent.at(-1)?.["type"]).toBe("task-state");
    feed.stop();
  });

  it("start/stop：默认 2 秒间隔注册；自定义 pollMs", () => {
    const seen: number[] = [];
    const timer: FeedTimerApi = {
      every: (ms) => {
        seen.push(ms);
        return 1;
      },
      cancel: () => undefined,
    };
    const feed = new StateFeed(db.conn, { bridgeProvider: () => null, timer });
    feed.start();
    feed.stop();
    const fast = new StateFeed(db.conn, { bridgeProvider: () => null, timer, pollMs: 500 });
    fast.start();
    fast.stop();
    expect(seen).toEqual([2_000, 500]);
  });
});
