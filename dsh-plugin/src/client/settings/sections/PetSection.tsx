/**
 * 桌宠分区页（🐾，对齐主应用 SectionPets）：主宝可梦/台词/输入响应×2/语音/陪跑——
 * 标「作用于主应用桌宠」badge；减弱动效（默认跟随系统，U15——dsh helper 同读）；
 * 显示桌宠（petShow/petHide 即时动作，恢复入口 U4）+ 随 dsh 启动（dsh Config schema，
 * A2 双轨——插件私有配置在宿主 ConfigEditor）。
 */
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import { Select, TextInput, Toggle } from "../../ui/controls";
import ui from "../../ui/ui.module.css";
import type { SectionProps } from "../sectionProps";
import { PET_KEYS } from "../sectionKeys";
import { SectionShell } from "../SectionShell";
import styles from "../settings.module.css";

export function PetSection({
  data,
  ...props
}: SectionProps & { data: { categories: Array<{ id: number; name: string; pokemon: string }> } }): React.JSX.Element {
  const { draft, saved, onField, onSavedKeys } = props;
  const t = useT();
  const client = useClient();
  const pokemonOptions = [
    { value: "", label: t("cats.mainFollow") },
    ...data.categories.filter((c) => c.pokemon !== "").map((c) => ({ value: c.pokemon, label: c.pokemon })),
  ];
  return (
    <SectionShell title={`🐾 ${t("stabs.pets")}`} keys={PET_KEYS} draft={draft} saved={saved} onSavedKeys={onSavedKeys}>
      <div className={ui.card}>
        <h4 className={styles.cardTitle}>{t("cats.mainTitle")}</h4>
        <Select
          label={t("cats.mainLabel")}
          value={draft["main_pokemon"]}
          options={pokemonOptions}
          onChange={(v) => onField("main_pokemon", v)}
        />
        <p className={styles.cardHint}>{t("cats.mainDesc")}</p>
        <p className={styles.cardHint}>{t("cats.spriteHint")}</p>
      </div>
      <div className={ui.card}>
        <h4 className={styles.cardTitle}>{t("cats.quotesTitle")}</h4>
        <textarea
          className={styles.entityDescInput}
          rows={4}
          aria-label={t("cats.quotesTitle")}
          value={draft["pokemon_quotes"] === "{}" ? "" : draft["pokemon_quotes"]}
          placeholder={t("cats.quotesPh")}
          onChange={(event) => onField("pokemon_quotes", event.target.value)}
        />
        <p className={styles.cardHint}>
          {t("cats.quotesCount", { n: draft["pokemon_quotes"].split("\n").filter((l) => l.trim() !== "").length })}
        </p>
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
          <button type="button" className={ui.button} onClick={() => void client.petShow()}>
            {t("pet.menuDex")}
          </button>
          <button type="button" className={ui.button} onClick={() => void client.petHide()}>
            {t("pet.menuHide")}
          </button>
        </div>
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
