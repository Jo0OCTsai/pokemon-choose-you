/**
 * 提醒到期查询与 reminded CAS（FR-A3 · 桌面 scheduler.rs query_due_rows / due_precise /
 * parse_time_in / claim_reminded 同构，只镜像不重写语义）：SQL 粗筛（窗口放宽一天——
 * datetime-local 存无时区本地时间，与 UTC RFC3339 字典序不可比）+ 混排时间精判
 * （RFC3339 直转 UTC、datetime-local 按场景时区解析）+ 送达权抢占（D28 双形态仲裁：
 * BEGIN IMMEDIATE 内 `UPDATE tasks SET reminded=1 WHERE id=? AND reminded=0`，
 * affected=1 → 抢到；affected=0 → 后到让位）。
 */
import { txImmediate, type Conn } from "../storage/db";
import { getSetting } from "../domain/settings";

/** 一条到期提醒（送达用：标题 + 优先级 + 分类宝可梦——桌面 Reminder 同构） */
export interface Reminder {
  id: number;
  title: string;
  priority: string;
  pokemon: string | null;
}

/** 紧急档（urgent/high）：更强提醒文案且不受勿扰约束（桌面 Reminder::urgent 同构） */
export function isUrgent(priority: string): boolean {
  return priority === "urgent" || priority === "high";
}

// ---- 混排时间解析（桌面 parse_time_in 镜像；秒级精度——桌面提醒值均整秒） ----

/** RFC3339 严格形态（chrono parse_from_rfc3339 的实测接受面：T/t 分隔、Z/z 或 ±HH:MM） */
const RFC3339_RE = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

/** datetime-local 无时区形态（桌面 %Y-%m-%dT%H:%M 与带秒两档） */
const NAIVE_LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2}))?$/;

export interface InstantParts {
  /** UTC epoch ms */
  epochMs: number;
  /** 解析出的时区偏移（分钟，东八 = +480；RFC3339 自带偏移，naive 形态无此值） */
  offsetMinutes: number;
}

