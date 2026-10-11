import { describe, expect, it } from "vitest";
import { ANIMATED_MAX_ID, DEFAULT_BUILTIN, DEFAULT_CDN_BASE, SpriteResolver } from "../src/sprites.ts";

describe("素材链（AD §3.3 A20：内置 → CDN → 双缺回退 + 单次缺失提示）", () => {
  it("内置清单口径 = 主应用 BUNDLED_POKEMON × public/pokemon 实际素材（6 只）", () => {
    expect(DEFAULT_BUILTIN.map((b) => b.key)).toEqual([
      "pikachu",
      "psyduck",
      "bulbasaur",
      "chansey",
      "eevee",
      "snorlax",
    ]);
  });

  it("内置精灵 → 本地候选（pokemon/{key}.gif|png，与主应用 URL 形态一致）", () => {
    const r = new SpriteResolver();
    const res = r.resolve("pikachu");
    expect(res.builtin).toBe(true);
    expect(res.fallback).toBe(false);
    expect(res.urls).toEqual(["pokemon/pikachu.gif", "pokemon/pikachu.png"]);
  });
});

describe("素材链 · CDN 候选与双缺回退", () => {
  it("非内置且 keyToId 有映射 → CDN 候选（≤#649 动图 + png；>649 只有 png）", () => {
    const r = new SpriteResolver(undefined, DEFAULT_CDN_BASE, (key) =>
      key === "charmander" ? 4 : key === "skeledirge" ? 911 : undefined,
    );
    expect(r.resolve("charmander").urls).toEqual([
      `${DEFAULT_CDN_BASE}/versions/generation-v/black-white/animated/4.gif`,
      `${DEFAULT_CDN_BASE}/4.png`,
    ]);
    expect(r.resolve("skeledirge").urls).toEqual([`${DEFAULT_CDN_BASE}/911.png`]);
    expect(ANIMATED_MAX_ID).toBe(649);
  });

  it("非内置且无映射（双缺第一层）→ 回退主宝可梦占位 + 单次缺失事件（同 key 去重）", () => {
    const r = new SpriteResolver();
    const res = r.resolve("mysterymon");
    expect(res.fallback).toBe(true);
    expect(res.urls).toEqual(["pokemon/pikachu.gif", "pokemon/pikachu.png"]);
    expect(r.takeMissingEvent("mysterymon")).toEqual({ kind: "sprite-missing", key: "mysterymon", standIn: "pikachu" });
    // 同 key 第二次：不再提示（单次语义）
    expect(r.takeMissingEvent("mysterymon")).toBeNull();
    // 另一个 key 仍提示
    expect(r.takeMissingEvent("othermon")).not.toBeNull();
  });

  it("宿主重下发 sprites（网络恢复）→ 清缺失去重，可再次提示（A20 恢复语义）", () => {
    const r = new SpriteResolver();
    r.resolve("gone-mon");
    expect(r.takeMissingEvent("gone-mon")).not.toBeNull();
    r.update(DEFAULT_BUILTIN, DEFAULT_CDN_BASE);
    expect(r.takeMissingEvent("gone-mon")).not.toBeNull();
  });

  it("宿主下发空 builtin → 回落默认内置清单（配置坏值不裸奔）", () => {
    const r = new SpriteResolver();
    r.update([], "");
    expect(r.builtinList.length).toBe(6);
    expect(r.resolve("eevee").builtin).toBe(true);
  });

  it("pokemonName：内置按语言取名；未知 key 原样返回", () => {
    const r = new SpriteResolver();
    expect(r.pokemonName("pikachu", "zh-Hans")).toBe("皮卡丘");
    expect(r.pokemonName("pikachu", "en")).toBe("Pikachu");
    expect(r.pokemonName("who", "en")).toBe("who");
  });
});
