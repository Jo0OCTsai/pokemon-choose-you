/**
 * 显示偏好上下文（date_format / time_format）：与 i18n locale 并列的面板级呈现偏好。
 * 共享设置（PanelData.config）单值读出 → 上下文注入，UI 层经 useDisplayPrefs 消费——
 * 改期弹窗等深层位不持 PanelData，避免 props 钻透；缺省/非法值回落 YYYY-MM-DD / 24h
 * （与 optionSets normalizeSettingValues 归一化口径一致）。语言不走此处（I18nProvider
 * 已有 locale 即时跟随机制，picker 经 useI18n 取）。
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DATE_FORMATS } from "../settings/optionSets";
import type { DateFormat, TimeFormat } from "./dateTime";

export interface DisplayPrefs {
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
}

/** 共享设置键 → 呈现偏好（未落盘/非法值回落缺省档） */
export function displayPrefsOf(config: Record<string, string>): DisplayPrefs {
  const rawDate = config["date_format"] ?? "";
  return {
    dateFormat: (DATE_FORMATS as readonly string[]).includes(rawDate) ? (rawDate as DateFormat) : "YYYY-MM-DD",
    timeFormat: config["time_format"] === "12h" ? "12h" : "24h",
  };
}

const DEFAULT_PREFS: DisplayPrefs = { dateFormat: "YYYY-MM-DD", timeFormat: "24h" };

const DisplayPrefsContext = createContext<DisplayPrefs>(DEFAULT_PREFS);

export function DisplayPrefsProvider({
  dateFormat,
  timeFormat,
  children,
}: DisplayPrefs & { children: ReactNode }): React.JSX.Element {
  const value = useMemo<DisplayPrefs>(() => ({ dateFormat, timeFormat }), [dateFormat, timeFormat]);
  return <DisplayPrefsContext.Provider value={value}>{children}</DisplayPrefsContext.Provider>;
}

export function useDisplayPrefs(): DisplayPrefs {
  return useContext(DisplayPrefsContext);
}
