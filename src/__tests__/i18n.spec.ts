import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import zhHans from "../i18n/zh-Hans";
import zhHant from "../i18n/zh-Hant";
import en from "../i18n/en";
import { SUPPORTED_LOCALES, i18n } from "../i18n";
import { SETTING_DEFAULTS, POKEMON_LIST } from "../stores/settings";

const locales: Record<string, unknown> = { "zh-Hans": zhHans, "zh-Hant": zhHant, en };

/** 展平成 dot-path 键，数组值保留为序号键 */
function flatten(obj: unknown, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of flatten(v, key)) out.set(k2, v2);
    } else {
      out.set(key, v);
    }
  }
  return out;
}

/** 提取文案里的命名插值占位符，如 {n} {v} */
function placeholders(v: unknown): string[] {
  if (typeof v !== "string") return [];
  return [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

describe("i18n 兼容性：三语语言包", () => {
  const hans = flatten(zhHans);
  const hant = flatten(zhHant);
  const enFlat = flatten(en);

  it("繁体与英文的键集合与简体完全一致", () => {
    expect([...hant.keys()].sort()).toEqual([...hans.keys()].sort());
    expect([...enFlat.keys()].sort()).toEqual([...hans.keys()].sort());
  });

  it("同键插值占位符三语一致（缺参数会在运行时渲染出 {n} 字面量）", () => {
    const base = hans;
    for (const [key, value] of base) {
      const expectPh = placeholders(value);
      for (const other of [hant, enFlat]) {
        const got = placeholders(other.get(key));
        expect(got).toEqual(expectPh);
      }
    }
  });

  it("所有文案均为非空字符串（数组除外）", () => {
    for (const locale of Object.values(locales)) {
      for (const value of flatten(locale).values()) {
        if (Array.isArray(value)) {
          expect(value.length).toBeGreaterThan(0);
        } else {
          expect(typeof value).toBe("string");
          expect((value as string).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("i18n 实例注册了全部语言，默认语言在支持列表内", () => {
    expect(Object.keys(i18n.global.messages.value).sort()).toEqual(["en", "zh-Hans", "zh-Hant"]);
    expect(SUPPORTED_LOCALES.map((l) => l.value)).toContain(SETTING_DEFAULTS.language);
    expect(i18n.global.fallbackLocale.value).toBe("zh-Hans");
  });
});

describe("素材兼容性：图鉴换装", () => {
  it("每只宝可梦在 public/pokemon 下有 gif 或 png 素材", () => {
    const publicDir = join(process.cwd(), "public", "pokemon");
    for (const p of POKEMON_LIST) {
      const hasSprite = existsSync(join(publicDir, `${p.key}.gif`)) || existsSync(join(publicDir, `${p.key}.png`));
      expect(hasSprite, `${p.key} 缺少素材`).toBe(true);
    }
  });
});

describe("设置兼容性：默认值", () => {
  it("布尔型设置取值合法", () => {
    for (const k of [
      "pomodoro_enabled",
      "pomodoro_notify",
      "notifications_enabled",
      "default_to_inbox",
      "feishu_enabled",
    ]) {
      expect(["true", "false"]).toContain(SETTING_DEFAULTS[k]);
    }
  });

  it("番茄时长默认值在产品档位内", () => {
    expect([15, 25, 45, 60]).toContain(Number(SETTING_DEFAULTS.pomodoro_minutes));
  });

  it("默认日期/时间格式是被支持的格式", () => {
    expect(["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"]).toContain(SETTING_DEFAULTS.date_format);
    expect(["24h", "12h"]).toContain(SETTING_DEFAULTS.time_format);
  });
});
