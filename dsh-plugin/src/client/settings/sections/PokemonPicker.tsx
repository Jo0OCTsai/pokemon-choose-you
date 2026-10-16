/**
 * 宝可梦下拉选择器（桌面 PokemonPicker 同构交互）：按钮（精灵 + 名 + ▼）→ 内联面板
 * （搜索框打开即聚焦 + 名录列表 + 选中 ▶ 光标 + 内置徽标）；Enter 直取第一条结果、
 * Esc 关闭、点击面板外关闭。allowEmptyLabel 提供一个「清空」档（主宝可梦跟随分类用）。
 * 搜索走注入的 pokemonSearch（异步名录查询；换装/主宝可梦/台词编辑器三处共用）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import { Sprite } from "../../ui/Sprite";
import styles from "../settings.module.css";

/** 换装搜索候选（适配层注入：1025 只名录搜索在 host 侧 / client 本地表） */
export interface PokemonCandidate {
  key: string;
  name: string;
  number: number;
  english: string;
}

/** 随应用打包精灵图的内置宝可梦（主应用 src/pokemon.ts BUNDLED_POKEMON 同表） */
export const BUNDLED_KEYS = ["pikachu", "psyduck", "bulbasaur", "chansey", "eevee", "snorlax"];

export function PokemonPicker({
  value,
  onPick,
  search,
  nameOf,
  allowEmptyLabel,
  ariaLabel,
}: {
  /** 当前选中 PokeAPI key（"" = 未选，显示 allowEmptyLabel 或占位） */
  value: string;
  onPick: (key: string) => void;
  search?: (query: string) => Promise<PokemonCandidate[]>;
  /** key → 展示名（名录外回落 key 本身） */
  nameOf: (key: string) => string;
  /** 清空档文案（如「跟随第一个分类」；不给则无清空项） */
  allowEmptyLabel?: string;
  ariaLabel?: string;
}): React.JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PokemonCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // 打开即清空搜索并聚焦（直接搜，不用再点一下——桌面同款）
  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    const raf = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // 查询 → 候选（异步搜索注入时；空查询列内置 6 只——桌面 results 兜底同观感）
  useEffect(() => {
    if (!open || search === undefined) {
      return;
    }
    let alive = true;
    setSearching(true);
    void search(query)
      .then((list) => {
        if (alive) {
          setResults(list);
        }
      })
      .finally(() => {
        if (alive) {
          setSearching(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [open, query, search]);

  // 点击面板外关闭（mousedown 捕获——桌面 onDocClick 同口径）
  useEffect(() => {
    if (!open) {
      return;
    }
    function onDocClick(event: MouseEvent): void {
      if (rootRef.current !== null && event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const selectedLabel = useMemo(() => {
    if (value === "") {
      return allowEmptyLabel ?? "";
    }
    return nameOf(value) || value;
  }, [value, allowEmptyLabel, nameOf]);

  function pick(key: string): void {
    onPick(key);
    setOpen(false);
  }

  function onSearchKeydown(event: React.KeyboardEvent): void {
    if (event.key === "Enter") {
      // 回车直取第一条结果（搜索 → 回车的最短路径）
      event.preventDefault();
      const first = results[0];
      if (first !== undefined) {
        pick(first.key);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={styles.pkPicker}>
      <button
        type="button"
        className={styles.pkButton}
        data-open={open ? "true" : undefined}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {value !== "" && (
          <span className={styles.pkThumb}>
            <Sprite spriteKey={value} size={24} alt={selectedLabel} />
          </span>
        )}
        <span className={styles.pkLabel}>{selectedLabel}</span>
        <span className={styles.pkArrow} aria-hidden="true">
          ▼
        </span>
      </button>
      {open && (
        <div className={styles.pkPanel}>
          <input
            ref={searchRef}
            className={styles.pkSearch}
            type="text"
            value={query}
            placeholder={t("dsh.pokeSearch.placeholder")}
            aria-label={t("dsh.pokeSearch.placeholder")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeydown}
          />
          <ul className={styles.pkList}>
            {allowEmptyLabel !== undefined && (
              <li className={styles.pkItem} data-sel={value === "" ? "true" : undefined} onClick={() => pick("")}>
                <span className={styles.pkCursor} aria-hidden="true">
                  ▶
                </span>
                {allowEmptyLabel}
              </li>
            )}
            {results.map((candidate) => (
              <li
                key={candidate.key}
                className={styles.pkItem}
                data-sel={candidate.key === value ? "true" : undefined}
                onClick={() => pick(candidate.key)}
              >
                <span className={styles.pkCursor} aria-hidden="true">
                  ▶
                </span>
                <span className={styles.pkThumb}>
                  <Sprite spriteKey={candidate.key} size={24} alt={candidate.name} />
                </span>
                <span className={styles.pkName}>{candidate.name}</span>
                <span className={styles.pkId}>#{candidate.number}</span>
                {BUNDLED_KEYS.includes(candidate.key) && (
                  <span className={styles.pkBundled}>{t("dsh.pokeSearch.bundled")}</span>
                )}
              </li>
            ))}
            {!searching && results.length === 0 && <li className={styles.pkNone}>{t("dsh.pokeSearch.noResult")}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
