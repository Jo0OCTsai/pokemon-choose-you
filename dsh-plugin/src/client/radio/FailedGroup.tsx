/**
 * 判定失败组（桌面 RadioTab failed 分组同构）：组头 = im.groupFailed 标题 + 计数徽标
 * （与其他状态组同一形态，非热点态）+ 一键重判（整组）/ 强制逃走（可折叠）；
 * 行点击选中（单条重判/分诊在右栏操作行）。
 */
import { useState } from "react";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import type { RadioMessage } from "../rpc";
import ui from "../ui/ui.module.css";
import { FeedGroup } from "./FeedGroup";
import { MessageRow } from "./MessageRow";
import styles from "./radio.module.css";

/** 判定失败组：⚠ AI 判定失败 + 计数徽标 + 组头一键重判（整组）/ 强制逃走（可折叠） */
export function FailedGroup({
  messages,
  selectedId,
  onSelect,
  collapsed,
  onToggle,
  readonly,
  onChanged,
}: {
  messages: RadioMessage[];
  /** 当前选中电波（右栏详情跟随） */
  selectedId: string | null;
  onSelect: (messageId: string) => void;
  collapsed: boolean;
  onToggle: () => void;
  readonly: boolean;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [busy, setBusy] = useState(false);
  return (
    <FeedGroup
      testId="failed-group"
      title={t("im.groupFailed")}
      count={messages.length}
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
              // host 侧命令开头同步段已把 error 重置并 claim 为 judging——不等判定全程，
              // 先刷一次让记录立即离开本组进「判定中」组（命令完成后再刷落最终态）
              const pending = client.retryJudge({ messageIds: "all" });
              onChanged();
              await pending;
              setBusy(false);
              onChanged();
            }}
          >
            {t("dsh.failed.retryAll")}
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
        <MessageRow
          key={message.messageId}
          message={message}
          variant="noise"
          selected={selectedId === message.messageId}
          onSelect={onSelect}
        />
      ))}
    </FeedGroup>
  );
}
