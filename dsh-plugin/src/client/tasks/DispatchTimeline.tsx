/**
 * Agent 执行时间线（时长/成本/退出码/会话标识 + 来源过滤回放，FR-D3）。
 */
import { useMemo, useState } from "react";
import { useT } from "../i18n";
import type { PanelData } from "../model";
import ui from "../ui/ui.module.css";
import styles from "./tasks.module.css";

export /** Agent 执行时间线（时长/成本/退出码/会话标识 + 来源过滤） */
function DispatchTimeline({ data, taskId }: { data: PanelData; taskId: number }): React.JSX.Element {
  const t = useT();
  const [filter, setFilter] = useState("all");
  const sessions = useMemo(
    () => data.sessions.filter((s) => s.taskId === taskId && (filter === "all" || s.kind === filter)),
    [data.sessions, taskId, filter],
  );
  const kinds = ["all", "classify", "capture", "dispatch_headless", "dispatch_interactive"];
  return (
    <div data-testid="dispatch-timeline">
      <h4 className={styles.drawerSectionTitle}>{t("edit.agentRuns")}</h4>
      <div className={styles.dexFilters} role="group" aria-label={t("sess.filter_all")}>
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            className={styles.filterButton}
            aria-pressed={filter === kind}
            onClick={() => setFilter(kind)}
          >
            {kind === "all" ? t("sess.filter_all") : t(`sess.kind.${kind}`)}
          </button>
        ))}
      </div>
      {sessions.length === 0 ? (
        <div className={ui.muted}>{t("dsh.empty.dispatch")}</div>
      ) : (
        sessions.map((session) => (
          <div key={session.id} className={styles.timelineItem}>
            <span className={styles.timelineDot} aria-hidden="true" />
            <span className={styles.timelineMain}>
              <div>
                {t(`sess.kind.${session.kind}`)} · {session.agentId}
                {session.sessionId !== null && <span className={ui.muted}> · {session.sessionId}</span>}
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
