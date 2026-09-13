import { createI18n } from "vue-i18n";
import { watchEffect } from "vue";
import { useSettingsStore } from "../stores/settings";
import zhHans from "./zh-Hans";
import zhHant from "./zh-Hant";
import en from "./en";

export const SUPPORTED_LOCALES = [
  { value: "zh-Hans", label: "简体中文" },
  { value: "zh-Hant", label: "繁體中文" },
  { value: "en", label: "English" },
] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number]["value"];

export const i18n = createI18n({
  legacy: false,
  locale: "zh-Hans",
  fallbackLocale: "zh-Hans",
  messages: { "zh-Hans": zhHans, "zh-Hant": zhHant, en },
});

/**
 * 语言设置 → i18n 实例（settings.values.language 写入后两窗口即时切换）。
 * 需在 app.use(createPinia()) 之后调用（两窗口入口各调一次）。
 */
export function bindLocaleToSettings() {
  const settings = useSettingsStore();
  watchEffect(() => {
    const lang = settings.sget("language") as AppLocale;
    if (SUPPORTED_LOCALES.some((l) => l.value === lang)) {
      i18n.global.locale.value = lang;
    }
  });
}

/** 组件外使用（Rust 事件回调等场景） */
export const t = i18n.global.t;
