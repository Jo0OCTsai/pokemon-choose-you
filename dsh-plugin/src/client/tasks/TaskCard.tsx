/**
 * 精灵条目卡（面板 signature，桌面 TaskCard 同构）：五呈现（普通/进行中♪/进行中·暂停
 * 变体/已捕捉/已逃走）× 派发徽标五态 × 优先级四点 × 标签 chips（⛳项目黄 / # 其他）×
 * 卡尾内联操作行（TaskQuickOps：出发/暂停/📅改期/✎编辑/✔完成/🚪逃走/✕放生——桌面
 * 无溢出菜单，单击直发）。点击主体开详情抽屉。
 */
import type { Category } from "../../host/domain/vocabulary";
import type { Task } from "../../host/domain/tasks";
import { dispatchTooltipKey, taskPresentation } from "../model";
import { useT } from "../i18n";
import { TaskQuickOps } from "./TaskQuickOps";
import { Sprite } from "../ui/Sprite";
import styles from "./tasks.module.css";

/** 种子分类 id → 属性徽章档（db.rs DEFAULT_CATEGORIES 播种序：工作/学习/生活/健康/兴趣） */
const CATEGORY_TYPE_KEYS: Record<number, string> = { 1: "work", 2: "study", 3: "life", 4: "health", 5: "interest" };

export function TaskCard({
  task,
  category,
  readonly,
  allowSchedule = false,
  onOpen,
  onChanged,
  onEdit,
}: {
  task: Task;
  category?: Category;
  /** DB_SCHEMA_TOO_NEW 只读传播（§4.2 禁用清单：状态机操作全部置灰） */
  readonly: boolean;
  /** 草丛（inbox）卡显示改期入口——桌面 allow-schedule 同口径 */
  allowSchedule?: boolean;
  onOpen: () => void;
  onChanged: () => void;
  /** ✎ 编辑入口（缺省 = 不渲染编辑钮） */
  onEdit?: (task: Task) => void;
}): React.JSX.Element {
  const t = useT();
  const presentation = taskPresentation(task);
  return (
    <div
      role="button"
      tabIndex={0}
      className={styles.taskCard}
      data-presentation={presentation}
      data-task-id={task.id}
      onClick={() => onOpen()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      {(presentation === "active" || presentation === "activePaused") && (
        <span className={styles.runningTag}>
          {presentation === "active" ? `♪ ${t("entry.catching")}` : `⏸ ${t("entry.paused")}`}
        </span>
      )}
      <span className={styles.taskNo} aria-hidden="true">
        No.{task.id}
      </span>
      <TaskSprite category={category} />
      <span className={styles.taskMain}>
        <span className={styles.taskTitle}>{task.title}</span>
        <TaskMeta task={task} category={category} />
      </span>
      {!readonly && (
        <TaskQuickOps
          task={task}
          readonly={readonly}
          allowSchedule={allowSchedule}
          onChanged={onChanged}
          onEdit={onEdit}
        />
      )}
    </div>
  );
}

/** 分类精灵图（CDN 候选链回退；分类缺失时占位点） */
function TaskSprite({ category }: { category?: Category }): React.JSX.Element {
  return (
    <span className={styles.taskSprite} aria-label={category?.pokemon ?? ""}>
      {category !== undefined && category.sprite !== "" ? (
        <Sprite spriteKey={category.sprite} alt={category.pokemon} />
      ) : (
        "•"
      )}
    </span>
  );
}

/** 辅助信息行（分类属性徽章/优先级点/截止/专注时长/来源/标签 chips/派发徽标——桌面 row2 同构） */
function TaskMeta({ task, category }: { task: Task; category?: Category }): React.JSX.Element {
  const t = useT();
  const focusMinutes = Math.floor(task.focusSeconds / 60);
  const dispatchState = task.dispatchState;
  const tooltipKey = dispatchTooltipKey(dispatchState);
  return (
    <span className={styles.taskMeta}>
      {category !== undefined && (
        <span className={styles.typeBadge} data-type={categoryTypeKey(category.id)}>
          {category.name}
        </span>
      )}
      <span className={styles.prioDot} data-prio={task.priority} aria-label={t(`priority.${task.priority}`)} />
      {task.dueAt !== null && <span>{t("entry.due", { v: task.dueAt.slice(0, 16).replace("T", " ") })}</span>}
      {focusMinutes > 0 && <span>{t("entry.focus", { n: focusMinutes })}</span>}
      {task.source !== "local" && <span>{t(`entry.${task.source === "feishu" ? "feishu" : "capture"}`)}</span>}
      {/* 标签 chips（桌面 tag-list 同构：项目维度 ⛳ 黄底主位，其余 # 中性） */}
      {task.tags.length > 0 && (
        <span className={styles.tagList}>
          {task.tags.map((ref) => (
            <i
              key={`${ref.dimension}:${ref.name}`}
              className={styles.metaTagChip}
              data-project={ref.dimension === "project"}
            >
              {ref.dimension === "project" ? "⛳ " : "# "}
              {ref.name}
            </i>
          ))}
        </span>
      )}
      {dispatchState !== null && (
        <span
          className={styles.dispatchBadge}
          data-state={dispatchState}
          title={tooltipKey !== null ? t(tooltipKey, { reason: "" }) : undefined}
        >
          <span className={styles.dispatchGlyph}>{DISPATCH_GLYPHS[dispatchState]}</span>
          {t(`dsh.dispatch.badge.${dispatchState}`)}
        </span>
      )}
    </span>
  );
}

const DISPATCH_GLYPHS: Record<string, string> = { queued: "⏳", running: "◉", done: "✓", failed: "▲" };

/** 分类 id → 属性徽章档（种子分类 1-5 固定序，与 DESIGN_SYSTEM 分类色同源；自定义分类中性） */
function categoryTypeKey(categoryId: number): string | undefined {
  return CATEGORY_TYPE_KEYS[categoryId];
}
