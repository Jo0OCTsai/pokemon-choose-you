/**
 * 建议流：工具栏（电波搜索 + ⏱按状态/📡按频道视图切换，桌面 RadioTab parity）+
 * 折叠分组（桌面 ImListGroup 同构，collapsed Set 集中管理）——状态模式五分组：
 * 待处理组（复选框 + 内联展开建议卡 + BatchBar 批量条：全选待处理/只选高置信）/
 * 判定失败组（一键重判 · 强制捕捉/逃走）/ 无动作组（组头「✕ 一键清空」= 整组批逃
 * noise）/ 已捕捉组、已逃走组（默认折叠；逃走留档 ↩恢复）。频道模式整列切
 * ChannelFeed（按会话聚拢，信号在前、已处理垫底，组同样可折叠）。键盘流（U9：仅
 * 插件页面聚焦域内）：J/K 移动、Esc 收起展开卡。
 * 失败组/批量条/已捕捉已逃走组拆件 → FailedGroup / BatchBar / ArchivedGroups。
 */
import { useMemo, useState } from "react";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import { suggestionGroups } from "../model";
import type { EscapeReasonCode, RadioMessage } from "../rpc";
import ui from "../ui/ui.module.css";
import { ArchivedGroups } from "./ArchivedGroups";
import { BatchBar } from "./BatchBar";
import { ChannelFeed } from "./ChannelFeed";
import { FailedGroup } from "./FailedGroup";
import { FeedGroup } from "./FeedGroup";
import { SuggestionCard } from "./SuggestionCard";
import styles from "./radio.module.css";

/** 视图模式：⏱ 按状态分区 / 📡 按频道聚拢（组件 state，桌面 mode 同构） */
type ViewMode = "time" | "channel";

/** 已处理分区默认收起（桌面 collapsed 初始值同构） */
const DEFAULT_COLLAPSED = ["caught", "escaped"];

