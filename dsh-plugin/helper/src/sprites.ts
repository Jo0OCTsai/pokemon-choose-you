/**
 * 素材链（AD §3.3 降级路径 A20；清单口径复用主应用 public/pokemon/ + src/pokemon.ts）：
 * 内置精灵（随 helper 打包，URL 形态 = pokemon/{key}.gif|png）→ CDN 候选（cdnBase 拼 PokeAPI
 * 路径，gen-5 动图仅 ≤#649）→ 双缺回退主宝可梦占位 + 单次「素材缺失」气泡（去重，不打扰）。
 */
import type { SpriteEntry } from "./bridge/protocol.ts";

/** 内置 6 只（= 主应用 BUNDLED_POKEMON × public/pokemon/ 实际素材；id 为主应用 catalog 口径） */
export const DEFAULT_BUILTIN: SpriteEntry[] = [
  { key: "pikachu", id: 25, name: { hans: "皮卡丘", hant: "皮卡丘", en: "Pikachu" } },
  { key: "psyduck", id: 54, name: { hans: "可达鸭", hant: "可達鴨", en: "Psyduck" } },
  { key: "bulbasaur", id: 1, name: { hans: "妙蛙种子", hant: "妙蛙種子", en: "Bulbasaur" } },
  { key: "chansey", id: 113, name: { hans: "吉利蛋", hant: "吉利蛋", en: "Chansey" } },
  { key: "eevee", id: 133, name: { hans: "伊布", hant: "伊布", en: "Eevee" } },
  { key: "snorlax", id: 143, name: { hans: "卡比兽", hant: "卡比獸", en: "Snorlax" } },
];

/** 与主应用 pokemon.ts 同源的 jsdelivr 入口（宿主可经 sprites.cdnBase 覆盖） */
export const DEFAULT_CDN_BASE = "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon";

/** gen-5 黑白动图只覆盖到 #649（合众图鉴收尾），之后世代只有静态图（对齐主应用） */
export const ANIMATED_MAX_ID = 649;

export interface SpriteResolution {
  /** 请求的 key（回退时 ≠ urls 实际指向的宝可梦） */
  key: string;
  /** 候选链（onerror 逐级回退） */
  urls: string[];
  builtin: boolean;
  /** 双缺回退：主宝可梦占位（渲染层出单次「素材缺失」气泡） */
  fallback: boolean;
}

export interface SpriteFallbackEvent {
  kind: "sprite-missing";
  key: string;
  standIn: string;
}

/**
 * 素材解析器。keyToId 注入点：Electron 形态由主进程读构建期拷贝的全量 catalog
 * （dist/renderer/pokemon-catalog.json，源 = 主应用 src/pokemon/catalog.json）提供
 * key→id 映射，使任意非内置宝可梦可拼 CDN 候选；headless/测试注入小映射即可。
 */
export class SpriteResolver {
  private missingSeen = new Set<string>();
  private builtin: SpriteEntry[];
  private cdnBase: string;
  private keyToId: (key: string) => number | undefined;

  // 显式字段赋值（不用参数属性——Node 24 原生类型擦除不支持参数属性语法）
  constructor(
    builtin: SpriteEntry[] = DEFAULT_BUILTIN,
    cdnBase: string = DEFAULT_CDN_BASE,
    keyToId: (key: string) => number | undefined = () => undefined,
  ) {
    this.builtin = builtin;
    this.cdnBase = cdnBase;
    this.keyToId = keyToId;
  }

  /** 宿主 sprites 消息到达时更新配置 */
  update(builtin: SpriteEntry[], cdnBase: string): void {
    this.builtin = builtin.length ? builtin : DEFAULT_BUILTIN;
    this.cdnBase = cdnBase || DEFAULT_CDN_BASE;
    // 配置刷新 = 网络恢复重下发：清缺失去重，允许下一次再提示（A20 恢复语义）
    this.missingSeen.clear();
  }

  /** key→id 映射注入（Electron 胶水读全量 catalog 后调用；headless/测试缺省只认内置） */
  setKeyToId(fn: (key: string) => number | undefined): void {
    this.keyToId = fn;
  }

  /** 内置清单（渲染层取名/主宝可梦占位用） */
  get builtinList(): readonly SpriteEntry[] {
    return this.builtin;
  }

  /** 主宝可梦占位（内置首位；宿主未下发主宝可梦键时的 v1 缺省） */
  get standIn(): SpriteEntry {
    return this.builtin[0];
  }

  pokemonName(key: string, lang: "zh-Hans" | "zh-Hant" | "en"): string {
    const hit = this.builtin.find((b) => b.key === key);
    if (hit) return lang === "zh-Hant" ? hit.name.hant : lang === "en" ? hit.name.en : hit.name.hans;
    return key;
  }

  resolve(key: string): SpriteResolution {
    if (!key) return this.fallbackResolution(key);
    if (this.builtin.some((b) => b.key === key)) {
      return { key, urls: this.localCandidates(key), builtin: true, fallback: false };
    }
    const id = this.keyToId(key);
    if (id !== undefined && Number.isFinite(id)) {
      return { key, urls: this.cdnCandidates(id), builtin: false, fallback: false };
    }
    return this.fallbackResolution(key);
  }

  /** 双缺回退是否需要提示（单次去重；返回 null = 已提示过或非回退） */
  takeMissingEvent(key: string): SpriteFallbackEvent | null {
    const res = this.resolve(key);
    if (!res.fallback || this.missingSeen.has(key)) return null;
    this.missingSeen.add(key);
    return { kind: "sprite-missing", key, standIn: this.standIn.key };
  }

  private fallbackResolution(key: string): SpriteResolution {
    return {
      key,
      urls: this.localCandidates(this.standIn.key),
      builtin: true,
      fallback: true,
    };
  }

  /** 本地候选（与主应用 spriteCandidates 内置分支同形态） */
  private localCandidates(key: string): string[] {
    return [`pokemon/${key}.gif`, `pokemon/${key}.png`];
  }

  /** CDN 候选（单 cdnBase 口径：宿主选定入口；动图 ≤#649，否则只有静态图） */
  private cdnCandidates(id: number): string[] {
    const png = `${this.cdnBase}/${id}.png`;
    if (id <= ANIMATED_MAX_ID) {
      return [`${this.cdnBase}/versions/generation-v/black-white/animated/${id}.gif`, png];
    }
    return [png];
  }
}
