/**
 * 任务全字段编辑弹窗（对照主应用 TaskEditModal.vue）：标题（必填校验）/ 备注 /
 * 分类（启用中，任务自身已停用分类保留）/ 优先级（low/normal/high/urgent）/
 * 截止与提醒（datetime-local，空串 → null 清空）/ 标签按维度分组 chips（项目
 * 维度单选互斥、总数上限 3、超限禁用新选中、空态引导）。保存 → taskUpdate →
 * onChanged 刷新 + 关闭；取消 / 未保存关闭直接丢弃（跟随桌面）。
 */
import { useMemo, useState } from "react";
import type { Task } from "../../host/domain/tasks";
import type { Tag } from "../../host/domain/vocabulary-tags";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import type { PanelData } from "../model";
import { Modal } from "../ui/Modal";
import { Select, TextInput } from "../ui/controls";
import styles from "./tasks.module.css";

/** 每条待办标签总数上限（防碎片化，与 AI 打标规则同口径） */
const MAX_TAGS = 3;
/** 优先级档序（与主应用 priorityOptions 同源） */
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

/** RFC3339 → datetime-local 值（YYYY-MM-DDTHH:mm；null/短串 → 空串 = 清空态） */
function toLocalInput(iso: string | null): string {
  return iso === null ? "" : iso.slice(0, 16);
}

