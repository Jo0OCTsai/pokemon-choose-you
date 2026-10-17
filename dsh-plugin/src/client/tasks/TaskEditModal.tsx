/**
 * 任务全字段弹窗（对照主应用 TaskEditModal.vue）· 编辑 + create 双模式（U22）：
 * - 编辑：标题（必填校验）/ 备注 / 分类（启用中，任务自身已停用分类保留）/
 *   优先级（low/normal/high/urgent）/ 截止与提醒（DateTimePicker 弹层选择，空串 → null 清空）/
 *   标签按维度分组 chips（项目维度单选互斥、总数上限 3、超限禁用新选中、空态引导）。
 *   保存 → taskUpdate → onChanged 刷新 + 关闭；取消 / 未保存关闭直接丢弃（跟随桌面）。
 * - create（task 入参缺省）：分类缺省第一个启用、优先级 normal、多「排期」字段
 *   （scheduledFor 有值 → 状态 scheduled、值兜底落截止）；提交 → taskCreate；标题必填
 *   trim 行内校验「标题不能为空」（焦点回标题输入）。
 */
import { useMemo, useState } from "react";
import type { Task } from "../../host/domain/tasks";
import type { Tag } from "../../host/domain/vocabulary-tags";
import { useClient } from "../clientContext";
import type { HostClient } from "../rpc";
import { useT } from "../i18n";
import type { PanelData } from "../model";
import { DateTimePicker } from "../ui/DateTimePicker";
import { Modal } from "../ui/Modal";
import { Select, TextInput } from "../ui/controls";
import { MAX_TAGS, TagPicker, buildTagGroups, initialTagIds } from "./tagPicker";
import { initialFormValues, modalAriaLabel, modalTitle, orUndefined } from "./taskEditHelpers";
import styles from "./tasks.module.css";

/** 优先级档序（与主应用 priorityOptions 同源） */
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

/** 表单值集（提交与 chips 选择的入参面） */
interface TaskFormState {
  title: string;
  note: string;
  categoryId: number;
  priority: string;
  dueAt: string;
  remindAt: string;
  scheduledFor: string;
  tagIds: number[];
}

/** create 模式提交（U22：状态 = 排期?scheduled:inbox 由 host 推导；标签全量替换关联） */
async function submitTaskCreate(client: HostClient, form: TaskFormState): Promise<string> {
  const result = await client.taskCreate({
    title: form.title,
    note: form.note,
    categoryId: form.categoryId,
    priority: form.priority,
    due: orUndefined(form.dueAt),
    remindAt: orUndefined(form.remindAt),
    scheduledFor: orUndefined(form.scheduledFor),
    tagIds: form.tagIds,
  });
  return result.ok ? "" : result.error.message;
}

/** edit 模式提交（TaskPatch.note 契约收 string——空串 = 清空；picker 空串转 null 清空；状态不手动改） */
async function submitTaskUpdate(client: HostClient, task: Task, form: TaskFormState): Promise<string> {
  const result = await client.taskUpdate({
    id: task.id,
    title: form.title,
    note: form.note,
    categoryId: form.categoryId,
    priority: form.priority,
    dueAt: form.dueAt === "" ? null : form.dueAt,
    remindAt: form.remindAt === "" ? null : form.remindAt,
    tagIds: form.tagIds,
  });
  return result.ok ? "" : result.error.message;
}

/** chips 切换实现（桌面 toggleTag 同构）：已选去除；单选维度先清同维；上限后新选不再进 */
function toggleTagId(
  tag: Tag,
  single: boolean,
  sameDimIds: Map<string, Set<number>>,
  setSelected: (updater: (prev: number[]) => number[]) => void,
): void {
  setSelected((prev) => {
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

export function TaskEditModal({
  task,
  data,
  readonly = false,
  onClose,
  onChanged,
}: {
  /** 缺省 = create 模式（U22：taskCreate 全字段同构表单） */
  task?: Task;
  data: PanelData;
  readonly?: boolean;
  onClose: () => void;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const creating = task === undefined;
  const initial = initialFormValues(task, data);
  const [title, setTitle] = useState(initial.title);
  const [note, setNote] = useState(initial.note);
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [priority, setPriority] = useState(initial.priority);
  const [dueAt, setDueAt] = useState(initial.dueAt);
  const [remindAt, setRemindAt] = useState(initial.remindAt);
  // create 模式独有字段：排期（scheduledFor 有值 → 状态 scheduled；值兜底落截止）
  const [scheduledFor, setScheduledFor] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>(() =>
    task !== undefined ? initialTagIds(task, data.tags ?? []) : [],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // 分类选项：只列启用中的分类；编辑模式下任务自身所属分类若已停用则保留（否则下拉显示不出名字）
  const categoryOptions = useMemo(
    () =>
      data.categories
        .filter((c) => c.enabled || c?.id === task?.categoryId)
        .map((c) => ({ value: String(c.id), label: c.name })),
    [data.categories, task?.categoryId],
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

  /** chips 切换（实现归 toggleTagId；状态归本组件） */
  function toggleTag(tag: Tag, single: boolean): void {
    toggleTagId(tag, single, sameDimIds, setSelectedTagIds);
  }

  async function save(): Promise<void> {
    const trimmedTitle = title.trim();
    if (trimmedTitle === "") {
      setError(t("edit.titleRequired"));
      return;
    }
    setSaving(true);
    setError("");
    const form: TaskFormState = {
      title: trimmedTitle,
      note,
      categoryId,
      priority,
      dueAt,
      remindAt,
      scheduledFor,
      tagIds: selectedTagIds,
    };
    const failure = creating ? await submitTaskCreate(client, form) : await submitTaskUpdate(client, task, form);
    setSaving(false);
    if (failure === "") {
      onChanged();
      onClose();
    } else {
      setError(failure);
    }
  }

  return (
    <Modal
      title={modalTitle(task, t)}
      ariaLabel={modalAriaLabel(task, t)}
      actions={[
        {
          label: t("save2"),
          onChoose: () => void save(),
          variant: "primary",
          disabled: saving || readonly,
        },
        { label: t("cancel"), onChoose: onClose },
      ]}
      onClose={onClose}
    >
      <div className={styles.editForm} data-testid={creating ? "task-create-form" : "task-edit-form"}>
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
          <DateTimePicker value={dueAt} onChange={setDueAt} ariaLabel={t("edit.due")} />
        </div>
        <div className={styles.editRow}>
          <span className={styles.editRowLabel}>{t("edit.remind")}</span>
          <DateTimePicker value={remindAt} onChange={setRemindAt} ariaLabel={t("edit.remind")} />
        </div>
        {creating && (
          <div className={styles.editRow}>
            <span className={styles.editRowLabel}>{t("dsh.taskCreate.scheduledFor")}</span>
            <DateTimePicker
              value={scheduledFor}
              onChange={setScheduledFor}
              ariaLabel={t("dsh.taskCreate.scheduledFor")}
            />
          </div>
        )}
        <div className={styles.editRow}>
          <span className={styles.editRowLabel}>{t("edit.tags")}</span>
          <TagPicker
            groups={tagGroups}
            selectedIds={selectedTagIds}
            onToggle={toggleTag}
            noTagsLabel={t("edit.noTags")}
          />
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
