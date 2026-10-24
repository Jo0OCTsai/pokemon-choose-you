/**
 * 设置选项值单源（与主应用对齐口径）：双形态共用同一份设置存储，值域不一致会互相
 * 写坏（如插件曾以「分钟」存 feishu_poll_interval——host/主应用一律按「秒」读，标签
 * 与实际行为背离）。本模块集中定义选项数组 + 装载期归一化（历史存量值吸附到合法档位）。
 *
 * 各键的值域单源 = 主应用对应分区：SectionFocus（番茄/休息/提前提醒/勿扰时段）、
 * SectionDisplay（日期格式）、FeishuCard（轮询间隔——值=秒）。
 */

/** 番茄时长（分钟） */
export const POMODORO_MINUTES = [15, 25, 45, 60] as const;
/** 短休息（分钟；0 = 关闭，番茄结束就停） */
export const BREAK_MINUTES = [0, 5, 10] as const;
/** 提前提醒（分钟；0 = 准时） */
export const REMIND_AHEAD_MINUTES = [0, 5, 15, 30] as const;
/** 轮询间隔（值=秒；主应用/host backoff 同口径，下限 30 秒） */
export const POLL_INTERVAL_SECS = [60, 120, 300, 900] as const;
/** 日期格式 */
export const DATE_FORMATS = ["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"] as const;
/** 时间制式 */
export const TIME_FORMATS = ["24h", "12h"] as const;

/** 勿扰时段整点下拉（值 "HH:00"、标签 "HH"——与主应用 quietTimeOptions 同形） */
export function quietHourOptions(): Array<{ value: string; label: string }> {
  return Array.from({ length: 24 }, (_, h) => {
    const hh = String(h).padStart(2, "0");
    return { value: `${hh}:00`, label: hh };
  });
}

/** 数值吸附到合法档位（就近，等距取更大档——拉取/提醒频率更保守） */
function snapTo(value: number, allowed: readonly number[]): number {
  return allowed.reduce((best, cur) => {
    const dCur = Math.abs(cur - value);
    const dBest = Math.abs(best - value);
    return dCur < dBest || (dCur === dBest && cur > best) ? cur : best;
  }, allowed[0]);
}

const normNum = (raw: string | undefined, allowed: readonly number[], fallback: number): string => {
  const n = Number(raw ?? "");
  if (raw === undefined || raw === "" || !Number.isFinite(n)) {
    return String(fallback);
  }
  return String(allowed.includes(n) ? n : snapTo(n, allowed));
};

/** "8"/"08"/"08:30" → "08:00" 风格的整点值；非法回落默认 */
const normQuietHour = (raw: string | undefined, fallback: string): string => {
  const m = /^(\d{1,2})(?::\d{2})?$/.exec((raw ?? "").trim());
  if (m !== null) {
    const h = Number(m[1]);
    if (h >= 0 && h <= 23) {
      return `${String(h).padStart(2, "0")}:00`;
    }
  }
  return fallback;
};

const normChoice = (raw: string | undefined, allowed: readonly string[], fallback: string): string =>
  raw !== undefined && (allowed as readonly string[]).includes(raw) ? raw : fallback;

/**
 * 装载期归一化（draft 与 saved 同过此管）：把历史存量值吸附/回落到与主应用一致的
 * 合法档位。只处理值域键，未落盘键（undefined）交由调用方归一空串的既有逻辑。
 */
export function normalizeSettingValues(kv: Record<string, string>): Record<string, string> {
  const out = { ...kv };
  if (out["pomodoro_minutes"] !== undefined) {
    out["pomodoro_minutes"] = normNum(out["pomodoro_minutes"], POMODORO_MINUTES, 25);
  }
  if (out["break_minutes"] !== undefined) {
    out["break_minutes"] = normNum(out["break_minutes"], BREAK_MINUTES, 0);
  }
  if (out["remind_ahead_minutes"] !== undefined) {
    out["remind_ahead_minutes"] = normNum(out["remind_ahead_minutes"], REMIND_AHEAD_MINUTES, 0);
  }
  if (out["feishu_poll_interval"] !== undefined) {
    out["feishu_poll_interval"] = normNum(out["feishu_poll_interval"], POLL_INTERVAL_SECS, 120);
  }
  if (out["date_format"] !== undefined) {
    out["date_format"] = normChoice(out["date_format"], DATE_FORMATS, "YYYY-MM-DD");
  }
  if (out["time_format"] !== undefined) {
    out["time_format"] = normChoice(out["time_format"], TIME_FORMATS, "24h");
  }
  if (out["quiet_start"] !== undefined) {
    out["quiet_start"] = normQuietHour(out["quiet_start"], "22:00");
  }
  if (out["quiet_end"] !== undefined) {
    out["quiet_end"] = normQuietHour(out["quiet_end"], "08:00");
  }
  return out;
}
