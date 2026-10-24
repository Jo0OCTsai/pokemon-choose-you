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
} satisfies Record<string, (l: Lang, t?: string) => string>;

export function formatCatching(l: Lang, p: string, t: string): string {
  return l === "en" ? `${p} is catching: ${t}` : `${p}正在捕捉：${t}`;
}

export function formatSettledElsewhere(l: Lang, t: string): string {
  return l === "en" ? `${t} was wrapped up on the other side` : `${t} 已在别处收工`;
}

export default LINES;
