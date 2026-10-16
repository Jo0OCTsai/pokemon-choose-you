/**
 * 桌宠分区页（🐾，对齐主应用 SectionPets + QuotesEditorCard）：主宝可梦（全图鉴搜索选择，
 * 存 PokeAPI 裸 key；「跟随第一个分类」可清回）/ 按宝可梦分组的台词编辑器（pokemon_quotes
 * 是 JSON map——逐精灵 merge 写回，不再平面覆写共享键）/ 输入响应×2/语音/陪跑——标「作用于
 * 主应用桌宠」badge；减弱动效（默认跟随系统，U15——dsh helper 同读）；显示桌宠
 * （petShow/petHide 即时动作；hello 握手 5 秒未完成时行内警告，恢复入口 U4）+ 随 dsh 启动
 * （dsh Config schema，A2 双轨——插件私有配置在宿主 ConfigEditor）。
 * 宝可梦选择 = PokemonPicker 内联下拉（桌面 PokemonPicker 同构交互）。
 */
import { useMemo, useState } from "react";
import { useClient } from "../../clientContext";
import { useI18n, useT } from "../../i18n";
import { createPokemonName, createPokemonSearch } from "../../dsh/panelData";
import { TextInput, Toggle } from "../../ui/controls";
import { Sprite } from "../../ui/Sprite";
import ui from "../../ui/ui.module.css";
import type { SectionProps } from "../sectionProps";
import { SectionShell } from "../SectionShell";
import styles from "../settings.module.css";
import { PokemonPicker, type PokemonCandidate } from "./PokemonPicker";

/** key → 当前语言名 + 名录搜索（桌面 pokemonName/searchPokemon 同源；适配层未注入搜索时本地名录兜底） */
function usePokemonCatalog(locale: "zh-Hans" | "zh-Hant" | "en"): {
  pokemonName: (key: string) => string;
  pokemonSearch: (query: string) => Promise<PokemonCandidate[]>;
} {
  return useMemo(
    () => ({ pokemonName: createPokemonName(locale), pokemonSearch: createPokemonSearch(locale) }),
    [locale],
  );
}

/** 解析 pokemon_quotes JSON map（解析失败按 {} 起步——容忍旧版平面写坏的存量） */
function parseQuotes(raw: string): Record<string, string> {
  try {
    const map = JSON.parse(raw || "{}") as Record<string, string>;
    return typeof map === "object" && map !== null ? map : {};
  } catch {
    return {};
  }
}

/** 台词编辑器当前选中的宝可梦（默认跟主宝可梦，没设则皮卡丘——主应用同口径） */
const DEFAULT_QUOTE_POKEMON = "pikachu";

