/**
 * 提醒调度循环（full-parity 任务 2.7 / AD §4.6 序列图 · 桌面 scheduler.rs tick 同构）：
 * 20s tick（timer 注入——pollLoop 同形 TimerApi）→ 设置快照一次读齐 → SQL 粗筛
 * （窗口放宽一天）→ 混排时间精判 → reminded CAS 抢占（D28 双形态仲裁，BEGIN
 * IMMEDIATE 内 affected=1 得送达权）→ decideDelivery（聚合/勿扰/紧急例外）→ 送达
 * （deliver.ts：helper sys-notify 优先 / toast 降级）。
 *
 * 后半段（桌面 tick 同窗镜像）：逾期 fresh start（auto_grass 每日一次，当日去重键
 * CAS）与每周复盘提醒（设定星期当日一次）——键名与桌面逐字一致（跨形态仲裁键）。
 * 勿扰判定时刻 = now（未前移提前量——桌面同口径）；逾期/复盘告知受 notify_on 与
 * 勿扰约束（decision.quiet 已含）。
 */
import { getSetting } from "../domain/settings";
import { nowRfc3339, txImmediate, type Conn } from "../storage/db";
import { realTimer, type TimerApi } from "../radio/pollLoop";
import { claimDailyKey, FRESH_START_LAST_RUN, REVIEW_LAST_NOTIFIED } from "./daily-keys";
import { decideDelivery } from "./aggregate";
import { claimReminded, duePrecise, formatRfc3339Utc, loadReminderSettings, queryDueRows } from "./query";
import { ReminderDelivery, type DeliveryChannel } from "./deliver";

/** tick 间隔（AD §4.6：20s——tick→通知 ≤30s 上界的载体） */
export const REMINDER_TICK_MS = 20_000;

/** 循环依赖（timer/时钟注入可测；桥面经 delivery 通道封装） */
export interface ReminderLoopDeps {
  conn: Conn;
  delivery: ReminderDelivery;
  timer?: TimerApi;
  now?: () => number;
  log?: (level: "info" | "warn", message: string) => void;
  /** fresh start 归草丛后的写后直推（桌面 emit TASKS_CHANGED 同位；缺省不推） */
  onWrites?(): void;
}

/** 单轮结果（诊断/测试断言面） */
export interface ReminderTickResult {
  /** 精判到期数 */
  due: number;
  /** CAS 抢到送达权数（让位 = due - claimed） */
  claimed: number;
  /** 勿扰静默条数（已置标记不补发） */
  silenced: number;
  /** 实际送达通道（notification 为 null 时 = "dropped"） */
  channel: DeliveryChannel;
  /** 桌宠事件载荷是否产出（供装配层后续桥接——v1 无独立桥消息，见 README） */
  petFired: boolean;
  /** fresh start 归草丛条数（auto_grass 当日一次） */
  freshStart: number;
  /** 每周复盘提醒是否送达（当日一次） */
  reviewNotified: boolean;
}

/** 本地时区偏移（分钟，东八 = +480——datetime-local 解析与勿扰本地时刻共用） */
function localOffsetMinutes(nowMs: number): number {
  return -new Date(nowMs).getTimezoneOffset();
}

