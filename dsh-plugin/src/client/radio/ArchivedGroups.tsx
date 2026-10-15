/**
 * 已捕捉/已逃走组（从 SuggestionFeed 等量迁出）：默认折叠的留档两组——捕捉命中任务号
 * 回执；逃走带原因码文案与 ↩恢复。
 */
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import type { RadioMessage } from "../rpc";
import ui from "../ui/ui.module.css";
import { FeedGroup } from "./FeedGroup";
import styles from "./radio.module.css";

export function ArchivedGroups({
  caught,
  escaped,
  collapsed,
  onToggleGroup,
  readonly,
  onChanged,
}: {
  caught: RadioMessage[];
  escaped: RadioMessage[];
  collapsed: Set<string>;
  onToggleGroup: (key: string) => void;
  readonly: boolean;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  return (
    <>
      {/* 已捕捉组（默认折叠；命中任务号回执） */}
      {caught.length > 0 && (
        <FeedGroup
          testId="caught-group"
          title={t("im.groupCaught")}
          count={caught.length}
          collapsed={collapsed.has("caught")}
          onToggle={() => onToggleGroup("caught")}
        >
          {caught.map((message) => (
            <div key={message.messageId} className={styles.archivedRow}>
              ✔ {message.content}
              {message.taskId !== null && <span>{t("im.caughtTask", { id: message.taskId })}</span>}
            </div>
          ))}
        </FeedGroup>
      )}

      {/* 已逃走组（默认折叠；↩恢复逃走留档项） */}
      {escaped.length > 0 && (
        <FeedGroup
          testId="escaped-group"
          title={t("im.groupEscaped")}
          count={escaped.length}
          collapsed={collapsed.has("escaped")}
          onToggle={() => onToggleGroup("escaped")}
        >
          {escaped.map((message) => (
            <div key={message.messageId} className={styles.archivedRow}>
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
        </FeedGroup>
      )}
    </>
  );
}
