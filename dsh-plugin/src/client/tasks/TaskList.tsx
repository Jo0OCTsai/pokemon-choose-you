/**
 * 任务列表公共件：TaskList（条目卡列表）/ EmptyState（冷启动被动引导，无按钮）/
 * SkeletonRows（首载骨架——灰条占位，无闪烁动画）。
 */
import type { Category } from "../../host/domain/vocabulary";
import type { Task } from "../../host/domain/tasks";
import { useT } from "../i18n";
import { TaskCard } from "./TaskCard";
import ui from "../ui/ui.module.css";
import styles from "./tasks.module.css";

export function TaskList({
  tasks,
  categories,
  readonly,
  allowSchedule = false,
  onOpen,
  onChanged,
  onEdit,
}: {
  tasks: Task[];
  categories: Category[];
  readonly: boolean;
  /** 草丛（inbox）卡显示改期入口——桌面 allow-schedule 同口径 */
  allowSchedule?: boolean;
  onOpen: (taskId: number) => void;
  onChanged: () => void;
  /** ✎ 编辑入口（缺省 = 不渲染编辑钮，如只读快照面） */
  onEdit?: (task: Task) => void;
}): React.JSX.Element {
  return (
    <div className={styles.segmentWrap} role="list">
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          category={categories.find((c) => c.id === task.categoryId)}
          readonly={readonly}
          allowSchedule={allowSchedule}
          onOpen={() => onOpen(task.id)}
          onChanged={onChanged}
          onEdit={onEdit !== undefined ? () => onEdit(task) : undefined}
        />
      ))}
    </div>
  );
}

/** 空态（冷启动：文案引导会话/发报入口，无按钮——被动引导） */
export function EmptyState({ kind }: { kind: "tasks" | "radio" | "dispatch" }): React.JSX.Element {
  const t = useT();
  return <div className={styles.emptyState}>{t(`dsh.empty.${kind}`)}</div>;
}

/** 首载骨架（灰条占位：无 animation 声明，NFR-6 零闪烁） */
export function SkeletonRows({ rows = 3 }: { rows?: number }): React.JSX.Element {
  return (
    <div data-testid="skeleton-rows" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={ui.skeletonRow}>
          <span className={ui.skeletonSprite} />
          <span className={ui.skeletonLine} style={{ width: "60%" }} />
          <span className={ui.skeletonLine} style={{ width: "20%" }} />
        </div>
      ))}
    </div>
  );
}
