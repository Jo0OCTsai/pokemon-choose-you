/**
 * reminder loop + backupLoop 装配（任务 2.7 · AD §4.6/A36）：fake 时钟全链——到期→
 * CAS→聚合送达→去重→勿扰→toast 降级 + 补看面；当日去重键；backupLoop 跨天。
 * 桌面语义细节断言在 reminder-* 与 backup-loop.spec（domain 层）。
 */
import { describe, expect, it } from "vitest";
import { setSetting, getSetting } from "../src/host/domain/settings";
import { createReminderLoop, reviewDue, reviewText, runFreshStart, runReminderTick } from "../src/host/reminder/loop";
import {
  lastSeenReminderAt,
  missedRemindersSinceLastSeen,
  touchLastSeenReminderAt,
} from "../src/host/reminder/deliver";
import { claimDailyKey, FRESH_START_LAST_RUN, REVIEW_LAST_NOTIFIED } from "../src/host/reminder/daily-keys";
import { runDailyBackup } from "../src/host/domain/backup-loop";
import { ReminderDelivery } from "../src/host/reminder/deliver";
import { setupReminderLoopFx } from "./reminderLoopFx";

const fx = setupReminderLoopFx();
const db = {
  get conn() {
    return fx.db.conn;
  },
  secondConn() {
    return fx.db.secondConn();
  },
  get dir() {
    return fx.db.dir;
  },
};
const baseNow = () => fx.baseNow();
const seedReminder = (title: string, minutesFromNow: number, priority = "normal") =>
  fx.seedReminder(title, minutesFromNow, priority);
const deliveryRig = (helper: boolean) => fx.deliveryRig(helper);
const setReviewDowToday = (now: number) => fx.setReviewDowToday(now);
const loopDeps = (rig: Parameters<typeof fx.loopDeps>[0], nowMs: number) => fx.loopDeps(rig, nowMs);

describe("提醒主链：到期 → CAS 抢占 → 聚合送达", () => {
  it("单条到期原样送达（helper 通道）；已提醒行不再发（去重）", async () => {
    seedReminder("买咖啡", -5);
    const rig = deliveryRig(true);
    const out = await runReminderTick(loopDeps(rig, baseNow()));
    expect(out).toMatchObject({ due: 1, claimed: 1, silenced: 0, channel: "helper" });
    expect(rig.notified).toHaveLength(1);
    expect(rig.notified[0]).toMatchObject({ kind: "reminder", title: expect.stringContaining("训练家") });
    // 第二轮：reminded 已置 1 → 粗筛不再看到（去重）
    const again = await runReminderTick(loopDeps(rig, baseNow() + 60_000));
    expect(again.claimed).toBe(0);
    expect(rig.notified).toHaveLength(1);
  });

  it("多条到期聚合成一条（点名 + 等 N 项）；任一紧急整体 ‼ 前缀", async () => {
    seedReminder("a", -5);
    seedReminder("b", -5);
    seedReminder("c", -5);
    seedReminder("紧急事", -5, "urgent");
    const rig = deliveryRig(true);
    const out = await runReminderTick(loopDeps(rig, baseNow()));
    expect(out.claimed).toBe(4);
    expect(rig.notified).toHaveLength(1);
    expect(rig.notified[0].title).toContain("‼");
    expect(rig.notified[0].body).toContain("等 4 项");
  });

  it("CAS 让位：另一连接先抢 → 本形态 claimed=0 不发（D28 双形态仲裁）", async () => {
    const id = seedReminder("让位", -5);
    const other = db.secondConn();
    other.prepare("UPDATE tasks SET reminded=1 WHERE id=?").run(id);
    const rig = deliveryRig(true);
    const out = await runReminderTick(loopDeps(rig, baseNow()));
    expect(out.due).toBe(0); // 粗筛 reminded=0 已排除
    expect(out.claimed).toBe(0);
    expect(rig.notified).toHaveLength(0);
    other.close();
  });
});

