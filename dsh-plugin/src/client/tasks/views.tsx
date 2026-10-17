/**
 * 任务四分段视图（UIUX §2.2 与主应用五视图的映射）：
 * - AdventureView：逾期折叠 + 任务列表（日期与 CAUGHT 进度条在 PageHeader，桌面 today 页头同位）
 * - RouteView：按日期分组
 * - GrassView：无截止草丛
 * - DexView：统计 + 里程碑贺词 + 筛选（全部/已捕捉/已逃走）+ 每周复盘向导入口（🧢复盘）
 * 四段共用：顶部搜索栏（TaskSearchShell）+ 全字段编辑弹窗状态（useTaskEditor）。
 * 三任务段（冒险/草丛/路线）段头常驻「＋ 新建任务」（U22 · 宿主档次按钮）+ 空态主行动
 * buttonDex（空态唯一主推进动作）→ TaskEditModal create 模式。
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
import ui from "../ui/ui.module.css";
import styles from "./tasks.module.css";

interface SegmentProps {
  data: PanelData;
  readonly: boolean;
  onOpen: (taskId: number) => void;
  onChanged: () => void;
}

/** 分段层编辑/新建弹窗状态（任务段共用：卡片溢出菜单「编辑」/ 段头与空态「＋ 新建任务」） */
function useTaskEditor(
  data: PanelData,
  readonly: boolean,
  onChanged: () => void,
): {
  openEdit: (task: Task) => void;
  openCreate: () => void;
  createButton: React.JSX.Element;
  emptyState: React.JSX.Element;
  modal: React.JSX.Element | null;
} {
  const t = useT();
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  return {
    openEdit: setEditing,
    openCreate: () => setCreating(true),
    // 段头工具行「＋ 新建任务」（U22：宿主档次按钮——非主行动黄；只读置灰）
    createButton: (
      <button
        type="button"
        className={ui.button}
        data-testid="task-create-entry"
        disabled={readonly}
        onClick={() => setCreating(true)}
      >
        {t("dsh.taskCreate.entry")}
      </button>
    ),
    // 空态主行动（U22：buttonDex 档——空态唯一主推进动作；文案升级 §8）
    emptyState: (
      <div className={styles.emptyWrap}>
        <EmptyState kind="tasks" />
        <button
          type="button"
          className={ui.buttonDex}
          data-testid="task-create-empty"
          disabled={readonly}
          onClick={() => setCreating(true)}
        >
          {t("dsh.taskCreate.entry")}
        </button>
      </div>
    ),
    modal:
      editing !== null ? (
        <TaskEditModal
          task={editing}
          data={data}
          readonly={readonly}
          onClose={() => setEditing(null)}
          onChanged={onChanged}
        />
      ) : creating ? (
        <TaskEditModal data={data} readonly={readonly} onClose={() => setCreating(false)} onChanged={onChanged} />
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
              <div className={styles.segmentToolbar}>{editor.createButton}</div>
              <OverdueFold tasks={snapshot.overdueTasks} readonly={readonly} onChanged={onChanged} />
              {snapshot.todayTasks.length === 0 && snapshot.overdueTasks.length === 0 ? (
                editor.emptyState
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
    body = editor.emptyState;
  } else {
    body = (
      <section className={styles.segmentWrap} data-testid="segment-route">
        <div className={styles.segmentToolbar}>{editor.createButton}</div>
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
            editor.emptyState
          ) : (
            <>
              <div className={styles.segmentToolbar}>{editor.createButton}</div>
              <TaskList
                tasks={tasks}
                categories={data.categories}
                readonly={readonly}
                allowSchedule
                onOpen={onOpen}
                onChanged={onChanged}
                onEdit={editor.openEdit}
              />
            </>
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
