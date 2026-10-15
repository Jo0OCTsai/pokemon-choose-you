/**
 * 判定失败组（从 SuggestionFeed 等量迁出）：AI 判定失败 · N 条 + 组头一键重判（整组）/
 * 强制捕捉 / 强制逃走（可折叠）；单条重试与原因码菜单。
 */
import { useState } from "react";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import { ESCAPE_REASON_CODES, type RadioMessage } from "../rpc";
import ui from "../ui/ui.module.css";
import { FeedGroup } from "./FeedGroup";
import styles from "./radio.module.css";

/** 判定失败组：AI 判定失败 · N 条 + 组头一键重判（整组）/ 强制捕捉 / 强制逃走（可折叠） */
export function FailedGroup({
  messages,
  collapsed,
  onToggle,
  readonly,
  onChanged,
}: {
  messages: RadioMessage[];
  collapsed: boolean;
  onToggle: () => void;
  readonly: boolean;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [busy, setBusy] = useState(false);
  const [forceTarget, setForceTarget] = useState<RadioMessage | null>(null);
  return (
    <FeedGroup
      testId="failed-group"
      title={t("dsh.failed.group", { n: messages.length })}
      collapsed={collapsed}
      onToggle={onToggle}
      actions={
        <>
          <button
            type="button"
            className={`${ui.button} ${styles.headAction}`}
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
            className={`${ui.button} ${styles.headAction}`}
            disabled={readonly || messages.length !== 1}
            onClick={() => setForceTarget(messages[0])}
          >
            {t("dsh.failed.forceCapture")}
          </button>
          <button
            type="button"
            className={`${ui.button} ${styles.headAction}`}
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
        </>
      }
    >
      {messages.map((message) => (
        <div key={message.messageId} className={styles.failedCard}>
          <span className={styles.failedText}>{message.content}</span>
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
    </FeedGroup>
  );
}
