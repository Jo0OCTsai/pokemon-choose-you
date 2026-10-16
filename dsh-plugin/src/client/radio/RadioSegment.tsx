/**
 * 收音机分段（桌面 RadioTab 同构双栏）：HealthStrip（健康最小面 D13）+ AuthBanner
 * （未授权/失效单次）+ 主区两栏（左 = SuggestionFeed 列表/批量条；右 = MessageDetail
 * 选中详情与固定操作行）+ CaptureBar（⚡发报，5 秒撤销）。选中前进：分诊动作完成后
 * 跳到待处理池下一条（信号优先，桌面 advanceFrom 同构）；键盘流（U9：仅插件页面聚焦
 * 域内）：J/K·方向键 移动、C 捕捉/应用更新、X 逃走、F 强制。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import { suggestionGroups } from "../model";
import type { PanelData } from "../model";
import { StatusDot } from "../ui/controls";
import { AuthBanner } from "./AuthBanner";
import { CaptureBar } from "./CaptureBar";
import { MessageDetail } from "./MessageDetail";
import { SuggestionFeed } from "./SuggestionFeed";
import { useRadioKeyboard } from "./useRadioKeyboard";
import styles from "./radio.module.css";

function timeOf(iso: string | null): string {
  return iso === null ? "" : iso.slice(11, 16);
}

/** 健康条：上次成功 · 下次轮询 · 失败计数 · 积压 · ⚡立即拉取（状态点 + 文字状态非颜色冗余） */
export function HealthStrip({
  health,
  readonly,
  onChanged,
}: {
  health: PanelData["health"];
  readonly: boolean;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [busy, setBusy] = useState(false);
  const stateText =
    health.level === "ok"
      ? t("diag.status.ok")
      : health.level === "warn"
        ? t("dsh.radio.stateWarn")
        : t("dsh.radio.stateFail");
  return (
    <div className={styles.healthStrip} data-testid="health-strip">
      <StatusDot level={health.level} text={stateText} />
      <span className={styles.healthItem}>
        {t("diag.lastSuccess", { v: timeOf(health.lastSuccessAt) || t("diag.never") })}
      </span>
      <span className={styles.healthItem}>{t("diag.nextPoll", { v: timeOf(health.nextPollAt) })}</span>
      <span className={styles.healthItem}>{t("dsh.radio.failCount", { n: health.consecutiveFailures })}</span>
      <button
        type="button"
        className={styles.pollNow}
        disabled={readonly || busy}
        onClick={async () => {
          setBusy(true);
          await client.pollNow();
          setBusy(false);
          onChanged();
        }}
      >
        ⚡ {t("diag.pollNow")}
      </button>
    </div>
  );
}

/** 收音机分段壳 */
export function RadioSegment({
  data,
  readonly,
  onChanged,
}: {
  data: PanelData;
  readonly: boolean;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const empty = data.messages.length === 0 && data.health.pendingCount === 0;
  /** 选中电波（右栏详情跟随；null = 未选中空态） */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 新标签提议接受态（接受发生在建议被捕捉时——原 SuggestionCard 卡内态上提） */
  const [acceptedTags, setAcceptedTags] = useState<Set<string>>(new Set());

  const groups = useMemo(() => suggestionGroups(data.messages), [data.messages]);
  /** 键盘/前进池：待处理信号 + 失败 + 无信号（桌面 [signal, noise] 池同构） */
  const pool = useMemo(() => [...groups.pending, ...groups.failed, ...groups.none], [groups]);
  const selectedMessage = useMemo(
    () => data.messages.find((m) => m.messageId === selectedId) ?? null,
    [data.messages, selectedId],
  );

  // 选中同步：选中项从消息面消失（刷新删除/搜索过滤）时回落池首；归档行选中保持
  // （回看留档时右栏详情不丢——桌面 syncSelection 同语义：id 仍在列表即不重选）
  useEffect(() => {
    if (selectedId !== null && data.messages.some((m) => m.messageId === selectedId)) {
      return;
    }
    setSelectedId(pool[0]?.messageId ?? null);
  }, [selectedId, data.messages, pool]);

  /** 分诊动作完成：跳到池中下一条再刷新（桌面 advanceFrom 同构；批量刷新走回落同步） */
  const onDetailAction = useCallback(() => {
    const index = pool.findIndex((m) => m.messageId === selectedId);
    if (index >= 0) {
      const next = pool[index + 1] ?? pool[index - 1] ?? null;
      setSelectedId(next?.messageId ?? null);
    }
    onChanged();
  }, [pool, selectedId, onChanged]);

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

  const onKeyDown = useRadioKeyboard({
    client,
    pool,
    selectedId,
    selectedMessage,
    setSelectedId,
    onActioned: onDetailAction,
  });

  return (
    <section className={styles.radioSegment} data-testid="segment-radio" onKeyDown={onKeyDown}>
      <HealthStrip health={data.health} readonly={readonly} onChanged={onChanged} />
      {!data.auth.authorized || data.auth.expired ? (
        <AuthBanner expired={data.auth.expired && data.auth.authorized} readonly={readonly} onChanged={onChanged} />
      ) : null}
      {empty ? (
        <div className={styles.radioEmpty}>{t("dsh.empty.radio")}</div>
      ) : (
        <div className={styles.radioMain}>
          <SuggestionFeed
            messages={data.messages}
            readonly={readonly}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChanged={onChanged}
          />
          <MessageDetail
            message={selectedMessage}
            acceptedTags={acceptedTags}
            onToggleTag={toggleTag}
            readonly={readonly}
            onChanged={onDetailAction}
          />
        </div>
      )}
      <CaptureBar readonly={readonly} onChanged={onChanged} />
      <p className={styles.kbdHint}>{t("dsh.radio.kbdHint")}</p>
    </section>
  );
}
