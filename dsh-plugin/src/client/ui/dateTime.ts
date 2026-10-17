/**
 * 日期时间解析/展示/日历纯函数（DateTimePicker 与触发钮展示共用）：
 * - 值口径 = datetime-local 形态 "YYYY-MM-DDTHH:mm"（本地钟面无时区——Task.dueAt 截前
 *   16 位的既有存储口径，picker 换装不改数据契约）；
 * - 展示口径 = 共享设置 date_format / time_format + i18n locale（12h 的上下午标签与
 *   前后位序经 Intl 随语言走：zh 系「下午6:30」、en「6:30 PM」）；
 * - 分钟粒度半小时：存量奇值（旧原生输入 1 分钟粒）按向下半点吸附展示，改动时落值。
 */
import type { Locale } from "../i18n";

export type DateFormat = "YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY";
export type TimeFormat = "24h" | "12h";

export interface DateTimeParts {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  /** 0-23 */
  hour: number;
  minute: number;
}

const VALUE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** datetime-local 值 → 字段（格式或值域不符 → null） */
export function parseDateTimeValue(value: string): DateTimeParts | null {
  const m = VALUE_RE.exec(value);
  if (m === null) {
    return null;
  }
  const parts = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
  };
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31 || parts.hour > 23 || parts.minute > 59) {
    return null;
  }
  return parts;
}

/** 字段 → datetime-local 值（YYYY-MM-DDTHH:mm） */
export function formatValue(parts: DateTimeParts): string {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

/** 日期键 YYYY-MM-DD（日历选中/今日对比） */
export function dateKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** 分钟半小时吸附（向下——吸附值不晚于原时刻，截止语义更保守） */
export function snapMinute(minute: number): number {
  return minute < 30 ? 0 : 30;
}

/** 已过 18:00（严格大于——18:00 整点仍算当天） */
function isPastEvening(now: Date): boolean {
  return now.getHours() > 18 || (now.getHours() === 18 && now.getMinutes() > 0);
}

/** 空值打开弹层的默认落点：当天 18:00，已过 18:00 取明天 18:00 */
export function defaultOpenValue(now: Date = new Date()): string {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (isPastEvening(now) ? 1 : 0));
  return `${dateKey(day.getFullYear(), day.getMonth() + 1, day.getDate())}T18:00`;
}

/** 弹层草案字段（value 空或残缺回落默认 18 点——仅弹层呈现用，落值须经交互） */
export function draftPartsOf(value: string, now: Date = new Date()): DateTimeParts {
  return (
    parseDateTimeValue(value) ??
    parseDateTimeValue(defaultOpenValue(now)) ?? {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      hour: 18,
      minute: 0,
    }
  );
}

/** i18n locale → Intl 地区标签（桌面 DexDateTime 同源映射） */
export function intlLocaleOf(locale: Locale): string {
  return { "zh-Hans": "zh-CN", "zh-Hant": "zh-TW", en: "en-US" }[locale] ?? "zh-CN";
}

/** 展示日期（读 date_format 设置档） */
export function fmtDisplayDate(value: string, format: DateFormat): string {
  const p = parseDateTimeValue(value);
  if (p === null) {
    return "";
  }
  switch (format) {
    case "MM/DD/YYYY":
      return `${pad2(p.month)}/${pad2(p.day)}/${p.year}`;
    case "DD/MM/YYYY":
      return `${pad2(p.day)}/${pad2(p.month)}/${p.year}`;
    default:
      return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
  }
}

/** 12 小时制的上下午标签与位序（参考时刻 10:30 / 14:30 取 dayPeriod，避开午夜正午的方言段） */
export interface DayPeriod {
  am: string;
  pm: string;
  /** 上下午标签在时位之前（zh 系「下午6:30」，en 为 false） */
  first: boolean;
}

export function dayPeriodOf(intlLocale: string): DayPeriod {
  const fmt = new Intl.DateTimeFormat(intlLocale, { hour: "numeric", minute: "2-digit", hourCycle: "h12" });
  const parts = (date: Date): Intl.DateTimeFormatPart[] => fmt.formatToParts(date);
  const period = (list: Intl.DateTimeFormatPart[]): string =>
    (list.find((x) => x.type === "dayPeriod")?.value ?? "").trim();
  const indexOfType = (list: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number =>
    list.findIndex((x) => x.type === type);
  const morning = parts(new Date(2026, 0, 1, 10, 30));
  const afternoon = parts(new Date(2026, 0, 1, 14, 30));
  return {
    am: period(morning),
    pm: period(afternoon),
    first: indexOfType(morning, "dayPeriod") < indexOfType(morning, "hour"),
  };
}

/** 展示时间（24h 固定 HH:mm；12h 标签与位序随语言） */
export function fmtDisplayTime(value: string, format: TimeFormat, intlLocale: string): string {
  const p = parseDateTimeValue(value);
  if (p === null) {
    return "";
  }
  if (format === "24h") {
    return `${pad2(p.hour)}:${pad2(p.minute)}`;
  }
  const { am, pm, first } = dayPeriodOf(intlLocale);
  const clock = `${p.hour % 12 === 0 ? 12 : p.hour % 12}:${pad2(p.minute)}`;
  return first ? `${p.hour < 12 ? am : pm}${clock}` : `${clock} ${p.hour < 12 ? am : pm}`;
}

/** 展示日期时间（触发钮文案；空值交由调用方显示 dt.none） */
export function fmtDisplayDateTime(
  value: string,
  format: DateFormat,
  timeFormat: TimeFormat,
  intlLocale: string,
): string {
  return `${fmtDisplayDate(value, format)} ${fmtDisplayTime(value, timeFormat, intlLocale)}`;
}

/** 月份平移（跨年回绕；month0 为 0-11） */
export function shiftedMonth(year: number, month0: number, delta: number): { year: number; month0: number } {
  const total = year * 12 + month0 + delta;
  return { year: Math.floor(total / 12), month0: ((total % 12) + 12) % 12 };
}

/** 日历月份标题（随语言，如「2026年10月」/「October 2026」） */
export function monthTitle(intlLocale: string, year: number, month0: number): string {
  return new Intl.DateTimeFormat(intlLocale, { year: "numeric", month: "long" }).format(new Date(year, month0, 1));
}

/** 周一开头的星期窄标题（2026-09-07 为周一，桌面 DexDateTime 同源锚点） */
export function weekdayHeaders(intlLocale: string): string[] {
  const fmt = new Intl.DateTimeFormat(intlLocale, { weekday: "narrow" });
  return [...Array(7)].map((_, i) => fmt.format(new Date(2026, 8, 7 + i)));
}

/** 日历格子：周一开头前置留白 + 当月天数（0 = 留白） */
export function calendarCells(year: number, month0: number): number[] {
  const days = new Date(year, month0 + 1, 0).getDate();
  const lead = (new Date(year, month0, 1).getDay() + 6) % 7;
  return [...new Array<number>(lead).fill(0), ...Array.from({ length: days }, (_, i) => i + 1)];
}
