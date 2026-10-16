/**
 * 专注分区页（🍅，对齐主应用 SectionFocus）：番茄钟表单（开关/时长/短休息/完成通知/
 * 长番茄提示音）+ 提醒与勿扰（通知总开关/提前提醒量/勿扰时段组——后五键标
 * 「作用于主应用触达」badge，U20；勿扰起止为整点下拉，起=止阻断保存）。
 * 选项值域 = optionSets 单源（与主应用一致，防双形态互写坏）。勿扰起=止防呆阻断
 * 在 SettingsSegment 保存控件侧统一承接（sectionSaveBlocker）。
 */
import { useT } from "../../i18n";
import { Select, Toggle } from "../../ui/controls";
import ui from "../../ui/ui.module.css";
import type { SectionProps } from "../sectionProps";
import { SectionShell } from "../SectionShell";
import { BREAK_MINUTES, POMODORO_MINUTES, REMIND_AHEAD_MINUTES, quietHourOptions } from "../optionSets";
import styles from "../settings.module.css";

export function FocusSection(props: SectionProps): React.JSX.Element {
  const { draft, onField } = props;
  const t = useT();
  const pomoMinutes = POMODORO_MINUTES.map((n) => ({ value: String(n), label: t("focus.minutes", { n }) }));
  const breaks = BREAK_MINUTES.map((n) => ({
    value: String(n),
    label: n === 0 ? t("focus.breakOff") : t("focus.minutes", { n }),
  }));
  const ahead = REMIND_AHEAD_MINUTES.map((n) => ({
    value: String(n),
    label: n === 0 ? t("remind.onTime") : t("remind.aheadN", { n }),
  }));
  const quietHours = quietHourOptions();
  return (
    <SectionShell>
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
        {/* 勿扰开始 / 结束各自单独一行（桌面 SectionFocus 两条 SettingRow + DexSelect 同构） */}
        <Select
          label={t("remind.quietStart")}
          value={draft["quiet_start"]}
          options={quietHours}
          onChange={(v) => onField("quiet_start", v)}
        />
        <Select
          label={t("remind.quietEnd")}
          value={draft["quiet_end"]}
          options={quietHours}
          onChange={(v) => onField("quiet_end", v)}
        />
        <p className={styles.cardHint}>{t("remind.quietDesc")}</p>
      </div>
    </SectionShell>
  );
}
