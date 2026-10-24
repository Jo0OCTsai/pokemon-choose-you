/**
 * 详情操作区拆件（桌面 ImDetailPanel .im-actions 同构）：分状态出钮——待处理
 * （捕捉 C / 应用更新 U / 重判 / 逃走 X + ▾ 原因码菜单 / 强制捕捉 F）、已逃走
 * （↩恢复 + 强制捕捉）、已捕捉（强制捕捉留档重抓）；判定中不出分诊键。
 */
import { useState } from "react";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import { ESCAPE_REASON_CODES, type PkyErrorShape, type RadioMessage } from "../rpc";
import { isJudging } from "./MessageRow";
import ui from "../ui/ui.module.css";
import styles from "./radio.module.css";

/** 动作执行壳（MessageDetail 持有：冲突中性提示 + onChanged 刷新） */
export type RunAction = (action: () => Promise<{ ok: boolean; error?: PkyErrorShape }>) => Promise<void>;

export function MessageActions({
  message,
  readonly,
  run,
  onRefresh,
}: {
  message: RadioMessage;
  readonly: boolean;
  run: RunAction;
  /** 纯刷新（不前进选中）——重判发起时立即拉一次「判定中」态 */
  onRefresh: () => void;
}): React.JSX.Element {
  const [escapeOpen, setEscapeOpen] = useState(false);
  const base = { message, readonly, run, onRefresh };
  const toggleEscape = () => setEscapeOpen((v) => !v);
  return (
    <div className={styles.actionBar}>
      {message.reviewStatus === "pending" && !isJudging(message.aiStatus) && (
        <PendingActions {...base} escapeOpen={escapeOpen} toggleEscape={toggleEscape} />
      )}
      {message.reviewStatus === "dismissed" && <DismissedActions {...base} />}
      {message.reviewStatus === "accepted" && <ForceButton {...base} closeEscape={() => undefined} />}
      {escapeOpen && <EscapeMenu {...base} closeEscape={() => setEscapeOpen(false)} />}
    </div>
  );
}

interface ActionProps {
  message: RadioMessage;
  readonly: boolean;
  run: RunAction;
  /** 纯刷新（不前进选中）——重判发起时立即拉一次「判定中」态 */
  onRefresh?: () => void;
  /** 逃走菜单收口（仅 MessageActions 顶层持有菜单态；其余动作钮不消费） */
  closeEscape?: () => void;
}

/** 待处理动作行：捕捉(C)/应用更新(U) · 重判 · 逃走 X + ▾ · 强制捕捉 F（随判定出钮） */
function PendingActions({
  message,
  readonly,
  run,
  onRefresh,
  escapeOpen,
  toggleEscape,
}: ActionProps & { escapeOpen: boolean; toggleEscape: () => void }): React.JSX.Element {
  const t = useT();
  const forceable = message.aiStatus === "none" || message.aiStatus === "todo" || message.aiStatus === "error";
  const escapable = message.aiStatus !== "none" && message.aiStatus !== "followup";
  return (
    <>
      {message.aiStatus === "update" && (
        <ApplyButton message={message} readonly={readonly} run={run} closeEscape={() => undefined} />
      )}
      {message.aiStatus === "todo" && (
        <CatchButton message={message} readonly={readonly} run={run} closeEscape={() => undefined} />
      )}
      {message.aiStatus === "error" && (
        <RetryButton
          message={message}
          readonly={readonly}
          run={run}
          onRefresh={onRefresh}
          closeEscape={() => undefined}
        />
      )}
      {escapable && (
        <>
          <DismissButton message={message} readonly={readonly} run={run} closeEscape={() => undefined} />
          <button
            type="button"
            className={ui.button}
            aria-label={t("im.escapeWhy")}
            aria-expanded={escapeOpen}
            onClick={toggleEscape}
          >
            ▾
          </button>
        </>
      )}
      {forceable && <ForceButton message={message} readonly={readonly} run={run} closeEscape={() => undefined} />}
    </>
  );
}

