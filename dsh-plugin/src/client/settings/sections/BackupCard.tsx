/**
 * 备份卡（从 GeneralSection.tsx 拆出——棘轮 max-lines，等量迁移）：开关 + 保留份数 +
 * 立即备份（快照 + 滚动保留）+ 恢复升级（U25：行内「恢复」/「从文件恢复…」→
 * RestoreConfirmModal 二次确认——超窗拒绝态确认键禁用）。
 */
import { useEffect, useRef, useState } from "react";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import { Select, Toggle } from "../../ui/controls";
import ui from "../../ui/ui.module.css";
import type { BackupInfo } from "../../rpc";
import { RestoreConfirmModal } from "./ImportRestoreModals";
import styles from "../settings.module.css";

/** 备份文件大小（BackupCard fmtSize 同款：MB 一位小数，否则 KB 取整） */
function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** 备份列表（null = 未加载——区分「空列表」与「还没查到」；行内「恢复」→ RestoreConfirmModal） */
function BackupList({
  backups,
  onRestore,
}: {
  backups: BackupInfo[] | null;
  onRestore: (backup: BackupInfo) => void;
}): React.JSX.Element {
  const t = useT();
  return (
    <>
      {backups !== null && backups.length > 0 && (
        <ul className={styles.entityList} data-testid="backup-list">
          {backups.map((b) => (
            <li key={b.file} className={styles.entityCard} data-testid="backup-row">
              <span>{b.file}</span>
              <span className={ui.muted}>
                {new Date(b.createdAt).toLocaleString()} · {fmtSize(b.size)}
              </span>
              {/* 只读模式放行（M7 裁决）：恢复旧版本备份是解除只读态的既有通道 */}
              <button type="button" className={ui.button} data-testid="backup-restore" onClick={() => onRestore(b)}>
                {t("dsh.restore.entry")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {backups !== null && backups.length === 0 && <p className={styles.cardHint}>{t("backup.empty")}</p>}
    </>
  );
}

/** 备份卡：开关 + 保留份数（保存制字段）+ 立即备份（快照 + 滚动保留）+ 恢复升级（U25：
 *  行内「恢复」/「从文件恢复…」→ RestoreConfirmModal 二次确认——超窗拒绝态确认键禁用） */
export function BackupCard({
  draft,
  onField,
  readonly,
  onChanged,
}: {
  draft: Record<string, string>;
  onField: (key: string, value: string) => void;
  readonly: boolean;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [backupMsg, setBackupMsg] = useState("");
  /** 恢复目标（托管条目 backupId / 外部文件 path） */
  const [restoreSource, setRestoreSource] = useState<{ backupId?: string; path?: string; file: string } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  // 备份列表直读（备份卡的列表初始态）
  useEffect(() => {
    void (async () => {
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

  return (
    <div className={ui.card}>
      <h4 className={styles.cardTitle}>{t("backup.title")}</h4>
      <Toggle
        label={t("backup.enable")}
        tip={t("backup.enableDesc")}
        checked={draft["backup_enabled"] === "true"}
        onChange={(v) => onField("backup_enabled", String(v))}
      />
      {/* 保留份数 + 选择框 + 立即备份同行（桌面 BackupCard .backup-controls 同构） */}
      <div className={styles.filterRow}>
        <span>{t("backup.keep")}</span>
        <Select
          ariaLabel={t("backup.keep")}
          value={draft["backup_keep"]}
          options={[3, 7, 14, 30].map((n) => ({ value: String(n), label: t("backup.keepN", { n }) }))}
          onChange={(v) => onField("backup_keep", v)}
        />
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
      <BackupList backups={backups} onRestore={(b) => setRestoreSource({ backupId: b.file, file: b.file })} />
      <input
        ref={fileInput}
        type="file"
        accept=".db"
        className={styles.hiddenFileInput}
        aria-label={t("dsh.restore.fromFile")}
        data-testid="restore-file-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) {
            setRestoreSource({ path: (file as File & { path?: string }).path ?? file.name, file: file.name });
          }
          event.target.value = "";
        }}
      />
      <div className={styles.filterRow}>
        <button
          type="button"
          className={ui.button}
          data-testid="restore-from-file"
          disabled={readonly}
          onClick={() => fileInput.current?.click()}
        >
          {t("dsh.restore.fromFile")}
        </button>
      </div>
      {restoreSource !== null && (
        <RestoreConfirmModal
          source={restoreSource}
          fileName={restoreSource.file}
          readonly={false}
          onClose={() => setRestoreSource(null)}
          onChanged={() => {
            onChanged();
            void client.backupList().then((list) => {
              if (list.ok) {
                setBackups(list.data.backups);
              }
            });
          }}
        />
      )}
    </div>
  );
}
