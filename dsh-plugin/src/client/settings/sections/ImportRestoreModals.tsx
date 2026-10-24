/**
 * 导入/恢复危险操作防线（U25 · FR-A5/D25）：
 * - ImportConfirmModal 全态序：选文件 → 校验中 → 校验失败（原因列表 + 0 行变更承诺 +
 *   [换一个文件]）→ 二次确认（明示整体替换 + 秘钥与提示词覆盖行保留 + 「已自动备份：{实文件名}」）
 *   → 执行中 → 成功（已导入 N 项 · 已自动备份）／备份失败中止（库内容未改动）。
 * - RestoreConfirmModal：确认（整体替换 + 前置自动备份说明）→ 执行中 → 成功（补跑迁移与
 *   默认分类补种说明）／失败（当前库保持恢复前状态）／版本超窗拒绝态（确认键禁用——
 *   DB_SCHEMA_TOO_NEW 经 restoreRun 回填，当前库不变）。
 * - 文件选择 = 宿主文件对话框（helper dialog 桥）；client 侧经 input[type=file] 承接，
 *   Electron 环境取 File.path，web 兜底文件名（host 侧按白名单/路径规则裁决）。
 */
import { useRef, useState } from "react";
import type { ImportSummary } from "../../rpc";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import { Modal, type ModalAction } from "../../ui/Modal";
import styles from "../settings.module.css";

/** File → path（Electron webview 暴露 .path；web 兜底文件名——host 侧白名单裁决） */
function pathOfFile(file: File): string {
  return (file as File & { path?: string }).path ?? file.name;
}

type ImportPhase = "pick" | "validating" | "invalid" | "confirm" | "running" | "done" | "backupFailed";

/** Import 按态动作区（选文件/校验中/失败/确认/执行中/结果） */
function importPhaseActions(
  phase: ImportPhase,
  t: (key: string) => string,
  readonly: boolean,
  onClose: () => void,
  runImport: () => void,
  openPicker: () => void,
): ModalAction[] {
  const actions: ModalAction[] = [];
  if (phase === "pick") {
    actions.push({ label: t("dsh.import.pickLabel"), onChoose: openPicker, variant: "primary" });
    actions.push({ label: t("cancel"), onChoose: onClose });
  } else if (phase === "validating") {
    actions.push({ label: t("dsh.import.validating"), onChoose: () => undefined, disabled: true });
  } else if (phase === "invalid") {
    actions.push({
      label: t("dsh.import.pickAnother"),
      onChoose: openPicker,
      variant: "primary",
    });
    actions.push({ label: t("cancel"), onChoose: onClose });
  } else if (phase === "confirm") {
    actions.push({ label: t("dsh.import.confirmOk"), onChoose: runImport, variant: "primary", disabled: readonly });
    actions.push({ label: t("cancel"), onChoose: onClose });
  } else if (phase === "running") {
    actions.push({ label: t("dsh.import.running"), onChoose: () => undefined, disabled: true });
  } else if (phase === "done") {
    actions.push({ label: t("dsh.common.close"), onChoose: onClose, variant: "primary" });
  } else {
    actions.push({ label: t("cancel"), onChoose: onClose });
  }
  return actions;
}

/** 导入计数兜底（缺省 0） */
function countOf(n: number | undefined): number {
  return n ?? 0;
}

/** Import 按态正文（选文件/校验中/失败/二次确认/执行中/成功/备份失败） */
function ImportPhaseBody({
  phase,
  path,
  summary,
  reasons,
  doneText,
  backupFailReason,
  onPick,
}: {
  phase: ImportPhase;
  path: string;
  summary: ImportSummary | null;
  reasons: string[];
  doneText: string;
  backupFailReason: string;
  onPick: () => void;
}): React.JSX.Element {
  const t = useT();
  return (
    <>
      {phase === "pick" && (
        <>
          <p>{t("dsh.import.pickHint")}</p>
          <button type="button" className={styles.importPickButton} onClick={onPick}>
            {t("dsh.import.pickLabel")}
          </button>
        </>
      )}
      {phase === "validating" && <p role="status">{t("dsh.import.validating")}</p>}
      {phase === "invalid" && (
        <div role="alert">
          <p>{t("dsh.import.invalid", { reasons: reasons.join("；") })}</p>
        </div>
      )}
      {phase === "confirm" && summary !== null && (
        <>
          <p>{t("dsh.import.confirmBody", { file: summary.backupFile ?? path })}</p>
          <p className={styles.importCounts}>{t("dsh.import.counts", { n: countOf(summary.counts.tasks) })}</p>
        </>
      )}
      {phase === "running" && <p role="status">{t("dsh.import.running")}</p>}
      {phase === "done" && (
        <p role="status" data-testid="import-done">
          {doneText}
        </p>
      )}
      {phase === "backupFailed" && (
        <p role="alert" data-testid="import-backup-failed">
          {t("dsh.import.backupFailed", { reason: backupFailReason })}
        </p>
      )}
    </>
  );
}