/** 本地日期串 "YYYY-MM-DD"（当日去重键值） */
function localDay(nowMs: number): string {
  const d = new Date(nowMs);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** ISO 星期（周一=1…周日=7——桌面 %u 同口径） */
function isoDow(nowMs: number): number {
  const dow = new Date(nowMs).getDay();
  return dow === 0 ? 7 : dow;
}

// ---- 逾期 fresh start（auto_grass · 桌面 run_fresh_start 镜像） ----

/**
 * 逾期未开始的排期任务清截止归回草丛（反羞耻：不删任务不堆羞耻墙；reminded 复位——
 * 归草丛后新截止再提醒）。单条 BEGIN IMMEDIATE 收口（逐行 UPDATE + 审计）。
 */
export function runFreshStart(conn: Conn, today: string): number {
  return txImmediate(conn, () => {
    const ids = (
      conn
        .prepare(
          "SELECT id FROM tasks WHERE status='scheduled' AND due_at IS NOT NULL " +
            "AND substr(due_at,1,10) < ? AND started_at IS NULL",
        )
        .all(today) as Array<{ id: number }>
    ).map((r) => Number(r.id));
    const update = conn.prepare("UPDATE tasks SET due_at=NULL, status='inbox', reminded=0 WHERE id=?");
    const audit = conn.prepare(
      "INSERT INTO task_logs (task_id, action, field, old_value, new_value, origin, created_at) " +
        "VALUES (?, 'update', 'due_at', 'overdue', NULL, 'fresh-start', ?)",
    );
    const at = nowRfc3339();
    for (const id of ids) {
      update.run(id);
      audit.run(id, at);
    }
    return ids.length;
  });
}

/** fresh start 温和告知文案与复盘提醒文案（桌面镜像）拆在 aggregate.ts（通知文案单源） */
export { freshStartText, reviewText } from "./aggregate";
import { freshStartText, reviewText } from "./aggregate";

// ---- 每周复盘提醒（桌面 review_due / week_stats / review_notification_text 镜像） ----

/** 复盘到期判定（桌面 review_due 镜像）：开启 + 今天是设定星期 + 今天还没提醒过 */
export function reviewDue(
  enabled: boolean,
  reviewDow: number,
  todayDow: number,
  lastNotified: string | null,
  today: string,
): boolean {
  return enabled && todayDow === reviewDow && lastNotified !== today;
}

/** 本周捕捉数与专注分钟（近 7 天完成口径；nowMs 注入可测——桌面 datetime('now','-7 days') 同义） */
export function weekStats(conn: Conn, nowMs: number): { caught: number; focusMin: number } {
  const since = new Date(nowMs - 7 * 86_400_000).toISOString().replace("Z", "+00:00");
  const row = conn
    .prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(focus_seconds), 0) / 60 AS m FROM tasks " +
        "WHERE status='done' AND datetime(completed_at) >= datetime(?)",
    )
    .get(since) as { n: number; m: number };
  return { caught: Number(row.n), focusMin: Number(row.m) };
}

// ---- tick 本体 ----

/** 单轮前半段的设置快照（主链与当日去重键同窗读齐——桌面 tick 同口径） */
interface TickSettings {
  settings: ReturnType<typeof loadReminderSettings>;
  overdueMode: string;
  freshStartLastRun: string | null;
  reviewEnabled: boolean;
  reviewDow: number;
  reviewLastNotified: string | null;
}

function loadTickSettings(conn: Conn): TickSettings {
  return {
    settings: loadReminderSettings(conn),
    overdueMode: getSetting(conn, "overdue_mode") ?? "collapse",
    freshStartLastRun: getSetting(conn, FRESH_START_LAST_RUN),
    reviewEnabled: getSetting(conn, "review_enabled") !== "false",
    reviewDow: parseDow(getSetting(conn, "review_dow")),
    reviewLastNotified: getSetting(conn, REVIEW_LAST_NOTIFIED),
  };
}

/** 提醒主链：粗筛 → 精判 → CAS 抢占 → 勿扰滤网 + 聚合 → 送达（AD §4.6 前半） */
function reminderMainChain(
  deps: ReminderLoopDeps,
  tick: TickSettings,
  nowMs: number,
  offsetMinutes: number,
): { claimed: number; due: number; silenced: number; channel: DeliveryChannel; petFired: boolean; quiet: boolean } {
  const { settings } = tick;
  const nowLeadMs = nowMs + settings.leadMinutes * 60_000;
  const rows = queryDueRows(deps.conn, formatRfc3339Utc(nowLeadMs + 86_400_000));
  const due = duePrecise(offsetMinutes, rows, nowLeadMs);
  const claimed = claimReminded(deps.conn, due);
  // 勿扰判定的本地时刻 = now（未前移提前量）按本地偏移折回墙上钟（桌面同款）
  const localMinutes = Math.floor((nowMs + offsetMinutes * 60_000) / 60_000) % 1440;
  const decision = decideDelivery(settings, claimed, localMinutes);
  if (decision.silenced > 0) {
    deps.log?.(
      "info",
      `quiet hours ${settings.quietStart}-${settings.quietEnd}：${decision.silenced} 条非紧急提醒静默`,
    );
  }
  const channel =
    decision.notification === null
      ? "dropped"
      : deps.delivery.notify("reminder", decision.notification, decision.silenced);
  // 桌宠事件（P1 D3：提醒第一现场——敲门/催促经桥下发；桥缺席静默，通知通道已承载）
  if (decision.pet !== null) deps.delivery.petEvent(decision.pet);
  return {
    due: due.length,
    claimed: claimed.length,
    silenced: decision.silenced,
    channel,
    petFired: decision.pet !== null,
    quiet: decision.quiet,
  };
}

