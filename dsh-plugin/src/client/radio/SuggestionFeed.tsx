/**
 * 建议流：工具栏（电波搜索 + ⏱按状态/📡按频道视图切换，桌面 RadioTab parity）+
 * 状态模式五分组——待处理组（复选框 + 内联展开建议卡 + BatchBar 批量条：全选待处理/
 * 只选高置信）/ 判定失败组（一键重判 · 强制捕捉/逃走）/ 无动作组（组头「✕ 一键清空」
 * = 整组批逃 noise）/ 已捕捉组、已逃走组（默认折叠；逃走留档 ↩恢复）。频道模式整列
 * 切 ChannelFeed（按会话聚拢，信号在前、已处理垫底）。键盘流（U9：仅插件页面聚焦
 * 域内）：J/K 移动、Esc 收起展开卡。
 */
import { useMemo, useState } from "react";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import { suggestionGroups } from "../model";
import { ESCAPE_REASON_CODES, type EscapeReasonCode, type RadioMessage } from "../rpc";
import ui from "../ui/ui.module.css";
import { ChannelFeed } from "./ChannelFeed";
import { SuggestionCard } from "./SuggestionCard";
import styles from "./radio.module.css";

/** 视图模式：⏱ 按状态分区 / 📡 按频道聚拢（组件 state，桌面 mode 同构） */
type ViewMode = "time" | "channel";

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

  // 电波搜索：前端过滤消息/会话/发送者（跨全部分组生效，清空恢复——桌面搜索同效）
  const filtered = useMemo(() => {
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
  }, [messages, query]);

  const groups = useMemo(() => suggestionGroups(filtered), [filtered]);

  function toggleSelect(messageId: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
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
        <ChannelFeed messages={filtered} readonly={readonly} onChanged={onChanged} />
      ) : (
        <>
          {/* 待处理组 */}
          {groups.pending.length > 0 && (
            <div>
              <h4 className={styles.feedGroupTitle}>
                {t("im.groupSignal")}
                <span className={styles.groupCount}>{groups.pending.length}</span>
              </h4>
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
              <div className={styles.batchBar} data-testid="batch-bar">
                <label className={styles.batchCheck}>
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label={t("im.selectAll")} />
                  {t("im.selectAll")}
                </label>
                <button
                  type="button"
                  className={ui.button}
                  disabled={readonly}
                  data-testid="hi-conf"
                  onClick={selectHighConfidence}
                >
                  {t("im.hiConf")}
                </button>
                <span>{t("dsh.batch.selected", { n: selected.size })}</span>
                <button
                  type="button"
                  className={ui.buttonPrimary}
                  disabled={readonly || batchBusy || selected.size === 0}
                  onClick={() => void runBatch("accept")}
                >
                  {t("dsh.batch.catchAll")}
                </button>
                <button
                  type="button"
                  className={ui.button}
                  disabled={readonly || batchBusy || selected.size === 0}
                  onClick={() => setBatchReason((v) => !v)}
                >
                  {t("dsh.batch.releaseAll")}
                </button>
                {selected.size > 0 && (
                  <button type="button" className={ui.button} onClick={() => setSelected(new Set())}>
                    {t("dsh.batch.clear")}
                  </button>
                )}
                {batchReason && (
                  <div className={styles.reasonMenu} role="menu">
                    {ESCAPE_REASON_CODES.map((code) => (
                      <button
                        key={code}
                        type="button"
                        role="menuitem"
                        onClick={() => void runBatch("dismiss", code)}
                        disabled={batchBusy}
                      >
                        {t(`im.escapeReasons.${code}`)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 判定失败组（中性命名 + 一键重判/强制） */}
          {groups.failed.length > 0 && (
            <FailedGroup messages={groups.failed} readonly={readonly} onChanged={onChanged} />
          )}

          {/* 无动作组（组头一键清空 = 整组确认为噪音；卡内可强制捕捉） */}
          {groups.none.length > 0 && (
            <div>
              <h4 className={styles.feedGroupTitle}>
                {t("im.groupNoise")}
                <span className={styles.groupCount}>{groups.none.length}</span>
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
              </h4>
              {groups.none.map((message) => (
                <SuggestionCard key={message.messageId} message={message} readonly={readonly} onChanged={onChanged} />
              ))}
            </div>
          )}

          <CaughtGroup messages={groups.caught} />
          <EscapedGroup messages={groups.escaped} readonly={readonly} onChanged={onChanged} />
        </>
      )}
    </div>
  );
}

/** 判定失败组：AI 判定失败 · N 条 + 一键重判（整组）/ 强制捕捉 / 强制逃走 */
export function FailedGroup({
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
  const [busy, setBusy] = useState(false);
  const [forceTarget, setForceTarget] = useState<RadioMessage | null>(null);
  return (
    <div data-testid="failed-group">
      <div className={styles.failedRow}>
        <h4 className={styles.feedGroupTitle}>{t("dsh.failed.group", { n: messages.length })}</h4>
        <button
          type="button"
          className={ui.button}
          disabled={readonly || busy}
          onClick={async () => {
            setBusy(true);
            await client.retryJudge({ messageIds: "all" });
            setBusy(false);
            onChanged();
          }}
        >
          {t("dsh.failed.retryAll")}
        </button>
        <button
          type="button"
          className={ui.button}
          disabled={readonly || messages.length !== 1}
          onClick={() => setForceTarget(messages[0])}
        >
          {t("dsh.failed.forceCapture")}
        </button>
        <button
          type="button"
          className={ui.button}
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
      </div>
      {messages.map((message) => (
        <div key={message.messageId} className={styles.failedCard}>
          <span className={styles.failedText}>{message.content}</span>
          <button
            type="button"
            className={ui.button}
            disabled={readonly}
            onClick={async () => {
              await client.retryJudge({ messageIds: [message.messageId] });
              onChanged();
            }}
          >
            {t("im.retry")}
          </button>
        </div>
      ))}
      {forceTarget !== null && (
        <div className={styles.reasonMenu} role="menu">
          {ESCAPE_REASON_CODES.map((code) => (
            <button
              key={code}
              type="button"
              role="menuitem"
              onClick={async () => {
                await client.forceDismiss({ messageId: forceTarget.messageId, reasonCode: code });
                setForceTarget(null);
                onChanged();
              }}
            >
              {t(`im.escapeReasons.${code}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 已捕捉组（默认折叠；命中任务号回执） */
function CaughtGroup({ messages }: { messages: RadioMessage[] }): React.JSX.Element | null {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (messages.length === 0) {
    return null;
  }
  return (
    <div>
      <button type="button" className={ui.button} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {t("im.groupCaught")} · {messages.length} {open ? t("im.collapse") : t("dsh.overdue.expand")}
      </button>
      {open &&
        messages.map((message) => (
          <div key={message.messageId} className={styles.archivedRow}>
            ✔ {message.content}
            {message.taskId !== null && <span>{t("im.caughtTask", { id: message.taskId })}</span>}
          </div>
        ))}
    </div>
  );
}

/** 已逃走组（默认折叠；↩恢复逃走留档项） */
function EscapedGroup({
  messages,
  readonly,
  onChanged,
}: {
  messages: RadioMessage[];
  readonly: boolean;
  onChanged: () => void;
}): React.JSX.Element | null {
  const t = useT();
  const client = useClient();
  const [open, setOpen] = useState(false);
  if (messages.length === 0) {
    return null;
  }
  return (
    <div>
      <button type="button" className={ui.button} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {t("im.groupEscaped")} · {messages.length} {open ? t("im.collapse") : t("dsh.overdue.expand")}
      </button>
      {open &&
        messages.map((message) => (
          <div key={message.messageId} className={styles.archivedRow}>
            ✕ {message.content}
            {message.dismissReason !== "" && <span>{t(`im.escapeReasons.${message.dismissReason}`)}</span>}
            <button
              type="button"
              className={ui.button}
              disabled={readonly}
              onClick={async () => {
                await client.reviewRestore({ messageId: message.messageId });
                onChanged();
              }}
            >
              ↩ {t("im.restore")}
            </button>
          </div>
        ))}
    </div>
  );
}
