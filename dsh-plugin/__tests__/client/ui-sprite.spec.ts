/** Sprite 候选链（client ui）：key 归一 + 名录 id → CDN 动图/静态图链（主应用 pokemon.ts 同源口径） */
import { describe, expect, it } from "vitest";
import { spriteCandidates, spriteKeyOf } from "../../src/client/ui/Sprite";

describe("spriteKeyOf", () => {
  it("裸 key 原样；历史 pokemon/x.gif 形态剥前缀与扩展名", () => {
    expect(spriteKeyOf("charmander")).toBe("charmander");
    expect(spriteKeyOf("pokemon/pikachu.gif")).toBe("pikachu");
    expect(spriteKeyOf("pokemon/eevee.png")).toBe("eevee");
  });
});

describe("spriteCandidates", () => {
  it("名录内 key → gen-5 动图三源打头 + 静态三源兜底（≤#649）", () => {
    const chain = spriteCandidates("charmander");
    expect(chain).toHaveLength(6);
    expect(chain[0]).toContain("/versions/generation-v/black-white/animated/4.gif");
    expect(chain[3]).toContain("/4.png");
    expect(chain[0].startsWith("https://cdn.jsdelivr.net/")).toBe(true);
    expect(chain[1].startsWith("https://fastly.jsdelivr.net/")).toBe(true);
    expect(chain[2].startsWith("https://raw.githubusercontent.com/")).toBe(true);
  });

  it("#649 之后世代无动图 → 仅静态三源", () => {
    const chain = spriteCandidates("miraidon");
    expect(chain).toHaveLength(3);
    expect(chain.every((u) => u.endsWith(".png"))).toBe(true);
  });

  it("名录外 key（含历史路径形态）→ 空链（渲染层出「？」占位）", () => {
    expect(spriteCandidates("missingno")).toHaveLength(0);
    expect(spriteCandidates("pokemon/missingno.gif")).toHaveLength(0);
  });
});
