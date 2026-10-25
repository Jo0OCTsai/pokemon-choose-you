/**
 * reminder/aggregate：勿扰判定全边界（跨零点 / start==end / 解析失败 fail-open / 开关关 /
 * 紧急例外）、送达决策（单条原样 / 多条聚合点名前 3 / 任一紧急 ‼ 前缀 / 通知关双通道不发 /
 * silenced 计数）、三语文案（单条 + 聚合、未知语言回退）。行为基准 = 桌面
 * scheduler.rs decide_delivery 系（contracts/fixtures/reminder 锁定）。
 */
import { describe, expect, it } from "vitest";
import type { Reminder, ReminderSettings } from "../src/host/reminder/query";
import {
  aggregatedNotificationText,
  decideDelivery,
  inQuietHours,
  notificationText,
  parseHm,
} from "../src/host/reminder/aggregate";

const NOON = 12 * 60;
const LATE = 23 * 60 + 30;

function reminder(id: number, title: string, priority: string, pokemon: string | null = null): Reminder {
  return { id, title, priority, pokemon };
}

function settings(partial: Partial<ReminderSettings> = {}): ReminderSettings {
  return {
    leadMinutes: 0,
    notifyOn: true,
    quietOn: true,
    quietStart: "22:00",
    quietEnd: "08:00",
    lang: "zh-Hans",
    ...partial,
  };
}

// ---- parseHm / inQuietHours：勿扰边界全枚举 ----

describe("parseHm", () => {
  it("合法 HH:MM → 当日分钟数；非法拒绝", () => {
    expect(parseHm("22:00")).toBe(22 * 60);
    expect(parseHm("08:05")).toBe(8 * 60 + 5);
    expect(parseHm("25:00")).toBeNull();
    expect(parseHm("22:99")).toBeNull();
    expect(parseHm("")).toBeNull();
    expect(parseHm("bad!")).toBeNull();
    expect(parseHm("2ab:00")).toBeNull();
  });
});

describe("inQuietHours", () => {
  const start = parseHm("22:00") as number;
  const end = parseHm("08:00") as number;

  it("跨零点区间：深夜与清晨都在内，白天不在；起点含、终点不含", () => {
    expect(inQuietHours(parseHm("23:30") as number, start, end)).toBe(true);
    expect(inQuietHours(parseHm("05:59") as number, start, end)).toBe(true);
    expect(inQuietHours(NOON, start, end)).toBe(false);
    expect(inQuietHours(start, start, end)).toBe(true);
    expect(inQuietHours(end, start, end)).toBe(false);
  });

  it("不跨零点区间与 start==end 视为关", () => {
    expect(inQuietHours(13 * 60, 12 * 60, 14 * 60)).toBe(true);
    expect(inQuietHours(15 * 60, 12 * 60, 14 * 60)).toBe(false);
    expect(inQuietHours(12 * 60, 22 * 60, 22 * 60)).toBe(false);
  });
});

// ---- decideDelivery：送达决策 ----

describe("decideDelivery", () => {
  it("单条原样：文案附分类宝可梦名，桌宠载荷同门控", () => {
    const d = decideDelivery(settings(), [reminder(1, "交周报", "normal", "皮卡丘")], NOON);
    expect(d.notification).toEqual({ title: "🐾 训练家，别忘了", body: "交周报（皮卡丘）" });
    expect(d.pet).toEqual({ id: 1, title: "交周报", urgent: false, pokemon: "皮卡丘" });
    expect(d.quiet).toBe(false);
    expect(d.silenced).toBe(0);
    expect(d.deliver.map((r) => r.id)).toEqual([1]);
  });

  it("多条聚合：任一紧急整体 ‼ 前缀，桌宠代表选第一条紧急", () => {
    const d = decideDelivery(
      settings({ quietOn: false }),
      [reminder(1, "一", "normal"), reminder(2, "二", "urgent")],
      NOON,
    );
    expect(d.notification?.title).toBe("‼ 2 只宝可梦同时敲门！");
    expect(d.notification?.body).toBe("点名：一、二——到冒险页逐只看看");
    expect(d.pet).toEqual({ id: 2, title: "二", urgent: true, pokemon: null });
  });

  it("多条点名封顶前 3 + 等 N 项", () => {
    const d = decideDelivery(
      settings(),
      [1, 2, 3, 4, 5].map((i) => reminder(i, `任务${i}`, "normal")),
      NOON,
    );
    expect(d.notification?.body).toContain("任务1、任务2、任务3 等 5 项");
    expect(d.notification?.body).not.toContain("任务4");
    expect(d.pet?.id).toBe(1);
  });
});

