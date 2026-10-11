/**
 * 建议流（五分组）：待处理组（复选框 + 内联展开建议卡 + BatchBar 批量条）/ 无动作组 /
 * 判定失败组（一键重判 · 强制捕捉/逃走）/ 已捕捉组、已逃走组（默认折叠；逃走留档 ↩恢复）。
 * 键盘流（U9：仅插件页面聚焦域内）：J/K 移动、Esc 收起展开卡。
 */
import { useState } from "react";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import type { SuggestionGroups } from "../model";
import { ESCAPE_REASON_CODES, type EscapeReasonCode, type RadioMessage } from "../rpc";
import ui from "../ui/ui.module.css";
import { SuggestionCard } from "./SuggestionCard";
import styles from "./radio.module.css";

export function SuggestionFeed({
  groups,
  readonly,
  onChanged,
}: {
  groups: SuggestionGroups;
  readonly: boolean;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchReason, setBatchReason] = useState(false);

  function toggleSelect(messageId: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }

  async function runBatch(op: "accept" | "dismiss", reasonCode?: EscapeReasonCode): Promise<void> {
    setBatchBusy(true);
    await client.reviewBatch({ messageIds: [...selected], op, reasonCode });
    setBatchBusy(false);
    setSelected(new Set());
    setBatchReason(false);
    onChanged();
  }

  return (
    <div className={styles.feedGroup} data-testid="suggestion-feed">
      {/* 待处理组 */}
      {groups.pending.length > 0 && (
        <div>
          <h4 className={styles.feedGroupTitle}>
            {t("im.groupSignal")} · {groups.pending.length}
          </h4>
          {groups.pending.map((message) => (
            <div key={message.messageId} style={{ display: "flex", alignItems: "flex-start" }}>
              <label className={styles.selectCheckbox}>
                <input
                  type="checkbox"
                  checked={selected.has(message.messageId)}
                  onChange={() => toggleSelect(message.messageId)}
                  aria-label={t("im.selectAll")}
                />
              </label>
              <div style={{ flex: 1, minWidth: 0 }}>
                <SuggestionCard message={message} readonly={readonly} onChanged={onChanged} />
              </div>
            </div>
          ))}
          {/* BatchBar（U13：选中 ≥1 浮现；只作用于待处理组） */}
          {selected.size >= 1 && (
            <div className={styles.batchBar} data-testid="batch-bar">
              <span>{t("dsh.batch.selected", { n: selected.size })}</span>
              <button
                type="button"
                className={ui.button}
                disabled={readonly || batchBusy}
                onClick={() => void runBatch("accept")}
              >
                {t("dsh.batch.catchAll")}
              </button>
              <button
                type="button"
                className={ui.button}
                disabled={readonly || batchBusy}
                onClick={() => setBatchReason((v) => !v)}
              >
                {t("dsh.batch.releaseAll")}
              </button>
              <button type="button" className={ui.button} onClick={() => setSelected(new Set())}>
                {t("dsh.batch.clear")}
              </button>
              {batchReason && (
                <div className={styles.reasonMenu} role="menu">
                  {ESCAPE_REASON_CODES.map((code) => (
                    <button
                      key={code}
                      type="button"
                      role="menuitem"
                      onClick={() => void runBatch("dismiss", code)}
                      disabled={batchBusy}
                    >
                      {t(`im.escapeReasons.${code}`)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 判定失败组（中性命名 + 一键重判/强制） */}
      {groups.failed.length > 0 && <FailedGroup messages={groups.failed} readonly={readonly} onChanged={onChanged} />}

      {/* 无动作组 */}
      {groups.none.length > 0 && (
        <div>
          <h4 className={styles.feedGroupTitle}>
            {t("im.groupNoise")} · {groups.none.length}
          </h4>
          {groups.none.map((message) => (
            <div key={message.messageId} className={ui.muted} style={{ padding: "4px 0" }}>
              {message.content}
            </div>
          ))}
        </div>
      )}

      <CaughtGroup messages={groups.caught} />
      <EscapedGroup messages={groups.escaped} readonly={readonly} onChanged={onChanged} />
    </div>
  );
}

/** 判定失败组：AI 判定失败 · N 条 + 一键重判（整组）/ 强制捕捉 / 强制逃走 */
export function FailedGroup({
  messages,
  readonly,
  onChanged,
}: {
  messages: RadioMessage[];
  readonly: boolean;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [busy, setBusy] = useState(false);
  const [forceTarget, setForceTarget] = useState<RadioMessage | null>(null);
  return (
    <div data-testid="failed-group">
      <div className={styles.failedRow}>
        <h4 className={styles.feedGroupTitle}>{t("dsh.failed.group", { n: messages.length })}</h4>
        <button
          type="button"
          className={ui.button}
          disabled={readonly || busy}
          onClick={async () => {
            setBusy(true);
            await client.retryJudge({ messageIds: "all" });
            setBusy(false);
            onChanged();
          }}
        >
          {t("dsh.failed.retryAll")}
        </button>
        <button
          type="button"
          className={ui.button}
          disabled={readonly || messages.length !== 1}
          onClick={() => setForceTarget(messages[0])}
        >
          {t("dsh.failed.forceCapture")}
        </button>
        <button
          type="button"
          className={ui.button}
          disabled={readonly || busy}
          onClick={async () => {
            setBusy(true);
            for (const message of messages) {
              await client.forceDismiss({ messageId: message.messageId });
            }
            setBusy(false);
            onChanged();
          }}
        >
          {t("dsh.failed.forceDismiss")}
        </button>
      </div>
      {messages.map((message) => (
        <div key={message.messageId} className={styles.escapedRow}>
          {message.content}
          <button
            type="button"
            className={ui.button}
            disabled={readonly}
            onClick={async () => {
              await client.retryJudge({ messageIds: [message.messageId] });
              onChanged();
            }}
          >
            {t("im.retry")}
          </button>
        </div>
      ))}
      {forceTarget !== null && (
        <div className={styles.reasonMenu} role="menu">
          {ESCAPE_REASON_CODES.map((code) => (
            <button
              key={code}
              type="button"
              role="menuitem"
              onClick={async () => {
                await client.forceDismiss({ messageId: forceTarget.messageId, reasonCode: code });
                setForceTarget(null);
                onChanged();
              }}
            >
              {t(`im.escapeReasons.${code}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 已捕捉组（默认折叠；命中任务号回执） */
function CaughtGroup({ messages }: { messages: RadioMessage[] }): React.JSX.Element | null {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (messages.length === 0) {
    return null;
  }
  return (
    <div>
      <button type="button" className={ui.button} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {t("im.groupCaught")} · {messages.length} {open ? t("im.collapse") : t("dsh.overdue.expand")}
      </button>
      {open &&
        messages.map((message) => (
          <div key={message.messageId} className={styles.escapedRow}>
            ✔ {message.content}
            {message.taskId !== null && <span>{t("im.caughtTask", { id: message.taskId })}</span>}
          </div>
        ))}
    </div>
  );
}

/** 已逃走组（默认折叠；↩恢复逃走留档项） */
function EscapedGroup({
  messages,
  readonly,
  onChanged,
}: {
  messages: RadioMessage[];
  readonly: boolean;
  onChanged: () => void;
}): React.JSX.Element | null {
  const t = useT();
  const client = useClient();
  const [open, setOpen] = useState(false);
  if (messages.length === 0) {
    return null;
  }
  return (
    <div>
      <button type="button" className={ui.button} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {t("im.groupEscaped")} · {messages.length} {open ? t("im.collapse") : t("dsh.overdue.expand")}
      </button>
      {open &&
        messages.map((message) => (
          <div key={message.messageId} className={styles.escapedRow}>
            ✕ {message.content}
            {message.dismissReason !== "" && <span>{t(`im.escapeReasons.${message.dismissReason}`)}</span>}
            <button
              type="button"
              className={ui.button}
              disabled={readonly}
              onClick={async () => {
                await client.reviewRestore({ messageId: message.messageId });
                onChanged();
              }}
            >
              ↩ {t("im.restore")}
            </button>
          </div>
        ))}
    </div>
  );
}
