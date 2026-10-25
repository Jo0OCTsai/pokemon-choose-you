/**
 * 数据导出卡（从 GeneralSection.tsx 拆出——棘轮 max-lines，等量迁移）：全量 JSON /
 * 任务 CSV / 今日日报（提示写入路径）+「导入 JSON」「打开导出目录」（U25）。
 */
import { useState } from "react";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import ui from "../../ui/ui.module.css";
import { ImportConfirmModal } from "./ImportRestoreModals";
import styles from "../settings.module.css";

/** 数据导出卡：全量 JSON / 任务 CSV / 今日日报（提示写入路径）+「导入 JSON」「打开导出目录」（U25） */
export function ExportCard({ readonly, onChanged }: { readonly: boolean; onChanged: () => void }): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState("");
  const [importOpen, setImportOpen] = useState(false);

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

  /** 打开导出目录（只读操作不受限；失败 toast 给原因与可手动前往的路径） */
  async function openExportDir(): Promise<void> {
    setExportMsg("");
    const result = await client.exportDirOpen();
    if (!result.ok) {
      setExportMsg(t("dsh.export.dirOpenFailed", { reason: result.error.message, path: result.error.hint ?? "" }));
    }
  }

  return (
    <div className={ui.card}>
      <h4 className={styles.cardTitle} data-tip={t("export.hint")}>
        {t("export.title")}
      </h4>
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
        <button
          type="button"
          className={ui.button}
          data-testid="import-json"
          disabled={readonly}
          onClick={() => setImportOpen(true)}
        >
          {t("dsh.import.entry")}
        </button>
        <button type="button" className={ui.button} data-testid="export-dir-open" onClick={() => void openExportDir()}>
          {t("dsh.export.dirOpen")}
        </button>
        {exportMsg !== "" && (
          <span className={ui.muted} data-testid="export-msg" role={exportMsg.startsWith("❌") ? "alert" : undefined}>
            {exportMsg}
          </span>
        )}
      </div>
      {importOpen && (
        <ImportConfirmModal readonly={readonly} onClose={() => setImportOpen(false)} onChanged={onChanged} />
      )}
    </div>
  );
}
