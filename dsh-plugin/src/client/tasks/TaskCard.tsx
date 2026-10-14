/**
 * 精灵条目卡（面板 signature，UIUX §3.3）：五呈现（普通/进行中♪/进行中·暂停变体/
 * 已捕捉/已逃走）× 派发徽标五态 × 优先级四点 × 卡尾「…」溢出菜单（逃走[6 原因码]/
 * 改期/放生两层确认——U12，承接主应用右键语义）。点击主体开详情抽屉。
 */
import { useState } from "react";
import type { Category } from "../../host/domain/vocabulary";
import type { Task } from "../../host/domain/tasks";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import { dispatchTooltipKey, taskPresentation } from "../model";
import { TaskQuickOps } from "./TaskQuickOps";
import { TaskReleaseModal } from "./TaskReleaseModal";
import { ESCAPE_REASON_CODES } from "../rpc";
import { Sprite } from "../ui/Sprite";
import ui from "../ui/ui.module.css";
import styles from "./tasks.module.css";

const DISPATCH_GLYPHS: Record<string, string> = { queued: "⏳", running: "◉", done: "✓", failed: "▲" };
/** 种子分类 id → 属性徽章档（db.rs DEFAULT_CATEGORIES 播种序：工作/学习/生活/健康/兴趣） */
const CATEGORY_TYPE_KEYS: Record<number, string> = { 1: "work", 2: "study", 3: "life", 4: "health", 5: "interest" };

export function TaskCard({
  task,
  category,
  readonly,
  onOpen,
  onChanged,
  onEdit,
}: {
  task: Task;
  category?: Category;
  /** DB_SCHEMA_TOO_NEW 只读传播（§4.2 禁用清单：状态机操作全部置灰） */
  readonly: boolean;
  onOpen: () => void;
  onChanged: () => void;
  /** 溢出菜单「编辑」入口（缺省 = 不渲染编辑项） */
  onEdit?: (task: Task) => void;
}): React.JSX.Element {
  const t = useT();
  const [releaseOpen, setReleaseOpen] = useState(false);

  const presentation = taskPresentation(task);

  const quickOps = <TaskQuickOps task={task} readonly={readonly} onChanged={onChanged} />;
  return (
    <>
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
        {!readonly && quickOps}
        <OverflowMenu
          task={task}
          readonly={readonly}
          onChanged={onChanged}
          onRelease={() => setReleaseOpen(true)}
          onEdit={onEdit}
        />
      </div>
      <TaskReleaseModal
        task={task}
        open={releaseOpen}
        onClose={() => setReleaseOpen(false)}
        onChanged={onChanged}
      />{" "}
    </>
  );
}

/** 卡尾「…」溢出菜单（U12：编辑/逃走[6 原因码]/改期/放生——承接主应用右键语义） */
function OverflowMenu({
  task,
  readonly,
  onChanged,
  onRelease,
  onEdit,
}: {
  task: Task;
  readonly: boolean;
  onChanged: () => void;
  onRelease: () => void;
  onEdit?: (task: Task) => void;
}): React.JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [escapeOpen, setEscapeOpen] = useState(false);
  return (
    <span className={styles.overflowWrap}>
      <button
        type="button"
        className={ui.button}
        aria-label={t("ctx.openDetail")}
        aria-expanded={open}
        disabled={readonly}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((v) => !v);
          setEscapeOpen(false);
        }}
      >
        …
      </button>
      {open && (
        <OverflowMenuItems
          task={task}
          escapeOpen={escapeOpen}
          setEscapeOpen={setEscapeOpen}
          close={() => setOpen(false)}
          onChanged={onChanged}
          onRelease={onRelease}
          onEdit={onEdit}
        />
      )}
    </span>
  );
}

/** 菜单内容（编辑项 / 逃走子菜单 6 原因码 / 改期日期 / 放生入口由卡片层弹层承接） */
function OverflowMenuItems({
  task,
  escapeOpen,
  setEscapeOpen,
  close,
  onChanged,
  onRelease,
  onEdit,
}: {
  task: Task;
  escapeOpen: boolean;
  setEscapeOpen: (v: boolean) => void;
  close: () => void;
  onChanged: () => void;
  onRelease: () => void;
  onEdit?: (task: Task) => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  if (escapeOpen) {
    return (
      <div className={styles.overflowMenu} role="menu" onClick={(event) => event.stopPropagation()}>
        {ESCAPE_REASON_CODES.map((code) => (
          <button
            key={code}
            type="button"
            role="menuitem"
            onClick={() => {
              void client.taskCancel({ taskId: task.id, reasonCode: code }).then(() => onChanged());
              close();
              setEscapeOpen(false);
            }}
          >
            {t(`im.escapeReasons.${code}`)}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className={styles.overflowMenu} role="menu" onClick={(event) => event.stopPropagation()}>
      {onEdit !== undefined && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            close();
            onEdit(task);
          }}
        >
          ✎ {t("entry.edit")}
        </button>
      )}
      <button type="button" role="menuitem" onClick={() => setEscapeOpen(true)}>
        {t("entry.escape")}
      </button>
      <RescheduleItem task={task} close={close} onChanged={onChanged} />
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          close();
          onRelease();
        }}
      >
        {t("entry.release")}
      </button>
    </div>
  );
}

/** 改期项（日期输入即改） */
function RescheduleItem({
  task,
  close,
  onChanged,
}: {
  task: Task;
  close: () => void;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  return (
    <label>
      {t("dsh.task.reschedule")}
      <input
        type="date"
        onChange={(event) => {
          void client
            .taskReschedule({ taskId: task.id, due: `${event.target.value}T00:00:00` })
            .then(() => onChanged());
          close();
        }}
      />
    </label>
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

/** 辅助信息行（分类属性徽章/优先级点/截止/专注时长/来源/派发徽标——原型 aux 行口径） */
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

/** 分类 id → 属性徽章档（种子分类 1-5 固定序，与 DESIGN_SYSTEM 分类色同源；自定义分类中性） */
function categoryTypeKey(categoryId: number): string | undefined {
  return CATEGORY_TYPE_KEYS[categoryId];
}