describe("勿扰与降级链", () => {
  it("勿扰内非紧急静默（0 补发）；紧急仍敲门", async () => {
    setSetting(db.conn, "quiet_hours_enabled", "true");
    setSetting(db.conn, "quiet_start", "00:00");
    setSetting(db.conn, "quiet_end", "23:59");
    seedReminder("温和事", -5, "normal");
    const rig = deliveryRig(true);
    const out = await runReminderTick(loopDeps(rig, baseNow()));
    expect(out).toMatchObject({ claimed: 1, silenced: 1, channel: "dropped" });
    expect(rig.notified).toHaveLength(0);
    // 紧急例外：urgent 不受勿扰约束
    seedReminder("急事", -5, "urgent");
    const out2 = await runReminderTick(loopDeps(rig, baseNow()));
    expect(out2.silenced).toBe(0);
    expect(rig.notified).toHaveLength(1);
    expect(rig.notified[0].title).toContain("‼");
  });

  it("helper 缺席 → toast 降级（reminded 已置 1 不丢标记）+ 无 toast 通道 → dropped 计数", async () => {
    seedReminder("降级", -5);
    const rig = deliveryRig(false);
    const out = await runReminderTick(loopDeps(rig, baseNow()));
    expect(out.channel).toBe("toast");
    expect(rig.toasts[0]).toMatchObject({ kind: "reminder", silenced: 0 });
    expect(rig.delivery.stats).toEqual({ degraded: 1, dropped: 0 });
    // reminded 照常置位（标记不丢）
    expect(db.conn.prepare("SELECT reminded FROM tasks WHERE remind_at IS NOT NULL").get()).toMatchObject({
      reminded: 1,
    });
    // 彻底无通道（无 toast sink）：dropped 计数 + 补看面承接
    const bare = new ReminderDelivery({ bridge: () => null });
    seedReminder("丢弃", -5);
    const out2 = await runReminderTick({ ...loopDeps(rig, baseNow()), delivery: bare });
    expect(out2.channel).toBe("dropped");
    expect(bare.stats).toEqual({ degraded: 1, dropped: 1 });
  });

  it("通知关闭（notifications_enabled=false）→ 两通道都不发，标记照置", async () => {
    setSetting(db.conn, "notifications_enabled", "false");
    seedReminder("静音", -5);
    const rig = deliveryRig(true);
    const out = await runReminderTick(loopDeps(rig, baseNow()));
    expect(out).toMatchObject({ channel: "dropped", claimed: 1 });
    expect(rig.notified).toHaveLength(0);
  });
});

describe("补看面（AD §4.6 静默消费闭环）", () => {
  it("面板打开更新锚点；离开期间到期清单含降级送达与勿扰静默的", async () => {
    const now = baseNow();
    const past = new Date(now - 3_600_000).toISOString().replace("Z", "+00:00");
    touchLastSeenReminderAt(db.conn, past);
    expect(lastSeenReminderAt(db.conn)).toBe(past);
    // 勿扰静默一条 + 正常送达一条，都应出现在补看清单
    setSetting(db.conn, "quiet_hours_enabled", "true");
    setSetting(db.conn, "quiet_start", "00:00");
    setSetting(db.conn, "quiet_end", "23:59");
    seedReminder("静默的那条", -30);
    seedReminder("送达的那条", -10, "urgent");
    const rig = deliveryRig(true);
    await runReminderTick(loopDeps(rig, now));
    const missed = missedRemindersSinceLastSeen(db.conn, {
      nowMs: now,
      offsetMinutes: -new Date(now).getTimezoneOffset(),
    });
    expect(missed.rows.map((r) => r.title).sort()).toEqual(["静默的那条", "送达的那条"].sort());
    // 从未打开面板 → 空清单
    db.conn.prepare("DELETE FROM settings WHERE key='dsh:last_seen_reminder_at'").run();
    expect(missedRemindersSinceLastSeen(db.conn, { nowMs: now, offsetMinutes: 0 }).rows).toEqual([]);
  });
});

