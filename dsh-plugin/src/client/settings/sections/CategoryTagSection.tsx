/**
 * 分类与标签分区页（🗂，U19：实体 CRUD 不走保存制——行内确认提交即时生效）：
 * 分类卡（名称/描述可编辑 = AI 判定参考规则 · 绑定宝可梦缩略图 · 换装入口（搜索 1025 只
 * 名称/编号/英文名）· 停用/启用 · 放生分类级联确认）+ 标签维度卡（名称/上限/停用；key
 * 与单多选建后只读呈现）+ 标签管理卡（按维度分组：改名/描述/维度迁移/保存/两段式删除，
 * ⚡ = 已配置项目派发）。新标签提议「＋」接受入口在建议卡侧（SuggestionCard）。
 * 图鉴搜索弹层 → PokeSearchModal.tsx；标签管理卡 → TagsManagerCard.tsx（均再出口）。
 */
import { useState } from "react";
import type { Category } from "../../../host/domain/vocabulary";
import type { Tag, TagDimension } from "../../../host/domain/vocabulary-tags";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import type { DispatchRoute } from "../../rpc";
import { ConfirmDialog } from "../../ui/Modal";
import { Sprite } from "../../ui/Sprite";
import { TextInput, Toggle } from "../../ui/controls";
import ui from "../../ui/ui.module.css";
import styles from "../settings.module.css";
import { PokeSearchModal, type PokemonCandidate } from "./PokeSearchModal";
import { TagsManagerCard } from "./TagsManagerCard";

// 图鉴搜索弹层拆件再出口（PetSection/model/panelData 消费面 import 路径不变）
export { PokeSearchModal } from "./PokeSearchModal";
export type { PokemonCandidate } from "./PokeSearchModal";

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
              className={styles.entityCardStack}
              data-testid="category-ui.card"
              data-off={category.enabled ? undefined : "true"}
            >
              {/* 上行：精灵 + 名称 + 停用开关 + 换装/放生 同行排齐（桌面 cat-line 同构） */}
              <div className={styles.entityLine}>
                <span className={styles.entitySprite}>
                  {category.sprite !== "" && <Sprite spriteKey={category.sprite} size={28} alt={category.pokemon} />}
                </span>
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
