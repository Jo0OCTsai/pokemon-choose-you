/**
 * 页面标题行（UIUX §3.1 PageHeader）：标题「图鉴机」+ 精灵剪影 + 待处理计数 + POKé-DEX
 * 装饰英文（§8：装饰英文不入 i18n）。计数徽章 = 图鉴红底白字（世界观 scoped——
 * DESIGN_SYSTEM --dex-red），数字单字 + title/aria-label 全句（原型 pagehead.badge
 * 口径，静态无 aria-live）；无待处理（0）不渲染——被动信号不强调零态（§2.4 原则 3）。
 */
import { useT } from "../i18n";
import { Sprite } from "../ui/Sprite";
import styles from "./app.module.css";

export function PageHeader({ pendingCount }: { pendingCount: number }): React.JSX.Element {
  const t = useT();
  return (
    <header className={styles.pageHeader}>
      <span className={styles.pageHeaderSprite} aria-hidden="true">
        <Sprite spriteKey="pikachu" size={24} />
      </span>
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
    </header>
  );
}
