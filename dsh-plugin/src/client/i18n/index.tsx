/**
 * 客户端半边 i18n（A16/NFR-7）：主应用字典源直引（@app-i18n alias → 仓根 src/i18n/*.ts，
 * 零拷贝零同步）+ dsh.* 增量键三文件同构合并；自研 t(key, params)（{name} 插值）。
 * 三语键集一致性由 __tests__/client/i18n.spec.ts 断言（缺键即红）。
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import appZhHans from "@app-i18n/zh-Hans";
import appZhHant from "@app-i18n/zh-Hant";
import appEn from "@app-i18n/en";
import dshZhHans from "./dsh-zh-Hans";
import dshZhHant from "./dsh-zh-Hant";
import dshEn from "./dsh-en";

export type Locale = "zh-Hans" | "zh-Hant" | "en";

export const SUPPORTED_LOCALES: ReadonlyArray<{ value: Locale; label: string }> = [
  { value: "zh-Hans", label: "简体中文" },
  { value: "zh-Hant", label: "繁體中文" },
  { value: "en", label: "English" },
];

type MessageTree = Record<string, unknown>;

/** 装配后的三语字典（主应用键 + dsh.* 增量键同层合并） */
export const MESSAGES: Record<Locale, MessageTree> = {
  "zh-Hans": { ...appZhHans, dsh: dshZhHans },
  "zh-Hant": { ...appZhHant, dsh: dshZhHant },
  en: { ...appEn, dsh: dshEn },
};

/** 按点路径取叶子（数组与原语都是叶子；找不到返回 undefined） */
function lookup(tree: MessageTree, key: string): unknown {
  let node: unknown = tree;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") {
      return undefined;
    }
    node = (node as MessageTree)[part];
  }
  return node;
}

/** {name} 插值（与主应用 vue-i18n 字面量语法一致） */
export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (params === undefined) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

export type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

/** 构造某语言的 t()：缺键回落键名本身（缺键红线在构建/测试层，不在运行时） */
export function createT(locale: Locale): TranslateFn {
  const tree = MESSAGES[locale];
  return (key, params) => {
    const value = lookup(tree, key);
    if (typeof value === "string") {
      return interpolate(value, params);
    }
    return key;
  };
}

/** 展平键路径集合（对象递归、数组与原语为叶子）——键集一致性断言用 */
export function flattenKeys(tree: unknown, prefix = ""): Set<string> {
  const keys = new Set<string>();
  for (const [key, value] of Object.entries(tree as MessageTree)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const sub of flattenKeys(value, path)) {
        keys.add(sub);
      }
    } else {
      keys.add(path);
    }
  }
  return keys;
}

// ---- React 装配（i18nProvider：UIUX §3.1 组件树） ----

interface I18nValue {
  locale: Locale;
  t: TranslateFn;
}

const I18nContext = createContext<I18nValue>({ locale: "zh-Hans", t: createT("zh-Hans") });

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }): React.JSX.Element {
  const value = useMemo<I18nValue>(() => ({ locale, t: createT(locale) }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

export function useT(): TranslateFn {
  return useI18n().t;
}
