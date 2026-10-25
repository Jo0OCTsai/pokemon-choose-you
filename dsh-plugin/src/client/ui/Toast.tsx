/**
 * 撤销 toast（a11y 断言①）：右下角、role="status" + aria-live="polite"、不抢焦点、
 * 5 秒窗口（捕捉/放生共用范式）。计数静态（NFR-6：无闪烁、无动画）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import styles from "./ui.module.css";

export const UNDO_WINDOW_MS = 5000;

export interface UndoToastProps {
  message: string;
  extra?: string;
  onUndo?: () => void;
  onExpire?: () => void;
}

/** useUndoToast()：show(message, {onUndo}) 打开 5 秒撤销窗；undo/超时自动收口 */
export function useUndoToast(): {
  toast: UndoToastProps | null;
  show: (message: string, opts?: { onUndo?: () => void; extra?: string; onExpire?: () => void }) => void;
  dismiss: () => void;
} {
  const [toast, setToast] = useState<UndoToastProps | null>(null);
  const onExpireRef = useRef<(() => void) | undefined>(undefined);
  const show = useCallback((message: string, opts?: { onUndo?: () => void; extra?: string; onExpire?: () => void }) => {
    onExpireRef.current = opts?.onExpire;
    setToast({ message, extra: opts?.extra, onUndo: opts?.onUndo });
  }, []);
  const dismiss = useCallback(() => {
    onExpireRef.current?.();
    onExpireRef.current = undefined;
    setToast(null);
  }, []);
  return { toast, show, dismiss };
}

export function UndoToast({
  toast,
  onClose,
}: {
  toast: UndoToastProps;
  onClose: () => void;
}): React.JSX.Element | null {
  const t = useT();
  useEffect(() => {
    const timer = setTimeout(onClose, UNDO_WINDOW_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [toast, onClose]);
  return (
    <div className={styles.undoToast} role="status" aria-live="polite" data-testid="undo-toast">
      <span>
        {toast.message}
        {toast.extra !== undefined && <span className={styles.muted}> · {toast.extra}</span>}
      </span>
      {toast.onUndo !== undefined && (
        <button
          type="button"
          className={styles.undoToastButton}
          onClick={() => {
            toast.onUndo?.();
            onClose();
          }}
        >
          {t("dsh.toast.undo", { sec: 5 })}
        </button>
      )}
    </div>
  );
}
