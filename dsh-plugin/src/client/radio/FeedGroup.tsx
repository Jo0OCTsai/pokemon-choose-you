/**
 * 电波折叠分组（桌面 ImListGroup 同构）：组头 = 折叠钮（▸/▾ caret + 标题 + 计数徽标 +
 * 右侧状态文字）+ 组头动作区（一键清空/重判等——动作钮在折叠钮外，避免按钮嵌套）+
 * 折叠 body（折叠即卸载）。折叠状态由 SuggestionFeed 集中管理：状态五分组与频道
 * 分组共用一套 Set（频道组键 `ch:<名>`，桌面 collapsed Set 同构）。
 */
import type { ReactNode } from "react";
import { useT } from "../i18n";
import styles from "./radio.module.css";

export function FeedGroup({
  testId,
  chat,
  headTitle,
  title,
  count,
  hot = false,
  stateLabel,
  actions,
  collapsed,
  onToggle,
  children,
}: {
  /** 包装节点的 data-testid（channel-group / failed-group 等定位锚） */
  testId?: string;
  /** 频道组会话名（data-chat 断言锚） */
  chat?: string;
  /** 组头折叠钮的原生 title 提示（无信号组点明「未经人工确认」边界） */
  headTitle?: string;
  /** 组头标题（频道组自带 📡 前缀） */
  title: ReactNode;
  /** 计数徽标（频道组传「{n} 待处理」文案） */
  count?: ReactNode;
  /** 计数徽标热点态（组内有待处理信号） */
  hot?: boolean;
  /** 右侧状态文字；缺省按折叠态显示「展开 / 收起」（频道组传会话总数） */
  stateLabel?: ReactNode;
  /** 组头动作（置于折叠钮右侧、贴组头右缘） */
  actions?: ReactNode;
  /** 是否收起 */
  collapsed: boolean;
  /** 折叠钮点击回调 */
  onToggle: () => void;
  children: ReactNode;
}): React.JSX.Element {
  const t = useT();
  return (
    <section className={styles.feedGroupSection} data-testid={testId} data-chat={chat}>
      <div className={styles.groupHead}>
        <button
          type="button"
          className={styles.groupToggle}
          title={headTitle}
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          <span className={styles.groupCaret} aria-hidden="true">
            {collapsed ? "▸" : "▾"}
          </span>
          <span className={styles.groupTitleText}>{title}</span>
          {count !== undefined && (
            <span className={styles.groupCount} data-hot={hot ? "true" : undefined}>
              {count}
            </span>
          )}
          <span className={styles.groupState}>{stateLabel ?? (collapsed ? t("im.expand") : t("im.collapse"))}</span>
        </button>
        {actions}
      </div>
      {collapsed ? null : children}
    </section>
  );
}
