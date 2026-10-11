/**
 * 放生危险区（ReleaseGuard）：两层确认（级联范围说明：任务 + 标签关联 + 跟进记录一并
 * 删除、审计留档）+ 5 秒撤销 toast（对齐捕捉撤销范式，role=status）。
 */
import { useState } from "react";
import type { Task } from "../../host/domain/tasks";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import { Modal } from "../ui/Modal";
import { UndoToast, useUndoToast } from "../ui/Toast";
import ui from "../ui/ui.module.css";
import styles from "./tasks.module.css";

export /** 放生危险区：两层确认（级联范围说明）+ 5 秒撤销 toast */
function ReleaseGuard({
  task,
  readonly,
  onChanged,
}: {
  task: Task;
  readonly: boolean;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [confirming, setConfirming] = useState(false);
  const undo = useUndoToast();
  return (
    <div data-testid="release-guard" className={`${ui.card} ${styles.dangerZone}`}>
      <h4 className={styles.drawerSectionTitle}>{t("entry.release")}</h4>
      <button type="button" className={ui.button} disabled={readonly} onClick={() => setConfirming(true)}>
        {t("entry.release")}
      </button>
      {confirming && (
        <Modal
          title={t("entry.release")}
          actions={[
            { label: t("cancel"), onChoose: () => setConfirming(false) },
            {
              label: t("dsh.release.confirmOk"),
              variant: "danger",
              onChoose: () => {
                setConfirming(false);
                void (async () => {
                  const result = await client.taskDelete({ taskId: task.id });
                  if (result.ok) {
                    undo.show(t("dsh.toast.released", { title: task.title }), {
                      onUndo: () => {
                        void client.taskDeleteUndo({ taskId: task.id }).then(() => onChanged());
                      },
                      onExpire: onChanged,
                    });
                  } else {
                    onChanged();
                  }
                })();
              },
            },
          ]}
          onClose={() => setConfirming(false)}
        >
          {t("dsh.release.confirmBody", { title: task.title })}
        </Modal>
      )}
      {undo.toast !== null && <UndoToast toast={undo.toast} onClose={undo.dismiss} />}
    </div>
  );
}
