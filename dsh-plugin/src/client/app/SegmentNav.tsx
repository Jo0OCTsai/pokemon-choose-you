/**
 * 分段导航（七段 · 含背包独立分段，U17/U18）：收音机段携带待处理静态计数；连续失败
 * ≥3 时计数前叠加静态 ⚠ 前缀（U14——静默失败的被动可发现性，不闪烁不变色动画）。
 */
import { useT } from "../i18n";
import { SEGMENTS, SEGMENT_LABEL_KEYS, type SegmentKey } from "../model";
import styles from "./app.module.css";

export function SegmentNav({
  active,
  onChange,
  radioPending,
  radioFailures,
}: {
  active: SegmentKey;
  onChange: (segment: SegmentKey) => void;
  radioPending: number;
  /** 收音机链路连续失败计数（≥3 触发 ⚠ 静态前缀） */
  radioFailures: number;
}): React.JSX.Element {
  const t = useT();
  return (
    <nav className={styles.segmentNav} aria-label={t("dsh.page.title")} data-testid="segment-nav">
      {SEGMENTS.map((segment) => {
        const isRadio = segment === "radio";
        const showCount = isRadio && radioPending > 0;
        const warn = isRadio && radioFailures >= 3;
        return (
          <button
            key={segment}
            type="button"
            className={styles.segmentButton}
            aria-current={active === segment ? "page" : undefined}
            data-segment={segment}
            data-warn={warn ? "true" : undefined}
            onClick={() => onChange(segment)}
          >
            {t(SEGMENT_LABEL_KEYS[segment])}
            {showCount && (
              <span className={styles.segmentCount}>
                {warn ? "⚠" : ""}
                {radioPending}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
