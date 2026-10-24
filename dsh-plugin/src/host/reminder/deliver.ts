/**
 * 提醒送达通道（full-parity 任务 2.7 / AD §4.6 交互分支 + 静默消费闭环）：
 * - helper 在位（hello.caps 含 sys-notify）→ sendSysNotify（三语文案 host 组装——
 *   aggregate.ts 的 notificationText/aggregatedNotificationText 已备，本层只转发）；
 * - helper 缺席 → 面板 toast 通道回调（reminded 已置 1 不静默丢标记）+ 分段计数
 *   （degraded/dropped 观测点，诊断面消费）；
 * - 补看面（AD §4.6 静默消费闭环）：settings 键 `dsh:last_seen_reminder_at` 语义 =
 *   最近一次面板打开时刻（panelSnapshot 首载时更新——本模块提供更新函数，客户端
 *   呈现归组 3）；面板打开查询该时间窗内到期的已提醒任务（勿扰静默与降级送达的
 *   都「看得见」，不补「再送达」——送达权已被 CAS 消费）。
 */
import type { Conn } from "../storage/db";
import { setSetting, getSetting } from "../domain/settings";
import { parseTimeIn } from "./query";
import type { NotificationText } from "./aggregate";
import type { BridgeClient } from "../pet/bridge";
import type { SysNotifyMsg } from "../../../helper/src/bridge/protocol";

/** 补看时间戳键（语义 = 最近一次面板打开时刻；跨形态共享库键） */
export const LAST_SEEN_REMINDER_AT = "dsh:last_seen_reminder_at";

/** toast 通道载荷（helper 缺席时的页内降级呈现；silenced = 本次决策的勿扰静默条数） */
export interface ReminderToastPayload {
  kind: SysNotifyMsg["kind"];
  title: string;
  body: string;
  silenced: number;
}

/** 送达通道观测计数（诊断面 / 分段计数呈现） */
export interface ReminderDeliveryStats {
  /** helper 通道不可用而降级的次数（toast 或丢弃） */
  degraded: number;
  /** 降级且无 toast 通道承接（仅补看面可见）的次数 */
  dropped: number;
}

/** 送达通道依赖（桥面 + toast 回调全部注入——装配层 2.7 接线） */
export interface ReminderDeliveryDeps {
  /** 本形态当前桥（helper 不在 = null → toast 降级） */
  bridge(): BridgeClient | null;
  /** 面板 toast 通道（面板在位时装配层挂接；缺席 = 丢弃计数） */
  toast?(payload: ReminderToastPayload): void;
}

/** 送达结果通道（面板 toast 计数呈现用） */
export type DeliveryChannel = "helper" | "toast" | "dropped";

/** 提醒送达通道：helper sys-notify 优先，缺席降级 toast（无通道则丢弃计数） */
export class ReminderDelivery {
  private degraded = 0;
  private dropped = 0;
  private readonly deps: ReminderDeliveryDeps;

  constructor(deps: ReminderDeliveryDeps) {
    this.deps = deps;
  }

  get stats(): ReminderDeliveryStats {
    return { degraded: this.degraded, dropped: this.dropped };
  }

  /** 送达一条通知文案（kind = reminder/overdue/review…；返回实际通道） */
  notify(kind: SysNotifyMsg["kind"], text: NotificationText, silenced = 0): DeliveryChannel {
    const bridge = this.deps.bridge();
    if (bridge !== null && bridge.sys.sendSysNotify(kind, text.title, text.body)) {
      return "helper";
    }
    this.degraded += 1;
    if (this.deps.toast !== undefined) {
      this.deps.toast({ kind, title: text.title, body: text.body, silenced });
      return "toast";
    }
    this.dropped += 1;
    return "dropped";
  }
}

// ---- 补看面（静默消费闭环数据面；panelSnapshot 消费） ----

/** 面板打开时刻更新补看锚点（单语句写；面板首载 panelSnapshot 内调用） */
export function touchLastSeenReminderAt(conn: Conn, now: string): void {
  setSetting(conn, LAST_SEEN_REMINDER_AT, now);
}

/** 当前补看锚点（null = 从未打开过面板——补看清单为空口径由调用方定） */
export function lastSeenReminderAt(conn: Conn): string | null {
  return getSetting(conn, LAST_SEEN_REMINDER_AT);
}

/** 补看清单行（面板首屏「离开期间到期」清单——UIUX §4.2） */
export interface MissedReminder {
  id: number;
  title: string;
  priority: string;
  pokemon: string | null;
}

/**
 * 离开期间到期清单（AD §4.6）：reminded=1 且 remind_at 落在 (lastSeen, now] 的开放任务
 * （勿扰静默与 toast 降级送达的都含）。零新列约束（§5.1）下以 remind_at 时间窗代理
 * 「新置 reminded」——粗筛放宽一天（混排格式字典序不可比）后逐行时间精判（parseTimeIn
 * 同口径）。lastSeen 为 null（从未打开面板）时返回空清单。
 */
export function missedRemindersSinceLastSeen(
  conn: Conn,
  opts: { nowMs: number; offsetMinutes: number },
): { since: string | null; rows: MissedReminder[] } {
  const since = lastSeenReminderAt(conn);
  if (since === null) {
    return { since: null, rows: [] };
  }
  const sinceMs = parseTimeIn(opts.offsetMinutes, since);
  if (sinceMs === null) {
    return { since, rows: [] }; // 锚点损坏（手改库）——空清单不炸面板
  }
  const widen = new Date(opts.nowMs + 86_400_000).toISOString().replace("Z", "+00:00");
  const candidates = conn
    .prepare(
      "SELECT t.id, t.title, t.priority, t.remind_at, c.pokemon FROM tasks t " +
        "LEFT JOIN categories c ON c.id = t.category_id " +
        "WHERE t.reminded=1 AND t.remind_at IS NOT NULL AND t.remind_at <= ? " +
        "AND t.status IN ('inbox','scheduled','active','paused')",
    )
    .all(widen) as Array<Record<string, unknown>>;
  const rows: MissedReminder[] = [];
  for (const r of candidates) {
    const at = parseTimeIn(opts.offsetMinutes, String(r.remind_at));
    if (at !== null && at > sinceMs && at <= opts.nowMs) {
      rows.push({
        id: Number(r.id),
        title: String(r.title),
        priority: String(r.priority),
        pokemon: r.pokemon == null ? null : String(r.pokemon),
      });
    }
  }
  rows.sort((a, b) => a.id - b.id);
  return { since, rows };
}
