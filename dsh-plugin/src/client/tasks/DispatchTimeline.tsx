/**
 * Agent 执行时间线（时长/成本/退出码/会话标识，FR-D3；按任务全量呈现，不设来源筛选）。
 */
import { useMemo } from "react";
import { useT } from "../i18n";
import { displaySessionId } from "../rpc";
import type { PanelData } from "../model";
import ui from "../ui/ui.module.css";
import styles from "./tasks.module.css";

export /** Agent 执行时间线（时长/成本/退出码/会话标识，按任务全量呈现） */
function DispatchTimeline({ data, taskId }: { data: PanelData; taskId: number }): React.JSX.Element {
  const t = useT();
  const sessions = useMemo(() => data.sessions.filter((s) => s.taskId === taskId), [data.sessions, taskId]);
  return (
    <div className={styles.drawerSection} data-testid="dispatch-timeline">
      <h4 className={styles.drawerSectionTitle}>{t("edit.agentRuns")}</h4>
      {sessions.length === 0 ? (
        <div className={`${ui.muted} ${styles.timelineEmpty}`}>{t("dsh.empty.dispatch")}</div>
      ) : (
        sessions.map((session) => (
          <div key={session.id} className={styles.timelineItem}>
            <span className={styles.timelineDot} aria-hidden="true" />
            <span className={styles.timelineMain}>
              <div>
                {t(`sess.kind.${session.kind}`)} · {session.agentId}
                {displaySessionId(session.sessionId) !== null && (
                  <span className={ui.muted}> · {displaySessionId(session.sessionId)}</span>
                )}
              </div>
              <div className={ui.muted}>
                {session.durationMs !== null && <span>{Math.round(session.durationMs / 1000)}s </span>}
                {session.costUsd !== null && <span>${session.costUsd.toFixed(3)} </span>}
                {session.exitCode !== null && <span>exit {session.exitCode}</span>}
                {session.summary !== null && <span> · {session.summary}</span>}
              </div>
            </span>
          </div>
        ))
      )}
    </div>
  );
}