/** 任务标签引用（name+dimension）→ 标签 id（同名跨维度先精确命中，回落同名） */
function initialTagIds(task: Task, tags: Tag[]): number[] {
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

interface TagGroup {
  key: string;
  name: string;
  /** 单选维度（cardinality === "single"，如项目）：chips 互斥 */
  single: boolean;
  tags: Tag[];
}

/** 标签分组：启用维度序 × 维度内标签（未知维度标签不呈现——与桌面 enabledDimensions 口径一致） */
function buildTagGroups(data: PanelData): TagGroup[] {
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

export function TaskEditModal({
  task,
  data,
  onClose,
  onChanged,
}: {
  task: Task;
  data: PanelData;
  onClose: () => void;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [title, setTitle] = useState(task.title);
  const [note, setNote] = useState(task.note ?? "");
  const [categoryId, setCategoryId] = useState(task.categoryId);
  const [priority, setPriority] = useState(task.priority);
  const [dueAt, setDueAt] = useState(toLocalInput(task.dueAt));
  const [remindAt, setRemindAt] = useState(toLocalInput(task.remindAt));
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>(() => initialTagIds(task, data.tags ?? []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // 分类选项：只列启用中的分类；任务自身所属分类若已停用则保留（否则下拉显示不出名字）
  const categoryOptions = useMemo(
    () =>
      data.categories
        .filter((c) => c.enabled || c.id === task.categoryId)
        .map((c) => ({ value: String(c.id), label: c.name })),
    [data.categories, task.categoryId],
  );
  const tagGroups = useMemo(() => buildTagGroups(data), [data]);
  const sameDimIds = useMemo(() => {
    const byDim = new Map<string, Set<number>>();
    for (const tag of data.tags ?? []) {
      const set = byDim.get(tag.dimension) ?? new Set<number>();
      set.add(tag.id);
      byDim.set(tag.dimension, set);
    }
    return byDim;
  }, [data.tags]);

  /** chips 切换（桌面 toggleTag 同构）：已选去除；单选维度先清同维；上限后新选不再进 */
  function toggleTag(tag: Tag, single: boolean): void {
    setSelectedTagIds((prev) => {
      if (prev.includes(tag.id)) {
        return prev.filter((id) => id !== tag.id);
      }
      let next = prev;
      if (single) {
        const sameDim = sameDimIds.get(tag.dimension) ?? new Set<number>();
        next = next.filter((id) => !sameDim.has(id));
      }
      if (next.length >= MAX_TAGS) {
        return next;
      }
      return [...next, tag.id];
    });
  }

  async function save(): Promise<void> {
    const trimmedTitle = title.trim();
    if (trimmedTitle === "") {
      setError(t("edit.titleRequired"));
      return;
    }
    setSaving(true);
    setError("");
    const result = await client.taskUpdate({
      id: task.id,
      title: trimmedTitle,
      // TaskPatch.note 契约收 string（空串 = 清空；null 仅 due/remind 三态支持）
      note,
      categoryId,
      priority,
      // datetime-local 空串转 null 表示清空；状态不手动改，由后端不变量归位
      dueAt: dueAt === "" ? null : dueAt,
      remindAt: remindAt === "" ? null : remindAt,
      tagIds: selectedTagIds,
    });
    setSaving(false);
    if (result.ok) {
      onChanged();
      onClose();
    } else {
      setError(result.error.message);
    }
  }

  return (
    <Modal
      title={`✎ No.${String(task.id).padStart(3, "0")} ${t("edit.title")}`}
      ariaLabel={t("edit.title")}
      actions={[
        { label: t("save2"), onChoose: () => void save(), variant: "primary", disabled: saving },
        { label: t("cancel"), onChoose: onClose },
      ]}
      onClose={onClose}
    >
      <div className={styles.editForm} data-testid="task-edit-form">
        <label className={styles.editRow}>
          <span className={styles.editRowLabel}>{t("edit.taskTitle")}</span>
          <TextInput value={title} onChange={setTitle} ariaLabel={t("edit.taskTitle")} />
        </label>
        <label className={styles.editRow}>
          <span className={styles.editRowLabel}>{t("edit.note")}</span>
          <textarea
            className={styles.editTextarea}
            rows={2}
            value={note}
            aria-label={t("edit.note")}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <div className={styles.editRow}>
          <span className={styles.editRowLabel}>{t("edit.category")}</span>
          <Select
            value={String(categoryId)}
            onChange={(value) => setCategoryId(Number(value))}
            options={categoryOptions}
            ariaLabel={t("edit.category")}
          />
        </div>
        <div className={styles.editRow}>
          <span className={styles.editRowLabel}>{t("edit.priority")}</span>
          <Select
            value={priority}
            onChange={setPriority}
            options={PRIORITIES.map((p) => ({ value: p, label: t(`priority.${p}`) }))}
            ariaLabel={t("edit.priority")}
          />
        </div>
        <div className={styles.editRow}>
          <span className={styles.editRowLabel}>{t("edit.due")}</span>
          <input
            type="datetime-local"
            className={styles.editDatetime}
            value={dueAt}
            aria-label={t("edit.due")}
            onChange={(event) => setDueAt(event.target.value)}
          />
        </div>
        <div className={styles.editRow}>
          <span className={styles.editRowLabel}>{t("edit.remind")}</span>
          <input
            type="datetime-local"
            className={styles.editDatetime}
            value={remindAt}
            aria-label={t("edit.remind")}
            onChange={(event) => setRemindAt(event.target.value)}
          />
        </div>
        <div className={styles.editRow}>
          <span className={styles.editRowLabel}>{t("edit.tags")}</span>
          <div className={styles.tagPick}>
            {tagGroups.length === 0 ? (
              <span className={styles.tagCount}>{t("edit.noTags")}</span>
            ) : (
              tagGroups.map((group) => (
                <div key={group.key} className={styles.tagDim}>
                  <span className={styles.dimName}>{group.name}</span>
                  {group.tags.length === 0 ? (
                    <span className={styles.dimName}>—</span>
                  ) : (
                    group.tags.map((tag) => {
                      const selected = selectedTagIds.includes(tag.id);
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
                          disabled={!selected && selectedTagIds.length >= MAX_TAGS && !group.single}
                          onClick={() => toggleTag(tag, group.single)}
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
              {selectedTagIds.length}/{MAX_TAGS}
            </span>
          </div>
        </div>
        {error !== "" && (
          <p className={styles.editError} role="alert">
            ❌ {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