/** 已逃走留档动作行：↩恢复（拉回待处理）+ 强制捕捉 */
function DismissedActions({ message, readonly, run }: ActionProps): React.JSX.Element {
  const t = useT();
  const client = useClient();
  return (
    <>
      <button
        type="button"
        className={ui.button}
        disabled={readonly}
        onClick={() => void run(() => client.reviewRestore({ messageId: message.messageId }))}
      >
        ↩ {t("im.restore")}
      </button>
      <ForceButton message={message} readonly={readonly} run={run} closeEscape={() => undefined} />
    </>
  );
}

/** 逃走原因码菜单（▾ 展开：6 原因码，桌面 EscapeReasonPop 同位） */
function EscapeMenu({ message, readonly, run, closeEscape }: ActionProps): React.JSX.Element {
  const t = useT();
  const client = useClient();
  return (
    <div className={styles.reasonMenu} role="menu" aria-label={t("im.escapeWhy")}>
      {ESCAPE_REASON_CODES.map((code) => (
        <button
          key={code}
          type="button"
          role="menuitem"
          disabled={readonly}
          onClick={() => {
            closeEscape?.();
            void run(() => client.reviewDismiss({ messageId: message.messageId, reasonCode: code }));
          }}
        >
          {t(`im.escapeReasons.${code}`)}
        </button>
      ))}
    </div>
  );
}

function ApplyButton({ message, readonly, run }: ActionProps): React.JSX.Element {
  const t = useT();
  const client = useClient();
  return (
    <button
      type="button"
      className={ui.buttonDex}
      disabled={readonly}
      onClick={() => void run(() => client.reviewApplyUpdate({ messageId: message.messageId }))}
    >
      {t("im.applyUpdate")}
      <Kbd>U</Kbd>
    </button>
  );
}

function CatchButton({ message, readonly, run }: ActionProps): React.JSX.Element {
  const t = useT();
  const client = useClient();
  return (
    <button
      type="button"
      className={ui.buttonDex}
      disabled={readonly}
      onClick={() => void run(() => client.reviewAccept({ messageId: message.messageId }))}
    >
      {t("im.catch")}
      <Kbd>C</Kbd>
    </button>
  );
}

function RetryButton({ message, readonly, run, onRefresh }: ActionProps): React.JSX.Element {
  const t = useT();
  const client = useClient();
  return (
    <button
      type="button"
      className={ui.button}
      disabled={readonly}
      onClick={() => {
        // host 侧命令开头同步段已 claim 为 judging——不等判定全程，先刷一次让记录
        // 立即离开失败组进「判定中」组（命令完成后 run 尾再刷落最终态）
        const pending = client.retryJudge({ messageIds: [message.messageId] });
        onRefresh?.();
        void run(() => pending);
      }}
    >
      ♻ {t("im.retry")}
    </button>
  );
}

function DismissButton({ message, readonly, run }: ActionProps): React.JSX.Element {
  const t = useT();
  const client = useClient();
  return (
    <button
      type="button"
      className={ui.button}
      disabled={readonly}
      onClick={() => void run(() => client.reviewDismiss({ messageId: message.messageId, reasonCode: "other" }))}
    >
      {t("im.release")}
      <Kbd>X</Kbd>
    </button>
  );
}

function ForceButton({ message, readonly, run }: ActionProps): React.JSX.Element {
  const t = useT();
  const client = useClient();
  return (
    <button
      type="button"
      className={ui.button}
      disabled={readonly}
      onClick={() => void run(() => client.forceCapture({ messageId: message.messageId }))}
    >
      {t("im.force")}
      <Kbd>F</Kbd>
    </button>
  );
}

/** 快捷键提示 chip（桌面 .kbd 同款：快捷键标在按钮上） */
function Kbd({ children }: { children: string }): React.JSX.Element {
  return <span className={styles.kbdChip}>{children}</span>;
}
