/**
 * 分类与标签分区页（🗂，U19：实体 CRUD 不走保存制——行内确认提交即时生效）：
 * 分类卡（名称/描述可编辑 = AI 判定参考规则 · 绑定宝可梦缩略图 · 换装入口（PokemonPicker
 * 内联下拉搜 1025 只名称/编号/英文名）· 停用/启用 · 放生分类级联确认）+ 标签管理卡
 * （按维度分组：改名/描述/维度迁移/保存/两段式删除，⚡ = 已配置项目派发）+ 标签维度卡
 * （名称/上限/停用；key 与单多选建后只读呈现——桌面 SectionTaxonomy 同序：维度卡最下）。
 * 新标签提议「＋」接受入口在建议卡侧（SuggestionFeed）。宝可梦选择 → PokemonPicker.tsx；
 * 标签管理卡 → TagsManagerCard.tsx（均再出口）。
 */
import { useState } from "react";
import type { Category } from "../../../host/domain/vocabulary";
import type { Tag, TagDimension } from "../../../host/domain/vocabulary-tags";
import { useClient } from "../../clientContext";
import { useI18n, useT } from "../../i18n";
import { createPokemonName, createPokemonSearch } from "../../dsh/panelData";
import type { DispatchRoute } from "../../rpc";
import { ConfirmDialog } from "../../ui/Modal";
import { TextInput, Toggle } from "../../ui/controls";
import ui from "../../ui/ui.module.css";
import styles from "../settings.module.css";
import { PokemonPicker, type PokemonCandidate } from "./PokemonPicker";
import { TagsManagerCard } from "./TagsManagerCard";

// 图鉴选择器拆件再出口（PetSection/model/panelData 消费面 import 路径不变）
export { PokemonPicker } from "./PokemonPicker";
export type { PokemonCandidate } from "./PokemonPicker";

export function CategoryTagSection({
  categories,
  dimensions,
  tags,
  routes = [],
  pokemonSearch,
  nameOf,
  onChanged,
}: {
  categories: Category[];
  dimensions: TagDimension[];
  tags: Tag[];
  /** 项目派发路由（⚡ chip 判定：agent/目录任一指定 = 已配置） */
  routes?: DispatchRoute[];
  /** 搜索函数（异步；适配层接 host 名录） */
  pokemonSearch?: (query: string) => Promise<PokemonCandidate[]>;
  /** key → 展示名（名录外回落 key；选择器与缩略图 alt 共用） */
  nameOf?: (key: string) => string;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const { locale } = useI18n();
  const [releaseTarget, setReleaseTarget] = useState<Category | null>(null);
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

  const pokemonName = nameOf ?? createPokemonName(locale);
  const search = pokemonSearch ?? createPokemonSearch(locale);

  return (
    <section className={styles.sectionPage} data-testid="section-page">
      <div className={ui.card}>
        <h4 className={styles.cardTitle}>{t("cats.title")}</h4>
        <p className={styles.cardHint}>{t("cats.hint")}</p>
        <div className={styles.entityList}>
          {categories.map((category) => (
            <div
              key={category.id}
              className={styles.entityCardStack}
              data-testid="category-ui.card"
              data-off={category.enabled ? undefined : "true"}
            >
              {/* 上行：名称 + 换装选择器（自带精灵）+ 停用开关 + 放生 同行排齐（桌面 cat-line 同构） */}
              <div className={styles.entityLine}>
                <TextInput
                  className={styles.w110}
                  ariaLabel={t("tags.namePh")}
                  value={category.name}
                  onChange={(name) => void saveCategory(category, { name })}
                  placeholder={t("tags.namePh")}
                />
                <Toggle
                  compact
                  label={t("cats.toggle")}
                  checked={category.enabled}
                  onChange={(enabled) => void toggleCategory(category, enabled)}
                />
                {/* 换装 = 常驻宝可梦下拉（桌面 cat-line 内 PokemonPicker v-model 同构；
                    sprite 存 PokeAPI 裸 key——共享库约定，主应用 PokemonSprite 按此解析） */}
                <PokemonPicker
                  value={category.sprite}
                  onPick={(key) => {
                    void client
                      .categoryUpsert({ id: category.id, pokemon: pokemonName(key), sprite: key })
                      .then(onChanged);
                  }}
                  search={search}
                  nameOf={pokemonName}
                  ariaLabel={`${category.name} · ${t("dsh.pokeSearch.placeholder")}`}
                />
                <button type="button" className={ui.button} onClick={() => setReleaseTarget(category)}>
                  {t("cats.release")}
                </button>
              </div>
              {/* 下行：描述通栏（AI 判定参考规则，桌面 cat-desc 同构） */}
              <TextInput
                ariaLabel={t("cats.descPlaceholder")}
                value={category.description}
                onChange={(description) => void saveCategory(category, { description })}
                placeholder={t("cats.descPlaceholder")}
              />
              {toggleError?.id === category.id && (
                <span className={styles.saveFailHint} role="alert">
                  {toggleError.message}
                </span>
              )}
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
      <TagsManagerCard dimensions={dimensions} tags={tags} routes={routes} onChanged={onChanged} />
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
      {/* 单行排齐（桌面 dim-row 同构）：只读 key 定宽 84 + 名称 110 + 上限 64 + 停用开关 + 保存 */}
      <span className={styles.dimKey} title={dimension.key}>
        {dimension.key}
      </span>
      <TextInput
        className={styles.w110}
        ariaLabel={t("tags.dimNamePh")}
        value={name}
        onChange={setName}
        placeholder={t("tags.dimNamePh")}
      />
      <TextInput
        className={styles.w64}
        ariaLabel={t("tags.maxTags")}
        value={maxTags}
        onChange={setMaxTags}
        placeholder={t("tags.maxTags")}
      />
      <Toggle
        compact
        label={t("cats.toggle")}
        checked={dimension.enabled}
        onChange={(enabled) => {
          void client.dimensionUpdate({ key: dimension.key, name, enabled });
          onChanged();
        }}
      />
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
    </div>
  );
}
