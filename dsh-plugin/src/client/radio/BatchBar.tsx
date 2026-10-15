/**
 * 批量条（从 SuggestionFeed 等量迁出，U13）：随待处理组常驻，桌面批量条 parity；
 * 全选/只选高置信/批量捕捉/批量逃走（原因码菜单）/清空选择。
 */
import { useT } from "../i18n";
import { ESCAPE_REASON_CODES, type EscapeReasonCode } from "../rpc";
import ui from "../ui/ui.module.css";
import styles from "./radio.module.css";

export function BatchBar({
  selected,
  allChecked,
  readonly,
  batchBusy,
  batchReason,
  onToggleAll,
  onSelectHighConfidence,
  onRunBatch,
  onToggleReason,
  onClear,
}: {
  selected: Set<string>;
  allChecked: boolean;
  readonly: boolean;
  batchBusy: boolean;
  batchReason: boolean;
  onToggleAll: () => void;
  onSelectHighConfidence: () => void;
  onRunBatch: (op: "accept" | "dismiss", reasonCode?: EscapeReasonCode) => Promise<void>;
  onToggleReason: () => void;
  onClear: () => void;
}): React.JSX.Element {
  const t = useT();
  return (
    <div className={styles.batchBar} data-testid="batch-bar">
      <label className={styles.batchCheck}>
        <input type="checkbox" checked={allChecked} onChange={onToggleAll} aria-label={t("im.selectAll")} />
        {t("im.selectAll")}
      </label>
      <button
        type="button"
        className={ui.button}
        disabled={readonly}
        data-testid="hi-conf"
        onClick={onSelectHighConfidence}
      >
        {t("im.hiConf")}
      </button>
      <span>{t("dsh.batch.selected", { n: selected.size })}</span>
      <button
        type="button"
        className={ui.buttonPrimary}
        disabled={readonly || batchBusy || selected.size === 0}
        onClick={() => void onRunBatch("accept")}
      >
        {t("dsh.batch.catchAll")}
      </button>
      <button
        type="button"
        className={ui.button}
        disabled={readonly || batchBusy || selected.size === 0}
        onClick={onToggleReason}
      >
        {t("dsh.batch.releaseAll")}
      </button>
      {selected.size > 0 && (
        <button type="button" className={ui.button} onClick={onClear}>
          {t("dsh.batch.clear")}
        </button>
      )}
      {batchReason && (
        <div className={styles.reasonMenu} role="menu">
          {ESCAPE_REASON_CODES.map((code) => (
            <button
              key={code}
              type="button"
              role="menuitem"
              onClick={() => void onRunBatch("dismiss", code)}
              disabled={batchBusy}
            >
              {t(`im.escapeReasons.${code}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
