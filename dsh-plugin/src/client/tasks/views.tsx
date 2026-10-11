/**
 * 任务四分段视图（UIUX §2.2 与主应用五视图的映射）：
 * - AdventureView：日期 + CAUGHT x/y 进度条 + 逾期折叠 + 任务列表
 * - RouteView：按日期分组
 * - GrassView：无截止草丛
 * - DexView：统计 + 里程碑贺词 + 筛选（全部/已捕捉/已逃走）
 */
import { useMemo, useState } from "react";
import { useT } from "../i18n";
import { adventureSnapshot, dexStats, grassTasks, routeGroups } from "../model";
import type { PanelData } from "../model";
import { EmptyState, SkeletonRows, TaskList } from "./TaskList";
import { OverdueFold } from "./OverdueFold";
import ui from "../ui/ui.module.css";
import styles from "./tasks.module.css";

interface SegmentProps {
  data: PanelData;
  readonly: boolean;
  onOpen: (taskId: number) => void;
  onChanged: () => void;
}

/** 冒险分段：进行中 + 今日到期 + 逾期折叠（fresh start） */
export function AdventureView({ data, readonly, onOpen, onChanged }: SegmentProps): React.JSX.Element {
  const snapshot = useMemo(() => adventureSnapshot(data.tasks, data.today), [data.tasks, data.today]);
  const percent = snapshot.total === 0 ? 0 : Math.round((snapshot.caught / snapshot.total) * 100);
  return (
    <section className={styles.segmentWrap} data-testid="segment-adventure">
      {data.loading === true ? (
        <SkeletonRows />
      ) : (
        <>
          <div className={styles.adventureHeader}>
            <span className={styles.adventureDate}>{data.today}</span>
            <span
              className={styles.caughtBar}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={snapshot.total}
              aria-valuenow={snapshot.caught}
            >
              <span className={styles.caughtFill} style={{ width: `${percent}%` }} />
            </span>
            <span className={styles.caughtLabel}>
              CAUGHT {snapshot.caught}/{snapshot.total}
            </span>
          </div>
          <OverdueFold tasks={snapshot.overdueTasks} readonly={readonly} onChanged={onChanged} />
          {snapshot.todayTasks.length === 0 && snapshot.overdueTasks.length === 0 ? (
            <EmptyState kind="tasks" />
          ) : (
            <TaskList
              tasks={snapshot.todayTasks}
              categories={data.categories}
              readonly={readonly}
              onOpen={onOpen}
              onChanged={onChanged}
            />
          )}
        </>
      )}
    </section>
  );
}

/** 路线分段：按日期分组 */
export function RouteView({ data, readonly, onOpen, onChanged }: SegmentProps): React.JSX.Element {
  const groups = useMemo(() => routeGroups(data.tasks), [data.tasks]);
  const categories = data.categories;
  if (data.loading === true) {
    return <SkeletonRows rows={4} />;
  }
  if (groups.length === 0) {
    return <EmptyState kind="tasks" />;
  }
  return (
    <section className={styles.segmentWrap} data-testid="segment-route">
      {groups.map((group) => (
        <div key={group.date}>
          <h4 className={styles.routeGroupDate}>{group.date}</h4>
          <TaskList
            tasks={group.tasks}
            categories={categories}
            readonly={readonly}
            onOpen={onOpen}
            onChanged={onChanged}
          />
        </div>
      ))}
    </section>
  );
}

/** 草丛分段：无截止的未决定项 */
export function GrassView({ data, readonly, onOpen, onChanged }: SegmentProps): React.JSX.Element {
  const tasks = useMemo(() => grassTasks(data.tasks), [data.tasks]);
  return (
    <section data-testid="segment-grass" className={styles.segmentWrap}>
      {data.loading === true ? (
        <SkeletonRows />
      ) : tasks.length === 0 ? (
        <EmptyState kind="tasks" />
      ) : (
        <TaskList
          tasks={tasks}
          categories={data.categories}
          readonly={readonly}
          onOpen={onOpen}
          onChanged={onChanged}
        />
      )}
    </section>
  );
}

type DexFilter = "all" | "done" | "cancelled";

/** 图鉴分段：累计统计 + 里程碑贺词档位 + 筛选 */
export function DexView({ data, readonly, onOpen, onChanged }: SegmentProps): React.JSX.Element {
  const t = useT();
  const [filter, setFilter] = useState<DexFilter>("all");
  const stats = useMemo(() => dexStats(data.tasks), [data.tasks]);
  const archived = data.tasks.filter((t0) => t0.status === "done" || t0.status === "cancelled");
  const shown = archived.filter((task) => filter === "all" || task.status === filter);
  return (
    <section className={styles.segmentWrap} data-testid="segment-dex">
      <div className={styles.dexStatsLine}>{t("dexStats.line", { caught: stats.caught, escaped: stats.escaped })}</div>
      <div className={styles.dexMilestone}>
        {t(`dexStats.milestone.${stats.milestone}`, { n: stats.milestoneParam })}
      </div>
      <div className={styles.dexFilters} role="group" aria-label={t("dexFilter.all")}>
        {(["all", "done", "cancelled"] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={styles.filterButton}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {t(`dexFilter.${key}`)}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <EmptyState kind="tasks" />
      ) : (
        <TaskList
          tasks={shown}
          categories={data.categories}
          readonly={readonly}
          onOpen={onOpen}
          onChanged={onChanged}
        />
      )}
    </section>
  );
}

/** 日志分段（AgentLedger 行卡 + 来源过滤，FR-D3） */
export function LogSegment({ data }: { data: PanelData }): React.JSX.Element {
  const t = useT();
  const [filter, setFilter] = useState<string>("all");
  const kinds = ["all", "classify", "capture", "dispatch_headless", "dispatch_interactive", "pk"];
  const shown = data.sessions.filter((s) => filter === "all" || s.kind === filter);
  return (
    <section className={styles.segmentWrap} data-testid="segment-logs">
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
      {shown.length === 0 ? (
        <EmptyState kind="dispatch" />
      ) : (
        shown.map((session) => (
          <div key={session.id} className={ui.card}>
            <div className={styles.taskMeta}>
              <span>{t(`sess.kind.${session.kind}`)}</span>
              <span>{session.agentId}</span>
              {session.sessionId !== null && <span className={ui.muted}>{session.sessionId}</span>}
              {session.durationMs !== null && <span>{Math.round(session.durationMs / 1000)}s</span>}
              {session.costUsd !== null && <span>${session.costUsd.toFixed(3)}</span>}
              {session.exitCode !== null && <span>exit {session.exitCode}</span>}
            </div>
            {session.summary !== null && <div className={ui.muted}>{session.summary}</div>}
          </div>
        ))
      )}
    </section>
  );
}