describe("decideDelivery：勿扰与开关路径", () => {
  it("勿扰内：非紧急静默（silenced 计数、不进送达集）、紧急例外仍敲门", () => {
    const d = decideDelivery(settings(), [reminder(1, "普通", "normal"), reminder(2, "紧急", "high")], LATE);
    expect(d.quiet).toBe(true);
    expect(d.silenced).toBe(1);
    expect(d.deliver.map((r) => r.id)).toEqual([2]);
    expect(d.notification?.title.startsWith("‼")).toBe(true);
    expect(d.pet?.id).toBe(2);
  });

  it("勿扰全静默：送达集空 → 双通道 null", () => {
    const d = decideDelivery(settings(), [reminder(1, "普通", "normal")], LATE);
    expect(d.quiet).toBe(true);
    expect(d.silenced).toBe(1);
    expect(d.deliver).toEqual([]);
    expect(d.notification).toBeNull();
    expect(d.pet).toBeNull();
  });

  it("通知关：系统通知与桌宠事件都不发（送达集保留给调用方）", () => {
    const d = decideDelivery(settings({ notifyOn: false }), [reminder(1, "x", "normal")], NOON);
    expect(d.notification).toBeNull();
    expect(d.pet).toBeNull();
    expect(d.deliver).toHaveLength(1);
  });

  it("fail-open：边界解析失败 / start==end / 勿扰开关关 都不静默", () => {
    const bad = decideDelivery(settings({ quietStart: "bad!" }), [reminder(1, "普通", "normal")], LATE);
    expect(bad.quiet).toBe(false);
    expect(bad.notification).not.toBeNull();
    const eq = decideDelivery(
      settings({ quietStart: "23:30", quietEnd: "23:30" }),
      [reminder(1, "普通", "normal")],
      LATE,
    );
    expect(eq.quiet).toBe(false);
    const off = decideDelivery(settings({ quietOn: false }), [reminder(1, "普通", "normal")], LATE);
    expect(off.quiet).toBe(false);
  });
});

// ---- 三语文案 ----

describe("notificationText（三语 × 紧急/普通 × 宝可梦后缀）", () => {
  it("简体两档 + 全角括号后缀", () => {
    expect(notificationText("zh-Hans", true, "交报告", null)).toEqual({
      title: "‼ 训练家，快看快看！",
      body: "紧急任务提醒：交报告",
    });
    expect(notificationText("zh-Hans", false, "交报告", "皮卡丘")).toEqual({
      title: "🐾 训练家，别忘了",
      body: "交报告（皮卡丘）",
    });
  });

  it("繁体 / 英文 / 未知语言回退简体", () => {
    expect(notificationText("zh-Hant", false, "交報告", null)).toEqual({
      title: "🐾 訓練家，別忘了",
      body: "交報告",
    });
    expect(notificationText("en", true, "report", "Pikachu")).toEqual({
      title: "‼ Trainer, quick look!",
      body: "Urgent: report (Pikachu)",
    });
    expect(notificationText("fr", false, "x", null).title).toBe("🐾 训练家，别忘了");
  });
});

describe("aggregatedNotificationText（三语 + 前 3 封顶）", () => {
  it("简体：2 条点名全列、任一紧急换 ‼ 徽标", () => {
    const calm = aggregatedNotificationText("zh-Hans", ["交周报", "取快递"], false);
    expect(calm.title).toBe("🐾 2 只宝可梦同时敲门！");
    expect(calm.body).toBe("点名：交周报、取快递——到冒险页逐只看看");
    const urgent = aggregatedNotificationText("zh-Hans", ["a"], true);
    expect(urgent.title).toBe("‼ 1 只宝可梦同时敲门！");
  });

  it("繁体 / 英文（and more）/ 未知语言回退简体", () => {
    const ht = aggregatedNotificationText("zh-Hant", ["a", "b"], false);
    expect(ht.title).toBe("🐾 2 隻寶可夢同時敲門！");
    expect(ht.body).toContain("冒險頁");
    const en = aggregatedNotificationText("en", ["a", "b", "c", "d"], false);
    expect(en.title).toBe("🐾 4 Pokemon knocking at once!");
    expect(en.body).toBe("a, b, c and more are due — check the Adventure list");
    expect(aggregatedNotificationText("fr", ["a"], false).title).toBe("🐾 1 只宝可梦同时敲门！");
  });

  it("第 4 条起不点名、尾部汇总总数", () => {
    const { body } = aggregatedNotificationText("zh-Hans", ["一", "二", "三", "四", "五"], false);
    expect(body).toContain("一、二、三");
    expect(body).toContain("等 5 项");
    expect(body).not.toContain("四");
  });
});
