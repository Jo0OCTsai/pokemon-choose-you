/**
 * 标签管理卡（从 CategoryTagSection 等量迁出，对齐主应用 TagsManagerCard）：编辑行按
 * 维度分组渲染——组头（维度名 + {used}/{max} 配额 + 单选标记 + 「＋ 新标签」）、行内
 * 改名/描述/维度迁移/保存/两段式删除。⚡ = 已配置项目派发（agent 或目录任一指定）。
 */
import { useMemo, useState } from "react";
import type { Tag, TagDimension } from "../../../host/domain/vocabulary-tags";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import type { DispatchRoute } from "../../rpc";
import { ConfirmDialog } from "../../ui/Modal";
import { Select, TextInput } from "../../ui/controls";
import ui from "../../ui/ui.module.css";
import styles from "../settings.module.css";

/**
 * 标签管理卡（对齐主应用 TagsManagerCard）：编辑行按维度分组渲染——组头（维度名 +
 * {used}/{max} 配额 + 单选标记 + 「＋ 新标签」）、行内改名/描述/维度迁移/保存/两段式删除。
 * ⚡ = 已配置项目派发（agent 或目录任一指定，口径同「项目派发」卡的「已配置」）。
 */
export function TagsManagerCard({
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
      {/* 单行排齐（桌面 tag-row 同构）：名称 110 + ⚡ + 描述占满 + 维度下拉 92 + 保存/删除 */}
      <TextInput
        className={styles.w110}
        ariaLabel={t("tags.namePh")}
        value={name}
        onChange={setName}
        placeholder={t("tags.namePh")}
      />
      {dispatched && (
        <span className={styles.tagChip} title={t("tagDispatch.chipHint")}>
          ⚡
        </span>
      )}
      <TextInput
        className={styles.grow}
        ariaLabel={t("tags.descPh")}
        value={description}
        onChange={setDescription}
        placeholder={t("tags.descPh")}
      />
      <Select
        className={styles.w92}
        ariaLabel={t("tags.dimTitle")}
        value={dimension}
        options={dimOptions}
        onChange={setDimension}
      />
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
