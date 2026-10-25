/**
 * 单条电波行（桌面 ImMessageRow 同构）：行点击 = 选中（右栏详情跟随），勾选框只出现在
 * 可分诊行（待处理信号/无信号/频道待处理）；行尾标记 = 已捕捉回执 ✔ No.x / 已逃走 ✕
 * （信号被否决加 ⚡ chip——AI 判了信号但被人工推翻，回看一眼可辨）。呈现拆件：
 * RowMain（两行主体）/ RowMarks（行尾标记）本文件内组件。
 */
import { useT } from "../i18n";
import type { RadioMessage } from "../rpc";
import styles from "./radio.module.css";

export type RowVariant = "signal" | "noise" | "judging" | "caught" | "escaped" | "channel";

/** 待办信号（桌面 isSignal 同口径）：AI 挑出的待办/更新建议 */
export function isSignal(message: RadioMessage): boolean {
  return message.aiStatus === "todo" || message.aiStatus === "update";
}

/** 判定中/待判定同观感（im.status.judging 口径） */
export function isJudging(aiStatus: RadioMessage["aiStatus"]): boolean {
  return aiStatus === "judging" || aiStatus === "pending";
}

export function MessageRow({
  message,
  variant,
  selected,
  checked = false,
  onSelect,
  onToggleCheck,
}: {
  message: RadioMessage;
  variant: RowVariant;
  /** 当前选中（右栏详情跟随） */
  selected: boolean;
  /** 勾选态（批量分诊；仅待处理行渲染勾选框） */
  checked?: boolean;
  onSelect: (messageId: string) => void;
  onToggleCheck?: (messageId: string) => void;
}): React.JSX.Element {
  const t = useT();
  return (
    <div
      role="button"
      tabIndex={0}
      className={styles.messageRow}
      data-selected={selected || undefined}
      data-dim={isArchivedRow(message, variant) || undefined}
      data-testid="radio-row"
      data-message-id={message.messageId}
      onClick={() => onSelect(message.messageId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(message.messageId);
        }
      }}
    >
      {checkboxVisible(message, variant) && (
        <label className={styles.rowCheck} onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            checked={checked}
            aria-label={t("im.selectAll")}
            onChange={() => onToggleCheck?.(message.messageId)}
          />
        </label>
      )}
      <RowMain message={message} variant={variant} />
      <RowMarks message={message} variant={variant} />
    </div>
  );
}

/** 已处理行降透明（已捕捉/已逃走/频道内已处理） */
function isArchivedRow(message: RadioMessage, variant: RowVariant): boolean {
  return variant === "caught" || variant === "escaped" || (variant === "channel" && message.reviewStatus !== "pending");
}

/** 勾选框只出现在可分诊行（待处理信号/无信号/频道待处理） */
function checkboxVisible(message: RadioMessage, variant: RowVariant): boolean {
  return variant === "signal" || variant === "noise" || (variant === "channel" && message.reviewStatus === "pending");
}

/** 两行主体：行 1 = 会话徽章 + 发送者 + 🔧/🔇 chip + 置信色点 + 时间；行 2 = 首行摘要 */
function RowMain({ message, variant }: { message: RadioMessage; variant: RowVariant }): React.JSX.Element {
  return (
    <span className={styles.rowMain}>
      <RowLine1 message={message} variant={variant} />
      <span className={styles.rowSnippet}>{message.content.split("\n")[0] ?? ""}</span>
    </span>
  );
}

/** 行 1 徽章链（会话名/发送者/更新·噪音 chip/置信色点/时间——桌面 r-line1 同构） */
function RowLine1({ message, variant }: { message: RadioMessage; variant: RowVariant }): React.JSX.Element {
  const t = useT();
  const conf = message.confidence ?? "low";
  const confDot = confidenceDotVisible(message, variant);
  return (
    <span className={styles.rowLine1}>
      {rowBadges(message, variant, t).map((badge) => (
        <span key={badge.key} className={styles.rowBadge}>
          {badge.text}
        </span>
      ))}
      <span className={styles.rowSender}>{message.senderName}</span>
      {confDot && (
        <span
          className={styles.confDot}
          data-conf={conf}
          aria-label={t(`im.confidence.${conf}`)}
          title={t(`im.confidence.${conf}`)}
        />
      )}
      <span className={styles.rowTime}>{message.receivedAt.slice(0, 16).replace("T", " ")}</span>
    </span>
  );
}

/** 行首徽章组（会话名 + 🔧更新 / 🔇噪音——chip 显隐随 variant，桌面 r-line1 同构） */
function rowBadges(
  message: RadioMessage,
  variant: RowVariant,
  t: ReturnType<typeof useT>,
): { key: string; text: string }[] {
  const pending = message.reviewStatus === "pending";
  const badges: { key: string; text: string }[] = [];
  if (message.chatName !== "") {
    badges.push({ key: "chat", text: message.chatName });
  }
  if (message.aiStatus === "update" && (variant === "signal" || (variant === "channel" && pending))) {
    badges.push({ key: "update", text: `🔧 ${t("im.chipUpdate")}` });
  }
  if (variant === "channel" && !isSignal(message) && pending) {
    badges.push({ key: "noise", text: `🔇 ${t("im.chipNoise")}` });
  }
  return badges;
}

/** 置信色点仅信号行可见（待处理信号 / 频道内待处理信号） */
function confidenceDotVisible(message: RadioMessage, variant: RowVariant): boolean {
  const pending = message.reviewStatus === "pending";
  return variant === "signal" || (variant === "channel" && pending && isSignal(message));
}

/** 行尾标记（随 variant）：已捕捉回执 / 已逃走 ✕（含 ⚡已否决）/ 频道混合行按状态取 */
function RowMarks({ message, variant }: { message: RadioMessage; variant: RowVariant }): React.JSX.Element | null {
  if (variant === "caught") {
    return message.taskId !== null ? <CaughtMark taskId={message.taskId} /> : null;
  }
  if (variant === "escaped") {
    return <EscapedMarks message={message} />;
  }
  if (variant === "channel" && message.reviewStatus === "accepted") {
    return message.taskId !== null ? <CaughtMark taskId={message.taskId} /> : null;
  }
  if (variant === "channel" && message.reviewStatus === "dismissed") {
    return <EscapedMarks message={message} />;
  }
  return null;
}

function CaughtMark({ taskId }: { taskId: number }): React.JSX.Element {
  return <span className={styles.rowMarkOk}>✔ No.{taskId}</span>;
}

/** 已逃走标记组：✕ 旁可挂 ⚡已否决 chip——AI 判了信号但被人工推翻，回看一眼可辨 */
function EscapedMarks({ message }: { message: RadioMessage }): React.JSX.Element {
  const t = useT();
  return (
    <span className={styles.rowMarks}>
      {isSignal(message) && (
        <span className={styles.vetoChip} title={t("im.vetoedTitle")}>
          ⚡ {t("im.chipVetoed")}
        </span>
      )}
      <span className={styles.rowMarkNo}>✕</span>
    </span>
  );
}
