/**
 * 标签按维度分组 chips 选择器（从 TaskEditModal.tsx 拆出——棘轮 max-lines，等量
 * 迁移）：项目维度单选互斥、总数上限 3、超限禁用新选中、空态引导。
 */
import type { Tag } from "../../host/domain/vocabulary-tags";
import type { PanelData } from "../model";
import type { Task } from "../../host/domain/tasks";
import styles from "./tasks.module.css";

/** 每条待办标签总数上限（防碎片化，与 AI 打标规则同口径） */
export const MAX_TAGS = 3;

export interface TagGroup {
  key: string;
  name: string;
  /** 单选维度（cardinality === "single"，如项目）：chips 互斥 */
  single: boolean;
  tags: Tag[];
}

/** 标签分组：启用维度序 × 维度内标签（未知维度标签不呈现——与桌面 enabledDimensions 口径一致） */
export function buildTagGroups(data: PanelData): TagGroup[] {
  const groups = new Map<string, Tag[]>();
  for (const dim of data.dimensions ?? []) {
    if (dim.enabled) {
      groups.set(dim.key, []);
    }
  }
  for (const tag of data.tags ?? []) {
    const bucket = groups.get(tag.dimension);
    if (bucket !== undefined) {
      bucket.push(tag);
    }
  }
  return [...groups.entries()].map(([key, tags]) => {
    const dim = (data.dimensions ?? []).find((d) => d.key === key);
    return { key, name: dim?.name ?? key, single: dim?.cardinality === "single", tags };
  });
}

/** 任务标签引用（name+dimension）→ 标签 id（同名跨维度先精确命中，回落同名） */
export function initialTagIds(task: Task, tags: Tag[]): number[] {
  const ids: number[] = [];
  for (const ref of task.tags) {
    const hit =
      tags.find((x) => x.name === ref.name && x.dimension === ref.dimension) ?? tags.find((x) => x.name === ref.name);
    if (hit !== undefined && !ids.includes(hit.id)) {
      ids.push(hit.id);
    }
  }
  return ids;
}

/** chips 选择器呈现（选择逻辑由调用方 toggleTag 承载——状态归 TaskEditModal） */
export function TagPicker({
  groups,
  selectedIds,
  onToggle,
  noTagsLabel,
}: {
  groups: TagGroup[];
  selectedIds: number[];
  onToggle: (tag: Tag, single: boolean) => void;
  noTagsLabel: string;
}): React.JSX.Element {
  return (
    <div className={styles.tagPick}>
      {groups.length === 0 ? (
        <span className={styles.tagCount}>{noTagsLabel}</span>
      ) : (
        groups.map((group) => (
          <div key={group.key} className={styles.tagDim}>
            <span className={styles.dimName}>{group.name}</span>
            {group.tags.length === 0 ? (
              <span className={styles.dimName}>—</span>
            ) : (
              group.tags.map((tag) => {
                const selected = selectedIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    className={styles.tagChip}
                    data-on={selected}
                    data-project={group.key === "project"}
                    aria-pressed={selected}
                    title={tag.description !== "" ? tag.description : group.name}
                    // 上限后新选禁用；单选维度换选不减总数，保持可点（桌面同构）
                    disabled={!selected && selectedIds.length >= MAX_TAGS && !group.single}
                    onClick={() => onToggle(tag, group.single)}
                  >
                    {tag.name}
                  </button>
                );
              })
            )}
          </div>
        ))
      )}
      <span className={styles.tagCount}>
        {selectedIds.length}/{MAX_TAGS}
      </span>
    </div>
  );
}
