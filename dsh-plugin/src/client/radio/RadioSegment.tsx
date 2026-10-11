/**
 * 收音机分段（UIUX §3.1）：HealthStrip（健康最小面 D13）+ AuthBanner（未授权/失效单次）
 * + SuggestionFeed（五分组：待处理/无动作/失败/已捕捉/已逃走——后两组默认折叠）+
 * CaptureBar（⚡发报，5 秒撤销）。纵向流 + 建议卡内联展开（U2）。
 */
import { useMemo, useState } from "react";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import { suggestionGroups, type PanelData } from "../model";
import { StatusDot } from "../ui/controls";
import ui from "../ui/ui.module.css";
import { AuthBanner } from "./AuthBanner";
import { CaptureBar } from "./CaptureBar";
import { SuggestionFeed } from "./SuggestionFeed";
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
        className={ui.button}
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
  const groups = useMemo(() => suggestionGroups(data.messages), [data.messages]);
  const empty = data.messages.length === 0 && data.health.pendingCount === 0;
  return (
    <section className={styles.radioSegment} data-testid="segment-radio">
      <HealthStrip health={data.health} readonly={readonly} onChanged={onChanged} />
      {!data.auth.authorized || data.auth.expired ? (
        <AuthBanner expired={data.auth.expired && data.auth.authorized} readonly={readonly} onChanged={onChanged} />
      ) : null}
      {empty ? (
        <div className={ui.muted}>{t("dsh.empty.radio")}</div>
      ) : (
        <SuggestionFeed groups={groups} readonly={readonly} onChanged={onChanged} />
      )}
      <CaptureBar readonly={readonly} onChanged={onChanged} />
      <p className={styles.kbdHint}>{t("dsh.radio.kbdHint")}</p>
    </section>
  );
}
