/**
 * 通用分区页（⚙️）：复盘提醒（开关+星期）/备份（开关+保留份数+立即备份+列表）/
 * 关闭到托盘——三项标「作用于主应用」、保存制（U21）；待办库状态（dbStatus 即时查询，
 * 挂载即探测一次供只读判定）/数据导出（全量 JSON/任务 CSV/今日日报——导入与另存为
 * 不在 dsh 形态）/使用指南链接/双形态说明（语言与显示偏好已移入显示分区页）。
 */
import { useEffect, useState } from "react";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import { Select, Toggle } from "../../ui/controls";
import ui from "../../ui/ui.module.css";
import type { SectionProps } from "../sectionProps";
import { GENERAL_KEYS } from "../sectionKeys";
import type { BackupInfo, DbStatus } from "../../rpc";
import { SectionShell } from "../SectionShell";
import styles from "../settings.module.css";

/** 备份文件大小（BackupCard fmtSize 同款：MB 一位小数，否则 KB 取整） */
function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function GeneralSection(props: SectionProps): React.JSX.Element {
  const { draft, saved, onField, onSavedKeys } = props;
  const t = useT();
  const client = useClient();
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  // 备份列表（null = 未加载——区分「空列表」与「还没查到」）
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [backupMsg, setBackupMsg] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState("");
  // 只读模式（库版本较新）：写动作按钮统一禁用（桌面无此态，dsh 按 §4.2 禁用清单口径）
  const readonly = dbStatus?.mode === "ro";

  // 挂载即探测库状态（只读判定）+ 备份列表（备份卡的列表直读）
  useEffect(() => {
    void (async () => {
      const status = await client.dbStatus();
      if (status.ok) {
        setDbStatus(status.data);
      }
      const list = await client.backupList();
      if (list.ok) {
        setBackups(list.data.backups);
      }
    })();
  }, [client]);

  /** 立即备份：快照 + 滚动保留，行内提示新文件名并刷新列表 */
  async function backupNow(): Promise<void> {
    if (backingUp || readonly) {
      return;
    }
    setBackingUp(true);
    setBackupMsg("");
    const result = await client.backupRun();
    setBackingUp(false);
    if (result.ok) {
      setBackupMsg(t("backup.done", { v: result.data.file }));
      setBackups(result.data.files);
    } else {
      setBackupMsg(`❌ ${result.error.message}`);
    }
  }

  /** 数据导出：全量 JSON / 任务 CSV / 今日日报，提示写入路径 */
  async function runExport(kind: "json" | "csv" | "report"): Promise<void> {
    if (exporting || readonly) {
      return;
    }
    setExporting(true);
    setExportMsg("");
    const result = await client.exportRun({ kind });
    setExporting(false);
    if (result.ok) {
      setExportMsg(t("export.savedTo", { v: result.data.path }));
    } else {
      setExportMsg(`❌ ${result.error.message}`);
    }
  }

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
        <div className={styles.filterRow}>
          <button
            type="button"
            className={ui.button}
            disabled={backingUp || readonly}
            data-testid="backup-now"
            onClick={() => void backupNow()}
          >
            {backingUp ? t("backup.working") : t("backup.now")}
          </button>
          {backupMsg !== "" && (
            <span className={ui.muted} data-testid="backup-msg">
              {backupMsg}
            </span>
          )}
        </div>
        {backups !== null && backups.length > 0 && (
          <ul className={styles.entityList} data-testid="backup-list">
            {backups.map((b) => (
              <li key={b.file} className={styles.entityCard} data-testid="backup-row">
                <span>{b.file}</span>
                <span className={ui.muted}>
                  {new Date(b.createdAt).toLocaleString()} · {fmtSize(b.size)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {backups !== null && backups.length === 0 && <p className={styles.cardHint}>{t("backup.empty")}</p>}
      </div>
      <div className={ui.card}>
        <h4 className={styles.cardTitle}>{t("export.title")}</h4>
        <div className={styles.filterRow}>
          <button
            type="button"
            className={ui.button}
            disabled={exporting || readonly}
            data-testid="export-json"
            onClick={() => void runExport("json")}
          >
            {t("export.json")}
          </button>
          <button
            type="button"
            className={ui.button}
            disabled={exporting || readonly}
            data-testid="export-csv"
            onClick={() => void runExport("csv")}
          >
            {t("export.csv")}
          </button>
          <button
            type="button"
            className={ui.button}
            disabled={exporting || readonly}
            data-testid="export-report"
            onClick={() => void runExport("report")}
          >
            {t("export.md")}
          </button>
          {exportMsg !== "" && (
            <span className={ui.muted} data-testid="export-msg">
              {exportMsg}
            </span>
          )}
        </div>
        <p className={styles.cardHint}>{t("export.hint")}</p>
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
