/**
 * 右栏详情与操作（桌面 ImDetailPanel 同构）：选中电波的元信息行 + 正文 + AI 建议盒 +
 * 已处理状态条 + 底部固定操作行（按钮位置不随消息滚动）。动作 = 捕捉(C)/应用更新(U)/
 * 逃走(X，▾ 展开 6 原因码)/强制捕捉(F)/重判(判定失败)/恢复(逃走留档)；幂等冲突中性提示。
 * 操作区拆件 → MessageActions.tsx（本文件只做详情呈现）。
 */
import { useState } from "react";
import { useT } from "../i18n";
import type { RadioMessage } from "../rpc";
import { AiSuggestionBox, statusLabelKey } from "./SuggestionAiBox";
import { isJudging, isSignal } from "./MessageRow";
import { MessageActions, type RunAction } from "./MessageActions";
import ui from "../ui/ui.module.css";
import styles from "./radio.module.css";

export function MessageDetail({
  message,
  acceptedTags,
  onToggleTag,
  readonly,
  onChanged,
}: {
  /** 当前选中电波（null = 未选中空态） */
  message: RadioMessage | null;
  acceptedTags: Set<string>;
  onToggleTag: (name: string) => void;
  readonly: boolean;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const [conflict, setConflict] = useState<string | null>(null);

  /** 分诊动作汇报：幂等冲突 → 中性提示；成功 → 刷新（原 SuggestionCard 壳语义） */
  const run: RunAction = async (action) => {
    const result = await action();
    if (!result.ok && result.error?.code === "SUGGESTION_ALREADY_RESOLVED") {
      setConflict(t("dsh.toast.alreadyHandled"));
      return;
    }
    setConflict(null);
    onChanged();
  };

  if (message === null) {
    return (
      <section className={styles.detailPanel} data-testid="message-detail">
        <div className={styles.detailEmpty}>{t("im.selectHint")}</div>
      </section>
    );
  }
  return (
    <section className={styles.detailPanel} data-testid="message-detail" data-message-id={message.messageId}>
      <div className={styles.detailBody}>
        <div className={styles.detailMeta}>
          <span>
            {message.chatName !== "" ? `${message.chatName} · ` : ""}
            {message.senderName} · {message.receivedAt.slice(0, 16).replace("T", " ")}
          </span>
          <span className={styles.detailStatus}>{t(statusLabelKey(message.aiStatus))}</span>
        </div>
        <div className={styles.detailContent}>{message.content}</div>
        <DetailSuggestion message={message} acceptedTags={acceptedTags} readonly={readonly} onToggleTag={onToggleTag} />
        <DetailBanner message={message} />
        <MessageActions message={message} readonly={readonly} run={run} />
        {conflict !== null && (
          <div role="status" className={ui.muted}>
            {conflict}
          </div>
        )}
      </div>
    </section>
  );
}

/** 详情中部：AI 建议盒（待处理信号）/ 无信号说明 / 判定中 chip */
function DetailSuggestion({
  message,
  acceptedTags,
  readonly,
  onToggleTag,
}: {
  message: RadioMessage;
  acceptedTags: Set<string>;
  readonly: boolean;
  onToggleTag: (name: string) => void;
}): React.JSX.Element | null {
  const t = useT();
  if (message.reviewStatus !== "pending") {
    return null;
  }
  if (isJudging(message.aiStatus)) {
    return <span className={styles.judgingChip}>{t("dsh.radio.judging")}</span>;
  }
  if (isSignal(message)) {
    return (
      <AiSuggestionBox message={message} acceptedTags={acceptedTags} readonly={readonly} onToggleTag={onToggleTag} />
    );
  }
  return (
    <div className={styles.noneLine}>
      🔇 {t(statusLabelKey(message.aiStatus))}
      {message.reason !== null && <span> · {message.reason}</span>}
    </div>
  );
}

/** 已处理状态条（桌面 done-banner 同构）：捕捉回执 / 逃走原委（AI 原判 + 原因码） */
function DetailBanner({ message }: { message: RadioMessage }): React.JSX.Element | null {
  const t = useT();
  if (message.reviewStatus === "accepted") {
    if (message.taskId === null) {
      return null;
    }
    return <div className={styles.doneBanner}>✔ {t("im.caughtTask", { id: message.taskId })}</div>;
  }
  if (message.reviewStatus !== "dismissed") {
    return null;
  }
  return (
    <div className={styles.doneBanner}>
      ✕ {t("im.released")}
      <span className={styles.bannerSub}>
        {t("im.aiVerdict")}：{t(statusLabelKey(message.aiStatus))}
      </span>
      {message.dismissReason !== "" && (
        <span className={styles.bannerSub}>
          {t("im.dismissReasonLabel")}：{t(`im.escapeReasons.${message.dismissReason}`)}
        </span>
      )}
    </div>
  );
}
