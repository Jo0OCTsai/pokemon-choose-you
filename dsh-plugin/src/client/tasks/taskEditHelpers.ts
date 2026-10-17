/**
 * TaskEditModal 纯辅助件（从 TaskEditModal.tsx 拆出——棘轮 max-lines，等量迁移）：
 * datetime-local 双向归一、弹窗标题、编辑初值提取（?. / ?? 链收敛在独立小函数）。
 */
import type { Task } from "../../host/domain/tasks";
import type { PanelData } from "../model";

/** RFC3339 → datetime-local 值（YYYY-MM-DDTHH:mm；null/短串 → 空串 = 清空态） */
export function toLocalInput(iso: string | null): string {
  return iso === null ? "" : iso.slice(0, 16);
}

/** datetime-local 空串 → undefined（create 入参三态：缺省 = 不设） */
export function orUndefined(value: string): string | undefined {
  return value === "" ? undefined : value;
}

/** 弹窗标题（create = 入口文案；edit = ✎ No.xxx 编辑） */
export function modalTitle(task: Task | undefined, t: (key: string) => string): string {
  return task === undefined ? t("dsh.taskCreate.entry") : `✎ No.${String(task.id).padStart(3, "0")} ${t("edit.title")}`;
}

/** 弹窗 aria 标题（create = 入口文案；edit = 编辑） */
export function modalAriaLabel(task: Task | undefined, t: (key: string) => string): string {
  return task === undefined ? t("dsh.taskCreate.entry") : t("edit.title");
}

/** 分类缺省（任务自身 → 第一个启用 → 第一个）；无可落 = 0 */
function initialCategoryId(task: Task | undefined, data: PanelData): number {
  const fallback = data.categories.find((c) => c.enabled)?.id ?? data.categories[0]?.id;
  return task?.categoryId ?? fallback ?? 0;
}

/** 任务文本字段初值对（title/note） */
function initialTexts(task: Task | undefined): { title: string; note: string } {
  return { title: task?.title ?? "", note: task?.note ?? "" };
}

/** 任务时间字段初值对（dueAt/remindAt → datetime-local 值） */
function initialTimes(task: Task | undefined): { dueAt: string; remindAt: string } {
  return { dueAt: toLocalInput(task?.dueAt ?? null), remindAt: toLocalInput(task?.remindAt ?? null) };
}

/** 编辑初值提取（task 缺省 = create 模式空态；分类缺省第一个启用） */
export function initialFormValues(
  task: Task | undefined,
  data: PanelData,
): {
  title: string;
  note: string;
  categoryId: number;
  priority: string;
  dueAt: string;
  remindAt: string;
} {
  return {
    ...initialTexts(task),
    categoryId: initialCategoryId(task, data),
    priority: task?.priority ?? "normal",
    ...initialTimes(task),
  };
}
