/**
 * 专注分区页（🍅，对齐主应用 SectionFocus）：番茄钟表单（开关/时长/短休息/完成通知/
 * 长番茄提示音）+ 提醒与勿扰（通知总开关/提前提醒量/勿扰时段组——后五键标
 * 「作用于主应用触达」badge，U20；勿扰起止行内校验：起=止阻断保存）。
 */
import { useT } from "../../i18n";
import { Select, TextInput, Toggle } from "../../ui/controls";
import ui from "../../ui/ui.module.css";
import type { SectionProps } from "../sectionProps";
import { FOCUS_KEYS } from "../sectionKeys";
import { SectionShell } from "../SectionShell";
import styles from "../settings.module.css";

export function FocusSection(props: SectionProps): React.JSX.Element {
  const { draft, saved, onField, onSavedKeys } = props;
  const t = useT();
  const pomoMinutes = [
    { value: "15", label: t("focus.minutes", { n: 15 }) },
    { value: "25", label: t("focus.minutes", { n: 25 }) },
    { value: "45", label: t("focus.minutes", { n: 45 }) },
    { value: "60", label: t("focus.minutes", { n: 60 }) },
  ];
  const breaks = [
    { value: "0", label: t("focus.breakOff") },
    { value: "5", label: t("focus.minutes", { n: 5 }) },
    { value: "10", label: t("focus.minutes", { n: 10 }) },
    { value: "15", label: t("focus.minutes", { n: 15 }) },
  ];
  const ahead = [
    { value: "0", label: t("remind.onTime") },
    { value: "10", label: t("remind.aheadN", { n: 10 }) },
    { value: "30", label: t("remind.aheadN", { n: 30 }) },
    { value: "60", label: t("remind.aheadN", { n: 60 }) },
  ];
  const quietInvalid =
    draft["quiet_hours_enabled"] === "true" &&
    draft["quiet_start"] !== "" &&
    draft["quiet_start"] === draft["quiet_end"];
  return (
    <SectionShell
      title={`🍅 ${t("stabs.focus")}`}
      keys={FOCUS_KEYS}
      draft={draft}
      saved={saved}
      onSavedKeys={onSavedKeys}
      saveBlocked={quietInvalid}
      blockedReason={quietInvalid ? t("dsh.settings.saveFailed", { reason: t("remind.quiet") }) : undefined}
    >
      <div className={ui.card}>
        <h4 className={styles.cardTitle}>{t("focus.title")}</h4>
        <Toggle
          label={t("focus.enable")}
          checked={draft["pomodoro_enabled"] === "true"}
          onChange={(v) => onField("pomodoro_enabled", String(v))}
        />
        <Select
          label={t("focus.duration")}
          value={draft["pomodoro_minutes"]}
          options={pomoMinutes}
          onChange={(v) => onField("pomodoro_minutes", v)}
        />
        <Select
          label={t("focus.break")}
          value={draft["break_minutes"]}
          options={breaks}
          onChange={(v) => onField("break_minutes", v)}
        />
        <Toggle
          label={t("focus.notify")}
          checked={draft["pomodoro_notify"] === "true"}
          onChange={(v) => onField("pomodoro_notify", String(v))}
          badge={t("dsh.badge.notifications")}
        />
        <Toggle
          label={t("focus.chime")}
          checked={draft["pomodoro_chime"] === "true"}
          onChange={(v) => onField("pomodoro_chime", String(v))}
          badge={t("dsh.badge.notifications")}
        />
      </div>
      <div className={ui.card}>
        <h4 className={styles.cardTitle}>{t("remind.title")}</h4>
        <Toggle
          label={t("remind.enable")}
          checked={draft["notifications_enabled"] === "true"}
          onChange={(v) => onField("notifications_enabled", String(v))}
          badge={t("dsh.badge.notifications")}
        />
        <Select
          label={t("remind.ahead")}
          value={draft["remind_ahead_minutes"]}
          options={ahead}
          onChange={(v) => onField("remind_ahead_minutes", v)}
        />
        <Toggle
          label={t("remind.quiet")}
          checked={draft["quiet_hours_enabled"] === "true"}
          onChange={(v) => onField("quiet_hours_enabled", String(v))}
          badge={t("dsh.badge.notifications")}
        />
        <div className={styles.filterRow}>
          <span>{t("remind.quietStart")}</span>
          <TextInput
            ariaLabel={t("remind.quietStart")}
            value={draft["quiet_start"]}
            onChange={(v) => onField("quiet_start", v)}
          />
          <span>{t("remind.quietEnd")}</span>
          <TextInput
            ariaLabel={t("remind.quietEnd")}
            value={draft["quiet_end"]}
            onChange={(v) => onField("quiet_end", v)}
          />
        </div>
        <p className={styles.cardHint}>{t("remind.quietDesc")}</p>
      </div>
    </SectionShell>
  );
}
