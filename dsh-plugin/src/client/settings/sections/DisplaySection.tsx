/**
 * 显示分区页（👀，对齐主应用 SectionDisplay）：语言（UI 即时跟随 + 保存落库，U21/
 * U8——两形态同语言）+ 日期格式/时间制式（带实时预览）+ 逾期展示模式/相对截止时间
 * （dsh 面板同读同生效，U20）。
 */
import { useT, type Locale } from "../../i18n";
import { Select, Toggle } from "../../ui/controls";
import ui from "../../ui/ui.module.css";
import type { SectionProps } from "../sectionProps";
import { DISPLAY_KEYS } from "../sectionKeys";
import { SectionShell } from "../SectionShell";
import styles from "../settings.module.css";

function previewDateTime(draft: Record<string, string>): string {
  const date =
    draft["date_format"] === "MM-DD" ? "10-11" : draft["date_format"] === "zh-CN" ? "10月11日" : "2026-10-11";
  const time = draft["time_format"] === "12h" ? "4:24 PM" : "16:24";
  return `${date} ${time}`;
}

export function DisplaySection({
  onLocalePreview,
  ...props
}: SectionProps & { onLocalePreview?: (locale: Locale) => void }): React.JSX.Element {
  const { draft, saved, onField, onSavedKeys } = props;
  const t = useT();
  return (
    <SectionShell
      title={`👀 ${t("stabs.display")}`}
      keys={DISPLAY_KEYS}
      draft={draft}
      saved={saved}
      onSavedKeys={onSavedKeys}
    >
      <div className={ui.card}>
        <h4 className={styles.cardTitle}>{t("display.title")}</h4>
        <Select
          label={t("display.language")}
          value={draft["language"]}
          options={[
            { value: "zh-Hans", label: "简体中文" },
            { value: "zh-Hant", label: "繁體中文" },
            { value: "en", label: "English" },
          ]}
          onChange={(v) => {
            onField("language", v);
            // locale 随控件即时跟随（对齐主应用 bindLocaleToSettings 语义）；落库走保存
            onLocalePreview?.(v as Locale);
          }}
        />
        <Select
          label={t("display.date")}
          value={draft["date_format"]}
          options={[
            { value: "YYYY-MM-DD", label: "2026-10-11" },
            { value: "MM-DD", label: "10-11" },
            { value: "zh-CN", label: "10月11日" },
          ]}
          onChange={(v) => onField("date_format", v)}
        />
        <Select
          label={t("display.time")}
          value={draft["time_format"]}
          options={[
            { value: "24h", label: t("display.h24") },
            { value: "12h", label: t("display.h12") },
          ]}
          onChange={(v) => onField("time_format", v)}
        />
        <p className={styles.previewLine} data-testid="display-preview">
          {t("display.preview", { v: previewDateTime(draft) })}
        </p>
        <Select
          label={t("display.overdueMode")}
          value={draft["overdue_mode"]}
          options={[
            { value: "collapse", label: t("overdue.modeCollapse") },
            { value: "auto_grass", label: t("overdue.modeAuto") },
            { value: "show", label: t("overdue.modeShow") },
          ]}
          onChange={(v) => onField("overdue_mode", v)}
        />
        <Toggle
          label={t("display.dueRelative")}
          checked={draft["due_relative"] === "true"}
          onChange={(v) => onField("due_relative", String(v))}
        />
        <p className={styles.cardHint}>{t("display.dueRelativeDesc")}</p>
      </div>
    </SectionShell>
  );
}
