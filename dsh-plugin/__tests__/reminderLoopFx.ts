/**
 * reminder-loop 系列受测装配（从 reminder-loop.spec.ts 拆出——棘轮 max-lines，等量
 * 迁移）：db 每用例重建 + naive-local 提醒种子 + 送达 rig（helper 在位/缺席）+ 复盘
 * 星期对齐 + loopDeps 组装；消费面 = reminder-loop.spec.ts。
 */
import { afterEach, beforeEach } from "vitest";
import { createTestDb, type TestDb } from "./helpers";
import { setSetting } from "../src/host/domain/settings";
import type { ReminderLoopDeps } from "../src/host/reminder/loop";
import { ReminderDelivery, type ReminderToastPayload } from "../src/host/reminder/deliver";
import type { BridgeClient } from "../src/host/pet/bridge";

/** 送达记录 rig：helper 在位（sendSysNotify 记录）或缺席（toast 记录） */
export type Notified = { kind: string; title: string; body: string };
export type DeliveryRig = { delivery: ReminderDelivery; notified: Notified[]; toasts: ReminderToastPayload[] };

/** 正午基准时刻（提醒窗口的中点基准；固定日期锚定——真实日期会在「缺省 review_dow=周一」
 *  与真实星期撞车时触发无关复盘提醒（周一时炸），确定性取周三） */
function noonNow(): number {
  return new Date(2026, 5, 10, 12, 0, 0, 0).getTime();
}

/** 直插带提醒任务行（naive-local 格式——桌面主形态） */
function seedReminderRow(
  conn: TestDb["conn"],
  nowMs: number,
  title: string,
  minutesFromNow: number,
  priority: string,
): number {
  const at = new Date(nowMs + minutesFromNow * 60_000);
  const p = (n: number): string => String(n).padStart(2, "0");
  const local = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}T${p(at.getHours())}:${p(at.getMinutes())}`;
  return Number(
    conn
      .prepare(
        "INSERT INTO tasks (title, status, priority, remind_at, reminded, created_at) VALUES (?, 'scheduled', ?, ?, 0, '2026-01-01T00:00:00+00:00')",
      )
      .run(title, priority, local).lastInsertRowid,
  );
}

/** 送达 rig 组装：helper 在位（sendSysNotify 记录）或缺席（toast 记录） */
function buildDeliveryRig(helper: boolean): DeliveryRig {
  const notified: Notified[] = [];
  const toasts: ReminderToastPayload[] = [];
  const bridge =
    helper === true
      ? ({
          sys: {
            sendSysNotify: (kind: string, title: string, body: string) => {
              notified.push({ kind, title, body });
              return true;
            },
          },
        } as unknown as BridgeClient)
      : null;
  const delivery = new ReminderDelivery({
    bridge: () => bridge,
    toast: (payload) => toasts.push(payload),
  });
  return { delivery, notified, toasts };
}

/** 装配受测面（beforeEach 重建 / afterEach 收口）；调用方 spec 顶层调用一次 */
export function setupReminderLoopFx() {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb();
  });
  afterEach(() => {
    db.close();
  });
  return {
    get db(): TestDb {
      return db;
    },
    baseNow: () => noonNow(),
    /** 直插带提醒任务（remind_at = naive-local——桌面主形态格式） */
    seedReminder: (title: string, minutesFromNow: number, priority = "normal") =>
      seedReminderRow(db.conn, noonNow(), title, minutesFromNow, priority),
    /** 把 review_dow 设成今天（触发复盘判定） */
    setReviewDowToday(now: number): void {
      const dow = new Date(now).getDay();
      setSetting(db.conn, "review_dow", String(dow === 0 ? 7 : dow));
    },
    deliveryRig: (helper: boolean) => buildDeliveryRig(helper),
    loopDeps(rig: DeliveryRig, nowMs: number): ReminderLoopDeps {
      return {
        conn: db.conn,
        delivery: rig.delivery,
        now: () => nowMs,
        log: () => undefined,
        onWrites: () => undefined,
      };
    },
  };
}
