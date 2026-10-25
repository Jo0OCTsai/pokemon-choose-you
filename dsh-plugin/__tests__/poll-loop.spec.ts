/**
 * radio/pollLoop：一轮 = reclaim → 拉取 → 触发判定 → 健康更新 → 退避/恢复；
 * 未授权暂停 + 单次事件；恢复（pollNow 成功 / 显式 resume）；开关关闭空转；
 * 下次轮询时间登记（退避倍数口径）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPollLoop, type PollLoopDeps, type TimerApi } from "../src/host/radio/pollLoop";
import { createLark, type LarkCli } from "../src/host/radio/lark";
import { fakeSubagentExecutor } from "../src/host/judge/adapters";
import { HealthState, FEISHU } from "../src/host/health/snapshot";
import { claimJudging } from "../src/host/domain/claim";
import { createTestDb, scalar, seedMessage, type TestDb } from "./helpers";
import { stageFixture } from "./fake-shell";

let db: TestDb;
let staged: { bin: string; cleanup: () => void };
let lark: LarkCli;
let events: string[];
let logs: string[];

beforeEach(() => {
  db = createTestDb();
  staged = stageFixture("lark-cli-ok.sh");
  lark = createLark(staged.bin);
  events = [];
  logs = [];
  db.conn.prepare("INSERT INTO settings (key, value) VALUES ('feishu_enabled', 'true')").run();
});
afterEach(() => {
  db.close();
  staged.cleanup();
});

const NOW_MS = 1_789_211_331_894;

function makeDeps(overrides: Partial<PollLoopDeps> = {}): PollLoopDeps {
  return {
    conn: db.conn,
    lark,
    health: new HealthState(),
    newExecutor: () =>
      fakeSubagentExecutor("fake", (batch) =>
        batch.messageIds.map((id) => ({ messageId: id, action: "none", reason: "闲聊", tags: [] })),
      ),
    log: (level, message) => logs.push(`${level}: ${message}`),
    onEvent: (e) => events.push(e),
    now: () => NOW_MS,
    ...overrides,
  };
}

/** 手动 timer：记录每次调度的毫秒数，回调由测试显式触发 */
function manualTimer(): { timer: TimerApi; fire: () => void; lastMs: number[] } {
  const state = { cb: null as null | (() => void), lastMs: [] as number[] };
  return {
    timer: (cb, ms) => {
      state.cb = cb;
      state.lastMs.push(ms);
      return () => {
        state.cb = null;
      };
    },
    fire: () => state.cb?.(),
    get lastMs() {
      return state.lastMs;
    },
  };
}

