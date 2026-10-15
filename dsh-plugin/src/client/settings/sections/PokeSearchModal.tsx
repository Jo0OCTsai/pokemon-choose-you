/**
 * 拓展图鉴搜索弹层（从 CategoryTagSection 等量迁出）：搜索 1025 只（名称/编号/英文名；
 * 搜索中/无结果态）。分类换装与桌宠主宝可梦选择共用（title 由调用方拼）。
 */
import { useMemo, useState } from "react";
import { useT } from "../../i18n";
import { Modal } from "../../ui/Modal";
import { Sprite } from "../../ui/Sprite";
import { TextInput } from "../../ui/controls";
import ui from "../../ui/ui.module.css";
import styles from "../settings.module.css";

/** 换装搜索候选（适配层注入：1025 只名录搜索在 host 侧） */
export interface PokemonCandidate {
  key: string;
  name: string;
  number: number;
  english: string;
}

/** 换装/选宠搜索弹层（搜索 1025 只：名称/编号/英文名；搜索中/无结果态；title 由调用方拼） */
export function PokeSearchModal({
  title,
  search,
  onClose,
  onPick,
}: {
  title: string;
  search?: (query: string) => Promise<PokemonCandidate[]>;
  onClose: () => void;
  onPick: (candidate: PokemonCandidate) => void;
}): React.JSX.Element {
  const t = useT();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<PokemonCandidate[] | null>(null);
  const candidates = useMemo(
    () =>
      results?.filter(
        (c) =>
          query === "" ||
          c.name.includes(query) ||
          c.english.toLowerCase().includes(query.toLowerCase()) ||
          String(c.number) === query,
      ) ?? [],
    [results, query],
  );
  return (
    <Modal title={title} actions={[{ label: t("cancel"), onChoose: onClose }]} onClose={onClose}>
      <TextInput
        ariaLabel={t("dsh.pokeSearch.placeholder")}
        value={query}
        onChange={(v) => {
          setQuery(v);
          if (search !== undefined) {
            setBusy(true);
            void search(v).then((list) => {
              setResults(list);
              setBusy(false);
            });
          }
        }}
        placeholder={t("dsh.pokeSearch.placeholder")}
      />
      <div className={styles.pokeResults}>
        {busy && <span className={ui.muted}>{t("dsh.pokeSearch.searching")}</span>}
        {!busy && results !== null && candidates.length === 0 && (
          <span className={ui.muted}>{t("dsh.pokeSearch.noResult")}</span>
        )}
        {candidates.map((candidate) => (
          <button key={candidate.key} type="button" className={styles.pokeResultRow} onClick={() => onPick(candidate)}>
            <span className={styles.entitySprite}>
              <Sprite spriteKey={candidate.key} size={24} alt={candidate.name} />
            </span>
            No.{candidate.number} {candidate.name} · {candidate.english}
          </button>
        ))}
      </div>
    </Modal>
  );
}