/** 逾期 fresh start 轮（auto_grass 每日一次；当日去重键 CAS——跨形态单跑） */
function freshStartRound(deps: ReminderLoopDeps, tick: TickSettings, quiet: boolean, today: string): number {
  if (tick.overdueMode !== "auto_grass" || tick.freshStartLastRun === today) {
    return 0;
  }
  if (!claimDailyKey(deps.conn, FRESH_START_LAST_RUN, today)) {
    return 0;
  }
  const moved = runFreshStart(deps.conn, today);
  if (moved > 0) {
    deps.onWrites?.();
    if (tick.settings.notifyOn && !quiet) {
      deps.delivery.notify("overdue", freshStartText(tick.settings.lang, moved));
    }
  }
  return moved;
}

/** 每周复盘提醒轮（设定星期当日一次；当日去重键 CAS） */
function reviewRound(
  deps: ReminderLoopDeps,
  tick: TickSettings,
  quiet: boolean,
  today: string,
  nowMs: number,
): boolean {
  if (!reviewDue(tick.reviewEnabled, tick.reviewDow, isoDow(nowMs), tick.reviewLastNotified, today)) {
    return false;
  }
  if (!claimDailyKey(deps.conn, REVIEW_LAST_NOTIFIED, today)) {
    return false;
  }
  if (tick.settings.notifyOn && !quiet) {
    const { caught, focusMin } = weekStats(deps.conn, nowMs);
    deps.delivery.notify("review", reviewText(tick.settings.lang, caught, focusMin));
    deps.log?.("info", "review: 每周复盘提醒已发送");
    return true;
  }
  return false;
}

/**
 * 单轮调度（桌面 tick 全链镜像）：提醒主链 + auto_grass + 每周复盘。任何一步的
 * 异常不炸循环（记 warn 续轮——桌面 log::warn 同口径），库层错误由调用方兜底。
 */
export async function runReminderTick(deps: ReminderLoopDeps): Promise<ReminderTickResult> {
  const nowMs = deps.now?.() ?? Date.now();
  const offsetMinutes = localOffsetMinutes(nowMs);
  const tick = loadTickSettings(deps.conn);
  const main = reminderMainChain(deps, tick, nowMs, offsetMinutes);
  const today = localDay(nowMs);
  return {
    due: main.due,
    claimed: main.claimed,
    silenced: main.silenced,
    channel: main.channel,
    petFired: main.petFired,
    freshStart: freshStartRound(deps, tick, main.quiet, today),
    reviewNotified: reviewRound(deps, tick, main.quiet, today, nowMs),
  };
}

/** review_dow 设置解析（1–7 整数；缺省/非法 = 周一——桌面 parse().unwrap_or(1) 同口径） */
function parseDow(raw: string | null): number {
  if (raw !== null && /^[1-7]$/.test(raw)) {
    return Number.parseInt(raw, 10);
  }
  return 1;
}

/** 提醒循环（20s tick；异常记 warn 续轮——循环不因单轮失败停摆） */
export interface ReminderLoop {
  start(): void;
  stop(): void;
  runTick(): Promise<ReminderTickResult>;
}

export function createReminderLoop(deps: ReminderLoopDeps): ReminderLoop {
  const timer = deps.timer ?? realTimer;
  let stop: (() => void) | null = null;
  const tick = async (): Promise<ReminderTickResult> => {
    try {
      return await runReminderTick(deps);
    } catch (error) {
      deps.log?.("warn", `reminder tick 失败：${String(error).slice(0, 160)}`);
      return {
        due: 0,
        claimed: 0,
        silenced: 0,
        channel: "dropped",
        petFired: false,
        freshStart: 0,
        reviewNotified: false,
      };
    }
  };
  return {
    start() {
      if (stop === null) {
        stop = timer(() => void tick(), REMINDER_TICK_MS);
      }
    },
    stop() {
      stop?.();
      stop = null;
    },
    runTick: tick,
  };
}
