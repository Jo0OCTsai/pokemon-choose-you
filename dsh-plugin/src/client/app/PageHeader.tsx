/**
 * 页面标题行（UIUX §3.1 PageHeader）：标题「图鉴机」+ 精灵剪影 + 待处理计数。
 * 计数徽章 = 图鉴红底白字（世界观 scoped——DESIGN_SYSTEM --dex-red），数字单字 +
 * title/aria-label 全句（原型 pagehead.badge 口径，静态无 aria-live）。
 */
import { useT } from "../i18n";
import styles from "./app.module.css";

export function PageHeader({ pendingCount }: { pendingCount: number }): React.JSX.Element {
  const t = useT();
  return (
    <header className={styles.pageHeader}>
      <span className={styles.pageHeaderSprite} aria-hidden="true">
        🐾
      </span>
      <h2 className={styles.pageTitle}>{t("dsh.page.title")}</h2>
      <span
        className={styles.pendingBadge}
        data-testid="pending-count"
        title={t("dsh.page.pending", { n: pendingCount })}
        aria-label={t("dsh.page.pending", { n: pendingCount })}
      >
        {pendingCount}
      </span>
    </header>
  );
}
