/**
 * 跟进记录流（append-only 时间流展示；数据源 = taskDetail 懒载灌入 data.followups——
 * 追加入口在会话/主应用侧，host 命令面无 note 写命令）。
 */
import { useT } from "../i18n";
import type { PanelData } from "../model";
import ui from "../ui/ui.module.css";
import styles from "./tasks.module.css";

export /** 跟进记录流（append-only 时间流展示） */
function FollowupStream({ data, taskId }: { data: PanelData; taskId: number }): React.JSX.Element {
  const t = useT();
  const notes = data.followups[taskId] ?? [];
  return (
    <div data-testid="followup-stream">
      <h4 className={styles.drawerSectionTitle}>{t("edit.followUps")}</h4>
      {notes.length === 0 ? (
        <div className={ui.muted}>{t("edit.noFollowUps")}</div>
      ) : (
        notes.map((note) => (
          <div key={note.id} className={styles.followupItem}>
            <div>{note.content}</div>
            <div className={styles.followupMeta}>
              {note.source} · {note.createdAt}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
