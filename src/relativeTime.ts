/**
 * 相对截止时间：注意力缺陷用户对「9月15日 14:00」无感、对「还有 5 小时」有反应。
 * 一律显示为距现在的距离（X 分钟后 / 明天 15:00 / 周五 / 已逾期 2 天），并按临近程度分档，
 * 调用方用 level 上色（overdue/urgent 红、hours 琥珀、days 常规、far 灰）。
 */
import { t } from "./i18n";
import { useSettingsStore } from "./stores/settings";

export type DueLevel = "overdue" | "urgent" | "hours" | "days" | "far";

export interface DueInfo {
  /** 相对文案，如「3 小时后」「明天 15:00」「已逾期 2 天」 */
  text: string;
  level: DueLevel;
}

function parseDue(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s.length === 16 ? s + ":00" : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 与 settings 的 time_format 一致的时分（12h → 3:00 PM） */
function fmtClock(d: Date): string {
  const store = useSettingsStore();
  const h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, "0");
  if (store.sget("time_format") === "12h") {
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${min} ${ampm}`;
  }
  return `${String(h).padStart(2, "0")}:${min}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const WEEKDAYS = ["rel.sun", "rel.mon", "rel.tue", "rel.wed", "rel.thu", "rel.fri", "rel.sat"];

/**
 * 相对截止时间（now 可注入，测试用）。
 * - 已逾期 → 已逾期 X 分钟/小时/天（overdue）
 * - ≤ 1 小时 → X 分钟后（urgent）
 * - 今天稍后 → X 小时后；跨到明天/后天 → 明天 HH:MM / 后天 HH:MM（hours）
 * - 7 天内 → 周X（days）
 * - 更远 → X 天后（far）
 */
export function relativeDue(due: string, now: Date = new Date()): DueInfo {
  const d = parseDue(due);
  if (!d) return { text: "", level: "far" };
  const diffMs = d.getTime() - now.getTime();

  if (diffMs < 0) {
    const past = -diffMs;
    if (past < 3_600_000)
      return { text: t("rel.overdueMin", { n: Math.max(1, Math.round(past / 60_000)) }), level: "overdue" };
    if (past < 86_400_000) return { text: t("rel.overdueHour", { n: Math.round(past / 3_600_000) }), level: "overdue" };
    return { text: t("rel.overdueDay", { n: Math.round(past / 86_400_000) }), level: "overdue" };
  }
  if (diffMs < 3_600_000) {
    return { text: t("rel.inMin", { n: Math.max(1, Math.round(diffMs / 60_000)) }), level: "urgent" };
  }
  if (isSameDay(d, now)) {
    return { text: t("rel.inHour", { n: Math.round(diffMs / 3_600_000) }), level: "hours" };
  }
  if (diffMs < 3 * 86_400_000) {
    // 明天 / 后天：带具体钟点，方便安排
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const dayAfter = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
    if (isSameDay(d, tomorrow)) return { text: t("rel.tomorrowAt", { v: fmtClock(d) }), level: "hours" };
    if (isSameDay(d, dayAfter)) return { text: t("rel.dayAfterAt", { v: fmtClock(d) }), level: "hours" };
  }
  if (diffMs < 7 * 86_400_000) {
    return { text: t(WEEKDAYS[d.getDay()]), level: "days" };
  }
  return { text: t("rel.inDay", { n: Math.round(diffMs / 86_400_000) }), level: "far" };
}
