/**
 * 内置三语台词（结构对齐 UIUX §8 文案表——桌宠气泡/菜单/ChatBox 列；插值位
 * {p}=宝可梦名、{t}=任务名、{n}=天数/里程碑数）。
 *
 * 同源声明（UIUX §8「行为组台词键归属」行）：FR-B2 时刻台词 / FR-B4 陪跑 / FR-B5 问候
 * 与打盹台词**复用主应用 pet.\* 同源键的词汇**（值取 src/i18n/zh-Hans.ts pet: 段同文，
 * 不新造语义）；FR-B1 坐栖与 FR-A8 ChatBox 用 UIUX §8 helper 行文案。完整三语字典接入
 * （A16：共享主应用 src/i18n/*.ts）是并行组 3 任务，此处先内置同文值。
 */
import type { Lang } from "../bridge/protocol.ts";

export interface LineSet {
  /** 出发开场（快捷屏点选「▶ 出发」的本地即时反馈；宿主回推 task-state 后另有 {p}正在捕捉：{t}） */
  chooseYou: string;
  /** 时段问候（早/午/晚/深夜各一次——pet.greet* 同文，{p}=宝可梦名） */
  greetMorning: string;
  greetDay: string;
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
  /** AI 聊聊入口（UIUX §8 helper 行；agentConfigured 才现——接线注记见 helper/README） */
  menuChat: string;
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
  // ---- FR-B2 时刻台词（pet.hourLine/nightLine/fridayLine 同文；生日 = UIUX §8 行） ----
  hourLine: string;
  nightLine: string;
  fridayLine: string;
  /** 生日台词（带陪伴天数 {n}；UIUX §8「今天是和{p}相遇的第 {n} 天！」） */
  birthdayLine: string;
  // ---- FR-B1 坐栖（UIUX §8 helper 行） ----
  perchedLine: string;
  // ---- FR-B5 打盹（pet.asleepHint/wakeUp 同文） ----
  asleepHint: string;
  wakeUp: string;
  // ---- FR-B4 陪跑（pet.mateHint 同文） ----
  mateHint: string;
  // ---- FR-A8 ChatBox（UIUX §8 helper 行 + pet.chatGreet/chatPh 同文） ----
  chatGreet: string;
  chatThinking: string;
  chatFail: string;
  chatPh: string;
  chatSend: string;
  chatClose: string;
  chatChips: [string, string, string];
}

const hans: LineSet = {
  chooseYou: "就决定是你了！",
  greetMorning: "早安！{p}精神满满，今天也一起出发吧",
  greetDay: "下午好！{p}在草丛边等你挑目标",
  greetEvening: "晚上好！今天的冒险还剩一点，{p}陪你收尾",
  greetNight: "夜深了，{p}说：再专注也要睡觉哦",
  chatQuotes: ["嗯？有什么事吗？", "我在听呢。", "皮皮～", "要一起去草丛看看吗？"],
  petQuotes: ["嘿嘿，好舒服～", "再摸摸头也可以哦。", "呼噜呼噜……"],
  quickEmpty: "草丛静悄悄——今天还没有待捕捉的目标",
  menuSwitch: "⇄ 换目标",
  menuOpenPage: "打开图鉴机页面",
  menuHide: "隐藏桌宠",
  menuChat: "💬 对话",
  spriteMissing: "素材缺失，先由{p}代班",
  pausedLine: "{p}在原地休息",
  escapedLine: "{t} 逃走了，下次再遇到它",
  pillPause: "暂停",
  pillResume: "继续",
  pillDone: "完成捕捉",
  pillTrial: "🍦 先试 5 分钟",
  hourLine: "🐾 整点报时：这个小时也一起加油",
  nightLine: "这么晚了还在冒险……收工也是很强的选择哦",
  fridayLine: "🐾 路线上的宝可梦都说：周末快乐！",
  birthdayLine: "今天是和{p}相遇的第 {n} 天！",
  perchedLine: "{p}在桌沿坐下来了",
  asleepHint: "（睡着了，动一下鼠标或点点它）",
  wakeUp: "呜哇——{p}揉揉眼睛：你回来啦！",
  mateHint: "陪跑的客人（点它就挥手告别）",
  chatGreet: "🐾 在的在的！任务和图鉴的事都可以问我（Esc 收起）",
  chatThinking: "（{p}歪着头思考…）",
  chatFail: "（{p}没听清，再说一次？）",
  chatPh: "问它任务 / 图鉴的事…",
  chatSend: "发送",
  chatClose: "收起对话",
  chatChips: ["连胜几天了？", "接下来做什么？", "今天辛苦了"],
};

