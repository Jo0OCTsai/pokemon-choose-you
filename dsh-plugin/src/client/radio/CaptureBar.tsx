/**
 * 快速捕捉条（⚡发报）：输入 → 判定中（spinner 文案）→ 建卡/更新卡 + 5 秒撤销 toast
 * （右下角不抢焦点；判重命中时附「产生了更新建议，待你确认」）。撤销 = taskDelete 新建卡。
 */
import { useState } from "react";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import { UndoToast, useUndoToast } from "../ui/Toast";
import ui from "../ui/ui.module.css";
import styles from "./radio.module.css";

export function CaptureBar({ readonly, onChanged }: { readonly: boolean; onChanged: () => void }): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [text, setText] = useState("");
  const [judging, setJudging] = useState(false);
  const undo = useUndoToast();

  async function send(): Promise<void> {
    const trimmed = text.trim();
    if (trimmed === "" || judging) {
      return;
    }
    setJudging(true);
    const result = await client.captureTodo({ text: trimmed });
    setJudging(false);
    setText("");
    if (result.ok) {
      const { outcome, taskId, title } = result.data;
      undo.show(t("dsh.toast.caught", { title: title ?? trimmed }), {
        extra: outcome === "updateSuggested" ? t("dsh.toast.caughtMatch") : undefined,
        onUndo: () => {
          if (taskId !== null) {
            void client.taskDelete({ taskId }).then(() => onChanged());
          }
        },
        onExpire: onChanged,
      });
    } else {
      onChanged();
    }
  }

  return (
    <>
      <form
        className={styles.captureBar}
        data-testid="capture-bar"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <input
          className={styles.captureInput}
          value={text}
          placeholder={t("im.capturePlaceholder")}
          disabled={readonly || judging}
          aria-label={t("im.capturePlaceholder")}
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" className={ui.buttonPrimary} disabled={readonly || judging || text.trim() === ""}>
          {judging ? t("dsh.radio.judging") : t("im.captureSend")}
        </button>
      </form>
      {undo.toast !== null && <UndoToast toast={undo.toast} onClose={undo.dismiss} />}
    </>
  );
}
