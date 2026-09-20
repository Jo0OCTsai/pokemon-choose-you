/**
 * 时刻台词（PET_EXPERIENCE_PROPOSAL F3）：时段问候之上的「环境台词池」。
 * 这里只做纯判定（某时刻哪些台词 eligible），去重（每类每天/每小时一次）由调用方负责。
 * 语气纪律（COPYWRITING）：跨任务聚合文案保持泛称，深夜只提供收工出口、绝不催睡。
 */

export type TimeLineKey = "birthday" | "night" | "friday" | "hour";

export interface TimeLineCtx {
  /** 精灵生日（首次见面日）的月/日（1 基）；缺省不判生日 */
  birthday?: { month: number; day: number } | null;
}

/** 工作时段整点台词的适用小时（9:00~18:59 的整点场合） */
const HOUR_FROM = 9;
const HOUR_TO = 18;

/**
 * 返回此刻 eligible 的台词键（优先级：生日 > 深夜 > 周五晚 > 整点）。
 * 调用方对返回键做当天（整点为当小时）去重后再播。
 */
export function pickTimeLine(now: Date, ctx: TimeLineCtx = {}): TimeLineKey | null {
  if (ctx.birthday && now.getMonth() + 1 === ctx.birthday.month && now.getDate() === ctx.birthday.day) {
    return "birthday";
  }
  const h = now.getHours();
  if (h >= 23 || h < 5) return "night";
  if (now.getDay() === 5 && h >= 18) return "friday";
  if (h >= HOUR_FROM && h <= HOUR_TO) return "hour";
  return null;
}

/** 当天（整点为当天+小时）去重键：同键同周期只播一次 */
export function lineDedupKey(key: TimeLineKey, now: Date): string {
  const d = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  return key === "hour" ? `pet.line.hour.${d}.${now.getHours()}` : `pet.line.${key}.${d}`;
}
