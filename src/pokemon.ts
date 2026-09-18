/**
 * 全量宝可梦图鉴：名录（catalog.json，由 scripts/gen-pokemon-catalog.mjs 从 PokeAPI 生成）、
 * 本地化名查找、精灵图候选链与每宝可梦自定义台词的存取。
 *
 * 精灵图策略（本地优先）：
 * - 内置 6 只（BUNDLED_POKEMON）随应用打包 /pokemon/{key}.gif|png，断网可用；
 * - 其余宝可梦按编号从 PokeAPI 素材库 CDN 加载（gen-5 动图 ≤#649，其余静态图），
 *   jsdelivr（cdn/fastly 双入口，fastly 对大陆网络更友好）与 raw.githubusercontent 三源互备，
 *   加载过的图走 WebView 缓存。
 */
import catalogJson from "./pokemon/catalog.json";
import { i18n } from "./i18n";
import { useSettingsStore } from "./stores/settings";

export interface PokemonEntry {
  id: number;
  /** PokeAPI key（同时是精灵素材名与设置里的 sprite 值） */
  key: string;
  hans: string;
  hant: string;
  en: string;
}

export type PokemonLocale = "zh-Hans" | "zh-Hant" | "en";

/** 随应用打包精灵图的内置宝可梦（分类默认阵容） */
export const BUNDLED_POKEMON: { key: string; name: string }[] = [
  { key: "pikachu", name: "皮卡丘" },
  { key: "psyduck", name: "可达鸭" },
  { key: "bulbasaur", name: "妙蛙种子" },
  { key: "chansey", name: "吉利蛋" },
  { key: "eevee", name: "伊布" },
  { key: "snorlax", name: "卡比兽" },
];

const BUNDLED_KEYS = new Set(BUNDLED_POKEMON.map((p) => p.key));

type CatalogRow = [number, string, string, string, string];
const rows = (catalogJson as { v: number; entries: CatalogRow[] }).entries;

export const POKEMON_CATALOG: PokemonEntry[] = rows.map(([id, key, hans, hant, en]) => ({
  id,
  key,
  hans,
  hant,
  en,
}));

export const POKEMON_BY_KEY: Map<string, PokemonEntry> = new Map(POKEMON_CATALOG.map((p) => [p.key, p]));

const SPRITE_CDN = "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon";
const SPRITE_FASTLY = "https://fastly.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon";
const SPRITE_RAW = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";
/** gen-5 黑白动图只覆盖到 #649（合众图鉴收尾），之后世代只有静态图 */
const ANIMATED_MAX_ID = 649;

/**
 * 精灵图候选链（按序尝试，onerror 逐级回退）：
 * 内置 → 本地 gif/png；名录内 → CDN 动图 → fastly 动图 → raw 动图 → 三源 png；未知 key → 本地素材（兼容旧数据）。
 */
export function spriteCandidates(key: string): string[] {
  if (BUNDLED_KEYS.has(key) || !POKEMON_BY_KEY.has(key)) {
    return [`/pokemon/${key}.gif`, `/pokemon/${key}.png`];
  }
  const { id } = POKEMON_BY_KEY.get(key)!;
  const hosts = [SPRITE_CDN, SPRITE_FASTLY, SPRITE_RAW];
  const pngs = hosts.map((h) => `${h}/${id}.png`);
  return id <= ANIMATED_MAX_ID
    ? [...hosts.map((h) => `${h}/versions/generation-v/black-white/animated/${id}.gif`), ...pngs]
    : pngs;
}

/** 目录里是否随包附带素材（用于 UI 提示「断网可用」） */
export function isBundled(key: string): boolean {
  return BUNDLED_KEYS.has(key);
}

/** 当前语言下的宝可梦名；key 不在名录（自定义/旧数据）时回退 fallbackName 或 key 本身 */
export function pokemonName(key: string | null | undefined, fallbackName = "", locale?: PokemonLocale): string {
  if (!key) return fallbackName;
  const e = POKEMON_BY_KEY.get(key);
  if (!e) return fallbackName || key;
  const loc = locale ?? (i18n.global.locale.value as PokemonLocale);
  return loc === "zh-Hant" ? e.hant : loc === "en" ? e.en : e.hans;
}

/** 名录搜索：简中/繁中/英文/key/编号 前缀与包含匹配；空查询返回内置 6 只打头的全量 */
export function searchPokemon(query: string, limit = 60): PokemonEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    const bundled = BUNDLED_POKEMON.map((p) => POKEMON_BY_KEY.get(p.key)!).filter(Boolean);
    const rest = POKEMON_CATALOG.filter((p) => !BUNDLED_KEYS.has(p.key));
    return [...bundled, ...rest].slice(0, limit);
  }
  const hit = (p: PokemonEntry) =>
    p.hans.toLowerCase().includes(q) ||
    p.hant.toLowerCase().includes(q) ||
    p.en.toLowerCase().includes(q) ||
    p.key.includes(q) ||
    String(p.id) === q;
  return POKEMON_CATALOG.filter(hit).slice(0, limit);
}

// ---- 每宝可梦自定义台词（settings 表 pokemon_quotes 键，JSON：{ [key]: 多行文本 }） ----

/** 解析某只宝可梦的自定义台词（逐行拆分、去空白；无自定义返回空数组） */
export function pokemonQuotesFor(sget: (key: string) => string, key: string): string[] {
  try {
    const map = JSON.parse(sget("pokemon_quotes") || "{}") as Record<string, string>;
    const raw = map?.[key];
    return typeof raw === "string"
      ? raw
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

/** 把编辑中的多行文本写回设置值（与其他宝可梦的台词合并保留） */
export function mergePokemonQuotes(sget: (key: string) => string, key: string, text: string): string {
  let map: Record<string, string> = {};
  try {
    map = JSON.parse(sget("pokemon_quotes") || "{}") ?? {};
  } catch {
    map = {};
  }
  const trimmed = text.trim();
  if (trimmed) map[key] = trimmed;
  else delete map[key];
  return JSON.stringify(map);
}

/** 随机撸宠台词：当前宝可梦配了自定义台词就先用它，否则回默认语录池（深夜档换安睡语录） */
export function randomQuote(pokemonKey?: string): string {
  if (pokemonKey) {
    try {
      const custom = pokemonQuotesFor((k) => useSettingsStore().sget(k), pokemonKey);
      if (custom.length) return custom[Math.floor(Math.random() * custom.length)];
    } catch {
      /* pinia 未激活（极早期调用）时走默认池 */
    }
  }
  const hour = new Date().getHours();
  const key = hour >= 22 || hour < 6 ? "pet.quotesNight" : "pet.quotes";
  const quotes = i18n.global.tm(key) as unknown[];
  const arr = quotes.map((q) => String(q));
  return arr[Math.floor(Math.random() * arr.length)] ?? "";
}