export function PetSection({
  data,
  ...props
}: SectionProps & {
  data: {
    categories: Array<{ id: number; name: string; pokemon: string }>;
    pokemonSearch?: (query: string) => Promise<PokemonCandidate[]>;
  };
}): React.JSX.Element {
  const { draft, onField } = props;
  const t = useT();
  const client = useClient();
  const { locale } = useI18n();
  const { pokemonName, pokemonSearch: localPokemonSearch } = usePokemonCatalog(locale);
  const pokemonSearch = data.pokemonSearch ?? localPokemonSearch;
  const [quotePokemon, setQuotePokemon] = useState(draft["main_pokemon"] || DEFAULT_QUOTE_POKEMON);
  /** petShow ready=false 警告（hello 握手 5 秒超时；简单起见不自隐，下次动作自然覆盖） */
  const [showWarn, setShowWarn] = useState<string | null>(null);

  const mainKey = draft["main_pokemon"];
  const quotesMap = parseQuotes(draft["pokemon_quotes"]);
  const quoteText = quotesMap[quotePokemon] ?? "";

  /** 台词写回：merge 该精灵的行（空文本 = 删除该 key），其他精灵保留——主应用 mergePokemonQuotes 同构 */
  function writeQuotes(key: string, text: string): void {
    const map = { ...parseQuotes(draft["pokemon_quotes"]) };
    const trimmed = text.trim();
    if (trimmed !== "") {
      map[key] = trimmed;
    } else {
      delete map[key];
    }
    onField("pokemon_quotes", JSON.stringify(map));
  }

  async function showPet(): Promise<void> {
    const result = await client.petShow();
    // host 契约返回 { ok, ready }（rpcTypes 尚未带 ready——宽收读取，缺省视为正常）
    const ready = result.ok ? (result.data as { ready?: boolean }).ready : undefined;
    setShowWarn(ready === false ? t("dsh.pet.showNotReady") : null);
  }

  return (
    <SectionShell>
      <div className={ui.card}>
        <h4 className={styles.cardTitle}>{t("cats.mainTitle")}</h4>
        <div className={styles.filterRow} data-testid="main-pokemon-row">
          {mainKey !== "" && (
            <span className={styles.entitySprite}>
              <Sprite spriteKey={mainKey} size={28} alt={pokemonName(mainKey)} />
            </span>
          )}
          <span style={{ flex: 1 }}>
            {t("cats.mainLabel")}：{mainKey === "" ? t("cats.mainFollow") : pokemonName(mainKey)}
          </span>
          <PokemonPicker
            value={mainKey}
            onPick={(key) => onField("main_pokemon", key)}
            search={pokemonSearch}
            nameOf={pokemonName}
            allowEmptyLabel={t("cats.mainFollow")}
            ariaLabel={t("cats.mainLabel")}
          />
        </div>
        <p className={styles.cardHint}>{t("cats.mainDesc")}</p>
        <p className={styles.cardHint}>{t("cats.spriteHint")}</p>
      </div>
      <div className={ui.card}>
        <h4 className={styles.cardTitle}>{t("cats.quotesTitle")}</h4>
        <div className={styles.filterRow}>
          <PokemonPicker
            value={quotePokemon}
            onPick={setQuotePokemon}
            search={pokemonSearch}
            nameOf={pokemonName}
            ariaLabel={t("cats.quotesTitle")}
          />
          <span className={styles.dimCount}>
            {t("cats.quotesCount", {
              n: quoteText.split("\n").filter((l) => l.trim() !== "").length,
            })}
          </span>
        </div>
        <textarea
          className={styles.entityDescInput}
          rows={4}
          aria-label={t("cats.quotesTitle")}
          value={quoteText}
          placeholder={t("cats.quotesPh")}
          onChange={(event) => writeQuotes(quotePokemon, event.target.value)}
        />
      </div>
      <div className={ui.card}>
        <h4 className={styles.cardTitle}>{t("focus.petTitle")}</h4>
        <Toggle
          label={t("focus.petInput")}
          checked={draft["pet_input_response"] === "true"}
          onChange={(v) => onField("pet_input_response", String(v))}
          badge={t("dsh.badge.pet")}
        />
        <p className={styles.cardHint}>{t("focus.petInputDesc")}</p>
        <Toggle
          label={t("focus.petInputWorking")}
          checked={draft["pet_input_response_working"] === "true"}
          onChange={(v) => onField("pet_input_response_working", String(v))}
          badge={t("dsh.badge.pet")}
        />
        <p className={styles.cardHint}>{t("focus.petInputWorkingDesc")}</p>
        <Toggle
          label={t("focus.petVoice")}
          checked={draft["pet_voice"] === "true"}
          onChange={(v) => onField("pet_voice", String(v))}
          badge={t("dsh.badge.pet")}
        />
        <p className={styles.cardHint}>{t("focus.petVoiceDesc")}</p>
        <Toggle
          label={t("focus.petMate")}
          checked={draft["pet_mate"] === "true"}
          onChange={(v) => onField("pet_mate", String(v))}
          badge={t("dsh.badge.pet")}
        />
        <p className={styles.cardHint}>{t("focus.petMateDesc")}</p>
      </div>
      <div className={ui.card}>
        <Toggle
          label={t("display.reduceMotion")}
          checked={draft["reduce_motion"] === "true"}
          onChange={(v) => onField("reduce_motion", String(v))}
        />
        <p className={styles.cardHint}>{t("display.reduceMotionDesc")}</p>
        <div className={styles.filterRow}>
          <span style={{ flex: 1 }}>{t("general.autostart")}</span>
          <button type="button" className={ui.button} onClick={() => void showPet()}>
            {t("pet.menuDex")}
          </button>
          <button
            type="button"
            className={ui.button}
            onClick={() => {
              setShowWarn(null);
              void client.petHide();
            }}
          >
            {t("pet.menuHide")}
          </button>
        </div>
        {showWarn !== null && (
          <p className={styles.saveFailHint} role="alert" data-testid="pet-show-warn">
            {showWarn}
          </p>
        )}
        <p className={styles.cardHint}>{t("general.autostartDesc")}</p>
        <TextInput
          ariaLabel={t("general.autostart")}
          value=""
          onChange={() => {}}
          placeholder="dsh Config schema"
          disabled
        />
      </div>
    </SectionShell>
  );
}
