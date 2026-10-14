/**
 * 跟进记录流（对照主应用 TaskDetailDrawer.vue 跟进段）：时间流展示 + 添加跟进表单
 * （taskNoteAdd）+ 两段式删除（✕ → 「确认删除？」4 秒内再点生效 → taskNoteDelete，
 * AI 来源同样可删——对齐桌面）。写后经 onRefresh 重拉 taskDetail 回灌流。
 */
import { useEffect, useRef, useState } from "react";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import type { PanelData } from "../model";
import ui from "../ui/ui.module.css";
import styles from "./tasks.module.css";

/** 两段式确认窗口（4 秒内再点生效，超时自动复位） */
const DELETE_CONFIRM_MS = 4000;

export /** 跟进记录流（append-only 时间流展示 + 添加/删除） */
function FollowupStream({
  data,
  taskId,
  onRefresh,
  readonly,
}: {
  data: PanelData;
  taskId: number;
  /** 写命令成功后的回读刷新（taskDetail 重拉 → overlay 回灌） */
  onRefresh: () => void;
  readonly: boolean;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const notes = data.followups[taskId] ?? [];
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  /** 两段式删除确认中的 note id（null = 无） */
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (confirmTimer.current !== null) {
        clearTimeout(confirmTimer.current);
      }
    },
    [],
  );

  function addNote(): void {
    const content = draft.trim();
    if (content === "" || busy) {
      return;
    }
    setBusy(true);
    void client.taskNoteAdd({ taskId, content }).then((result) => {
      setBusy(false);
      if (result.ok) {
        setDraft("");
        onRefresh();
      }
    });
  }

  /** 两段式：第一次点 ✕ 变「确认删除？」，4 秒内再点生效（AI 来源同样可删——桌面/Rust 无守卫） */
  function removeNote(id: number): void {
    if (confirmId !== id) {
      setConfirmId(id);
      if (confirmTimer.current !== null) {
        clearTimeout(confirmTimer.current);
      }
      confirmTimer.current = setTimeout(() => setConfirmId(null), DELETE_CONFIRM_MS);
      return;
    }
    if (confirmTimer.current !== null) {
      clearTimeout(confirmTimer.current);
    }
    setConfirmId(null);
    void client.taskNoteDelete({ id }).then((result) => {
      if (result.ok) {
        onRefresh();
      }
    });
  }

  return (
    <div data-testid="followup-stream">
      <h4 className={styles.drawerSectionTitle}>{t("edit.followUps")}</h4>
      {notes.length === 0 ? (
        <div className={styles.followupEmpty}>{t("edit.noFollowUps")}</div>
      ) : (
        notes.map((note) => (
          <div key={note.id} className={styles.followupItem}>
            <div className={styles.followupContent}>{note.content}</div>
            <div className={styles.followupMeta}>
              {note.source === "ai" && <span className={styles.followupSrc}>AI</span>}
              <span>
                {note.source} · {note.createdAt.slice(0, 16).replace("T", " ")}
              </span>
              <button
                type="button"
                className={styles.followupDelete}
                data-confirming={confirmId === note.id}
                disabled={readonly}
                aria-label={confirmId === note.id ? t("edit.confirmDeleteNote") : `✕ ${note.content}`}
                onClick={() => removeNote(note.id)}
              >
                {confirmId === note.id ? t("edit.confirmDeleteNote") : "✕"}
              </button>
            </div>
          </div>
        ))
      )}
      <form
        className={styles.followupComposer}
        onSubmit={(event) => {
          event.preventDefault();
          addNote();
        }}
      >
        <input
          className={styles.followupInput}
          value={draft}
          placeholder={t("edit.followUpPlaceholder")}
          aria-label={t("edit.followUpPlaceholder")}
          disabled={readonly || busy}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className={ui.button} disabled={readonly || busy || draft.trim() === ""}>
          {t("edit.addFollowUp")}
        </button>
      </form>
    </div>
  );
}
