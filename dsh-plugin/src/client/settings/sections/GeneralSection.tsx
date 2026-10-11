/**
 * 通用分区页（⚙️）：复盘提醒（开关+星期）/备份（开关+保留份数）/关闭到托盘——三项标
 * 「作用于主应用」、保存制（U21）；待办库状态（dbStatus 即时查询）/使用指南链接/
 * 双形态说明（语言与显示偏好已移入显示分区页）。
 */
import { useState } from "react";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import { Select, Toggle } from "../../ui/controls";
import ui from "../../ui/ui.module.css";
import type { SectionProps } from "../sectionProps";
import { GENERAL_KEYS } from "../sectionKeys";
import type { DbStatus } from "../../rpc";
import { SectionShell } from "../SectionShell";
import styles from "../settings.module.css";

export function GeneralSection(props: SectionProps): React.JSX.Element {
  const { draft, saved, onField, onSavedKeys } = props;
  const t = useT();
  const client = useClient();
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  return (
    <SectionShell
      title={`⚙️ ${t("stabs.general")}`}
      keys={GENERAL_KEYS}
      draft={draft}
      saved={saved}
      onSavedKeys={onSavedKeys}
    >
      <div className={ui.card}>
        <h4 className={styles.cardTitle}>{t("reviewCfg.title")}</h4>
        <Toggle
          label={t("reviewCfg.enable")}
          checked={draft["review_enabled"] === "true"}
          onChange={(v) => onField("review_enabled", String(v))}
          badge={t("dsh.badge.mainApp")}
        />
        <p className={styles.cardHint}>{t("reviewCfg.enableDesc")}</p>
        <Select
          label={t("reviewCfg.dow")}
          value={draft["review_dow"]}
          options={[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: t(`reviewDow.${n}`) }))}
          onChange={(v) => onField("review_dow", v)}
        />
      </div>
      <div className={ui.card}>
        <h4 className={styles.cardTitle}>{t("backup.title")}</h4>
        <Toggle
          label={t("backup.enable")}
          checked={draft["backup_enabled"] === "true"}
          onChange={(v) => onField("backup_enabled", String(v))}
          badge={t("dsh.badge.mainApp")}
        />
        <p className={styles.cardHint}>{t("backup.enableDesc")}</p>
        <Select
          label={t("backup.keep")}
          value={draft["backup_keep"]}
          options={[3, 7, 14, 30].map((n) => ({ value: String(n), label: t("backup.keepN", { n }) }))}
          onChange={(v) => onField("backup_keep", v)}
        />
      </div>
      <div className={ui.card}>
        <Toggle
          label={t("general.closeToTray")}
          checked={draft["close_to_tray"] === "true"}
          onChange={(v) => onField("close_to_tray", String(v))}
          badge={t("dsh.badge.mainApp")}
        />
        <p className={styles.cardHint}>{t("general.closeToTrayDesc")}</p>
      </div>
      <div className={ui.card}>
        <h4 className={styles.cardTitle}>{t("dsh.settings.dbStatusTitle")}</h4>
        <div className={styles.filterRow}>
          <button
            type="button"
            className={ui.button}
            onClick={async () => {
              const result = await client.dbStatus();
              if (result.ok) {
                setDbStatus(result.data);
              }
            }}
          >
            {t("dsh.settings.dbStatusQuery")}
          </button>
          {dbStatus !== null && (
            <span className={ui.muted}>
              {t("dsh.settings.dbUserVersion", {
                v: dbStatus.userVersion,
                mode: dbStatus.mode === "ro" ? t("dsh.settings.dbModeRo") : t("dsh.settings.dbModeRw"),
              })}
            </span>
          )}
        </div>
      </div>
      <div className={ui.card}>
        <h4 className={styles.cardTitle}>{t("dsh.settings.guideTitle")}</h4>
        <p className={ui.muted}>{t("dsh.settings.guideLink")}</p>
      </div>
      <div className={styles.noteBlock} data-testid="dual-form-note">
        <b>{t("dsh.settings.dualFormTitle")}</b>
        <br />
        {t("dsh.settings.dualFormBody")}
      </div>
    </SectionShell>
  );
}
