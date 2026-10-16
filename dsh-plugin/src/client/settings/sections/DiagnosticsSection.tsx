/**
 * 诊断分区页（🩺，U19/U20）：链路健康完整面板（飞书/判定两链路 × 三档聚合呈现
 * [状态点+文字非颜色冗余] / 上次成功 / 下次轮询 / 连续失败 / 最近错误；飞书含建议积压）
 * + 手动重试（即时动作）+ 支持报告一键复制（生成中… → 已复制，role=status）+
 * LogViewer 运行日志查看器（提前进 v1：级别/来源过滤、分页、最新在上、空态指向
 * ~/.choose-you/logs/）。
 */
import { useEffect, useState } from "react";
import type { DiagnosticsLink, LogEntry } from "../../rpc";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import ui from "../../ui/ui.module.css";
import styles from "../settings.module.css";

/** 六态 level → 面板三档聚合（A23：诊断状态档位以主应用 health::level 六态为准，「三档」为面板呈现聚合） */
function aggregateLevel(level: DiagnosticsLink["level"]): "ok" | "warn" | "fail" {
  if (level === "ok" || level === "idle") {
    return "ok";
  }
  if (level === "degraded" || level === "paused") {
    return "warn";
  }
  return "fail";
}

function levelTextKey(level: DiagnosticsLink["level"]): string {
  return `diag.status.${level}`;
}

export function DiagnosticsSection(): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [links, setLinks] = useState<DiagnosticsLink[]>([]);
  const [reportState, setReportState] = useState<"idle" | "working" | "copied">("idle");

  function reload(): void {
    void client.diagnosticsSnapshot().then((result) => {
      if (result.ok) {
        setLinks(result.data.links);
      }
    });
  }
  useEffect(reload, [client]);

  async function copyReport(): Promise<void> {
    setReportState("working");
    const result = await client.supportReport();
    if (result.ok) {
      await navigator.clipboard?.writeText(result.data.text).catch(() => undefined);
      setReportState("copied");
    } else {
      setReportState("idle");
    }
  }

  return (
    <section className={styles.sectionPage} data-testid="section-page">
      <div className={ui.card}>
        <h4 className={styles.cardTitle}>{t("diag.healthTitle")}</h4>
        <p className={styles.cardHint}>{t("diag.healthHint")}</p>
        {/* 健康行（桌面 HealthCard .health-row 同构）：点 + 名称 + 状态章 + 元信息伸缩 + 动作钮右缘 */}
        {links.map((link) => (
          <div key={link.provider} className={styles.healthItem} data-testid="diag-link">
            <div className={styles.healthRow}>
              <span className={styles.healthDot} data-level={aggregateLevel(link.level)} aria-hidden="true" />
              <span className={styles.healthName}>{t(`diag.provider.${link.provider}`)}</span>
              <span className={styles.healthState} data-level={aggregateLevel(link.level)}>
                {t(levelTextKey(link.level))}
              </span>
              <span className={styles.healthMeta}>
                {link.lastSuccessAt !== null ? t("diag.lastSuccess", { v: link.lastSuccessAt }) : t("diag.never")}
                {link.nextPollAt !== null && <> · {t("diag.nextPoll", { v: link.nextPollAt })}</>}
                {link.provider === "feishu" && <> · {t("diag.pending", { n: link.pendingCount })}</>}
                {link.primaryAgent !== null && <> · {t("diag.primaryAgent", { name: link.primaryAgent })}</>}
                {" · "}
                {t("dsh.radio.failCount", { n: link.consecutiveFailures })}
              </span>
              <button
                type="button"
                className={ui.button}
                onClick={async () => {
                  if (link.provider === "feishu") {
                    await client.pollNow();
                  } else {
                    await client.retryJudge({ messageIds: "all" });
                  }
                  reload();
                }}
              >
                {t("diag.pollNow")}
              </button>
            </div>
            {link.lastError !== null && <p className={styles.healthErr}>{link.lastError}</p>}
          </div>
        ))}
        {links.length === 0 && <p className={ui.muted}>{t("diag.never")}</p>}
      </div>
      <div className={ui.card}>
        <button
          type="button"
          className={ui.button}
          disabled={reportState === "working"}
          onClick={() => void copyReport()}
        >
          {reportState === "working"
            ? t("dsh.pokeSearch.searching")
            : reportState === "copied"
              ? t("diag.reportCopied")
              : t("diag.copyReport")}
        </button>
        {reportState === "copied" && (
          <span className={styles.savedHint} role="status">
            ✔
          </span>
        )}
      </div>
      <LogViewer />
    </section>
  );
}

/** 运行日志查看器（logQuery：级别/来源过滤、分页、最新在上、脱敏后文本） */
export function LogViewer(): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [minLevel, setMinLevel] = useState<string>("");
  const [target, setTarget] = useState("");
  const pageSize = 50;

  function load(nextOffset: number): void {
    void client
      .logQuery({
        minLevel: (minLevel === "" ? undefined : minLevel) as LogEntry["level"] | undefined,
        target: target === "" ? undefined : target,
        offset: nextOffset,
        limit: pageSize,
      })
      .then((result) => {
        if (result.ok) {
          setEntries(result.data.entries);
          setTotal(result.data.total);
        }
      });
  }
  useEffect(() => {
    load(0);
    // 过滤条件变化时重查（回首页）
  }, [minLevel, target, client]);

  const pageMax = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.floor(offset / pageSize) + 1;
  return (
    <div className={ui.card} data-testid="log-viewer">
      <h4 className={styles.cardTitle}>{t("diag.logTitle")}</h4>
      <div className={styles.filterRow}>
        <select
          className={ui.select}
          aria-label={t("diag.logLevel")}
          value={minLevel}
          onChange={(event) => setMinLevel(event.target.value)}
        >
          <option value="">{t("diag.allLevels")}</option>
          <option value="info">info+</option>
          <option value="warn">warn+</option>
          <option value="error">error</option>
        </select>
        <input
          className={`${ui.input} ${styles.grow}`}
          aria-label={t("diag.logSource")}
          placeholder={t("diag.logSource")}
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        />
        <button type="button" className={ui.button} onClick={() => load(offset)}>
          {t("diag.refresh")}
        </button>
      </div>
      {entries.length === 0 ? (
        <p className={ui.muted}>{t("diag.logEmpty")}</p>
      ) : (
        <div className={styles.logList}>
          {entries.map((entry, index) => (
            <div key={`${entry.time}-${index}`} className={styles.logRow}>
              <div className={styles.logMeta}>
                <span className={styles.logTime}>{entry.time}</span>
                <span className={styles.logLevel} data-level={entry.level}>
                  {entry.level}
                </span>
                <span className={styles.logTarget}>{entry.target}</span>
              </div>
              <div className={styles.logMsg}>{entry.message}</div>
            </div>
          ))}
        </div>
      )}
      <div className={styles.logPager}>
        <button
          type="button"
          className={ui.button}
          disabled={page <= 1}
          onClick={() => setOffset(Math.max(0, offset - pageSize))}
        >
          {t("sess.prev")}
        </button>
        <span>{t("sess.pageOf", { cur: page, max: pageMax })}</span>
        <button
          type="button"
          className={ui.button}
          disabled={page >= pageMax}
          onClick={() => setOffset(offset + pageSize)}
        >
          {t("sess.next")}
        </button>
      </div>
    </div>
  );
}
