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

/** 弹窗标题（✎ No.xxx 编辑） */
export function modalTitle(task: Task, t: (key: string) => string): string {
  return `✎ No.${String(task.id).padStart(3, "0")} ${t("edit.title")}`;
}

/** 弹窗 aria 标题（编辑；task 参数保持与 modalTitle 同签名——调用面统一） */
export function modalAriaLabel(_task: Task, t: (key: string) => string): string {
  return t("edit.title");
}

/** 分类缺省（任务自身 → 第一个启用 → 第一个）；无可落 = 0 */
function initialCategoryId(task: Task, data: PanelData): number {
  const fallback = data.categories.find((c) => c.enabled)?.id ?? data.categories[0]?.id;
  return task.categoryId ?? fallback ?? 0;
}

/** 任务文本字段初值对（title/note；note null → 空串） */
function initialTexts(task: Task): { title: string; note: string } {
  return { title: task.title, note: task.note ?? "" };
}

/** 任务时间字段初值对（dueAt/remindAt → datetime-local 值） */
function initialTimes(task: Task): { dueAt: string; remindAt: string } {
  return { dueAt: toLocalInput(task.dueAt ?? null), remindAt: toLocalInput(task.remindAt ?? null) };
}

/** 编辑初值提取（分类缺省第一个启用） */
export function initialFormValues(
  task: Task,
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
    priority: task.priority,
    ...initialTimes(task),
  };
}
