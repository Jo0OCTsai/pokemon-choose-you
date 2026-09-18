import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  BUNDLED_POKEMON,
  POKEMON_BY_KEY,
  POKEMON_CATALOG,
  isBundled,
  mergePokemonQuotes,
  pokemonName,
  pokemonQuotesFor,
  randomQuote,
  searchPokemon,
  spriteCandidates,
} from "../pokemon";
import { i18n } from "../i18n";
import { SETTING_DEFAULTS, useSettingsStore } from "../stores/settings";

/** 名录文件与内置素材的完备性（生成脚本：scripts/gen-pokemon-catalog.mjs） */
describe("全量宝可梦名录", () => {
  it("覆盖 pokeapi 全部 1025 只，编号连续且 key 唯一", () => {
    expect(POKEMON_CATALOG).toHaveLength(1025);
    expect(POKEMON_CATALOG[0]).toMatchObject({ id: 1, key: "bulbasaur" });
    expect(POKEMON_CATALOG[1024]).toMatchObject({ id: 1025, key: "pecharunt" });
    const ids = new Set(POKEMON_CATALOG.map((p) => p.id));
    expect(ids.size).toBe(1025);
    const keys = new Set(POKEMON_CATALOG.map((p) => p.key));
    expect(keys.size).toBe(1025);
  });

  it("三语名非空且 key 为小写（与 PokeAPI 素材路径一致）", () => {
    for (const p of POKEMON_CATALOG) {
      expect(p.hans.length, `${p.key} 缺简中名`).toBeGreaterThan(0);
      expect(p.hant.length, `${p.key} 缺繁中名`).toBeGreaterThan(0);
      expect(p.en.length, `${p.key} 缺英文名`).toBeGreaterThan(0);
      expect(p.key).toBe(p.key.toLowerCase());
    }
  });

  it("内置 6 只在名录中且随包附带素材", () => {
    expect(BUNDLED_POKEMON).toHaveLength(6);
    const publicDir = join(process.cwd(), "public", "pokemon");
    for (const p of BUNDLED_POKEMON) {
      const entry = POKEMON_BY_KEY.get(p.key);
      expect(entry, p.key).toBeDefined();
      expect(entry!.hans).toBe(p.name);
      expect(isBundled(p.key)).toBe(true);
      const hasSprite = existsSync(join(publicDir, `${p.key}.gif`)) || existsSync(join(publicDir, `${p.key}.png`));
      expect(hasSprite, `${p.key} 缺少素材`).toBe(true);
    }
    expect(isBundled("garchomp")).toBe(false);
  });
});

describe("精灵图候选链（本地优先，联网回退 CDN）", () => {
  it("内置宝可梦用本地素材，动图优先", () => {
    expect(spriteCandidates("pikachu")).toEqual(["/pokemon/pikachu.gif", "/pokemon/pikachu.png"]);
  });

  it("名录内非内置：≤#649 走 gen-5 动图 → 静态图，>#649 只有静态图", () => {
    const gible = spriteCandidates("gible"); // #443
    expect(gible[0]).toContain("generation-v/black-white/animated/443.gif");
    expect(gible.some((s) => s.endsWith("/443.png"))).toBe(true);
    const chespin = spriteCandidates("chespin"); // #650 起无动图
    expect(chespin.every((s) => !s.includes("animated"))).toBe(true);
    expect(chespin[0]).toContain("/650.png");
  });

  it("CDN / fastly / raw 三源互备，断一处还有一处", () => {
    const cand = spriteCandidates("gible");
    const hosts = new Set(cand.map((s) => new URL(s).host));
    expect(hosts).toEqual(new Set(["cdn.jsdelivr.net", "fastly.jsdelivr.net", "raw.githubusercontent.com"]));
  });

  it("未知 key 回退本地素材路径（兼容旧数据）", () => {
    expect(spriteCandidates("who-is-this")[0]).toBe("/pokemon/who-is-this.gif");
  });
});

