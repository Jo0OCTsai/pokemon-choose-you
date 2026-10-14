/**
 * 分类与标签分区页（🗂，U19：实体 CRUD 不走保存制——行内确认提交即时生效）：
 * 分类卡（名称/描述可编辑 = AI 判定参考规则 · 绑定宝可梦缩略图 · 换装入口（搜索 1025 只
 * 名称/编号/英文名）· 放生分类级联确认）+ 标签维度卡（名称/上限/停用；key 与单多选建后
 * 只读呈现）。新标签提议「＋」接受入口在建议卡侧（SuggestionCard）。
 */
import { useMemo, useState } from "react";
import type { Category } from "../../../host/domain/vocabulary";
import type { Tag, TagDimension } from "../../../host/domain/vocabulary-tags";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import { ConfirmDialog, Modal } from "../../ui/Modal";
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

export function CategoryTagSection({
  categories,
  dimensions,
  tags,
  pokemonSearch,
  onChanged,
}: {
  categories: Category[];
  dimensions: TagDimension[];
  tags: Tag[];
  /** 搜索函数（异步；适配层接 host 名录） */
  pokemonSearch?: (query: string) => Promise<PokemonCandidate[]>;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [releaseTarget, setReleaseTarget] = useState<Category | null>(null);
  const [dressTarget, setDressTarget] = useState<Category | null>(null);
  const [newCategory, setNewCategory] = useState("");

  async function saveCategory(category: Category, patch: Partial<Category>): Promise<void> {
    await client.categoryUpsert({ id: category.id, ...patch });
    onChanged();
  }

  return (
    <section className={styles.sectionPage} data-testid="section-page">
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionHeading}>🗂 {t("stabs.taxonomy")}</h3>
      </div>
      <div className={ui.card}>
        <h4 className={styles.cardTitle}>{t("cats.title")}</h4>
        <p className={styles.cardHint}>{t("cats.hint")}</p>
        <div className={styles.entityList}>
          {categories.map((category) => (
            <div key={category.id} className={styles.entityCard} data-testid="category-ui.card">
              <span className={styles.entitySprite}>
                {category.sprite !== "" && <Sprite spriteKey={category.sprite} size={28} alt={category.pokemon} />}
              </span>
              <div className={styles.entityMain}>
                <TextInput
                  ariaLabel={t("tags.namePh")}
                  value={category.name}
                  onChange={(name) => void saveCategory(category, { name })}
                />
                <TextInput
                  ariaLabel={t("cats.descPlaceholder")}
                  value={category.description}
                  onChange={(description) => void saveCategory(category, { description })}
                />
              </div>
              <button
                type="button"
                className={ui.button}
                onClick={() => {
                  setDressTarget(category);
                }}
              >
                {t("pk.searchPh")}
              </button>
              <button type="button" className={ui.button} onClick={() => setReleaseTarget(category)}>
                {t("cats.release")}
              </button>
            </div>
          ))}
        </div>
        <div className={styles.filterRow}>
          <TextInput
            ariaLabel={t("cats.newName")}
            value={newCategory}
            onChange={setNewCategory}
            placeholder={t("cats.newName")}
          />
          <button
            type="button"
            className={ui.button}
            disabled={newCategory.trim() === ""}
            onClick={async () => {
              await client.categoryUpsert({ name: newCategory.trim() });
              setNewCategory("");
              onChanged();
            }}
          >
            {t("cats.new")}
          </button>
        </div>
      </div>
      <div className={ui.card}>
        <h4 className={styles.cardTitle}>{t("tags.dimTitle")}</h4>
        <p className={styles.cardHint}>{t("tags.dimManageHint")}</p>
        <div className={styles.entityList}>
          {dimensions.map((dimension) => (
            <DimensionCard key={dimension.key} dimension={dimension} onChanged={onChanged} />
          ))}
        </div>
        <p className={ui.muted}>
          {t("tags.dimHint")} · {tags.length} {t("tags.title")}
        </p>
      </div>
      {releaseTarget !== null && (
        <ConfirmDialog
          title={t("cats.release")}
          body={t("dsh.category.releaseConfirm", {
            name: releaseTarget.name,
            n: categories.length,
            first: categories.find((c) => c.id !== releaseTarget.id)?.name ?? "",
          })}
          confirmLabel={t("dsh.release.confirmOk")}
          danger
          onCancel={() => setReleaseTarget(null)}
          onConfirm={() => {
            void client.categoryDelete({ id: releaseTarget.id }).then(() => {
              setReleaseTarget(null);
              onChanged();
            });
          }}
        />
      )}
      {dressTarget !== null && (
        <PokeSearchModal
          category={dressTarget}
          search={pokemonSearch}
          onClose={() => setDressTarget(null)}
          onPick={(candidate) => {
            void client
              // sprite 存 PokeAPI 裸 key（共享库约定，主应用 PokemonSprite 按此解析）
              .categoryUpsert({ id: dressTarget.id, pokemon: candidate.name, sprite: candidate.key })
              .then(() => {
                setDressTarget(null);
                onChanged();
              });
          }}
        />
      )}
    </section>
  );
}

function DimensionCard({
  dimension,
  onChanged,
}: {
  dimension: TagDimension;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [name, setName] = useState(dimension.name);
  const [maxTags, setMaxTags] = useState(String(dimension.maxTags));
  return (
    <div className={styles.entityCard} data-testid="dimension-ui.card">
      <div className={styles.entityMain}>
        <TextInput ariaLabel={t("tags.dimNamePh")} value={name} onChange={setName} />
        <span className={styles.readonlyKey}>
          key={dimension.key} · {dimension.cardinality === "single" ? t("tags.single") : "multi"}
        </span>
      </div>
      <TextInput ariaLabel={t("tags.maxTags")} value={maxTags} onChange={setMaxTags} />
      <button
        type="button"
        className={ui.button}
        onClick={async () => {
          await client.dimensionUpdate({ key: dimension.key, name, maxTags: Number(maxTags) });
          onChanged();
        }}
      >
        {t("tags.save")}
      </button>
      <button
        type="button"
        className={ui.button}
        onClick={async () => {
          await client.dimensionUpdate({ key: dimension.key, name, enabled: !dimension.enabled });
          onChanged();
        }}
      >
        {t("cats.toggle")}
      </button>
    </div>
  );
}

/** 换装搜索弹层（搜索 1025 只：名称/编号/英文名；搜索中/无结果态） */
export function PokeSearchModal({
  category,
  search,
  onClose,
  onPick,
}: {
  category: Category;
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
    <Modal
      title={`${category.name} · ${t("dsh.pokeSearch.placeholder")}`}
      actions={[{ label: t("cancel"), onChoose: onClose }]}
      onClose={onClose}
    >
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
