/**
 * 任务详情抽屉（UIUX §3.1）：FollowupStream + DispatchTimeline + DispatchOps +
 * ReleaseGuard 四件（各自文件）；focus trap + Esc 关闭 + 焦点回归（a11y 断言②）。
 */
import { useState } from "react";
import type { Category } from "../../host/domain/vocabulary";
import type { Task } from "../../host/domain/tasks";
import { useT } from "../i18n";
import type { PanelData } from "../model";
import { useFocusTrap } from "../ui/useFocusTrap";
import ui from "../ui/ui.module.css";
import { DispatchOps } from "./DispatchOps";
import { DispatchTimeline } from "./DispatchTimeline";
import { FollowupStream } from "./FollowupStream";
import { ReleaseGuard } from "./ReleaseGuard";
import styles from "./tasks.module.css";

export function TaskDetailDrawer({
  task,
  data,
  categories,
  onClose,
  onChanged,
}: {
  task: Task;
  data: PanelData;
  categories: Category[];
  onClose: () => void;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const readonly = data.dbStatus?.mode === "ro";
  const ref = useFocusTrapTarget(onClose);
  const category = categories.find((c) => c.id === task.categoryId);
  return (
    <>
      <div className={styles.drawerOverlay} onClick={onClose} aria-hidden="true" />
      <aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={task.title}
        className={styles.drawer}
        data-testid="task-drawer"
        tabIndex={-1}
      >
        <header className={styles.drawerHeader}>
          <h3 className={styles.drawerTitle}>
            No.{task.id} {task.title}
          </h3>
          <button type="button" className={`${ui.button} ${styles.drawerClose}`} onClick={onClose}>
            ✕
          </button>
        </header>
        <div className={styles.drawerBody}>
          <div>
            <h4 className={styles.drawerSectionTitle}>{t("detail.status")}</h4>
            <div className={ui.muted}>
              {t(`status.${task.status}`)} · {t("edit.category")}：{category?.name ?? "-"} · {t("detail.focus")}：
              {Math.floor(task.focusSeconds / 60)} min
            </div>
          </div>
          <FollowupStream data={data} taskId={task.id} />
          <DispatchTimeline data={data} taskId={task.id} />
          <DispatchOps task={task} data={data} readonly={readonly} onChanged={onChanged} />
          <ReleaseGuard task={task} readonly={readonly} onChanged={onChanged} />
        </div>
      </aside>
    </>
  );
}

/** 抽屉容器 ref + focus trap（Esc = 关闭，焦点回归触发卡） */
function useFocusTrapTarget(onClose: () => void) {
  const [ref, setRef] = useState<HTMLElement | null>(null);
  useFocusTrap({ current: ref } as React.RefObject<HTMLElement | null>, true, onClose);
  return setRef;
}
