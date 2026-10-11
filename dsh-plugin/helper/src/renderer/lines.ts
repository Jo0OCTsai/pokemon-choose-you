/**
 * 内置三语台词最小集（结构对齐 UIUX §8 文案表——桌宠气泡列；插值位 {p}=宝可梦名、{t}=任务名）。
 * 完整三语字典接入（A16：共享主应用 src/i18n/*.ts + dsh.* 增量键）是并行组 3 任务，此处先内置。
 */
import type { Lang } from "../bridge/protocol.ts";

export interface LineSet {
  /** 出发开场（快捷屏点选「▶ 出发」的本地即时反馈；宿主回推 task-state 后另有 {p}正在捕捉：{t}） */
  chooseYou: string;
  /** 时段问候（每日首现一次；早/午/晚/深夜四档） */
  greetMorning: string;
  greetNoon: string;
  greetEvening: string;
  greetNight: string;
  /** 单击搭话台词池（宝可梦视角） */
  chatQuotes: string[];
  /** 撸宠（长按 600ms）专属台词池 */
  petQuotes: string[];
  /** 快捷屏空态 */
  quickEmpty: string;
  /** 右键菜单 */
  menuSwitch: string;
  menuOpenPage: string;
  menuHide: string;
  /** 素材缺失单次提示（A20） */
  spriteMissing: string;
  /** 暂停 */
  pausedLine: string;
  /** 被逃走（中性，不指责） */
  escapedLine: string;
  /** 药丸按钮 title */
  pillPause: string;
  pillResume: string;
  pillDone: string;
  pillTrial: string;
}

const hans: LineSet = {
  chooseYou: "就决定是你了！",
  greetMorning: "早安！今天也要出发冒险吗？",
  greetNoon: "中午好，草丛里静悄悄的。",
  greetEvening: "晚上好，今天的图鉴收获得如何？",
  greetNight: "夜深了，早点休息吧。",
  chatQuotes: ["嗯？有什么事吗？", "我在听呢。", "皮皮～", "要一起去草丛看看吗？"],
  petQuotes: ["嘿嘿，好舒服～", "再摸摸头也可以哦。", "呼噜呼噜……"],
  quickEmpty: "草丛静悄悄——今天还没有待捕捉的目标",
  menuSwitch: "⇄ 换目标",
  menuOpenPage: "打开图鉴机页面",
  menuHide: "隐藏桌宠",
  spriteMissing: "素材缺失，先由{p}代班",
  pausedLine: "{p}在原地休息",
  escapedLine: "{t} 逃走了，下次再遇到它",
  pillPause: "暂停",
  pillResume: "继续",
  pillDone: "完成捕捉",
  pillTrial: "🍦 先试 5 分钟",
};

const hant: LineSet = {
  chooseYou: "就決定是你了！",
  greetMorning: "早安！今天也要出發冒險嗎？",
  greetNoon: "中午好，草叢裡靜悄悄的。",
  greetEvening: "晚上好，今天的圖鑑收穫得如何？",
  greetNight: "夜深了，早點休息吧。",
  chatQuotes: ["嗯？有什麼事嗎？", "我在聽呢。", "皮皮～", "要一起去草叢看看嗎？"],
  petQuotes: ["嘿嘿，好舒服～", "再摸摸頭也可以哦。", "呼嚕呼嚕……"],
  quickEmpty: "草叢靜悄悄——今天還沒有待捕捉的目標",
  menuSwitch: "⇄ 換目標",
  menuOpenPage: "打開圖鑑機頁面",
  menuHide: "隱藏桌寵",
  spriteMissing: "素材缺失，先由{p}代班",
  pausedLine: "{p}在原地休息",
  escapedLine: "{t}逃走了，下次再遇到它",
  pillPause: "暫停",
  pillResume: "繼續",
  pillDone: "完成捕捉",
  pillTrial: "🍦 先試 5 分鐘",
};

const en: LineSet = {
  chooseYou: "I choose you!",
  greetMorning: "Morning! Ready for today's adventure?",
  greetNoon: "Good noon — the tall grass is quiet.",
  greetEvening: "Good evening — how's the Pokédex today?",
  greetNight: "It's late — rest up.",
  chatQuotes: ["Hm? What's up?", "I'm listening.", "Pika~", "Shall we check the tall grass?"],
  petQuotes: ["Hehe, that's nice~", "Head pats welcome.", "Purr purr…"],
  quickEmpty: "The tall grass is quiet — nothing to catch today yet",
  menuSwitch: "⇄ Switch target",
  menuOpenPage: "Open Pokédex page",
  menuHide: "Hide pet",
  spriteMissing: "Sprite missing — {p} is standing in",
  pausedLine: "{p} is resting",
  escapedLine: "{t} got away — you'll meet again",
  pillPause: "Pause",
  pillResume: "Resume",
  pillDone: "Complete catch",
  pillTrial: "🍦 Try 5 minutes",
};

const LINES: Record<Lang, LineSet> = { "zh-Hans": hans, "zh-Hant": hant, en };

export function lines(lang: Lang): LineSet {
  return LINES[lang] ?? hans;
}

/** {p}/{t} 插值 */
export function fill(line: string, vars: { p?: string; t?: string }): string {
  return line.replaceAll("{p}", vars.p ?? "").replaceAll("{t}", vars.t ?? "");
}

/** 按当前时段取问候（早 5-11 / 午 11-17 / 晚 17-22 / 深夜 22-5） */
export function greetingFor(set: LineSet, hour: number): string {
  if (hour >= 5 && hour < 11) return set.greetMorning;
  if (hour >= 11 && hour < 17) return set.greetNoon;
  if (hour >= 17 && hour < 22) return set.greetEvening;
  return set.greetNight;
}
