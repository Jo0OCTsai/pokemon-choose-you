/**
 * 任务四分段视图（UIUX §2.2 与主应用五视图的映射）：
 * - AdventureView：逾期折叠 + 任务列表（日期与 CAUGHT 进度条在 PageHeader，桌面 today 页头同位）
 * - RouteView：按日期分组
 * - GrassView：无截止草丛
 * - DexView：统计 + 里程碑贺词 + 筛选（全部/已捕捉/已逃走）+ 每周复盘向导入口（🧢复盘）
 * 四段共用：顶部搜索栏（TaskSearchShell）+ 全字段编辑弹窗状态（useTaskEditor）。
 * （「＋ 新建任务」段头工具行与空态主行动已移除——2026-10-17 用户裁决，FR-C1/U22 回流；
 * 空态恢复纯被动文案，建卡走会话捕捉链路。）
 */
import { useMemo, useState } from "react";
import { useT } from "../i18n";
import { adventureSnapshot, dexStats, grassTasks, routeGroups } from "../model";
import type { PanelData } from "../model";
import type { Task } from "../../host/domain/tasks";
import { EmptyState, SkeletonRows, TaskList } from "./TaskList";
import { OverdueFold } from "./OverdueFold";
import { ReviewWizard } from "./ReviewWizard";
import { TaskSearchShell } from "./TaskSearchBar";
import { TaskEditModal } from "./TaskEditModal";
import styles from "./tasks.module.css";

interface SegmentProps {
  data: PanelData;
  readonly: boolean;
  onOpen: (taskId: number) => void;
  onChanged: () => void;
}

/** 分段层编辑弹窗状态（任务段共用：卡片溢出菜单「编辑」） */
function useTaskEditor(
  data: PanelData,
  readonly: boolean,
  onChanged: () => void,
): {
  openEdit: (task: Task) => void;
  modal: React.JSX.Element | null;
} {
  const [editing, setEditing] = useState<Task | null>(null);
  return {
    openEdit: setEditing,
    modal:
      editing !== null ? (
        <TaskEditModal
          task={editing}
          data={data}
          readonly={readonly}
          onClose={() => setEditing(null)}
          onChanged={onChanged}
        />
      ) : null,
  };
}

/** 冒险分段：进行中 + 今日到期 + 逾期折叠（fresh start）——日期/CAUGHT 头在 PageHeader */
export function AdventureView({ data, readonly, onOpen, onChanged }: SegmentProps): React.JSX.Element {
  const editor = useTaskEditor(data, readonly, onChanged);
  const snapshot = useMemo(() => adventureSnapshot(data.tasks, data.today), [data.tasks, data.today]);
  return (
    <>
      <TaskSearchShell data={data} readonly={readonly} onOpen={onOpen} onChanged={onChanged} onEdit={editor.openEdit}>
        <section className={styles.segmentWrap} data-testid="segment-adventure">
          {data.loading === true ? (
            <SkeletonRows />
          ) : (
            <>
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
                  onEdit={editor.openEdit}
                />
              )}
            </>
          )}
        </section>
      </TaskSearchShell>
      {editor.modal}
    </>
  );
}

/** 路线分段：按日期分组 */
export function RouteView({ data, readonly, onOpen, onChanged }: SegmentProps): React.JSX.Element {
  const editor = useTaskEditor(data, readonly, onChanged);
  const groups = useMemo(() => routeGroups(data.tasks), [data.tasks]);
  const categories = data.categories;
  let body: React.JSX.Element;
  if (data.loading === true) {
    body = <SkeletonRows rows={4} />;
  } else if (groups.length === 0) {
    body = <EmptyState kind="tasks" />;
  } else {
    body = (
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
              onEdit={editor.openEdit}
            />
          </div>
        ))}
      </section>
    );
  }
  return (
    <>
      <TaskSearchShell data={data} readonly={readonly} onOpen={onOpen} onChanged={onChanged} onEdit={editor.openEdit}>
        {body}
      </TaskSearchShell>
      {editor.modal}
    </>
  );
}

/** 草丛分段：无截止的未决定项 */
export function GrassView({ data, readonly, onOpen, onChanged }: SegmentProps): React.JSX.Element {
  const editor = useTaskEditor(data, readonly, onChanged);
  const tasks = useMemo(() => grassTasks(data.tasks), [data.tasks]);
  return (
    <>
      <TaskSearchShell data={data} readonly={readonly} onOpen={onOpen} onChanged={onChanged} onEdit={editor.openEdit}>
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
              allowSchedule
              onOpen={onOpen}
              onChanged={onChanged}
              onEdit={editor.openEdit}
            />
          )}
        </section>
      </TaskSearchShell>
      {editor.modal}
    </>
  );
}

type DexFilter = "all" | "done" | "cancelled";

/** 图鉴分段：累计统计 + 里程碑贺词档位 + 筛选 + 每周复盘向导入口（仅图鉴段，桌面同位） */
export function DexView({ data, readonly, onOpen, onChanged }: SegmentProps): React.JSX.Element {
  const t = useT();
  const editor = useTaskEditor(data, readonly, onChanged);
  const [filter, setFilter] = useState<DexFilter>("all");
  // 每周复盘向导（状态全内存态：关闭即重置；入口仅图鉴段可见）
  const [reviewOpen, setReviewOpen] = useState(false);
  const stats = useMemo(() => dexStats(data.tasks), [data.tasks]);
  const archived = data.tasks.filter((t0) => t0.status === "done" || t0.status === "cancelled");
  const shown = archived.filter((task) => filter === "all" || task.status === filter);
  return (
    <>
      <TaskSearchShell data={data} readonly={readonly} onOpen={onOpen} onChanged={onChanged} onEdit={editor.openEdit}>
        <section className={styles.segmentWrap} data-testid="segment-dex">
          <div className={styles.dexStatsLine}>
            {t("dexStats.line", { caught: stats.caught, escaped: stats.escaped })}
          </div>
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
            <button
              type="button"
              className={`${styles.filterButton} ${styles.reviewEntry}`}
              disabled={readonly}
              onClick={() => setReviewOpen(true)}
            >
              🧢 {t("review.entry")}
            </button>
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
              onEdit={editor.openEdit}
            />
          )}
        </section>
      </TaskSearchShell>
      {editor.modal}
      {reviewOpen && <ReviewWizard data={data} onClose={() => setReviewOpen(false)} onChanged={onChanged} />}
    </>
  );
}