describe("逾期 fresh start（auto_grass 每日一次）", () => {
  it("逾期排期任务归草丛（清截止 + reminded 复位 + 审计）；当日键挡第二轮", async () => {
    setSetting(db.conn, "overdue_mode", "auto_grass");
    const r = db.conn
      .prepare(
        "INSERT INTO tasks (title, status, due_at, reminded, created_at) VALUES ('逾期的', 'scheduled', '2020-01-01T09:00', 1, '2026-01-01T00:00:00+00:00')",
      )
      .run();
    const rig = deliveryRig(true);
    const out = await runReminderTick(loopDeps(rig, baseNow()));
    expect(out.freshStart).toBe(1);
    const row = db.conn.prepare("SELECT status, due_at, reminded FROM tasks WHERE id=?").get(Number(r.lastInsertRowid));
    expect(row).toMatchObject({ status: "inbox", due_at: null, reminded: 0 });
    expect(rig.notified.some((n) => n.kind === "overdue")).toBe(true);
    // 同日第二轮：当日键已抢 → 不再跑（新增逾期也不跑）
    const out2 = await runReminderTick(loopDeps(rig, baseNow()));
    expect(out2.freshStart).toBe(0);
    expect(getSetting(db.conn, FRESH_START_LAST_RUN)).toBeTruthy();
  });

  it("非 auto_grass 模式不跑；runFreshStart 纯原语直测", async () => {
    setSetting(db.conn, "overdue_mode", "collapse");
    const rig = deliveryRig(true);
    const out = await runReminderTick(loopDeps(rig, baseNow()));
    expect(out.freshStart).toBe(0);
    expect(runFreshStart(db.conn, "2099-01-01")).toBe(0);
  });
});

describe("每周复盘提醒（当日一次）", () => {
  it("设定星期当天送达一次 + reviewDue/文案纯函数", async () => {
    const now = baseNow();
    setReviewDowToday(now);
    const rig = deliveryRig(true);
    const out = await runReminderTick(loopDeps(rig, now));
    expect(out.reviewNotified).toBe(true);
    expect(rig.notified.some((n) => n.kind === "review" && n.title.includes("复盘"))).toBe(true);
    const out2 = await runReminderTick(loopDeps(rig, now));
    expect(out2.reviewNotified).toBe(false); // 当日一次
    // 非设定星期不送（改到别的星期）
    setSetting(db.conn, "review_dow", new Date(now).getDay() === 1 ? "2" : "1");
    db.conn.prepare("DELETE FROM settings WHERE key='review_last_notified'").run();
    const out3 = await runReminderTick(loopDeps(rig, now));
    expect(out3.reviewNotified).toBe(false);
    expect(reviewDue(true, 1, 1, null, "2026-09-14")).toBe(true);
    expect(reviewDue(true, 1, 2, null, "2026-09-14")).toBe(false);
    expect(reviewDue(true, 1, 1, "2026-09-14", "2026-09-14")).toBe(false);
    expect(reviewText("en", 3, 45).body).toContain("3 caught");
  });

  it("跨形态让位：对面形态已抢当日键 → 本形态不送（键名与桌面逐字一致）", async () => {
    const now = baseNow();
    setReviewDowToday(now);
    const other = db.secondConn();
    const today = new Date(now).toISOString().slice(0, 10);
    expect(claimDailyKey(other, REVIEW_LAST_NOTIFIED, today)).toBe(true);
    const rig = deliveryRig(true);
    const out = await runReminderTick(loopDeps(rig, now));
    expect(out.reviewNotified).toBe(false);
    other.close();
  });
});

describe("循环装配（timer 注入）", () => {
  it("start/stop：tick 由注入 timer 驱动；单轮异常不炸循环（记 warn 续轮）", async () => {
    const ticks: Array<() => void> = [];
    const rig = deliveryRig(true);
    const loop = createReminderLoop({
      ...loopDeps(rig, baseNow()),
      timer: (cb) => {
        ticks.push(cb);
        return () => undefined;
      },
    });
    loop.start();
    seedReminder("循环内", -5);
    await ticks[0]();
    expect(rig.notified.length).toBe(1);
    // 库关闭后单轮异常 → 返回兜底结果不断循环
    db.secondConn().close();
    expect(await loop.runTick()).toMatchObject({ due: 0, channel: "dropped" });
    loop.stop();
  });

  it("backupLoop 编排：runDailyBackup 每日一次（already-today 跳过 + 跨天新快照）", () => {
    db.conn
      .prepare("INSERT INTO tasks (title, status, created_at) VALUES ('有数据', 'inbox', '2026-01-01T00:00:00+00:00')")
      .run();
    expect(runDailyBackup(db.dir, db.conn, new Date(baseNow())).created).toBe(true);
    expect(runDailyBackup(db.dir, db.conn, new Date(baseNow() + 60_000))).toMatchObject({
      created: false,
      reason: "already-today",
    });
    expect(runDailyBackup(db.dir, db.conn, new Date(baseNow() + 86_400_000)).created).toBe(true);
  });
});
