/**
 * runtime 侧内置台词最小集（气泡文本 + 插值；结构对齐 UIUX §8 桌宠气泡列——
 * 词汇复用主应用 pet.* 同源键：caught=pet.catchOk / pomoDone=pet.pomoNotifTitle 族）。
 * 完整三语字典接入（A16：共享主应用 src/i18n/*.ts + dsh.* 增量键）是并行组 3 任务；
 * 渲染层另有一份更全的 renderer/lines.ts（右键菜单/药丸 title/行为组台词等 UI 面）。
 */
import type { Lang } from "../bridge/protocol.ts";

const LINES = {
  chooseYou: (l: Lang) => (l === "en" ? "I choose you!" : l === "zh-Hant" ? "就決定是你了！" : "就决定是你了！"),
  pomoDone: (l: Lang) =>
    l === "en"
      ? "🍅 Pomodoro done — take a break?"
      : l === "zh-Hant"
        ? "🍅 這輪番茄收工了，休息一下？"
        : "🍅 这轮番茄收工了，休息一下？",
  /** 🍦 试完收尾（=主应用 pet.trialDone——零挫败：不响长钟不接休息） */
  trialDone: (l: Lang) =>
    l === "en"
      ? "🍦 5 minutes logged! Continue with ▶ if it feels right, or stop for today — both win"
      : l === "zh-Hant"
        ? "🍦 5 分鐘打卡完成！感覺對了就 ▶ 繼續，今天到此為止也完全 OK"
        : "🍦 5 分钟打卡完成！感觉对了就 ▶ 继续，今天到此为止也完全 OK",
  /** 番茄到期系统通知（=主应用 pet.pomoNotifTitle/Body；pomodoro_notify 共享键门控） */
  pomoNotifTitle: (l: Lang) => (l === "en" ? "🍅 Pomodoro done!" : l === "zh-Hant" ? "🍅 番茄完成！" : "🍅 番茄完成！"),
  pomoNotifBody: (l: Lang, t = "", p = "") =>
    l === "en"
      ? `How far did '${t}' get? ${p} is resting with you~`
      : l === "zh-Hant"
        ? `「${t}」做到哪了？${p}陪你休息一下～`
        : `「${t}」做到哪了？${p}陪你休息一下~`,
  breakStart: (l: Lang) => (l === "en" ? "☕ taking a break" : l === "zh-Hant" ? "☕ 休息一下" : "☕ 休息一下"),
  breakOver: (l: Lang) =>
    l === "en"
      ? "☕ Break's over. Press ▶ for another round — your call"
      : l === "zh-Hant"
        ? "☕ 休息好了。點 ▶ 開新一輪番茄，你來定"
        : "☕ 休息好了。点 ▶ 开新一轮番茄，你来定",
  /** 捕捉成功（=主应用 pet.catchOk「✔ 捕捉成功！「{t}」记入图鉴啦」） */
  caught: (l: Lang, t = "") =>
    l === "en"
      ? `✔ Caught! "${t}" is logged in the dex`
      : l === "zh-Hant"
        ? `✔ 捕捉成功！「${t}」記入圖鑑啦`
        : `✔ 捕捉成功！「${t}」记入图鉴啦`,
  /** 收工清空（=主应用 pet.allDone——收尾台词最高优先级，allDone 送客陪跑） */
  allDone: (l: Lang, p = "") =>
    l === "en"
      ? `🎉 Today's dex is complete! ${p} says: wrap up and rest!`
      : l === "zh-Hant"
        ? `🎉 今日圖鑑圓滿！${p}說：收工，好好休息！`
        : `🎉 今日图鉴圆满！${p}说：收工，好好休息！`,
  /** 里程碑（=主应用 pet.milestone「★ 累计 {n} 只！{p}提议开一场图鉴庆典」） */
  milestone: (l: Lang, p = "", n = 0) =>
    l === "en"
      ? `★ ${String(n)} total catches! ${p} proposes a dex party`
      : l === "zh-Hant"
        ? `★ 累計 ${String(n)} 隻！${p}提議開一場圖鑑慶典`
        : `★ 累计 ${String(n)} 只！${p}提议开一场图鉴庆典`,
  /** 连胜（=主应用 pet.streakN「🐾 连胜 {n} 天！本周的草丛都被你踏平啦！」） */
  streakN: (l: Lang, n = 0) =>
    l === "en"
      ? `🐾 ${String(n)}-day streak! You've trampled every patch of grass this week!`
      : l === "zh-Hant"
        ? `🐾 連勝 ${String(n)} 天！本週的草叢都被你踏平啦！`
        : `🐾 连胜 ${String(n)} 天！本周的草丛都被你踏平啦！`,
} satisfies Record<string, (l: Lang, ...args: (string | number)[]) => string>;

export function formatCatching(l: Lang, p: string, t: string): string {
  return l === "en" ? `${p} is catching: ${t}` : `${p}正在捕捉：${t}`;
}

export function formatSettledElsewhere(l: Lang, t: string): string {
  return l === "en" ? `${t} was wrapped up on the other side` : `${t} 已在别处收工`;
}

export default LINES;
