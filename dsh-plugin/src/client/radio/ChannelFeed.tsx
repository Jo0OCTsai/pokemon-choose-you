/**
 * 频道视图（📡 按频道，桌面 RadioTab channelGroups 同构）：按会话名聚拢全部消息——
 * 组内待处理信号（todo/update）排前、其余待处理居中、已捕捉/已逃走垫底（并入各自
 * 频道组尾）；组头 = 📡 会话名 + 「{n} 待处理」（组内有信号时高亮）+ 「{n} 条」总数。
 * 待处理消息走建议卡（内联展开分诊），已处理走归档行（✔ 回执 / ✕ 原因）。
 */
import { useMemo } from "react";
import { useT } from "../i18n";
import type { RadioMessage } from "../rpc";
import { SuggestionCard } from "./SuggestionCard";
import styles from "./radio.module.css";

/** 待办信号（桌面 isSignal 同口径）：AI 挑出的待办/更新建议 */
function isSignal(message: RadioMessage): boolean {
  return message.aiStatus === "todo" || message.aiStatus === "update";
}

interface ChannelGroup {
  name: string;
  list: RadioMessage[];
}

/** 按会话聚拢（插件消息面无 chatId，按会话名归组；空名回落 FEISHU 同桌面） */
function groupByChannel(messages: RadioMessage[]): ChannelGroup[] {
  const map = new Map<string, RadioMessage[]>();
  for (const message of messages) {
    const key = message.chatName !== "" ? message.chatName : "FEISHU";
    const bucket = map.get(key);
    if (bucket === undefined) {
      map.set(key, [message]);
    } else {
      bucket.push(message);
    }
  }
  // 组内排序：信号（rank 0）→ 其余待处理（rank 1）→ 已处理垫底（rank 2）；同级保持原时间序
  const rank = (m: RadioMessage): number => (m.reviewStatus !== "pending" ? 2 : isSignal(m) ? 0 : 1);
  return [...map.entries()].map(([name, list]) => ({ name, list: [...list].sort((a, b) => rank(a) - rank(b)) }));
}

export function ChannelFeed({
  messages,
  readonly,
  onChanged,
}: {
  messages: RadioMessage[];
  readonly: boolean;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const groups = useMemo(() => groupByChannel(messages), [messages]);
  return (
    <div data-testid="channel-feed">
      {groups.map((group) => {
        const pendingSignals = group.list.filter((m) => m.reviewStatus === "pending" && isSignal(m)).length;
        return (
          <div key={group.name} data-testid="channel-group" data-chat={group.name}>
            <h4 className={styles.feedGroupTitle}>
              📡 {group.name}
              <span className={styles.groupCount} data-hot={pendingSignals > 0 ? "true" : undefined}>
                {t("im.chanPending", { n: pendingSignals })}
              </span>
              <span className={styles.groupCount}>{t("im.chanTotal", { n: group.list.length })}</span>
            </h4>
            {group.list.map((message) =>
              message.reviewStatus === "pending" ? (
                <SuggestionCard key={message.messageId} message={message} readonly={readonly} onChanged={onChanged} />
              ) : (
                <ArchivedChannelRow key={message.messageId} message={message} />
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 频道内已处理行（呈现同归档组：✔ 已捕捉回执 / ✕ 已逃走原因） */
function ArchivedChannelRow({ message }: { message: RadioMessage }): React.JSX.Element {
  const t = useT();
  const accepted = message.reviewStatus === "accepted";
  return (
    <div className={styles.archivedRow} data-testid="channel-archived-row">
      {accepted ? "✔" : "✕"} {message.content}
      {accepted && message.taskId !== null && <span>{t("im.caughtTask", { id: message.taskId })}</span>}
      {!accepted && message.dismissReason !== "" && <span>{t(`im.escapeReasons.${message.dismissReason}`)}</span>}
    </div>
  );
}
