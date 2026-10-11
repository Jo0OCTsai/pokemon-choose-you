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
import ui from "../ui/ui.module.css";
import styles from "./tasks.module.css";

const DISPATCH_GLYPHS: Record<string, string> = { queued: "⏳", running: "◉", done: "✓", failed: "▲" };

export function TaskCard({
  task,
  category,
  readonly,
  onOpen,
  onChanged,
}: {
  task: Task;
  category?: Category;
  /** DB_SCHEMA_TOO_NEW 只读传播（§4.2 禁用清单：状态机操作全部置灰） */
  readonly: boolean;
  onOpen: () => void;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const [releaseOpen, setReleaseOpen] = useState(false);

  const presentation = taskPresentation(task);
  const dispatchState = task.dispatchState;
  const tooltipKey = dispatchTooltipKey(dispatchState);

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
        <TaskSprite category={category} />
        <span className={styles.taskMain}>
          <span className={styles.taskTitle}>
            No.{task.id} {task.title}
            {presentation === "active" && <span className={styles.activeBadge}> ♪ {t("entry.catching")}</span>}
            {presentation === "activePaused" && <span className={styles.pausedBadge}> ⏸ {t("entry.paused")}</span>}
          </span>
          <TaskMeta task={task} category={category} />
        </span>
        {dispatchState !== null && (
          <span
            className={styles.dispatchBadge}
            data-state={dispatchState}
            title={tooltipKey !== null ? t(tooltipKey, { reason: "" }) : undefined}
          >
            {DISPATCH_GLYPHS[dispatchState]}
          </span>
        )}
        {!readonly && quickOps}
        <OverflowMenu task={task} readonly={readonly} onChanged={onChanged} onRelease={() => setReleaseOpen(true)} />
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

/** 卡尾「…」溢出菜单（U12：逃走[6 原因码]/改期/放生——承接主应用右键语义） */
function OverflowMenu({
  task,
  readonly,
  onChanged,
  onRelease,
}: {
  task: Task;
  readonly: boolean;
  onChanged: () => void;
  onRelease: () => void;
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
        />
      )}
    </span>
  );
}

/** 菜单内容（逃走子菜单 6 原因码 / 改期日期 / 放生入口由卡片层弹层承接） */
function OverflowMenuItems({
  task,
  escapeOpen,
  setEscapeOpen,
  close,
  onChanged,
  onRelease,
}: {
  task: Task;
  escapeOpen: boolean;
  setEscapeOpen: (v: boolean) => void;
  close: () => void;
  onChanged: () => void;
  onRelease: () => void;
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

/** 分类精灵图（pixelated；分类缺失时占位点） */
function TaskSprite({ category }: { category?: Category }): React.JSX.Element {
  return (
    <span className={styles.taskSprite} aria-label={category?.pokemon ?? ""}>
      {category !== undefined && category.pokemon !== "" ? (
        <img src={category.sprite} alt={category.pokemon} width={24} height={24} />
      ) : (
        "•"
      )}
    </span>
  );
}

/** 辅助信息行（优先级点/分类/截止/专注时长/来源徽标） */
function TaskMeta({ task, category }: { task: Task; category?: Category }): React.JSX.Element {
  const t = useT();
  const focusMinutes = Math.floor(task.focusSeconds / 60);
  return (
    <span className={styles.taskMeta}>
      <span className={styles.prioDot} data-prio={task.priority} aria-label={t(`priority.${task.priority}`)} />
      {category !== undefined && <span>{category.name}</span>}
      {task.dueAt !== null && <span>{t("entry.due", { v: task.dueAt.slice(0, 16).replace("T", " ") })}</span>}
      {focusMinutes > 0 && <span>{t("entry.focus", { n: focusMinutes })}</span>}
      {task.source !== "local" && <span>{t(`entry.${task.source === "feishu" ? "feishu" : "capture"}`)}</span>}
    </span>
  );
}
