/**
 * 卡片放生两层确认弹层 + 5 秒撤销 toast（与详情抽屉 ReleaseGuard 同集——U12）。
 */
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import { ConfirmDialog } from "../ui/Modal";
import { UndoToast, useUndoToast } from "../ui/Toast";
import type { Task } from "../../host/domain/tasks";

export function TaskReleaseModal({
  task,
  open,
  onClose,
  onChanged,
}: {
  task: Task;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}): React.JSX.Element | null {
  const t = useT();
  const client = useClient();
  const undo = useUndoToast();
  if (!open) {
    return undo.toast !== null ? <UndoToast toast={undo.toast} onClose={undo.dismiss} /> : null;
  }
  return (
    <>
      <ConfirmDialog
        title={t("entry.release")}
        body={t("dsh.release.confirmBody", { title: task.title })}
        confirmLabel={t("dsh.release.confirmOk")}
        danger
        onCancel={onClose}
        onConfirm={() => {
          onClose();
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
        }}
      />
      {undo.toast !== null && <UndoToast toast={undo.toast} onClose={undo.dismiss} />}
    </>
  );
}
