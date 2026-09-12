/**
 * 自然语言快速捕捉：把「明天 5pm 交周报 #工作」拆成结构化待办字段。
 *
 * 设计吸取 Todoist 十年误识别吐槽的教训：
 * - 只认高置信模式（明确的时间词 / #标签），认不出的原文保留在标题里不动
 * - 识别结果以高亮预览呈现，单击即可取消本次识别，设置里可全局关闭
 * - 纯本地解析，不依赖网络
 */

export interface NlCaptureContext {
  /** 可选分类（#分类名 命中启用分类时识别为分类） */
  categories: { id: number; name: string; enabled: boolean }[];
  /** 已有标签（#标签名 命中已有标签时带上） */
  tags: { id: number; name: string }[];
  /** 解析基准时间（缺省当前时间；测试注入固定值） */
  now?: Date;
}

export interface NlCaptureResult {
  /** 标题：抽走时间 / 分类 / 标签片段后剩余的文本 */
  title: string;
  /** 截止时间（本地 YYYY-MM-DDTHH:MM）；未识别到时间则为 null */
  dueAt: string | null;
  /** 命中的分类 id（#分类名） */
  categoryId: number | null;
  categoryName: string | null;
  /** 命中的标签（#标签名，只认已有标签） */
  tagIds: number[];
  tagNames: string[];
  /** 被抽走的原文片段（预览高亮用） */
  matchedTexts: string[];
}

const pad = (n: number) => String(n).padStart(2, "0");

function fmtLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 当天某个时刻（掐掉秒毫秒） */
function atTime(day: Date, hour: number, minute: number): Date {
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  d.setHours(hour, minute, 0, 0);
  return d;
}

/** 基准日 + n 天（保留年月日，掐掉时分） */
function addDays(day: Date, n: number): Date {
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

function midnight(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate());
}

// ---- 时间点：上午10点 / 下午3点半 / 晚上8:30 / 5pm / 14:00 ----

/** 时段前缀对小时的换算（下午/晚上 1-11 点 +12，其余原样） */
function applyPeriod(period: string, hour: number): number {
  if (/^(下午|傍晚|晚上|夜里|夜裏|今晚|明晚)/.test(period)) {
    return hour < 12 ? hour + 12 : hour;
  }
  // 上午 / 早上 / 清晨 / 凌晨 / 中午：原样（中午12点=12:00 最常见）
  return hour;
}

interface TimeMatch {
  hour: number;
  minute: number;
  source: string;
}

const TIME_RE =
  /(上午|早上|清晨|凌晨|中午|下午|傍晚|晚上|夜里|夜裏|今晚|明晚)?\s*(\d{1,2})(?:\s*(?:点|點|时|時|:|：)\s*(\d{1,2}|半|一刻|三刻)?|\s*(am|pm|AM|PM))?/g;

/** 在文本中找第一个可识别的时间点；找不到返回 null。裸数字不算时间 */
function parseTime(s: string): TimeMatch | null {
  // 全局扫描：左起的裸数字（如日期 "2026-12-01" 里的 20）不带时间标记，跳过继续找
  for (const m of s.matchAll(TIME_RE)) {
    if (!m[2]) continue;
    const hasMarker = m[3] !== undefined || m[4] !== undefined || /[点點时時:：]/.test(m[0]);
    if (!hasMarker) continue;

    let hour = Number(m[2]);
    let minute = 0;
    const minRaw = m[3];
    if (minRaw === "半") minute = 30;
    else if (minRaw === "一刻") minute = 15;
    else if (minRaw === "三刻") minute = 45;
    else if (minRaw) minute = Number(minRaw);

    if (m[4]) {
      // 5pm / 10AM：am/pm 优先于时段前缀
      const isPm = m[4].toLowerCase() === "pm";
      if (isPm && hour < 12) hour += 12;
      if (!isPm && hour === 12) hour = 0;
    } else if (m[1]) {
      hour = applyPeriod(m[1], hour);
    }
    if (hour > 23 || minute > 59) continue;
    return { hour, minute, source: m[0].trim() };
  }
  return null;
}

// ---- 日期：今天 / 明天 / 后天 / (下)周X / X月X日 / M/D / YYYY-M-D ----

interface DateMatch {
  day: Date;
  source: string;
}

const WEEKDAYS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0,
};