export function ImportConfirmModal({
  readonly,
  onClose,
  onChanged,
}: {
  readonly: boolean;
  onClose: () => void;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<ImportPhase>("pick");
  const [path, setPath] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [doneText, setDoneText] = useState("");
  const [backupFailReason, setBackupFailReason] = useState("");

  function pickFile(file: File | undefined): void {
    if (file === undefined) {
      return;
    }
    const nextPath = pathOfFile(file);
    setPath(nextPath);
    setPhase("validating");
    setReasons([]);
    void client.importValidate({ path: nextPath }).then((result) => {
      if (result.ok) {
        setSummary(result.data.summary);
        setPhase("confirm");
      } else {
        setReasons(result.error.message.split("；"));
        setPhase("invalid");
      }
    });
  }

  function runImport(): void {
    setPhase("running");
    void client.importRun({ path, confirmed: true }).then((result) => {
      if (result.ok) {
        setDoneText(t("dsh.import.done", { n: result.data.result.applied, file: result.data.result.backupId }));
        setPhase("done");
        onChanged();
      } else if (result.error.code === "BACKUP_FAILED") {
        setBackupFailReason(result.error.message);
        setPhase("backupFailed");
      } else {
        setReasons([result.error.message]);
        setPhase("invalid");
      }
    });
  }

  const openPicker = (): void => fileInput.current?.click();
  const actions = importPhaseActions(phase, t, readonly, onClose, runImport, openPicker);

  return (
    <Modal title={t("dsh.import.title")} ariaLabel={t("dsh.import.title")} actions={actions} onClose={onClose}>
      <div data-testid="import-modal">
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className={styles.hiddenFileInput}
          aria-label={t("dsh.import.pickLabel")}
          data-testid="import-file-input"
          onChange={(event) => {
            pickFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <ImportPhaseBody
          phase={phase}
          path={path}
          summary={summary}
          reasons={reasons}
          doneText={doneText}
          backupFailReason={backupFailReason}
          onPick={openPicker}
        />
      </div>
    </Modal>
  );
}

type RestorePhase = "confirm" | "running" | "rejected" | "done" | "failed";

/** 恢复确认（托管备份条目或外部备份文件；超窗拒绝态确认键禁用） */
export function RestoreConfirmModal({
  source,
  fileName,
  readonly,
  onClose,
  onChanged,
}: {
  source: { backupId?: string; path?: string };
  /** 呈现用文件名（托管条目 = 备份文件名；外部文件 = 所选文件名） */
  fileName: string;
  /** 只读模式下托管备份恢复通道放行（M7 裁决——解除只读态的既有通道） */
  readonly: boolean;
  onClose: () => void;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [phase, setPhase] = useState<RestorePhase>("confirm");
  const [failReason, setFailReason] = useState("");

  function runRestore(): void {
    setPhase("running");
    void client.restoreRun({ source, confirmed: true }).then((result) => {
      if (result.ok) {
        setPhase("done");
        onChanged();
      } else if (result.error.code === "DB_SCHEMA_TOO_NEW") {
        setFailReason(result.error.message);
        setPhase("rejected");
      } else {
        setFailReason(result.error.message);
        setPhase("failed");
      }
    });
  }

  /** 按态装配动作区（确认/执行中/超窗拒绝——确认键禁用/成功/失败） */
  const actions: ModalAction[] = [];
  if (phase === "confirm") {
    actions.push({ label: t("dsh.restore.confirmOk"), onChoose: runRestore, variant: "primary", disabled: readonly });
    actions.push({ label: t("cancel"), onChoose: onClose });
  } else if (phase === "running") {
    actions.push({ label: t("dsh.restore.running"), onChoose: () => undefined, disabled: true });
  } else if (phase === "rejected") {
    actions.push({ label: t("dsh.restore.confirmOk"), onChoose: () => undefined, disabled: true });
    actions.push({ label: t("cancel"), onChoose: onClose });
  } else if (phase === "done") {
    actions.push({ label: t("dsh.common.close"), onChoose: onClose, variant: "primary" });
  } else {
    actions.push({ label: t("cancel"), onChoose: onClose });
  }

  return (
    <Modal title={t("dsh.restore.title")} ariaLabel={t("dsh.restore.title")} actions={actions} onClose={onClose}>
      <div data-testid="restore-modal">
        {phase === "confirm" && <p>{t("dsh.restore.confirmBody", { file: fileName })}</p>}
        {phase === "running" && <p role="status">{t("dsh.restore.running")}</p>}
        {phase === "rejected" && (
          <div role="alert" data-testid="restore-rejected">
            <p>{t("dsh.restore.rejected")}</p>
            <p className={styles.importCounts}>{failReason}</p>
          </div>
        )}
        {phase === "done" && (
          <p role="status" data-testid="restore-done">
            {t("dsh.restore.done", { file: fileName })}
          </p>
        )}
        {phase === "failed" && (
          <p role="alert" data-testid="restore-failed">
            {t("dsh.restore.failed", { reason: failReason })}
          </p>
        )}
      </div>
    </Modal>
  );
}