/** Set 元素切换（组折叠/复选选择共用形态） */
function toggled<T>(set: Set<T>, key: T): Set<T> {
  const next = new Set(set);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

/** 电波搜索：前端过滤消息/会话/发送者（跨全部分组生效，清空恢复——桌面搜索同效） */
function filterMessages(messages: RadioMessage[], query: string): RadioMessage[] {
  const q = query.trim().toLowerCase();
  if (q === "") {
    return messages;
  }
  return messages.filter(
    (m) =>
      m.content.toLowerCase().includes(q) ||
      m.chatName.toLowerCase().includes(q) ||
      m.senderName.toLowerCase().includes(q),
  );
}

export function SuggestionFeed({
  messages,
  readonly,
  onChanged,
}: {
  messages: RadioMessage[];
  readonly: boolean;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchReason, setBatchReason] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [mode, setMode] = useState<ViewMode>("time");
  const [query, setQuery] = useState("");
  /** 折叠分组（状态组直接键名 + 频道组 `ch:<名>`；切换视图共用一套，桌面同构） */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(DEFAULT_COLLAPSED));

  const filtered = useMemo(() => filterMessages(messages, query), [messages, query]);

  const groups = useMemo(() => suggestionGroups(filtered), [filtered]);

  /** 组头折叠切换（桌面 toggleGroup 同构） */
  function toggleGroup(key: string): void {
    setCollapsed((prev) => toggled(prev, key));
  }

  function toggleSelect(messageId: string): void {
    setSelected((prev) => toggled(prev, messageId));
  }

  const pendingIds = useMemo(() => groups.pending.map((m) => m.messageId), [groups.pending]);
  const allChecked = pendingIds.length > 0 && pendingIds.every((id) => selected.has(id));

  function toggleAll(): void {
    setSelected(allChecked ? new Set() : new Set(pendingIds));
  }

  /** 只选高置信：快速圈定 AI 最有把握的待处理信号（桌面 checkHighConfidence 同构） */
  function selectHighConfidence(): void {
    setSelected(new Set(groups.pending.filter((m) => m.confidence === "high").map((m) => m.messageId)));
  }

  async function runBatch(op: "accept" | "dismiss", reasonCode?: EscapeReasonCode): Promise<void> {
    setBatchBusy(true);
    await client.reviewBatch({ messageIds: [...selected], op, reasonCode });
    setBatchBusy(false);
    setSelected(new Set());
    setBatchReason(false);
    onChanged();
  }

  /** 一键清空无信号：整组批逃并落 noise 原因（桌面 ClearNoiseActions 同构；无信号组仍 pending，CAS 可过） */
  async function clearNoise(): Promise<void> {
    const messageIds = groups.none.map((m) => m.messageId);
    if (messageIds.length === 0 || clearBusy) {
      return;
    }
    setClearBusy(true);
    await client.reviewBatch({ messageIds, op: "dismiss", reasonCode: "noise" });
    setClearBusy(false);
    onChanged();
  }

  return (
    <div className={styles.feedGroup} data-testid="suggestion-feed">
      {/* 工具栏：电波搜索 + 视图切换（⏱ 按状态 / 📡 按频道） */}
      <div className={styles.toolbar} data-testid="radio-toolbar">
        <input
          className={styles.searchInput}
          value={query}
          placeholder={t("im.search")}
          aria-label={t("im.search")}
          data-testid="radio-search"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className={styles.viewToggle} role="group" aria-label={t("im.viewMode")}>
          <button type="button" aria-pressed={mode === "time"} onClick={() => setMode("time")}>
            {t("im.viewTime")}
          </button>
          <button type="button" aria-pressed={mode === "channel"} onClick={() => setMode("channel")}>
            {t("im.viewChannel")}
          </button>
        </div>
      </div>

      {mode === "channel" ? (
        <ChannelFeed
          messages={filtered}
          collapsed={collapsed}
          onToggleGroup={toggleGroup}
          readonly={readonly}
          onChanged={onChanged}
        />
      ) : (
        <>
          {/* 待处理组 */}
          {groups.pending.length > 0 && (
            <FeedGroup
              testId="pending-group"
              title={t("im.groupSignal")}
              count={groups.pending.length}
              hot
              collapsed={collapsed.has("pending")}
              onToggle={() => toggleGroup("pending")}
            >
              {groups.pending.map((message) => (
                <div key={message.messageId} style={{ display: "flex", alignItems: "flex-start" }}>
                  <label className={styles.selectCheckbox}>
                    <input
                      type="checkbox"
                      checked={selected.has(message.messageId)}
                      onChange={() => toggleSelect(message.messageId)}
                      aria-label={t("im.selectAll")}
                    />
                  </label>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <SuggestionCard message={message} readonly={readonly} onChanged={onChanged} />
                  </div>
                </div>
              ))}
              {/* BatchBar（U13：随待处理组常驻，桌面批量条 parity；未选中时动作钮禁用） */}
              <BatchBar
                selected={selected}
                allChecked={allChecked}
                readonly={readonly}
                batchBusy={batchBusy}
                batchReason={batchReason}
                onToggleAll={toggleAll}
                onSelectHighConfidence={selectHighConfidence}
                onRunBatch={runBatch}
                onToggleReason={() => setBatchReason((v) => !v)}
                onClear={() => setSelected(new Set())}
              />
            </FeedGroup>
          )}

          {/* 判定失败组（中性命名 + 一键重判/强制） */}
          {groups.failed.length > 0 && (
            <FailedGroup
              messages={groups.failed}
              collapsed={collapsed.has("failed")}
              onToggle={() => toggleGroup("failed")}
              readonly={readonly}
              onChanged={onChanged}
            />
          )}

          {/* 无动作组（组头一键清空 = 整组确认为噪音；卡内可强制捕捉） */}
          {groups.none.length > 0 && (
            <FeedGroup
              title={t("im.groupNoise")}
              headTitle={t("im.groupNoiseTitle")}
              count={groups.none.length}
              collapsed={collapsed.has("none")}
              onToggle={() => toggleGroup("none")}
              actions={
                <button
                  type="button"
                  className={`${ui.button} ${styles.headAction}`}
                  title={t("im.clearNoiseTitle")}
                  disabled={readonly || clearBusy}
                  data-testid="clear-noise"
                  onClick={() => void clearNoise()}
                >
                  {t("im.clearNoise")}
                </button>
              }
            >
              {groups.none.map((message) => (
                <SuggestionCard key={message.messageId} message={message} readonly={readonly} onChanged={onChanged} />
              ))}
            </FeedGroup>
          )}

          <ArchivedGroups
            caught={groups.caught}
            escaped={groups.escaped}
            collapsed={collapsed}
            onToggleGroup={toggleGroup}
            readonly={readonly}
            onChanged={onChanged}
          />
        </>
      )}
    </div>
  );
}

export { FailedGroup } from "./FailedGroup";
