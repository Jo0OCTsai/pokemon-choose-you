/**
 * 复盘向导 · 标签体检步（Step 3 视图，对照桌面 ReviewWizard.vue 同段）：三组建议
 * （近义合并 / 僵尸标签 / 新维度）+ 失败重试 + 全空健康态 + 未判定脚注。
 * 行内动作经 props 回调壳层执行（host 调用与状态落位在 ReviewWizard.tsx）。
 */
import { useT } from "../i18n";
import type { TagCheckupReport } from "../rpc";
import type { TagDimension } from "../../host/domain/vocabulary-tags";
import { fmtLocal } from "./ReviewWizardSteps";
import ui from "../ui/ui.module.css";
import styles from "./tasks.module.css";

type MergeRow = TagCheckupReport["merges"][number];
type ZombieRow = TagCheckupReport["zombies"][number];
type DimRow = TagCheckupReport["newDimensions"][number];

export interface TagsStepProps {
  checking: boolean;
  error: string;
  checkup: TagCheckupReport | null;
  tagBusy: boolean;
  dimensions: TagDimension[];
  onRetry(): void;
  onMerge(row: MergeRow): void;
  onIgnoreMerge(row: MergeRow): void;
  onReleaseZombie(row: ZombieRow): void;
  onKeepZombie(row: ZombieRow): void;
  onAdopt(row: DimRow): void;
  onIgnoreDimension(row: DimRow): void;
}

/** 维度 key → 展示名（缺勤回落 key） */
function dimNameOf(dimensions: TagDimension[], key: string): string {
  return dimensions.find((d) => d.key === key)?.name ?? key;
}

/** origin 展示：review.tagOrigin.* 缺键回落原值（vue-i18n 默认消息口径） */
function originLabel(t: ReturnType<typeof useT>, origin: string): string {
  const key = `review.tagOrigin.${origin}`;
  const label = t(key);
  return label === key ? origin : label;
}

export function TagsStep(props: TagsStepProps): React.JSX.Element | null {
  const t = useT();
  if (props.checking) {
    return <p className={styles.reviewEmpty}>{t("review.tagChecking")}</p>;
  }
  if (props.error !== "") {
    return (
      <p className={styles.reviewEmpty}>
        {t("review.tagCheckFailed")}{" "}
        <button type="button" className={`${ui.button} ${styles.reviewMini}`} onClick={props.onRetry}>
          {t("review.tagRetry")}
        </button>
      </p>
    );
  }
  return props.checkup !== null ? <TagGroups {...props} /> : null;
}

/** 三组建议 + 全空健康态 + 未判定脚注 */
function TagGroups(props: TagsStepProps): React.JSX.Element {
  const t = useT();
  const checkup = props.checkup as TagCheckupReport;
  const empty = checkup.merges.length === 0 && checkup.zombies.length === 0 && checkup.newDimensions.length === 0;
  return (
    <>
      {checkup.merges.length > 0 && (
        <section>
          <h4 className={styles.reviewTgTitle}>{t("review.tagMerges")}</h4>
          {checkup.merges.map((m) => (
            <MergeRowView
              key={m.fromId}
              row={m}
              dimensions={props.dimensions}
              busy={props.tagBusy}
              onMerge={props.onMerge}
              onIgnore={props.onIgnoreMerge}
            />
          ))}
        </section>
      )}
      {checkup.zombies.length > 0 && (
        <section>
          <h4 className={styles.reviewTgTitle}>{t("review.tagZombies")}</h4>
          {checkup.zombies.map((z) => (
            <ZombieRowView
              key={z.id}
              row={z}
              dimensions={props.dimensions}
              busy={props.tagBusy}
              onRelease={props.onReleaseZombie}
              onKeep={props.onKeepZombie}
            />
          ))}
        </section>
      )}
      {checkup.newDimensions.length > 0 && (
        <section>
          <h4 className={styles.reviewTgTitle}>{t("review.tagNewDims")}</h4>
          {checkup.newDimensions.map((d) => (
            <DimRowView
              key={d.name}
              row={d}
              busy={props.tagBusy}
              onAdopt={props.onAdopt}
              onIgnore={props.onIgnoreDimension}
            />
          ))}
        </section>
      )}
      {empty && <p className={styles.reviewEmpty}>{t("review.tagClean")}</p>}
      <p className={styles.reviewTip}>{checkup.judged ? t("review.tagTip") : t("review.tagUnjudged")}</p>
    </>
  );
}