function validYmd(y: number, mo: number, d: number): boolean {
  if (mo < 1 || mo > 12 || d < 1) {
    return false;
  }
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** RFC3339 时区段 → 偏移分钟（Z/z = 0；偏移时/分越界 = null） */
function zoneOffsetMinutes(zone: string): number | null {
  if (zone === "Z" || zone === "z") {
    return 0;
  }
  const oh = Number(zone.slice(1, 3));
  const om = Number(zone.slice(4, 6));
  if (oh > 23 || om > 59) {
    return null;
  }
  return (zone[0] === "-" ? -1 : 1) * (oh * 60 + om);
}

/** RFC3339 严格解析（chrono parse_from_rfc3339 镜像）：日期真实存在、时分秒与偏移在界内 */
export function parseRfc3339(s: string): InstantParts | null {
  const m = RFC3339_RE.exec(s);
  if (m === null) {
    return null;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const hh = Number(m[4]);
  const mi = Number(m[5]);
  const ss = Number(m[6]);
  if (!validYmd(y, mo, d) || hh > 23 || mi > 59 || ss > 59) {
    return null;
  }
  const offsetMinutes = zoneOffsetMinutes(m[7]);
  if (offsetMinutes === null) {
    return null;
  }
  return { epochMs: Date.UTC(y, mo - 1, d, hh, mi, ss) - offsetMinutes * 60_000, offsetMinutes };
}

/** datetime-local（无时区）按 offsetMinutes 解析为 UTC epoch ms（tz.from_local_datetime 同构） */
export function parseNaiveLocal(s: string, offsetMinutes: number): number | null {
  const m = NAIVE_LOCAL_RE.exec(s);
  if (m === null) {
    return null;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const hh = Number(m[4]);
  const mi = Number(m[5]);
  const ss = m[6] === undefined ? 0 : Number(m[6]);
  if (!validYmd(y, mo, d) || hh > 23 || mi > 59 || ss > 59) {
    return null;
  }
  return Date.UTC(y, mo - 1, d, hh, mi, ss) - offsetMinutes * 60_000;
}

/** 混排解析（桌面 parse_time_in 镜像）：RFC3339 自带偏移不受 tz 影响；本地格式按 tz 解析 */
export function parseTimeIn(offsetMinutes: number, s: string): number | null {
  const rfc = parseRfc3339(s);
  if (rfc !== null) {
    return rfc.epochMs;
  }
  return parseNaiveLocal(s, offsetMinutes);
}

/** epoch ms → "YYYY-MM-DDTHH:MM:SS+00:00"（chrono Utc to_rfc3339 同形态——粗筛窗口串口径） */
export function formatRfc3339Utc(epochMs: number): string {
  const d = new Date(epochMs);
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+00:00`
  );
}

// ---- 设置快照（桌面 ReminderSettings::from_conn 镜像；缺省与设置面一致） ----

export interface ReminderSettings {
  /** 提前量（分钟）：到期判定把「现在」前移 */
  leadMinutes: number;
  /** 通知开关（系统通知与桌宠事件同受它控制） */
  notifyOn: boolean;
  /** 勿扰开关：时段内静默非紧急；边界解析失败视为关闭（fail open） */
  quietOn: boolean;
  quietStart: string;
  quietEnd: string;
  lang: string;
}

/** 从 settings 表读齐提醒决策键（缺省与桌面一致：0 / true / true / 22:00 / 08:00 / zh-Hans） */
export function loadReminderSettings(conn: Conn): ReminderSettings {
  const lead = getSetting(conn, "remind_ahead_minutes");
  const flag = (key: string): boolean => {
    const v = getSetting(conn, key);
    return v === null ? true : v !== "false";
  };
  return {
    // i64 parse 同口径：非整数串（含小数/空白）折 0，"+30"/"-5" 可解析
    leadMinutes: lead !== null && /^[+-]?\d+$/.test(lead) ? Number.parseInt(lead, 10) : 0,
    notifyOn: flag("notifications_enabled"),
    quietOn: flag("quiet_hours_enabled"),
    quietStart: getSetting(conn, "quiet_start") ?? "22:00",
    quietEnd: getSetting(conn, "quiet_end") ?? "08:00",
    lang: getSetting(conn, "language") ?? "zh-Hans",
  };
}

// ---- 到期查询（粗筛 SQL + 精判纯函数） ----

/** SQL 粗筛的到期候选行（精确判定前；两种格式混排在 remindAt 里） */
export interface DueRow {
  id: number;
  title: string;
  priority: string;
  remindAt: string;
  pokemon: string | null;
}

/** 到期粗筛（桌面 query_due_rows 同款 SQL；行序 = 引擎自然序，双实现一致） */
export function queryDueRows(conn: Conn, nowS: string): DueRow[] {
  const rows = conn
    .prepare(
      "SELECT t.id, t.title, t.priority, t.remind_at, c.pokemon FROM tasks t " +
        "LEFT JOIN categories c ON c.id = t.category_id " +
        "WHERE t.reminded=0 AND t.remind_at IS NOT NULL AND t.remind_at <= ? " +
        "AND t.status IN ('inbox','scheduled','active','paused')",
    )
    .all(nowS) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    priority: String(r.priority),
    remindAt: String(r.remind_at),
    pokemon: r.pokemon == null ? null : String(r.pokemon),
  }));
}

/** 到期精判（桌面 due_precise 镜像）：解析失败或未到期的行跳过 */
export function duePrecise(offsetMinutes: number, rows: DueRow[], nowMs: number): Reminder[] {
  const out: Reminder[] = [];
  for (const r of rows) {
    const t = parseTimeIn(offsetMinutes, r.remindAt);
    if (t !== null && t <= nowMs) {
      out.push({ id: r.id, title: r.title, priority: r.priority, pokemon: r.pokemon });
    }
  }
  return out;
}

/**
 * 抢占送达权（桌面 claim_reminded 镜像 · D28 双形态仲裁）：单条 BEGIN IMMEDIATE 内
 * 逐条条件更新，affected=1 抢到、affected=0 让位；返回抢到的子集（保持入参顺序）。
 * 单形态下守卫恒真，行为与无守卫版一致。
 */
export function claimReminded(conn: Conn, due: Reminder[]): Reminder[] {
  return txImmediate(conn, () => {
    const stmt = conn.prepare("UPDATE tasks SET reminded=1 WHERE id=? AND reminded=0");
    const won: Reminder[] = [];
    for (const r of due) {
      if (stmt.run(r.id).changes === 1) {
        won.push(r);
      }
    }
    return won;
  });
}
