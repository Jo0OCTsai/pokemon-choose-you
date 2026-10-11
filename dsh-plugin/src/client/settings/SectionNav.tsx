/**
 * 背包分区选单（SectionNav，U21）：八分区横向选单（🍅专注/🗂分类与标签/🐾桌宠/👀显示/
 * 🤖Agent/飞书/🩺诊断/⚙️通用——对齐主应用「上选单下内容」）；一次只选中一个分区
 * （aria-pressed + 焦点管理）；窄屏横向滚动；切换保留未保存草稿（不出确认）。
 */
import { useT } from "../i18n";
import { SECTION_KEYS, SECTION_LABEL_KEYS, type SectionKey } from "./sectionKeys";
import styles from "./settings.module.css";

export const SECTION_ICONS: Record<SectionKey, string> = {
  focus: "🍅",
  taxonomy: "🗂",
  pets: "🐾",
  display: "👀",
  agents: "🤖",
  feishu: "📡",
  diag: "🩺",
  general: "⚙️",
};

export function SectionNav({
  active,
  onChange,
  dirtySections,
}: {
  active: SectionKey;
  onChange: (section: SectionKey) => void;
  /** 有未保存草稿的分区（选单项带同款静态点提示，U21） */
  dirtySections: ReadonlySet<SectionKey>;
}): React.JSX.Element {
  const t = useT();
  return (
    <nav className={styles.sectionNav} aria-label={t("tabs.settings")} data-testid="section-nav" role="tablist">
      {SECTION_KEYS.map((section) => (
        <button
          key={section}
          type="button"
          role="tab"
          className={styles.sectionNavButton}
          aria-pressed={active === section}
          data-section={section}
          data-dirty={dirtySections.has(section) ? "true" : undefined}
          onClick={() => onChange(section)}
        >
          {SECTION_ICONS[section]} {t(SECTION_LABEL_KEYS[section])}
          {dirtySections.has(section) && <span className={styles.unsavedDotInline} aria-hidden="true" />}
        </button>
      ))}
    </nav>
  );
}
