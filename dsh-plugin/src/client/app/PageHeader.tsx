/**
 * 页面标题行（UIUX §3.1 PageHeader，对齐桌面 dex-main-head）：标题「图鉴机」+ 待处理计数 +
 * POKé-DEX 装饰英文（§8：装饰英文不入 i18n）；标题行右端同排挂日期（CAUGHT 前）+ CAUGHT
 * 计数与进度条——七段全程常显（验收裁决：日期/CAUGHT 是页头信息，不随分段隐藏）；
 * 不放精灵剪影（右侧选项与列表卡已有精灵，页头不重复）。
 * 计数徽章 = 图鉴红底白字（世界观 scoped——DESIGN_SYSTEM --dex-red），数字单字 +
 * title/aria-label 全句（原型 pagehead.badge 口径，静态无 aria-live）；无待处理（0）
 * 不渲染——被动信号不强调零态（§2.4 原则 3）。
 */
import { useMemo } from "react";
import { adventureSnapshot } from "../model";
import type { PanelData } from "../model";
import { useT } from "../i18n";
import styles from "./app.module.css";

export function PageHeader({ pendingCount, data }: { pendingCount: number; data: PanelData }): React.JSX.Element {
  const t = useT();
  const adventure = useMemo(() => adventureSnapshot(data.tasks, data.today), [data.tasks, data.today]);
  const percent = adventure.total === 0 ? 0 : Math.round((adventure.caught / adventure.total) * 100);
  return (
    <header className={styles.pageHeader}>
      <div className={styles.pageHeadMain}>
        <div className={styles.pageTitleRow}>
          <h2 className={styles.pageTitle}>{t("dsh.page.title")}</h2>
          <span className={styles.pageTitleDeco} aria-hidden="true">
            POKé-DEX
          </span>
          {pendingCount > 0 && (
            <span
              className={styles.pendingBadge}
              data-testid="pending-count"
              title={t("dsh.page.pending", { n: pendingCount })}
              aria-label={t("dsh.page.pending", { n: pendingCount })}
            >
              {pendingCount}
            </span>
          )}
        </div>
      </div>
      <span className={styles.pageDate}>{data.today}</span>
      <span className={styles.pageCaught}>
        <span className={styles.caughtLabel}>
          CAUGHT {adventure.caught}/{adventure.total}
        </span>
        <span
          className={styles.caughtBar}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={adventure.total}
          aria-valuenow={adventure.caught}
        >
          <span className={styles.caughtFill} style={{ width: `${percent}%` }} />
        </span>
      </span>
    </header>
  );
}
