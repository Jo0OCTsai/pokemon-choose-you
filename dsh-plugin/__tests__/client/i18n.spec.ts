/**
 * i18n（A16/NFR-7）：三语键集完全相等（含主应用字典借用键——merged 集合传递断言主字典
 * 本身一致）+ 缺键即红（组件源内全部 t() 字面键的存在性扫描）+ {name} 插值。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createT, flattenKeys, MESSAGES, interpolate, SUPPORTED_LOCALES } from "../../src/client/i18n/index";
import { ESCAPE_REASON_CODES } from "../../src/client/rpc";

const LOCALES = ["zh-Hans", "zh-Hant", "en"] as const;

describe("三语键集一致性（缺键即红）", () => {
  it("三语 merged 键集（主应用字典 + dsh.*）完全相等", () => {
    const sets = LOCALES.map((locale) => flattenKeys(MESSAGES[locale]));
    const [hans, hant, en] = sets;
    expect([...hant].every((key) => hans.has(key))).toBe(true);
    expect([...en].every((key) => hans.has(key))).toBe(true);
    expect([...hans].every((key) => hant.has(key) && en.has(key))).toBe(true);
    expect(hans.size).toBeGreaterThan(500); // 主应用字典借用面规模下限
    expect([...hans].filter((key) => key.startsWith("dsh.")).length).toBeGreaterThan(60);
  });

  it("组件源内全部 t() 字面键在三语中均存在（动态键族展开枚举）", () => {
    const { keys, templatePrefixes } = scanClientKeys();
    expect(collectFiles(join(__dirname, "../../src/client")).length).toBeGreaterThan(20);
    for (const prefix of templatePrefixes) {
      // 模板前缀（如 "im.escapeReasons."）：上面已展开枚举，这里只确认至少一个具体键存在
      const hit = [...keys].some((key) => key.startsWith(prefix));
      expect(hit, `动态键族 ${prefix} 无展开枚举`).toBe(true);
    }
    const missing: string[] = [];
    for (const locale of LOCALES) {
      const set = flattenKeys(MESSAGES[locale]);
      for (const key of keys) {
        if (!set.has(key)) {
          missing.push(`${locale}: ${key}`);
        }
      }
    }
    expect(missing, `缺键（NFR-7：缺键即红）：${missing.slice(0, 12).join(", ")}`).toEqual([]);
    expect(keys.size).toBeGreaterThan(80);
  });

  it("SUPPORTED_LOCALES 三语与主应用字典取值一致", () => {
    expect(SUPPORTED_LOCALES.map((l) => l.value)).toEqual(["zh-Hans", "zh-Hant", "en"]);
  });
});

describe("t() 与插值", () => {
  it("点路径取值 + {name} 插值；缺键回落键名", () => {
    const t = createT("zh-Hans");
    expect(t("dsh.page.title")).toBe("图鉴机");
    expect(t("dsh.overdue.leaked", { n: 5 })).toBe("昨天有 5 只溜走了");
    expect(t("tabs.settings")).toBe("背包");
    expect(t("not.a.key")).toBe("not.a.key");
    const en = createT("en");
    expect(en("dsh.page.title")).toBe("Pokédex");
    expect(en("dsh.overdue.leaked", { n: 5 })).toBe("5 slipped away yesterday");
  });

  it("interpolate 保留未知占位符、接受数字参数", () => {
    expect(interpolate("已选 {n} 条", { n: 3 })).toBe("已选 3 条");
    expect(interpolate("{a} {b}", { a: 1 })).toBe("1 {b}");
  });

  it("装饰英文（POKé-DEX/CAUGHT）不入 i18n（§8）：dsh.* 键值无该装饰串", () => {
    const hans = MESSAGES["zh-Hans"];
    const dshValues = collectLeafStrings((hans as Record<string, unknown>).dsh);
    expect(dshValues.length).toBeGreaterThan(40);
    for (const value of dshValues) {
      expect(value).not.toMatch(/POKé|CAUGHT\b/i);
    }
  });
});

/** 扫描 src/client 源码：t() 字面键全集 + 模板字面量前缀集 */
function scanClientKeys(): { keys: Set<string>; templatePrefixes: Set<string> } {
  const keys = new Set<string>();
  const templatePrefixes = new Set<string>();
  for (const file of collectFiles(join(__dirname, "../../src/client"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bt\("([^"]+)"/g)) {
      keys.add(match[1]);
    }
    for (const match of source.matchAll(/\bt\(`([^`$]*)(?:\$\{[^}]+\})?`/g)) {
      if (match[1] !== "") {
        templatePrefixes.add(match[1]);
      }
    }
  }
  expandDynamicKeyFamilies(keys);
  return { keys, templatePrefixes };
}

/** 动态键族前缀 → 枚举封闭集（组件内模板字面量 t(`prefix.${expr}`) 的展开面） */
const KEY_FAMILIES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["im.escapeReasons.", [...ESCAPE_REASON_CODES]],
  ["im.confidence.", ["high", "medium", "low"]],
  ["status.", ["active", "paused", "done", "cancelled", "inbox", "scheduled"]],
  ["priority.", ["low", "normal", "high", "urgent"]],
  ["sess.kind.", ["classify", "capture", "dispatch_headless", "dispatch_interactive"]],
  ["im.status.", ["todo", "update", "followup", "none"]],
  ["dsh.dispatch.badge.", ["queued", "running", "done", "failed"]],
  ["diag.provider.", ["feishu", "ai"]],
  ["diag.status.", ["off", "paused", "idle", "ok", "degraded", "down"]],
  ["dexStats.milestone.", ["m0", "m1", "m10", "m50", "m100", "m200"]],
  ["reviewDow.", ["1", "2", "3", "4", "5", "6", "7"]],
  ["prompts.feature.", ["im_classify", "capture", "tag_health", "dispatch"]],
];

/** 展开全部动态键族到键集合 */
function expandDynamicKeyFamilies(keys: Set<string>): void {
  for (const [prefix, values] of KEY_FAMILIES) {
    for (const value of values) {
      keys.add(`${prefix}${value}`);
    }
  }
}

function collectLeafStrings(node: unknown): string[] {
  if (typeof node === "string") {
    return [node];
  }
  if (node === null || typeof node !== "object") {
    return [];
  }
  return Object.values(node as Record<string, unknown>).flatMap(collectLeafStrings);
}

function collectFiles(dir: string): string[] {
  // 递归收集 .ts/.tsx（i18n 目录本身排除——t() 定义处不算消费面）
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "i18n") {
      continue;
    }
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectFiles(full));
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}
