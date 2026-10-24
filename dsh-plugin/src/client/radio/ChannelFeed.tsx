/**
 * 频道视图（📡 按频道，桌面 RadioTab channelGroups 同构）：按会话名聚拢全部消息——
 * 组内待处理信号（todo/update）排前、其余待处理居中、已捕捉/已逃走垫底（并入各自
 * 频道组尾）；组头 = 📡 会话名 + 「{n} 待处理」（组内有信号时高亮）+ 「{n} 条」总数，
 * 折叠状态由 SuggestionFeed 集中管理（键 `ch:<会话名>`，桌面同构）。
 * 行统一走 MessageRow（点击选中，详情在右栏）。
 */
import { useMemo } from "react";
import { useT } from "../i18n";
import type { RadioMessage } from "../rpc";
import { FeedGroup } from "./FeedGroup";
import { isSignal, MessageRow } from "./MessageRow";

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
  selectedId,
  onSelect,
  collapsed,
  onToggleGroup,
}: {
  messages: RadioMessage[];
  /** 当前选中电波（右栏详情跟随） */
  selectedId: string | null;
  onSelect: (messageId: string) => void;
  /** 集中折叠态（与状态分组共用一套 Set；频道组键 = `ch:<会话名>`） */
  collapsed: Set<string>;
  onToggleGroup: (key: string) => void;
}): React.JSX.Element {
  const t = useT();
  const groups = useMemo(() => groupByChannel(messages), [messages]);
  return (
    <div data-testid="channel-feed">
      {groups.map((group) => {
        const pendingSignals = group.list.filter((m) => m.reviewStatus === "pending" && isSignal(m)).length;
        const key = `ch:${group.name}`;
        return (
          <FeedGroup
            key={group.name}
            testId="channel-group"
            chat={group.name}
            title={`📡 ${group.name}`}
            count={t("im.chanPending", { n: pendingSignals })}
            hot={pendingSignals > 0}
            stateLabel={t("im.chanTotal", { n: group.list.length })}
            collapsed={collapsed.has(key)}
            onToggle={() => onToggleGroup(key)}
          >
            {group.list.map((message) => (
              <MessageRow
                key={message.messageId}
                message={message}
                variant="channel"
                selected={selectedId === message.messageId}
                onSelect={onSelect}
              />
            ))}
          </FeedGroup>
        );
      })}
    </div>
  );
}
