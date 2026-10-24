/**
 * 每日时段问候纯逻辑（FR-B5，桌面 greetOnce 的「各时段一次」扩版——UIUX §3.2
 * GreetingScheduler：早/午/晚/深夜问候每日各一次）：时段带沿用 helper 台词表既有
 * 切分（早 5–11 / 午 11–17 / 晚 17–22 / 深夜 22–5）；去重键按「时段 × 日期」，
 * 存储注入（渲染层 localStorage，与桌面 pet.greetedOn 同族键位）。
 */

export type GreetPeriod = "morning" | "day" | "evening" | "night";

/** 时段带（小时 → 时段；深夜 = 22–5 跨零点带） */
export function greetPeriod(hour: number): GreetPeriod {
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 17) return "day";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

/** 去重键：pet.greet.<period>.<yyyy-m-d>（本地时区自然日） */
export function greetDedupKey(period: GreetPeriod, now: Date): string {
  return `pet.greet.${period}.${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/** 键值存储抽象（渲染层传 localStorage；测试传内存 Map；不可用时传 null 存储 = 全跳过） */
export interface GreetStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export class InMemoryGreetStorage implements GreetStorage {
  private readonly map = new Map<string, string>();
  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
}

/**
 * 时段问候调度（时钟注入）：due() 返回本时段尚未问候过的时段（并记账）；
 * 全部时段已问候/存储不可用 → null。调用方自行守「可说话」态（睡着/演出/对话中不插话）。
 */
export class PeriodGreeter {
  private readonly storage: GreetStorage | null;
  private readonly now: () => Date;

  constructor(storage: GreetStorage | null, now: () => Date) {
    this.storage = storage;
    this.now = now;
  }

  due(): GreetPeriod | null {
    if (this.storage === null) return null;
    const now = this.now();
    const period = greetPeriod(now.getHours());
    const key = greetDedupKey(period, now);
    if (this.storage.get(key) !== null) return null;
    this.storage.set(key, "1");
    return period;
  }
}
