/**
 * 确认弹层 / 模态（a11y 断言②：focus trap + Esc + 焦点回归）：role="dialog" +
 * aria-modal；按钮行动作区由调用方给定。两层确认（放生等危险操作）即两层 Modal 叠用。
 */
import { useRef, type ReactNode } from "react";
import { useT } from "../i18n";
import { useFocusTrap } from "./useFocusTrap";
import styles from "./ui.module.css";

export interface ModalAction {
  label: string;
  onChoose: () => void;
  variant?: "primary" | "danger" | "default";
  disabled?: boolean;
}

export function Modal({
  title,
  children,
  actions,
  onClose,
  ariaLabel,
}: {
  title: string;
  children?: ReactNode;
  actions: ModalAction[];
  /** Esc / overlay 点击外的关闭语义（与「留在这里」一致） */
  onClose?: () => void;
  ariaLabel?: string;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const close = onClose ?? (() => actions.find((a) => a.variant !== "primary")?.onChoose());
  useFocusTrap(ref, true, close);
  return (
    <div className={styles.overlay} data-testid="modal-overlay">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
        className={styles.dialog}
        tabIndex={-1}
      >
        <h3 className={styles.dialogTitle}>{title}</h3>
        {children !== undefined && <div className={styles.dialogBody}>{children}</div>}
        <div className={styles.dialogActions}>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={
                action.variant === "primary"
                  ? styles.buttonPrimary
                  : action.variant === "danger"
                    ? styles.buttonDanger
                    : styles.button
              }
              onClick={action.onChoose}
              disabled={action.disabled}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 通用确认弹层（取消 / 确认两键；Esc = 取消） */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  danger = false,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}): React.JSX.Element {
  const t = useT();
  return (
    <Modal
      title={title}
      actions={[
        { label: t("cancel"), onChoose: onCancel },
        { label: confirmLabel, onChoose: onConfirm, variant: danger ? "danger" : "primary" },
      ]}
      onClose={onCancel}
    >
      {body}
    </Modal>
  );
}