describe("pokemonName 本地化", () => {
  it("按当前语言取名，key 不在名录时回退传入名", () => {
    const prev = i18n.global.locale.value;
    try {
      i18n.global.locale.value = "zh-Hans";
      expect(pokemonName("garchomp")).toBe("烈咬陆鲨");
      i18n.global.locale.value = "zh-Hant";
      expect(pokemonName("garchomp")).toBe("烈咬陸鯊");
      i18n.global.locale.value = "en";
      expect(pokemonName("garchomp")).toBe("Garchomp");
      expect(pokemonName("custom-key", "旧名字")).toBe("旧名字");
      expect(pokemonName("", "兜底")).toBe("兜底");
    } finally {
      i18n.global.locale.value = prev;
    }
  });
});

describe("searchPokemon 名录搜索", () => {
  it("简中/繁中/英文/key/编号均可命中", () => {
    expect(searchPokemon("烈咬陆鲨", 5).some((p) => p.key === "garchomp")).toBe(true);
    expect(searchPokemon("烈咬陸鯊", 5).some((p) => p.key === "garchomp")).toBe(true);
    expect(searchPokemon("garchomp", 5).some((p) => p.key === "garchomp")).toBe(true);
    expect(searchPokemon("445", 5).some((p) => p.key === "garchomp")).toBe(true);
    expect(searchPokemon("Garchomp", 5).some((p) => p.key === "garchomp")).toBe(true);
  });

  it("空查询：内置 6 只置顶；结果条数受 limit 约束", () => {
    const first = searchPokemon("", 60);
    expect(first.slice(0, 6).map((p) => p.key)).toEqual(BUNDLED_POKEMON.map((p) => p.key));
    expect(first).toHaveLength(60);
    expect(searchPokemon("皮卡丘", 50)).toHaveLength(1);
  });
});

describe("每宝可梦自定义台词", () => {
  const sget = (key: string) =>
    key === "pokemon_quotes"
      ? JSON.stringify({ pikachu: "皮卡皮卡！\n 训练家加油！ \n\n", eevee: "伊布伊布~" })
      : (SETTING_DEFAULTS[key] ?? "");
  const store = { sget };

  beforeEach(() => {
    setActivePinia(createPinia()); // pokemonName/i18n 相关链路需要 pinia 环境
  });

  it("逐行拆分并去空白，未配置返回空数组", () => {
    expect(pokemonQuotesFor(store.sget, "pikachu")).toEqual(["皮卡皮卡！", "训练家加油！"]);
    expect(pokemonQuotesFor(store.sget, "snorlax")).toEqual([]);
  });

  it("损坏的 JSON 容错返回空数组", () => {
    expect(pokemonQuotesFor(() => "{oops", "pikachu")).toEqual([]);
  });

  it("merge 保留其他宝可梦的台词，清空即删除该条目", () => {
    const merged = JSON.parse(mergePokemonQuotes(store.sget, "snorlax", "呼呼大睡"));
    expect(merged.pikachu).toBeDefined();
    expect(merged.eevee).toBeDefined();
    expect(merged.snorlax).toBe("呼呼大睡");
    const cleared = JSON.parse(mergePokemonQuotes(store.sget, "eevee", "  "));
    expect(cleared.eevee).toBeUndefined();
    expect(cleared.pikachu).toBeDefined();
  });
});

describe("randomQuote：自定义台词优先", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("配置了自定义台词的宝可梦只从自定义池里取", () => {
    const settings = useSettingsStore();
    settings.values.pokemon_quotes = JSON.stringify({ pikachu: "自定义台词A\n自定义台词B" });
    const picks = new Set<string>();
    for (let i = 0; i < 30; i++) picks.add(randomQuote("pikachu"));
    for (const p of picks) expect(["自定义台词A", "自定义台词B"]).toContain(p);
  });

  it("未配置时回默认语录池", () => {
    const settings = useSettingsStore();
    settings.values.pokemon_quotes = "{}";
    const q = randomQuote("pikachu");
    expect(typeof q).toBe("string");
    expect(q.length).toBeGreaterThan(0);
  });
});
