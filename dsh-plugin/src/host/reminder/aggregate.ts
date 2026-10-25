/**
 * 提醒聚合与送达决策（FR-A3 · 桌面 scheduler.rs decide_delivery / notification_text /
 * aggregated_notification_text / in_quiet_hours / parse_hm 同构，逐分支对齐）：
 * 单条原样 / 多条聚合（点名前 3 + 等 N 项、任一紧急整体 ‼ 前缀）；勿扰判定（跨零点、
 * start==end 视为关、解析失败 fail-open、urgent/high 例外仍敲门）。
 * 输出供 loop/deliver（组 2.7）消费：notification/pet null = 通知关或送达集空（两通道
 * 同门控，不发）；deliver 集 + silenced 供 toast 降级与分段计数——勿扰静默 = 0 补发
 * （抢到即置 reminded，本决策只决定「发不发」）。
 */
import { isUrgent, type Reminder, type ReminderSettings } from "./query";

/** 桌宠事件载荷（loop 侧经桥 emit，供敲门/催促动画——桌面 PetReminderEvent 同构） */
export interface PetReminderEvent {
  id: number;
  title: string;
  urgent: boolean;
  pokemon: string | null;
}

export interface NotificationText {
  title: string;
  body: string;
}

/** 送达决策（纯函数输出——桌面 DeliveryDecision 同构，IO 侧只消费不发） */
export interface DeliveryDecision {
  /** 当前时刻是否在勿扰时段内 */
  quiet: boolean;
  /** 勿扰静默掉的非紧急条数（已抢到标记但不送达、不补发） */
  silenced: number;
  /** 送达集（勿扰滤网后；通知关时也保留，由调用方看决策） */
  deliver: Reminder[];
  /** 系统通知文案（通知开且送达集非空才有；host 组装经 sys-notify 下发） */
  notification: NotificationText | null;
  /** 桌宠事件载荷（与系统通知同门控） */
  pet: PetReminderEvent | null;
}

/** "HH:MM" → 当日分钟数（设置里的勿扰边界；解析失败 null → 调用方 fail-open） */
export function parseHm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(s);
  if (m === null) {
    return null;
  }
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) {
    return null;
  }
  return h * 60 + mi;
}

