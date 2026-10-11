/**
 * 页面标题行（UIUX §3.1 PageHeader）：标题「图鉴机」+ 精灵剪影 + 待处理计数（静态数字）。
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
      <span className={styles.pendingBadge} data-testid="pending-count">
        {t("dsh.page.pending", { n: pendingCount })}
      </span>
    </header>
  );
}
