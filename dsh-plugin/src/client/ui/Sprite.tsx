/**
 * 精灵图（面板 signature 载体，UIUX §6.1）：categories.sprite 存 PokeAPI key（共享库约定，
 * 与主应用一致）——dsh 面板无本地 /pokemon/ 素材，全量走 CDN 候选链（gen-5 动图 ≤#649
 * 优先 + 三源静态图兜底，主应用 src/pokemon.ts spriteCandidates 同源口径）；onerror 逐级
 * 回退，全败渲染「？」占位（主应用 PokemonSprite.vue 同构）。key 兼容历史 "pokemon/x.gif"
 * 形态（剥前缀与扩展名）；名录外 key 无候选 → 直接占位。
 */
import { useMemo, useState } from "react";
import catalogJson from "@app-pokemon/catalog.json";

type CatalogRow = [number, string, string, string, string];
const CATALOG: readonly CatalogRow[] = (catalogJson as { v: number; entries: CatalogRow[] }).entries;
const ID_BY_KEY = new Map(CATALOG.map(([id, key]) => [key, id]));

const SPRITE_CDN = "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon";
const SPRITE_FASTLY = "https://fastly.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon";
const SPRITE_RAW = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";
/** gen-5 黑白动图只覆盖到 #649（合众图鉴收尾），之后世代只有静态图 */
const ANIMATED_MAX_ID = 649;

/** sprite 列值 → PokeAPI key（兼容裸 key 与历史 "pokemon/{key}.gif" 两形态） */
export function spriteKeyOf(raw: string): string {
  const trimmed = raw.trim();
  const base = trimmed.startsWith("pokemon/") ? trimmed.slice("pokemon/".length) : trimmed;
  return base.replace(/\.(gif|png)$/, "");
}

/** CDN 候选链（动图 ≤#649 三源 + 静态三源；名录外返回空 → 占位） */
export function spriteCandidates(raw: string): string[] {
  const id = ID_BY_KEY.get(spriteKeyOf(raw));
  if (id === undefined) {
    return [];
  }
  const hosts = [SPRITE_CDN, SPRITE_FASTLY, SPRITE_RAW];
  const pngs = hosts.map((h) => `${h}/${id}.png`);
  return id <= ANIMATED_MAX_ID
    ? [...hosts.map((h) => `${h}/versions/generation-v/black-white/animated/${id}.gif`), ...pngs]
    : pngs;
}

/** 精灵图（pixelated）：候选链回退 + 全败「？」占位；换装换 key 时回退游标归零 */
export function Sprite({
  spriteKey,
  size = 24,
  alt = "",
}: {
  spriteKey: string;
  size?: number;
  alt?: string;
}): React.JSX.Element {
  const candidates = useMemo(() => spriteCandidates(spriteKey), [spriteKey]);
  // render 期状态调整：key 变更即重置游标（对齐 PokemonSprite.vue 的 watch 语义）
  const [fallback, setFallback] = useState({ key: spriteKey, idx: 0 });
  const idx = fallback.key === spriteKey ? fallback.idx : 0;
  if (candidates.length === 0 || idx >= candidates.length) {
    return (
      <span aria-hidden="true" style={{ fontSize: size * 0.6, lineHeight: `${size}px` }}>
        ？
      </span>
    );
  }
  return (
    <img
      src={candidates[idx]}
      alt={alt}
      width={size}
      height={size}
      style={{ imageRendering: "pixelated" }}
      onError={() => setFallback({ key: spriteKey, idx: idx + 1 })}
    />
  );
}
