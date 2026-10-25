/**
 * 已捕捉/已逃走组（默认折叠的留档两组，桌面 caught/escaped 分组同构）：行点击选中
 * （回执/原委与 ↩恢复、⚡强制捕捉在右栏操作行）；捕捉命中任务号回执在行尾。
 */
import { useT } from "../i18n";
import type { RadioMessage } from "../rpc";
import { FeedGroup } from "./FeedGroup";
import { MessageRow } from "./MessageRow";

export function ArchivedGroups({
  caught,
  escaped,
  selectedId,
  onSelect,
  collapsed,
  onToggleGroup,
}: {
  caught: RadioMessage[];
  escaped: RadioMessage[];
  /** 当前选中电波（右栏详情跟随） */
  selectedId: string | null;
  onSelect: (messageId: string) => void;
  collapsed: Set<string>;
  onToggleGroup: (key: string) => void;
}): React.JSX.Element {
  const t = useT();
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
            <MessageRow
              key={message.messageId}
              message={message}
              variant="caught"
              selected={selectedId === message.messageId}
              onSelect={onSelect}
            />
          ))}
        </FeedGroup>
      )}

      {/* 已逃走组（默认折叠；↩恢复与强制捕捉走右栏操作行） */}
      {escaped.length > 0 && (
        <FeedGroup
          testId="escaped-group"
          title={t("im.groupEscaped")}
          count={escaped.length}
          collapsed={collapsed.has("escaped")}
          onToggle={() => onToggleGroup("escaped")}
        >
          {escaped.map((message) => (
            <MessageRow
              key={message.messageId}
              message={message}
              variant="escaped"
              selected={selectedId === message.messageId}
              onSelect={onSelect}
            />
          ))}
        </FeedGroup>
      )}
    </>
  );
}
