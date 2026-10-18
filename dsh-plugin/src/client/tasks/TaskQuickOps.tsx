/**
 * 卡内操作行（桌面 TaskCard .ops 同构，内联不折叠进菜单）：出发/暂停随状态、
 * 📅 改期（草丛卡）、✎ 编辑、✔ 完成、🚪 逃走、✕ 放生（两层确认弹层承接）；
 * 已捕捉/已逃走卡 = 状态标 + ↩撤销（taskUpdate 回 scheduled）。日期选择走
 * 改期弹窗（DateTimePicker 弹层 + 保存/取消贴选择器右侧——桌面 sched-card 同构，零键入）。
 */
import { useState } from "react";
import type { Task } from "../../host/domain/tasks";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import { DateTimePicker } from "../ui/DateTimePicker";
import { Modal } from "../ui/Modal";
import ui from "../ui/ui.module.css";
import { TaskReleaseModal } from "./TaskReleaseModal";
import styles from "./tasks.module.css";

export function TaskQuickOps({
  task,
  readonly,
  allowSchedule = false,
  onChanged,
  onEdit,
}: {
  task: Task;
  readonly: boolean;
  /** 草丛（inbox）卡才显示改期入口——桌面 allow-schedule 同口径 */
  allowSchedule?: boolean;
  onChanged: () => void;
  /** ✎ 编辑入口（分段层 TaskEditModal 承接） */
  onEdit?: (task: Task) => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const editable = task.status !== "done" && task.status !== "cancelled";
  const op = (event: React.MouseEvent, run: () => Promise<unknown>): void => {
    event.stopPropagation();
    void run().then(() => onChanged());
  };
  if (!editable) {
    const done = task.status === "done";
    return (
      <span className={styles.quickOps} onClick={(event) => event.stopPropagation()}>
        <span className={`${styles.catchMark} ${done ? "" : styles.escapeMark}`} aria-live="polite">
          {done ? t("entry.caught") : t("entry.escaped")}
        </span>
        <button
          type="button"
          className={ui.button}
          disabled={readonly}
          title={t("entry.undo")}
          onClick={(event) => op(event, () => client.taskUpdate({ id: task.id, status: "scheduled" }))}
        >
          {t("entry.undo")}
        </button>
      </span>
    );
  }
  return (
    <span className={styles.quickOps} onClick={(event) => event.stopPropagation()}>
      {task.status === "active" ? (
        <button
          type="button"
          className={ui.button}
          disabled={readonly}
          onClick={(event) => op(event, () => client.taskPause({ taskId: task.id }))}
        >
          {t("entry.pause")}
        </button>
      ) : (
        <button
          type="button"
          className={ui.button}
          disabled={readonly}
          onClick={(event) => op(event, () => client.taskStart({ taskId: task.id }))}
        >
          {t("entry.start")}
        </button>
      )}
      {allowSchedule && (
        <button
          type="button"
          className={ui.button}
          disabled={readonly}
          title={t("entry.route")}
          onClick={() => setScheduling(true)}
        >
          📅
        </button>
      )}
      {onEdit !== undefined && (
        <button
          type="button"
          className={ui.button}
          disabled={readonly}
          title={t("entry.edit")}
          onClick={() => onEdit(task)}
        >
          ✎
        </button>
      )}
      <button
        type="button"
        className={ui.button}
        disabled={readonly}
        title={t("entry.done")}
        onClick={(event) => op(event, () => client.taskComplete({ taskId: task.id }))}
      >
        ✔
      </button>
      {/* 逃走一步直发（桌面卡 🚪 同款单击语义；原因码落 other 审计位） */}
      <button
        type="button"
        className={ui.button}
        disabled={readonly}
        title={t("entry.escape")}
        onClick={(event) => op(event, () => client.taskCancel({ taskId: task.id, reasonCode: "other" }))}
      >
        🚪
      </button>
      <button
        type="button"
        className={`${ui.button} ${styles.opRelease}`}
        disabled={readonly}
        title={t("entry.release")}
        onClick={() => setReleaseOpen(true)}
      >
        ✕
      </button>
      {scheduling && (
        <ScheduleModal
          task={task}
          readonly={readonly}
          onClose={() => setScheduling(false)}
          onChanged={() => {
            setScheduling(false);
            onChanged();
          }}
        />
      )}
      {/* 常驻挂载（open 控制）：确认后卸载弹层但保留 5 秒撤销 toast（TaskReleaseModal 契约） */}
      <TaskReleaseModal task={task} open={releaseOpen} onClose={() => setReleaseOpen(false)} onChanged={onChanged} />
    </span>
  );
}

/** 改期弹窗（桌面 TaskTab sched-card 同构）：日期时间与保存/取消同行、按钮贴选择器
 *  右侧（桌面 sched-row 同构，日历弹层向下悬浮不占布局）；清空 = 回草丛 */
function ScheduleModal({
  task,
  readonly,
  onClose,
  onChanged,
}: {
  task: Task;
  readonly: boolean;
  onClose: () => void;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [due, setDue] = useState(task.dueAt === null ? "" : task.dueAt.slice(0, 16));
  return (
    <Modal title={`📅 ${t("dsh.task.reschedule")}`} ariaLabel={t("dsh.task.reschedule")} onClose={onClose}>
      <div className={styles.schedRow}>
        <DateTimePicker value={due} onChange={setDue} ariaLabel={t("edit.due")} className={styles.schedPicker} />
        <div className={styles.schedBtns}>
          <button
            type="button"
            className={ui.buttonPrimary}
            disabled={readonly}
            onClick={() => {
              void client.taskReschedule({ taskId: task.id, due }).then(() => onChanged());
            }}
          >
            {t("save2")}
          </button>
          <button type="button" className={ui.button} onClick={onClose}>
            {t("cancel")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
