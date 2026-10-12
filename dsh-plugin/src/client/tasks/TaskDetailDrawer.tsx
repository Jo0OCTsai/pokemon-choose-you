/**
 * 任务详情抽屉（UIUX §3.1）：FollowupStream + DispatchTimeline + DispatchOps +
 * ReleaseGuard 四件（各自文件）；focus trap + Esc 关闭 + 焦点回归（a11y 断言②）。
 * 跟进流与该任务的 agent 时间线经 taskDetail 懒载（实体读域按需命令）——拉回后以
 * overlay PanelData 下传，FollowupStream/DispatchTimeline 契约不变；旧 host 无此
 * 命令或加载中保持快照面（空跟进/全局账本过滤）。
 */
import { useEffect, useMemo, useState } from "react";
import type { Category } from "../../host/domain/vocabulary";
import type { Task } from "../../host/domain/tasks";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import type { PanelData } from "../model";
import type { AgentSessionEntry, HostClient, TaskDetail } from "../rpc";
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
  const client = useClient();
  const readonly = data.dbStatus?.mode === "ro";
  const ref = useFocusTrapTarget(onClose);
  const category = categories.find((c) => c.id === task.categoryId);
  const detail = useTaskDetail(client, task.id);
  const overlay = useMemo<PanelData>(
    () => (detail === null ? data : overlayDetail(data, task.id, detail)),
    [data, detail, task.id],
  );
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
          <FollowupStream data={overlay} taskId={task.id} />
          <DispatchTimeline data={overlay} taskId={task.id} />
          <DispatchOps task={task} data={data} readonly={readonly} onChanged={onChanged} />
          <ReleaseGuard task={task} readonly={readonly} onChanged={onChanged} />
        </div>
      </aside>
    </>
  );
}

/** taskDetail 懒载（失败/旧 host 无命令 → null，保持快照面不阻塞抽屉） */
function useTaskDetail(client: HostClient, taskId: number): TaskDetail | null {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  useEffect(() => {
    setDetail(null);
    let alive = true;
    void client.taskDetail({ taskId }).then((result) => {
      if (alive && result.ok) {
        setDetail(result.data);
      }
    });
    return () => {
      alive = false;
    };
  }, [client, taskId]);
  return detail;
}

/** 快照面 + 任务详情 overlay（跟进灌入 followups；时间线按 id 去重并入 sessions） */
function overlayDetail(data: PanelData, taskId: number, detail: TaskDetail): PanelData {
  const seen = new Set<number>();
  const sessions: AgentSessionEntry[] = [];
  for (const session of [...detail.timeline, ...data.sessions]) {
    if (!seen.has(session.id)) {
      seen.add(session.id);
      sessions.push(session);
    }
  }
  return {
    ...data,
    followups: { ...data.followups, [taskId]: detail.followups },
    sessions,
  };
}

/** 抽屉容器 ref + focus trap（Esc = 关闭，焦点回归触发卡） */
function useFocusTrapTarget(onClose: () => void) {
  const [ref, setRef] = useState<HTMLElement | null>(null);
  useFocusTrap({ current: ref } as React.RefObject<HTMLElement | null>, true, onClose);
  return setRef;
}