function parseDate(s: string, now: Date): DateMatch | null {
  // 相对日：今天 / 明天 / 后天 / 大后天
  let m = s.match(/(大后天|後天|后天|明天|明日|今天|今日)/);
  if (m) {
    const head = m[0][0];
    const offset = m[0].startsWith("大") ? 3 : head === "后" || head === "後" ? 2 : head === "明" ? 1 : 0;
    return { day: addDays(now, offset), source: m[0] };
  }
  // 星期：(下)周一 / 星期天 / 礼拜三（周一为一周起点）
  m = s.match(/(下)?(?:周|星期|礼拜|禮拜)([一二三四五六日天])/);
  if (m) {
    const target = WEEKDAYS[m[2]] === 0 ? 6 : WEEKDAYS[m[2]] - 1; // 周一=0 … 周日=6
    const cur = (now.getDay() + 6) % 7;
    const diff = (target - cur + 7) % 7;
    return { day: addDays(now, diff + (m[1] ? 7 : 0)), source: m[0] };
  }
  // 完整日期：2026-09-15 / 2026年9月15日
  m = s.match(/(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})日?/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!Number.isNaN(d.getTime())) return { day: d, source: m[0] };
  }
  // 月日：9月15日 / 9月15号；今年已过落明年
  m = s.match(/(\d{1,2})月(\d{1,2})(?:[日号號])?/);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      let d = new Date(now.getFullYear(), month - 1, day);
      if (d.getTime() < midnight(now).getTime()) d = new Date(now.getFullYear() + 1, month - 1, day);
      return { day: d, source: m[0] };
    }
  }
  // 斜杠日期：9/15（当年；过期落明年）
  m = s.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?=\s|$)/);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      let d = new Date(now.getFullYear(), month - 1, day);
      if (d.getTime() < midnight(now).getTime()) d = new Date(now.getFullYear() + 1, month - 1, day);
      return { day: d, source: m[0].trim() };
    }
  }
  return null;
}

/**
 * 解析一行快速捕捉输入。返回 null 表示没有可识别的时间 / 分类 / 标签
 * （或抽走后标题为空）——此时调用方应按普通文本处理，绝不猜。
 */
export function parseNlCapture(input: string, ctx: NlCaptureContext): NlCaptureResult | null {
  const now = ctx.now ?? new Date();
  const matchedTexts: string[] = [];
  let rest = input;

  // 1) 时间点先抽（避免 "10:00" 被 M/D 日期吞掉）
  const time = parseTime(rest);
  if (time) {
    rest = rest.replace(time.source, " ");
    matchedTexts.push(time.source);
  }

  // 2) 日期
  const date = parseDate(rest, now);
  if (date) {
    rest = rest.replace(date.source, " ");
    matchedTexts.push(date.source);
  }

  // 3) #分类名 / #标签名（只认启用分类与已有标签，未知名的 # 留在标题里）
  let categoryId: number | null = null;
  let categoryName: string | null = null;
  const tagIds: number[] = [];
  const tagNames: string[] = [];
  for (const hm of rest.matchAll(/#([^\s#，。,、!！?？:：;；]+)/g)) {
    const name = hm[1];
    const cat = ctx.categories.find((c) => c.enabled && c.name === name);
    if (cat) {
      categoryId = cat.id;
      categoryName = cat.name;
      rest = rest.replace(hm[0], " ");
      matchedTexts.push(hm[0]);
      continue;
    }
    const tag = ctx.tags.find((x) => x.name === name);
    if (tag) {
      tagIds.push(tag.id);
      tagNames.push(tag.name);
      rest = rest.replace(hm[0], " ");
      matchedTexts.push(hm[0]);
    }
  }

  if (!time && !date && categoryId === null && tagIds.length === 0) return null;

  // 4) 标题 = 剩余文本；被抽空就整体不识别（宁可少猜，不猜错）
  const title = rest.replace(/\s+/g, " ").trim();
  if (!title) return null;

  // 5) 组合截止时间：有日期有时间用两者；只有时间默认今天、已过顺延明天；
  //    只有日期缺省 09:00。预览展示实际时间，看着不对单击取消即可。
  let dueAt: string | null = null;
  if (date || time) {
    const base = date ? date.day : now;
    const hour = time ? time.hour : 9;
    const minute = time ? time.minute : 0;
    let due = atTime(base, hour, minute);
    if (!date && due.getTime() < now.getTime()) {
      due = atTime(addDays(now, 1), hour, minute);
    }
    dueAt = fmtLocal(due);
  }

  return { title, dueAt, categoryId, categoryName, tagIds, tagNames, matchedTexts };
}
