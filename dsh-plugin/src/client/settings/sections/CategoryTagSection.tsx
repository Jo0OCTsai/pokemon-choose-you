/**
 * 分类与标签分区页（🗂，U19：实体 CRUD 不走保存制——行内确认提交即时生效）：
 * 分类卡（名称/描述可编辑 = AI 判定参考规则 · 绑定宝可梦缩略图 · 换装入口（搜索 1025 只
 * 名称/编号/英文名）· 停用/启用 · 放生分类级联确认）+ 标签维度卡（名称/上限/停用；key
 * 与单多选建后只读呈现）+ 标签管理卡（按维度分组：改名/描述/维度迁移/保存/两段式删除，
 * ⚡ = 已配置项目派发）。新标签提议「＋」接受入口在建议卡侧（SuggestionCard）。
 */
import { useMemo, useState } from "react";
import type { Category } from "../../../host/domain/vocabulary";
import type { Tag, TagDimension } from "../../../host/domain/vocabulary-tags";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import type { DispatchRoute } from "../../rpc";
import { ConfirmDialog, Modal } from "../../ui/Modal";
import { Sprite } from "../../ui/Sprite";
import { Select, TextInput, Toggle } from "../../ui/controls";
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
  routes = [],
  pokemonSearch,
  onChanged,
}: {
  categories: Category[];
  dimensions: TagDimension[];
  tags: Tag[];
  /** 项目派发路由（⚡ chip 判定：agent/目录任一指定 = 已配置） */
  routes?: DispatchRoute[];
  /** 搜索函数（异步；适配层接 host 名录） */
  pokemonSearch?: (query: string) => Promise<PokemonCandidate[]>;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [releaseTarget, setReleaseTarget] = useState<Category | null>(null);
  const [dressTarget, setDressTarget] = useState<Category | null>(null);
  const [newCategory, setNewCategory] = useState("");
  /** 停用/启用失败行内错误（「至少保留一个启用分类」守卫等，不弹窗） */
  const [toggleError, setToggleError] = useState<{ id: number; message: string } | null>(null);

  async function saveCategory(category: Category, patch: Partial<Category>): Promise<void> {
    await client.categoryUpsert({ id: category.id, ...patch });
    onChanged();
  }

  /** 停用/启用即时生效；失败（如最后一个启用分类）行内回显错误 */
  async function toggleCategory(category: Category, enabled: boolean): Promise<void> {
    const result = await client.categoryUpsert({ id: category.id, enabled });
    if (result.ok) {
      setToggleError(null);
      onChanged();
    } else {
      setToggleError({ id: category.id, message: result.error.message });
    }
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
            <div
              key={category.id}
              className={styles.entityCard}
              data-testid="category-ui.card"
              data-off={category.enabled ? undefined : "true"}
            >
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
                {toggleError?.id === category.id && (
                  <span className={styles.saveFailHint} role="alert">
                    {toggleError.message}
                  </span>
                )}
              </div>
              <Toggle
                label={t("cats.toggle")}
                checked={category.enabled}
                onChange={(enabled) => void toggleCategory(category, enabled)}
              />
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
      <TagsManagerCard dimensions={dimensions} tags={tags} routes={routes} onChanged={onChanged} />
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
          title={`${dressTarget.name} · ${t("dsh.pokeSearch.placeholder")}`}
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

/**
 * 标签管理卡（对齐主应用 TagsManagerCard）：编辑行按维度分组渲染——组头（维度名 +
 * {used}/{max} 配额 + 单选标记 + 「＋ 新标签」）、行内改名/描述/维度迁移/保存/两段式删除。
 * ⚡ = 已配置项目派发（agent 或目录任一指定，口径同「项目派发」卡的「已配置」）。
 */
function TagsManagerCard({
  dimensions,
  tags,
  routes,
  onChanged,
}: {
  dimensions: TagDimension[];
  tags: Tag[];
  routes: DispatchRoute[];
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  /** 已配置派发的项目标签名集（路由以标签名为键） */
  const dispatchedNames = useMemo(
    () => new Set(routes.filter((r) => r.agentId !== "" || r.workdir !== "").map((r) => r.tag)),
    [routes],
  );
  /** 行内维度迁移下拉的选项（停用维度不进选项，主应用同口径） */
  const enabledDimOptions = useMemo(
    () => dimensions.filter((d) => d.enabled).map((d) => ({ value: d.key, label: d.name })),
    [dimensions],
  );

  async function addTag(dimKey: string): Promise<void> {
    await client.tagUpsert({ name: t("tags.newName"), dimension: dimKey, description: "" });
    onChanged();
  }

  return (
    <div className={ui.card}>
      <h4 className={styles.cardTitle}>{t("tags.title")}</h4>
      <p className={styles.cardHint}>{t("tags.hint")}</p>
      {dimensions.map((dimension) => {
        const rows = tags.filter((tag) => tag.dimension === dimension.key);
        return (
          <div key={dimension.key} className={styles.tagDimGroup}>
            <div className={styles.tagDimHead}>
              <b>{dimension.name}</b>
              <span className={styles.dimCount}>
                {t("tags.dimCount", { used: rows.length, max: dimension.maxTags })}
                {dimension.cardinality === "single" ? ` · ${t("tags.single")}` : ""}
              </span>
              <button
                type="button"
                className={ui.button}
                disabled={rows.length >= dimension.maxTags}
                onClick={() => void addTag(dimension.key)}
              >
                {t("tags.new")}
              </button>
            </div>
            {rows.map((tag) => (
              <TagRow
                key={tag.id}
                tag={tag}
                dispatched={dispatchedNames.has(tag.name)}
                dimOptions={enabledDimOptions}
                onChanged={onChanged}
              />
            ))}
          </div>
        );
      })}
      <p className={styles.cardHint}>{t("tags.dimHint")}</p>
    </div>
  );
}

/** 单个标签编辑行（行内改名/描述/维度迁移 → 保存；删除两段式确认） */
function TagRow({
  tag,
  dispatched,
  dimOptions,
  onChanged,
}: {
  tag: Tag;
  /** 是否已配置项目派发（⚡ chip） */
  dispatched: boolean;
  dimOptions: Array<{ value: string; label: string }>;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [name, setName] = useState(tag.name);
  const [description, setDescription] = useState(tag.description);
  const [dimension, setDimension] = useState(tag.dimension);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save(): Promise<void> {
    await client.tagUpsert({ id: tag.id, name: name.trim(), dimension, description });
    onChanged();
  }

  return (
    <div className={styles.entityCard} data-testid="tag-row">
      <TextInput ariaLabel={t("tags.namePh")} value={name} onChange={setName} placeholder={t("tags.namePh")} />
      {dispatched && (
        <span className={styles.tagChip} title={t("tagDispatch.chipHint")}>
          ⚡
        </span>
      )}
      <TextInput
        ariaLabel={t("tags.descPh")}
        value={description}
        onChange={setDescription}
        placeholder={t("tags.descPh")}
      />
      <Select ariaLabel={t("tags.dimTitle")} value={dimension} options={dimOptions} onChange={setDimension} />
      <button type="button" className={ui.button} onClick={() => void save()}>
        {t("tags.save")}
      </button>
      <button type="button" className={ui.button} onClick={() => setConfirmDelete(true)}>
        {t("tags.release")}
      </button>
      {confirmDelete && (
        <ConfirmDialog
          title={t("tags.release")}
          body={t("dsh.tag.deleteConfirm", { name: tag.name })}
          confirmLabel={t("tags.release")}
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            void client.tagDelete({ id: tag.id }).then(() => {
              setConfirmDelete(false);
              onChanged();
            });
          }}
        />
      )}
    </div>
  );
}
