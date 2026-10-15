/**
 * 建议卡（内联展开，U2）：折叠态一行（转写文本 + 置信文字档位标）；展开态 = LCD 全文 +
 * AI 建议盒（标题/分类/截止/标签提议/理由）+ 操作条（四动作随建议类型：todo=◎捕捉/
 * ✕逃走、update=◎应用更新、followup=自动并入说明；none 与低置信 todo 另有 ⚡强制捕捉
 * ——桌面 F 键语义，判定中/已处理不出；✕ 逃走展开 6 原因码菜单；新标签提议「＋」接受
 * 态——接受建议时创建）。置信三档：边框形色 + 行内文字档位标（高/中/低，非颜色冗余
 * ——a11y 断言③）。
 */
import { useState } from "react";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import { ESCAPE_REASON_CODES, type PkyErrorShape, type RadioMessage } from "../rpc";
import { AiSuggestionBox, statusLabelKey } from "./SuggestionAiBox";
import ui from "../ui/ui.module.css";
import styles from "./radio.module.css";

/** 判定中/待判定同观感（im.status.judging 口径） */
function isJudging(aiStatus: RadioMessage["aiStatus"]): boolean {
  return aiStatus === "judging" || aiStatus === "pending";
}

/** ✕ 逃走可用：已判定且非 none/followup（这两类无逃走语义） */
function canEscapeFrom(message: RadioMessage, judging: boolean): boolean {
  return !judging && message.aiStatus !== "none" && message.aiStatus !== "followup";
}

/** 强制捕捉（桌面 F 键语义）：无信号消息 / 低置信 todo 建议——AI 不确定时人工拍板；
 * update/followup 不需要，判定中/已处理不加 */
function canForceCatch(message: RadioMessage, judging: boolean): boolean {
  return (
    message.reviewStatus === "pending" &&
    !judging &&
    (message.aiStatus === "none" || (message.aiStatus === "todo" && (message.confidence ?? "low") === "low"))
  );
}

type TranslateFn = ReturnType<typeof useT>;

/** 分诊结果汇报：幂等冲突 → 中性提示；成功 → 刷新 */
async function reportResult(
  result: { ok: boolean; error?: PkyErrorShape },
  t: TranslateFn,
  setConflict: (text: string | null) => void,
  onChanged: () => void,
): Promise<void> {
  if (!result.ok && result.error?.code === "SUGGESTION_ALREADY_RESOLVED") {
    setConflict(t("dsh.toast.alreadyHandled"));
    return;
  }
  setConflict(null);
  onChanged();
}