/** 勿扰时段判定（桌面 in_quiet_hours 镜像）：start==end 视为关；支持跨零点区间 */
export function inQuietHours(nowMinutes: number, startMinutes: number, endMinutes: number): boolean {
  if (startMinutes === endMinutes) {
    return false;
  }
  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

/**
 * 送达决策（纯函数，无 IO；桌面 decide_delivery 镜像）：入参 = 设置快照 + 抢到送达权
 * 的到期集 + 当前本地时刻（当日分钟数）。注意力友好：一次只强调一件事——单条原样、
 * 多条聚合成一条、桌宠只敲一次门（代表选紧急优先）；通知关闭时两通道都不发。
 */
export function decideDelivery(
  settings: ReminderSettings,
  claimed: Reminder[],
  nowLocalMinutes: number,
): DeliveryDecision {
  // 勿扰判定：边界解析失败视为关闭（fail open，宁可多提醒也不静默丢事）
  const start = parseHm(settings.quietStart);
  const end = parseHm(settings.quietEnd);
  const quiet = settings.quietOn && start !== null && end !== null && inQuietHours(nowLocalMinutes, start, end);
  const deliver = quiet ? claimed.filter((r) => isUrgent(r.priority)) : [...claimed];
  const silenced = claimed.length - deliver.length;
  let notification: NotificationText | null = null;
  let pet: PetReminderEvent | null = null;
  if (deliver.length > 0 && settings.notifyOn) {
    if (deliver.length === 1) {
      const r = deliver[0];
      notification = notificationText(settings.lang, isUrgent(r.priority), r.title, r.pokemon);
      pet = petEventOf(r);
    } else {
      const anyUrgent = deliver.some((r) => isUrgent(r.priority));
      notification = aggregatedNotificationText(
        settings.lang,
        deliver.map((r) => r.title),
        anyUrgent,
      );
      pet = petEventOf(deliver.find((r) => isUrgent(r.priority)) ?? deliver[0]);
    }
  }
  return { quiet, silenced, deliver, notification, pet };
}

function petEventOf(r: Reminder): PetReminderEvent {
  return { id: r.id, title: r.title, urgent: isUrgent(r.priority), pokemon: r.pokemon };
}

/**
 * 单条通知文案（桌面 notification_text 镜像 · 三语两档；未知语言回退简体）：
 * body 附分类宝可梦名（en 半角括号、中文全角括号）
 */
export function notificationText(
  lang: string,
  urgent: boolean,
  title: string,
  pokemon: string | null,
): NotificationText {
  const subject = pokemon === null ? title : lang === "en" ? `${title} (${pokemon})` : `${title}（${pokemon}）`;
  if (lang === "zh-Hant") {
    return urgent
      ? { title: "‼ 訓練家，快看快看！", body: `緊急任務提醒：${subject}` }
      : { title: "🐾 訓練家，別忘了", body: subject };
  }
  if (lang === "en") {
    return urgent
      ? { title: "‼ Trainer, quick look!", body: `Urgent: ${subject}` }
      : { title: "🐾 Trainer, don't forget", body: subject };
  }
  return urgent
    ? { title: "‼ 训练家，快看快看！", body: `紧急任务提醒：${subject}` }
    : { title: "🐾 训练家，别忘了", body: subject };
}

/**
 * 聚合通知文案（桌面 aggregated_notification_text 镜像 · 三语）：点名前 3 条 +
 * 等 N 项；任一紧急整体 ‼ 前缀（点名条目自身不带前缀）
 */
export function aggregatedNotificationText(lang: string, titles: string[], anyUrgent: boolean): NotificationText {
  const n = titles.length;
  const sep = lang === "en" ? ", " : "、";
  const shown = titles.slice(0, 3).join(sep);
  const badge = anyUrgent ? "‼" : "🐾";
  if (lang === "zh-Hant") {
    return {
      title: `${badge} ${n} 隻寶可夢同時敲門！`,
      body: `點名：${n > 3 ? `${shown} 等 ${n} 項` : shown}——到冒險頁逐隻看看`,
    };
  }
  if (lang === "en") {
    return {
      title: `${badge} ${n} Pokemon knocking at once!`,
      body: `${n > 3 ? `${shown} and more` : shown} are due — check the Adventure list`,
    };
  }
  return {
    title: `${badge} ${n} 只宝可梦同时敲门！`,
    body: `点名：${n > 3 ? `${shown} 等 ${n} 项` : shown}——到冒险页逐只看看`,
  };
}

/**
 * 逾期 fresh start 温和告知文案（桌面 fresh_start_notification_text 镜像 · 三语；
 * 反羞耻口径——溜回去不是失败，想好了再去看）。
 */
export function freshStartText(lang: string, n: number): NotificationText {
  if (lang === "zh-Hant") {
    return { title: "🐾 有寶可夢溜回草叢", body: `${n} 隻逾期的小傢伙回了草叢——想好了再去看，不急` };
  }
  if (lang === "en") {
    return {
      title: "🐾 Some Pokemon slipped back",
      body: `${n} overdue friends returned to the grass — visit when you're ready`,
    };
  }
  return { title: "🐾 有宝可梦溜回草丛", body: `${n} 只逾期的小家伙回了草丛——想好了再去看，不急` };
}

/** 复盘提醒文案（桌面 review_notification_text 镜像 · 三语带本周战绩） */
export function reviewText(lang: string, caught: number, focusMin: number): NotificationText {
  if (lang === "zh-Hant") {
    return {
      title: "🧢 訓練家複盤",
      body: `本週捕捉 ${caught} 隻、專注 ${focusMin} 分鐘——到圖鑑頁點「複盤」逐站整理路線與草叢`,
    };
  }
  if (lang === "en") {
    return {
      title: "🧢 Trainer review",
      body: `${caught} caught, ${focusMin} focus min this week — open the Dex tab and run the review`,
    };
  }
  return {
    title: "🧢 训练家复盘",
    body: `本周捕捉 ${caught} 只、专注 ${focusMin} 分钟——到图鉴页点「复盘」逐站整理路线与草丛`,
  };
}
