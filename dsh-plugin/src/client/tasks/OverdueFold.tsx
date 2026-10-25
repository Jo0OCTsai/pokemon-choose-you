/**
 * 逾期折叠行（反羞耻 fresh start，UIUX §4.2）：默认折叠一行「昨天有 N 只溜走了」+
 * 「全部归草丛」（批量清空截止）；点「展开」看明细。中性色、无红色催逼。
 */
import { useState } from "react";
import type { Task } from "../../host/domain/tasks";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import ui from "../ui/ui.module.css";
import styles from "./tasks.module.css";

export function OverdueFold({
  tasks,
  readonly,
  onChanged,
}: {
  tasks: Task[];
  readonly: boolean;
  onChanged: () => void;
}): React.JSX.Element | null {
  const t = useT();
  const client = useClient();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  if (tasks.length === 0) {
    return null;
  }
  async function sendAllToGrass(): Promise<void> {
    setBusy(true);
    for (const task of tasks) {
      await client.taskReschedule({ taskId: task.id, due: "" });
    }
    setBusy(false);
    onChanged();
  }
  return (
    <div data-testid="overdue-fold">
      <div className={styles.overdueFold}>
        <span>{t("dsh.overdue.leaked", { n: tasks.length })}</span>
        <button type="button" className={ui.button} disabled={readonly || busy} onClick={() => void sendAllToGrass()}>
          {t("overdue.fresh")}
        </button>
        <button type="button" className={ui.button} aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? t("im.collapse") : t("dsh.overdue.expand")}
        </button>
      </div>
      {expanded && (
        <div className={styles.overdueList}>
          {tasks.map((task) => (
            <span key={task.id} className={ui.muted}>
              No.{task.id} {task.title}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
