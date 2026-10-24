/**
 * 复盘向导 · 步骤视图（对照桌面 ReviewWizard.vue 同段）：步骤条 / 总览统计与分类条形 /
 * 路线任务站卡（四动作按钮）/ 草丛批量归位清单 / 收尾贺词。纯展示组件——数据与动作
 * 经 props 由壳层（ReviewWizard.tsx）供给。
 */
import type { Task } from "../../host/domain/tasks";
import { useT } from "../i18n";
import ui from "../ui/ui.module.css";
import styles from "./tasks.module.css";

export type RouteActionKind = "keep" | "done" | "toGrass" | "escape";

/** RFC3339 → 本地展示（客户端通用口径：字面前 16 位、T 换空格） */
export function fmtLocal(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

/** 当天过期（桌面 overdue 同构：截止日期 ≤ 今日，UTC 字面口径） */
export function isOverdueToday(task: Task): boolean {
  return task.dueAt !== null && task.dueAt.slice(0, 10) <= new Date().toISOString().slice(0, 10);
}

/** 步骤条（当前步高亮、已过步打勾） */
export function StepsBar({ step, labels }: { step: number; labels: string[] }): React.JSX.Element {
  return (
    <div className={styles.reviewSteps}>
      {labels.map((label, i) => (
        <span key={label} className={styles.reviewStepDot} data-on={i === step} data-past={i < step}>
          {i < step ? "✔" : i + 1} {label}
        </span>
      ))}
    </div>
  );
}

/** Step 0 总览：四统计卡 + 每分类条形（降序，条宽 min(100, n/total*100)%） */
export function OverviewStep({
  caught,
  focusMin,
  routeCount,
  grassCount,
  byCategory,
  total,
}: {
  caught: number;
  focusMin: number;
  routeCount: number;
  grassCount: number;
  byCategory: Array<[string, number]>;
  total: number;
}): React.JSX.Element {
  const t = useT();
  return (
    <>
      <div className={styles.reviewStats}>
        <div className={styles.reviewStat} data-testid="review-stat-caught">
          <div className={styles.reviewStatNum}>{caught}</div>
          <div className={styles.reviewStatLbl}>{t("review.caughtWeek")}</div>
        </div>
        <div className={styles.reviewStat} data-testid="review-stat-focus">
          <div className={styles.reviewStatNum}>{focusMin}</div>
          <div className={styles.reviewStatLbl}>{t("review.focusWeek")}</div>
        </div>
        <div className={styles.reviewStat} data-testid="review-stat-route">
          <div className={styles.reviewStatNum}>{routeCount}</div>
          <div className={styles.reviewStatLbl}>{t("review.onRoute")}</div>
        </div>
        <div className={styles.reviewStat} data-testid="review-stat-grass">
          <div className={styles.reviewStatNum}>{grassCount}</div>
          <div className={styles.reviewStatLbl}>{t("review.inGrass")}</div>
        </div>
      </div>
      {byCategory.length > 0 && (
        <div className={styles.reviewBars}>
          {byCategory.map(([name, n]) => (
            <div key={name} className={styles.reviewBarRow}>
              <span className={styles.reviewBarName}>{name}</span>
              <span className={styles.reviewBarTrack} role="presentation">
                <span className={styles.reviewBarFill} style={{ width: `${Math.min(100, (n / total) * 100)}%` }} />
              </span>
              <span className={styles.reviewBarN}>{n}</span>
            </div>
          ))}
        </div>
      )}
      <p className={styles.reviewTip}>{t("review.overviewTip")}</p>
    </>
  );
}

/** Step 1 路线逐站复盘：任务站卡 + 四动作（保留/✔完成/归草丛/逃走）+ 进度提示 */
export function RouteStep({
  task,
  index,
  total,
  busy,
  categoryName,
  onAction,
}: {
  task: Task | null;
  index: number;
  total: number;
  busy: boolean;
  categoryName: string | undefined;
  onAction(action: RouteActionKind): void;
}): React.JSX.Element {
  const t = useT();
  if (task === null) {
    return <p className={styles.reviewEmpty}>{t("review.routeEmpty")}</p>;
  }
  return (
    <>
      <div className={styles.reviewStation}>
        <div className={styles.reviewStNo}>No.{String(task.id).padStart(3, "0")}</div>
        <div className={styles.reviewStTitle}>{task.title}</div>
        <div className={styles.reviewStMeta}>
          {task.dueAt !== null && (
            <span data-overdue={isOverdueToday(task)}>
              🕒 {fmtLocal(task.dueAt)}
              {isOverdueToday(task) ? ` · ${t("review.overdue")}` : ""}
            </span>
          )}
          <span>{categoryName}</span>
          <span>{t(`priority.${task.priority}`)}</span>
          <span>{t(`status.${task.status}`)}</span>
        </div>
        {task.note ? <p className={styles.reviewStNote}>{task.note}</p> : null}
      </div>
      <div className={styles.reviewBtnRow}>
        <button type="button" className={ui.button} disabled={busy} onClick={() => onAction("keep")}>
          {t("review.keep")}
        </button>
        <button type="button" className={ui.button} disabled={busy} onClick={() => onAction("done")}>
          ✔ {t("review.complete")}
        </button>
        <button
          type="button"
          className={`${ui.button} ${styles.reviewGhost}`}
          disabled={busy}
          onClick={() => onAction("toGrass")}
        >
          {t("review.toGrass")}
        </button>
        <button
          type="button"
          className={`${ui.button} ${styles.reviewGhost}`}
          disabled={busy}
          onClick={() => onAction("escape")}
        >
          🚪 {t("review.escape")}
        </button>
      </div>
      <p className={styles.reviewTip}>
        {index + 1} / {total} · {t("review.routeTip")}
      </p>
    </>
  );
}

/** Step 2 草丛批量归位：全选/单选 + 逐只串行放生 + 计数提示 */
export function GrassStep({
  tasks,
  selected,
  allSelected,
  releasedCount,
  busy,
  onToggleAll,
  onToggleOne,
  onRelease,
  categoryNameOf,
}: {
  tasks: Task[];
  selected: Set<number>;
  allSelected: boolean;
  releasedCount: number;
  busy: boolean;
  onToggleAll(): void;
  onToggleOne(id: number): void;
  onRelease(): void;
  categoryNameOf(id: number): string | undefined;
}): React.JSX.Element {
  const t = useT();
  return (
    <>
      <div className={styles.reviewGrassHead}>
        <label className={styles.reviewBatchCheck}>
          <input type="checkbox" checked={allSelected} onChange={onToggleAll} />
          {t("review.selectAllGrass")}（{tasks.length}）
        </label>
        <button
          type="button"
          className={`${ui.button} ${styles.reviewGhost}`}
          disabled={selected.size === 0 || busy}
          onClick={onRelease}
        >
          🌿 {t("review.releaseGrass")}
          {selected.size > 0 ? `（${selected.size}）` : ""}
        </button>
      </div>
      <ul className={styles.reviewGrassList}>
        {tasks.length === 0 && <li className={styles.reviewEmpty}>{t("review.grassEmpty")}</li>}
        {tasks.map((g) => (
          <li key={g.id} className={styles.reviewGrassItem}>
            <input
              type="checkbox"
              checked={selected.has(g.id)}
              onChange={() => onToggleOne(g.id)}
              aria-label={g.title}
            />
            <span className={styles.reviewGrassTitle}>{g.title}</span>
            <span className={styles.reviewGrassCat}>{categoryNameOf(g.categoryId)}</span>
          </li>
        ))}
      </ul>
      {releasedCount > 0 && <p className={styles.reviewTip}>{t("review.released", { n: releasedCount })}</p>}
    </>
  );
}

/** Step 4 收尾：贺词 + 本周共收服 n 只 */
export function FinishStep({ n }: { n: number }): React.JSX.Element {
  const t = useT();
  return (
    <div className={styles.reviewFin}>
      <div className={styles.reviewFinEmoji}>🎉</div>
      <p className={styles.reviewFinLine}>{t("review.finishLine", { n })}</p>
      <p className={styles.reviewTip}>{t("review.finishTip")}</p>
    </div>
  );
}
