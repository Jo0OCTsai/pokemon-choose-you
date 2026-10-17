/**
 * 托盘三语文案（UIUX §8 托盘菜单/托盘退出确认行；FR-A1 三语切换——lang 下行驱动）。
 * tooltip 由 host 经 sys-config.tray.tooltip 组装下发；缺省回退本表 defaultTooltip。
 */
import type { Lang } from "../bridge/protocol.ts";

export interface TrayLabelSet {
  /** 菜单四项（FR-A1：打开图鉴机 / 显示·隐藏桌宠 / 设置 / 退出[确认一次]） */
  open: string;
  hidePet: string;
  showPet: string;
  settings: string;
  quit: string;
  /** 退出一次确认（UIUX §4.3 危险操作矩阵「托盘退出」） */
  quitTitle: string;
  quitMessage: string;
  quitOk: string;
  quitCancel: string;
}

const HANS: TrayLabelSet = {
  open: "打开图鉴机",
  hidePet: "隐藏桌宠",
  showPet: "显示桌宠",
  settings: "设置",
  quit: "退出",
  quitTitle: "退出确认",
  quitMessage: "退出将关闭桌宠与托盘（dsh 宿主不受影响）。确定退出？",
  quitOk: "退出",
  quitCancel: "取消",
};

const HANT: TrayLabelSet = {
  open: "開啟圖鑑機",
  hidePet: "隱藏桌寵",
  showPet: "顯示桌寵",
  settings: "設定",
  quit: "退出",
  quitTitle: "退出確認",
  quitMessage: "退出將關閉桌寵與托盤（dsh 宿主不受影響）。確定退出？",
  quitOk: "退出",
  quitCancel: "取消",
};

const EN: TrayLabelSet = {
  open: "Open Pokédex",
  hidePet: "Hide pet",
  showPet: "Show pet",
  settings: "Settings",
  quit: "Quit",
  quitTitle: "Quit?",
  quitMessage: "Quit closes the pet & tray (dsh host unaffected). Quit?",
  quitOk: "Quit",
  quitCancel: "Cancel",
};

const TABLE: Record<Lang, TrayLabelSet> = { "zh-Hans": HANS, "zh-Hant": HANT, en: EN };

export function trayLabels(lang: Lang): TrayLabelSet {
  return TABLE[lang] ?? HANS;
}

/** tooltip 缺省回退（「就决定是你了」三语——UIUX §8） */
export function defaultTooltip(lang: Lang): string {
  return lang === "en" ? "I choose you!" : lang === "zh-Hant" ? "就決定是你了" : "就决定是你了";
}