export function SuggestionCard({
  message,
  readonly,
  onChanged,
}: {
  message: RadioMessage;
  readonly: boolean;
  onChanged: () => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [acceptedTags, setAcceptedTags] = useState<Set<string>>(new Set());

  function toggleTag(name: string): void {
    setAcceptedTags((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  return (
    <div
      className={styles.suggestionCard}
      data-confidence={message.confidence ?? "low"}
      data-testid="suggestion-card"
      data-message-id={message.messageId}
    >
      <CollapsedSuggestion message={message} expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
      {expanded && (
        <ExpandedSuggestion
          message={message}
          readonly={readonly}
          acceptedTags={acceptedTags}
          onToggleTag={toggleTag}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}

/** 折叠态单行（会话名 + 转写文本 + 置信文字档位标 + 建议类型徽章；Esc 收起） */
function CollapsedSuggestion({
  message,
  expanded,
  onToggle,
}: {
  message: RadioMessage;
  expanded: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const t = useT();
  const judging = isJudging(message.aiStatus);
  return (
    <button
      type="button"
      className={styles.suggestionCollapsed}
      aria-expanded={expanded}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          event.stopPropagation();
          onToggle();
        }
      }}
    >
      <span className={styles.suggestionText}>
        {message.chatName !== "" && <b>{message.chatName} · </b>}
        {message.content}
      </span>
      <span className={styles.confidenceTag} data-conf={message.confidence ?? "low"}>
        {t(`im.confidence.${message.confidence ?? "low"}`)}
      </span>
      <span className={styles.actionTag} data-act={judging ? "judging" : message.aiStatus}>
        {judging ? t("dsh.radio.judging") : t(statusLabelKey(message.aiStatus))}
      </span>
    </button>
  );
}

/** 展开态：LCD 全文 + AI 建议盒 + 操作条 + 原因码菜单 + 冲突中性提示 */
function ExpandedSuggestion({
  message,
  readonly,
  acceptedTags,
  onToggleTag,
  onChanged,
}: {
  message: RadioMessage;
  readonly: boolean;
  acceptedTags: Set<string>;
  onToggleTag: (name: string) => void;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [escapeOpen, setEscapeOpen] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const judging = isJudging(message.aiStatus);

  async function run(action: () => Promise<{ ok: boolean; error?: PkyErrorShape }>): Promise<void> {
    setEscapeOpen(false);
    await reportResult(await action(), t, setConflict, onChanged);
  }

  return (
    <div className={styles.suggestionExpanded}>
      <div className={styles.lcdText}>
        {message.receivedAt} · {message.chatName} / {message.senderName}
        {"\n"}
        {message.content}
      </div>
      {judging ? (
        <span className={styles.judgingChip}>{t("dsh.radio.judging")}</span>
      ) : (
        <AiSuggestionBox message={message} acceptedTags={acceptedTags} readonly={readonly} onToggleTag={onToggleTag} />
      )}
      {conflict !== null && (
        <div role="status" className={ui.muted}>
          {conflict}
        </div>
      )}
      <SuggestionActions
        message={message}
        readonly={readonly}
        judging={judging}
        onRun={run}
        onToggleEscape={() => setEscapeOpen((v) => !v)}
      />
      {escapeOpen && (
        <div className={styles.reasonMenu} role="menu" aria-label={t("im.escapeWhy")}>
          {ESCAPE_REASON_CODES.map((code) => (
            <button
              key={code}
              type="button"
              role="menuitem"
              disabled={readonly}
              onClick={() => void run(() => client.reviewDismiss({ messageId: message.messageId, reasonCode: code }))}
            >
              {t(`im.escapeReasons.${code}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 操作条（四动作随建议类型：todo=◎捕捉、update=◎应用更新、✕逃走开菜单、⚡强制捕捉） */
function SuggestionActions({
  message,
  readonly,
  judging,
  onRun,
  onToggleEscape,
}: {
  message: RadioMessage;
  readonly: boolean;
  judging: boolean;
  onRun: (action: () => Promise<{ ok: boolean; error?: PkyErrorShape }>) => Promise<void>;
  onToggleEscape: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const canCatch = message.aiStatus === "todo";
  const canApply = message.aiStatus === "update";
  const canEscape = canEscapeFrom(message, judging);
  const canForce = canForceCatch(message, judging);
  return (
    <div className={styles.actionBar}>
      {canCatch && (
        <button
          type="button"
          className={ui.button}
          disabled={readonly}
          onClick={() => void onRun(() => client.reviewAccept({ messageId: message.messageId }))}
        >
          {t("im.catch")}
        </button>
      )}
      {canApply && (
        <button
          type="button"
          className={ui.button}
          disabled={readonly}
          onClick={() => void onRun(() => client.reviewApplyUpdate({ messageId: message.messageId }))}
        >
          {t("im.applyUpdate")}
        </button>
      )}
      {canEscape && (
        <button type="button" className={ui.button} disabled={readonly} onClick={onToggleEscape}>
          {t("im.release")}
        </button>
      )}
      {canForce && (
        <button
          type="button"
          className={ui.button}
          disabled={readonly}
          onClick={() => void onRun(() => client.forceCapture({ messageId: message.messageId }))}
        >
          {t("im.force")}
        </button>
      )}
    </div>
  );
}