/** 近义合并行：「from」→「into」+ 维度 + 相似度 + 理由 */
function MergeRowView({
  row,
  dimensions,
  busy,
  onMerge,
  onIgnore,
}: {
  row: MergeRow;
  dimensions: TagDimension[];
  busy: boolean;
  onMerge(row: MergeRow): void;
  onIgnore(row: MergeRow): void;
}): React.JSX.Element {
  const t = useT();
  return (
    <div className={styles.reviewTgRow}>
      <span className={styles.reviewTgMain}>
        「{row.fromName}」→「{row.intoName}」
        <i className={styles.reviewTgDim}>
          {dimNameOf(dimensions, row.dimension)} · {Math.round(row.similarity * 100)}%
        </i>
      </span>
      {row.reason !== null && <span className={styles.reviewTgReason}>💡 {row.reason}</span>}
      <MiniButton label={t("review.tagMerge")} disabled={busy} onClick={() => onMerge(row)} />
      <MiniButton label={t("review.tagIgnore")} disabled={busy} del onClick={() => onIgnore(row)} />
    </div>
  );
}

/** 僵尸标签行：名 + 维度 + origin + 创建时间 */
function ZombieRowView({
  row,
  dimensions,
  busy,
  onRelease,
  onKeep,
}: {
  row: ZombieRow;
  dimensions: TagDimension[];
  busy: boolean;
  onRelease(row: ZombieRow): void;
  onKeep(row: ZombieRow): void;
}): React.JSX.Element {
  const t = useT();
  return (
    <div className={styles.reviewTgRow}>
      <span className={styles.reviewTgMain}>
        # {row.name}
        <i className={styles.reviewTgDim}>
          {dimNameOf(dimensions, row.dimension)} · {originLabel(t, row.origin)} · {fmtLocal(row.createdAt)}
        </i>
      </span>
      <MiniButton label={t("review.tagRelease")} disabled={busy} del onClick={() => onRelease(row)} />
      <MiniButton label={t("review.tagKeep")} disabled={busy} onClick={() => onKeep(row)} />
    </div>
  );
}

/** 新维度建议行：名 + 标签列表 + 理由 */
function DimRowView({
  row,
  busy,
  onAdopt,
  onIgnore,
}: {
  row: DimRow;
  busy: boolean;
  onAdopt(row: DimRow): void;
  onIgnore(row: DimRow): void;
}): React.JSX.Element {
  const t = useT();
  return (
    <div className={styles.reviewTgRow}>
      <span className={styles.reviewTgMain}>
        {row.name}：{row.tags.join("、")}
      </span>
      {row.reason !== null && <span className={styles.reviewTgReason}>💡 {row.reason}</span>}
      <MiniButton label={t("review.tagAdopt")} disabled={busy} onClick={() => onAdopt(row)} />
      <MiniButton label={t("review.tagIgnore")} disabled={busy} del onClick={() => onIgnore(row)} />
    </div>
  );
}

/** 行内 mini 档按钮（del = 危险字色） */
function MiniButton({
  label,
  disabled,
  del = false,
  onClick,
}: {
  label: string;
  disabled: boolean;
  del?: boolean;
  onClick(): void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={del ? `${ui.button} ${styles.reviewMini} ${styles.reviewDel}` : `${ui.button} ${styles.reviewMini}`}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