/** 等待谓词成立（真实子进程轮次 >30ms，固定 sleep 会竞态） */
async function waitUntil(pred: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) {
      throw new Error("waitUntil 超时");
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("一轮的完整链路", () => {
  it("reclaim 过期 judging → 拉取 → 触发判定（pending 消息被消费）→ 健康记成功", async () => {
    db.conn
      .prepare(
        "INSERT INTO chat_messages (message_id, content, ai_status, judge_claimed_at, review_status, created_at) VALUES ('om_stale', 'x', 'judging', ?, 'pending', ?)",
      )
      .run(
        new Date(NOW_MS - 11 * 60_000).toISOString().replace("Z", "+00:00"),
        new Date(NOW_MS - 3_600_000).toISOString().replace("Z", "+00:00"),
      );
    const deps = makeDeps();
    const out = await createPollLoop(deps).runRound();
    expect(out.ok).toBe(true);
    expect(out.inserted).toBe(10);
    expect(String(scalar(db.conn, "SELECT ai_status FROM chat_messages WHERE message_id='om_stale'"))).not.toBe(
      "judging",
    );
    expect(scalar(db.conn, "SELECT COUNT(*) FROM chat_messages WHERE ai_status='pending'")).toBe(0);
    expect(deps.health.snapshot(FEISHU).lastSuccessAt).not.toBeNull();
    expect(logs.some((l) => l.includes("回收 1 条超时 judging"))).toBe(true);
  });

  it("未配置 agent：拉取照常、判定跳过不阻断（pending 留给下一轮）", async () => {
    const deps = makeDeps({ newExecutor: () => null });
    const out = await createPollLoop(deps).runRound();
    expect(out.ok).toBe(true);
    expect(out.inserted).toBe(10);
    expect(scalar(db.conn, "SELECT COUNT(*) FROM chat_messages WHERE ai_status='pending'")).toBe(6);
  });

  it("feishu_enabled=false：空转不触达 lark", async () => {
    db.conn.prepare("UPDATE settings SET value='false' WHERE key='feishu_enabled'").run();
    let called = 0;
    const deps = makeDeps({
      lark: {
        ...lark,
        userIdentity: async () => {
          called += 1;
          return { openId: "ou_me", name: "x" };
        },
      },
    });
    const out = await createPollLoop(deps).runRound();
    expect(out).toEqual({ ok: true, inserted: 0, unauthorized: false });
    expect(called).toBe(0);
  });
});

describe("失败退避（timer 调度口径）", () => {
  it("连续失败 ×2 封顶 ×8：调度间隔 240s→480s→960s→960s；nextRunAt 登记", async () => {
    const timer = manualTimer();
    const deps = makeDeps({ lark: createLark("/nonexistent/lark-cli"), timer: timer.timer });
    const loop = createPollLoop(deps);
    loop.start();
    await waitUntil(() => timer.lastMs.length === 1);
    expect(timer.lastMs).toEqual([240_000]);
    timer.fire();
    await waitUntil(() => timer.lastMs.length === 2);
    expect(timer.lastMs[1]).toBe(480_000);
    timer.fire();
    await waitUntil(() => timer.lastMs.length === 3);
    expect(timer.lastMs[2]).toBe(960_000);
    timer.fire();
    await waitUntil(() => timer.lastMs.length === 4);
    expect(timer.lastMs[3]).toBe(960_000);
    loop.stop();
    expect(deps.health.snapshot(FEISHU).consecutiveFailures).toBe(4);
    expect(deps.health.snapshot(FEISHU).lastError).toContain("lark-cli");
    expect(deps.health.snapshot(FEISHU).nextRunAt).toBe(NOW_MS + 960_000);
  });

  it("成功复位：失败一轮后下一轮成功，调度回基准间隔", async () => {
    const timer = manualTimer();
    let fail = true;
    const deps = makeDeps({
      timer: timer.timer,
      lark: {
        ...lark,
        userIdentity: async () => {
          if (fail) {
            throw new (await import("../src/host/storage/errors")).PkyError("LARK_FETCH_FAILED", "boom");
          }
          return lark.userIdentity();
        },
      },
    });
    const loop = createPollLoop(deps);
    loop.start();
    await waitUntil(() => timer.lastMs.length === 1);
    expect(timer.lastMs[0]).toBe(240_000);
    fail = false;
    timer.fire();
    await waitUntil(() => timer.lastMs.length === 2);
    expect(timer.lastMs[1]).toBe(120_000);
    loop.stop();
  });
});

describe("未授权暂停与单次事件", () => {
  it("LARK_UNAUTHORIZED：暂停 + 单次事件；暂停期自动轮空转不再触达；手动成功后恢复", async () => {
    const unauthBin = stageFixture("lark-cli-unauth.sh");
    try {
      const timer = manualTimer();
      const health = new HealthState();
      const deps = makeDeps({ lark: createLark(unauthBin.bin), timer: timer.timer, health });
      const loop = createPollLoop(deps);
      const r1 = await loop.runRound();
      expect(r1.unauthorized).toBe(true);
      expect(loop.paused).toBe(true);
      expect(events).toEqual(["unauthorized"]);
      expect(health.snapshot(FEISHU).consecutiveFailures).toBe(1);
      // 暂停期的自动轮：空转返回、不再触达 lark、不发第二次事件
      loop.start();
      await waitUntil(() => timer.lastMs.length >= 1);
      timer.fire();
      await waitUntil(() => timer.lastMs.length >= 2);
      expect(events).toEqual(["unauthorized"]);
      expect(timer.lastMs.length).toBeGreaterThan(0);
      loop.stop();
      // 授权跳转完成后（换可用 lark）：手动 pollNow 成功恢复 + 失败清零
      const healed = makeDeps({
        health,
        onEvent: deps.onEvent,
        log: deps.log,
        now: deps.now,
        newExecutor: deps.newExecutor,
      });
      const r3 = await createPollLoop(healed).runRound();
      expect(r3.ok).toBe(true);
      expect(r3.unauthorized).toBe(false);
      expect(health.snapshot(FEISHU).consecutiveFailures).toBe(0);
    } finally {
      unauthBin.cleanup();
    }
  });
});

describe("授权恢复（resume）", () => {
  it("显式 resume() 清暂停态（larkAuth 成功后的装配层挂点）：新暂停回合再发一次事件", async () => {
    const unauthBin = stageFixture("lark-cli-unauth.sh");
    try {
      const deps = makeDeps({ lark: createLark(unauthBin.bin) });
      const loop = createPollLoop(deps);
      await loop.runRound();
      expect(loop.paused).toBe(true);
      loop.resume();
      expect(loop.paused).toBe(false);
      await loop.runRound();
      expect(events).toEqual(["unauthorized", "unauthorized"]);
    } finally {
      unauthBin.cleanup();
    }
  });
});

describe("claim 并发收敛（轮询与判定链路的桥接）", () => {
  it("他形态已 claim 的消息本轮 claim 落空、原样保留", async () => {
    seedMessage(db.conn, "om_taken", {});
    db.conn
      .prepare("UPDATE chat_messages SET created_at=? WHERE message_id='om_taken'")
      .run(new Date(NOW_MS - 3_600_000).toISOString().replace("Z", "+00:00"));
    claimJudging(db.conn, ["om_taken"], new Date(NOW_MS).toISOString().replace("Z", "+00:00"));
    const deps = makeDeps();
    const out = await createPollLoop(deps).runRound();
    expect(out.ok).toBe(true);
    expect(String(scalar(db.conn, "SELECT ai_status FROM chat_messages WHERE message_id='om_taken'"))).toBe("judging");
  });
});

describe("判定日志分流（judgeLog——target=judge 由装配层绑定）", () => {
  it("轮询触发的判定完成进 judgeLog（与轮询自身 log 分流）", async () => {
    const judgeLogs: string[] = [];
    const deps = makeDeps({ judgeLog: (level, message) => judgeLogs.push(`${level}: ${message}`) });
    const out = await createPollLoop(deps).runRound();
    expect(out.ok).toBe(true);
    expect(judgeLogs.length).toBeGreaterThan(0);
    expect(judgeLogs[0]).toMatch(
      /^info: 判定完成：\d+ 条（todo \d+ · update \d+ · followup \d+ · none \d+）· 执行方 fake · \d+ms$/,
    );
    expect(logs.every((l) => !l.includes("判定完成"))).toBe(true);
  });
});