const hant: LineSet = {
  chooseYou: "就決定是你了！",
  greetMorning: "早安！{p}精神滿滿，今天也一起出發吧",
  greetDay: "午安！{p}在草叢邊等你挑目標",
  greetEvening: "晚上好！今天的冒險還剩一點，{p}陪你收尾",
  greetNight: "夜深了，{p}說：再專注也要睡覺哦",
  chatQuotes: ["嗯？有什麼事嗎？", "我在聽呢。", "皮皮～", "要一起去草叢看看嗎？"],
  petQuotes: ["嘿嘿，好舒服～", "再摸摸頭也可以哦。", "呼嚕呼嚕……"],
  quickEmpty: "草叢靜悄悄——今天還沒有待捕捉的目標",
  menuSwitch: "⇄ 換目標",
  menuOpenPage: "打開圖鑑機頁面",
  menuHide: "隱藏桌寵",
  menuChat: "💬 對話",
  spriteMissing: "素材缺失，先由{p}代班",
  pausedLine: "{p}在原地休息",
  escapedLine: "{t}逃走了，下次再遇到它",
  pillPause: "暫停",
  pillResume: "繼續",
  pillDone: "完成捕捉",
  pillTrial: "🍦 先試 5 分鐘",
  hourLine: "🐾 整點報時：這個小時也一起加油",
  nightLine: "這麼晚了還在冒險……收工也是很強的選擇哦",
  fridayLine: "🐾 路線上的寶可夢都說：週末快樂！",
  birthdayLine: "今天是和{p}相遇的第 {n} 天！",
  perchedLine: "{p}在桌沿坐下來了",
  asleepHint: "（睡著了，動一下滑鼠或點點它）",
  wakeUp: "嗚哇——{p}揉揉眼睛：你回來啦！",
  mateHint: "陪跑的客人（點牠就揮手告別）",
  chatGreet: "🐾 在的在的！任務和圖鑑的事都可以問我（Esc 收起）",
  chatThinking: "（{p}歪著頭思考…）",
  chatFail: "（{p}沒聽清，再說一次？）",
  chatPh: "問牠任務 / 圖鑑的事…",
  chatSend: "送出",
  chatClose: "收起對話",
  chatChips: ["連勝幾天了？", "接下來做什麼？", "今天辛苦了"],
};

const en: LineSet = {
  chooseYou: "I choose you!",
  greetMorning: "Morning! {p} is fresh and ready to head out",
  greetDay: "Good afternoon! {p} waits by the tall grass",
  greetEvening: "Good evening! A bit of adventure left—{p} is with you",
  greetNight: "It's late—{p} says: focus, but sleep too",
  chatQuotes: ["Hm? What's up?", "I'm listening.", "Pika~", "Shall we check the tall grass?"],
  petQuotes: ["Hehe, that's nice~", "Head pats welcome.", "Purr purr…"],
  quickEmpty: "The tall grass is quiet — nothing to catch today yet",
  menuSwitch: "⇄ Switch target",
  menuOpenPage: "Open Pokédex page",
  menuHide: "Hide pet",
  menuChat: "💬 Chat",
  spriteMissing: "Sprite missing — {p} is standing in",
  pausedLine: "{p} is resting",
  escapedLine: "{t} got away — you'll meet again",
  pillPause: "Pause",
  pillResume: "Resume",
  pillDone: "Complete catch",
  pillTrial: "🍦 Try 5 minutes",
  hourLine: "🐾 On the hour: let's keep it up this hour too",
  nightLine: "Adventuring this late… wrapping up is a strong move too",
  fridayLine: "🐾 The Pokemon along your route say: happy weekend!",
  birthdayLine: "Day {n} with {p}!",
  perchedLine: "{p} settles on the desk edge",
  asleepHint: "(Fast asleep—wiggle the mouse or give it a poke)",
  wakeUp: "Whoa—{p} rubs its eyes: you're back!",
  mateHint: "A visiting companion (tap to wave goodbye)",
  chatGreet: "🐾 I'm here! Ask me about tasks or the Pokedex (Esc to close)",
  chatThinking: "({p} tilts its head, thinking…)",
  chatFail: "({p} didn't catch that — once more?)",
  chatPh: "Ask about tasks / Pokedex…",
  chatSend: "Send",
  chatClose: "Close chat",
  chatChips: ["Streak lately?", "What's next?", "Good work today"],
};

const LINES: Record<Lang, LineSet> = { "zh-Hans": hans, "zh-Hant": hant, en };

export function lines(lang: Lang): LineSet {
  return LINES[lang] ?? hans;
}

/** {p}/{t}/{n} 插值 */
export function fill(line: string, vars: { p?: string; t?: string; n?: number | string }): string {
  return line
    .replaceAll("{p}", vars.p ?? "")
    .replaceAll("{t}", vars.t ?? "")
    .replaceAll("{n}", String(vars.n ?? ""));
}

/** 时段问候取词（早 5–11 / 午 11–17 / 晚 17–22 / 深夜 22–5——与 state/greetings.ts 同带） */
export function greetingLine(set: LineSet, hour: number): string {
  if (hour >= 5 && hour < 11) return set.greetMorning;
  if (hour >= 11 && hour < 17) return set.greetDay;
  if (hour >= 17 && hour < 22) return set.greetEvening;
  return set.greetNight;
}
