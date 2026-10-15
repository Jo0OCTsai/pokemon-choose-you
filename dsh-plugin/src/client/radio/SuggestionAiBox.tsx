/**
 * 建议卡拆件 · AI 建议盒：标题/截止/分类/理由 + 新标签提议行（「＋」接受态切换；
 * 创建发生在建议被接受时）。建议类型状态标签键（statusLabelKey）随盒迁出供两侧共用。
 */
import { useT } from "../i18n";
import type { RadioMessage } from "../rpc";
import type { ProposedTag } from "../rpcTypes";
import ui from "../ui/ui.module.css";
import styles from "./radio.module.css";

/** 建议类型状态标签键 */
export function statusLabelKey(aiStatus: RadioMessage["aiStatus"]): string {
  if (aiStatus === "update" || aiStatus === "followup" || aiStatus === "none" || aiStatus === "error") {
    return `im.status.${aiStatus}`;
  }
  return "im.status.todo";
}

/** AI 建议盒（标题/截止/分类/理由 + 新标签提议行） */
export function AiSuggestionBox({
  message,
  acceptedTags,
  readonly,
  onToggleTag,
}: {
  message: RadioMessage;
  acceptedTags: Set<string>;
  readonly: boolean;
  onToggleTag: (name: string) => void;
}): React.JSX.Element {
  const t = useT();
  const newTags = message.suggestedTags.filter((tag) => tag.isNew === true);
  return (
    <div className={styles.aiBox} data-testid="ai-suggestion">
      <div>
        {t(statusLabelKey(message.aiStatus))}
        {message.suggestedTitle !== null && <b> {message.suggestedTitle}</b>}
      </div>
      {message.suggestedDue !== null && (
        <div>
          {t("edit.due")}：{message.suggestedDue}
        </div>
      )}
      {message.suggestedCategory !== null && (
        <div>
          {t("edit.category")}：{message.suggestedCategory}
        </div>
      )}
      {message.reason !== null && <div className={ui.muted}>{message.reason}</div>}
      {newTags.length > 0 && (
        <TagProposals newTags={newTags} acceptedTags={acceptedTags} readonly={readonly} onToggleTag={onToggleTag} />
      )}
    </div>
  );
}

/** 新标签提议行（「＋」接受态切换；创建发生在建议被接受时） */
function TagProposals({
  newTags,
  acceptedTags,
  readonly,
  onToggleTag,
}: {
  newTags: ProposedTag[];
  acceptedTags: Set<string>;
  readonly: boolean;
  onToggleTag: (name: string) => void;
}): React.JSX.Element {
  const t = useT();
  return (
    <div className={styles.aiBoxTags}>
      {newTags.map((tag) => (
        <span key={tag.name} className={styles.tagProposal}>
          {t("im.tagNew", { dim: tag.dimension ?? "topic" })}: {tag.name}
          <button
            type="button"
            className={styles.tagProposalAccept}
            aria-pressed={acceptedTags.has(tag.name)}
            disabled={readonly}
            title={t("dsh.radio.acceptTag")}
            onClick={() => onToggleTag(tag.name)}
          >
            ＋
          </button>
        </span>
      ))}
    </div>
  );
}
