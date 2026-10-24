/**
 * 诊断分区页（🩺，U19/U20/U30）：链路健康完整面板（飞书/判定两链路 × 三档聚合呈现
 * [状态点+文字非颜色冗余] / 上次成功 / 下次轮询 / 连续失败 / 最近错误；飞书含建议积压）
 * + 手动重试（即时动作）
 * + 系统能力矩阵（helper 六能力 + dsh-ssh 远程派发第七行 × 可用/降级；降级指引与
 * 运行时版本收敛为卡标题/行名悬浮气泡——说明文案不占常驻版面；U30）
 * + 全局快捷键注册状态行（失败才显示——成功即透明；U30/FR-A2）
 * + LogViewer 运行日志查看器（LCD 屏 = LcdScreen 单源组件——与向导输出屏同件两落位）。
 */
import { useEffect, useState } from "react";
import type { DiagnosticsLink, DiagnosticsSnapshotData, LogEntry } from "../../rpc";
import { HELPER_CAP_ROWS } from "../../rpc";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import { LcdScreen } from "../../ui/LcdScreen";
import { fmtLogTimeLocal } from "../../ui/dateTime";
import ui from "../../ui/ui.module.css";
import styles from "../settings.module.css";

/** 六态 status → 面板三档聚合（A23：诊断状态档位以主应用 health::level 六态为准，「三档」为面板呈现聚合） */
function aggregateLevel(status: DiagnosticsLink["status"]): "ok" | "warn" | "fail" {
  if (status === "ok" || status === "idle") {
    return "ok";
  }
  if (status === "degraded" || status === "paused") {
    return "warn";
  }
  return "fail";
}

function statusTextKey(status: DiagnosticsLink["status"]): string {
  return `diag.status.${status}`;
}

/** 下次轮询（host epoch 毫秒 → RFC3339 串，与 lastSuccessAt 同形直出；桌面 HealthCard fmtEpoch 同口径） */
function nextPollText(nextPollAt: number): string {
  return new Date(nextPollAt).toISOString();
}

/** 快捷键注册失败（null = 未知不显；false = 失败显示） */
function shortcutFailed(snapshot: DiagnosticsSnapshotData | null): boolean {
  return snapshot?.shortcutRegistered === false;
}

export function DiagnosticsSection(): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshotData | null>(null);

  function reload(): void {
    void client.diagnosticsSnapshot().then((result) => {
      if (result.ok) {
        setSnapshot(result.data);
      }
    });
  }
  useEffect(reload, [client]);

  const links = snapshot?.links ?? [];

  return (
    <section className={styles.sectionPage} data-testid="section-page">
      <div className={ui.card}>
        <h4 className={styles.cardTitle} data-tip={t("diag.healthHint")}>
          {t("diag.healthTitle")}
        </h4>
        {/* 健康行（桌面 HealthCard .health-row 同构）：点 + 名称 + 状态章 + 元信息伸缩 + 动作钮右缘 */}
        {links.map((link) => (
          <div key={link.provider} className={styles.healthItem} data-testid="diag-link">
            <div className={styles.healthRow}>
              <span className={styles.healthDot} data-level={aggregateLevel(link.status)} aria-hidden="true" />
              <span className={styles.healthName}>{t(`diag.provider.${link.provider}`)}</span>
              <span className={styles.healthState} data-level={aggregateLevel(link.status)}>
                {t(statusTextKey(link.status))}
              </span>
              <span className={styles.healthMeta}>
                {link.lastSuccessAt !== null ? t("diag.lastSuccess", { v: link.lastSuccessAt }) : t("diag.never")}
                {link.nextPollAt !== null && <> · {t("diag.nextPoll", { v: nextPollText(link.nextPollAt) })}</>}
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
      {/* 系统能力矩阵（U30：helper 六能力 + dsh-ssh 远程派发；与 HelperBanner 联动） */}
      <CapabilityMatrix snapshot={snapshot} />
      {/* 全局快捷键注册状态（U30/FR-A2：失败才显示——成功即透明） */}
      {shortcutFailed(snapshot) && (
        <p className={styles.shortcutLine} data-testid="shortcut-line">
          {t("dsh.diag.shortcutFailed")}
        </p>
      )}
      <LogViewer />
    </section>
  );
}

/** 能力矩阵行（可用/降级两态：行名气泡 = 降级时挂指引 tip；状态文案随 ok） */
function CapRow({
  ok,
  label,
  tip,
  testId,
}: {
  ok: boolean;
  label: string;
  tip?: string;
  testId?: string;
}): React.JSX.Element {
  const t = useT();
  return (
    <li className={styles.capRow} data-ok={ok} data-testid={testId}>
      <span className={styles.capDot} data-ok={ok} aria-hidden="true" />
      <span data-tip={ok ? undefined : tip}>{label}</span>
      <span className={styles.capState}>{t(ok ? "dsh.diag.caps.ok" : "dsh.diag.caps.degraded")}</span>
    </li>
  );
}

/** 卡标题气泡：helper 在位 = 运行时版本；缺席 = 手动放置指引（降级横幅已在页顶另行提示） */
function capsTitleTip(
  caps: Record<string, boolean> | null,
  helperVersion: string | null,
  t: ReturnType<typeof useT>,
): string | undefined {
  if (caps === null) return t("dsh.diag.caps.absent");
  return helperVersion != null ? t("dsh.diag.caps.version", { v: helperVersion }) : undefined;
}

/** 系统能力矩阵（helper 六能力 + dsh-ssh 远程派发第七行 × 可用/降级；helper 缺席 = 六能力全降级）。
 * 说明文案不占常驻版面：降级指引挂行名气泡、运行时版本/缺席指引挂卡标题气泡 */
function CapabilityMatrix({ snapshot }: { snapshot: DiagnosticsSnapshotData | null }): React.JSX.Element {
  const t = useT();
  const caps = snapshot?.helperCaps ?? null;
  const sshFamily = snapshot?.sshFamily ?? null;
  return (
    <div className={ui.card} data-testid="helper-caps">
      <h4 className={styles.cardTitle} data-tip={capsTitleTip(caps, snapshot?.helperVersion ?? null, t)}>
        {t("dsh.diag.capsTitle")}
      </h4>
      <ul className={styles.capList}>
        {HELPER_CAP_ROWS.map((row) => (
          <CapRow
            key={row.id}
            ok={caps?.[row.cap] === true}
            label={t(`dsh.diag.caps.${row.id}`)}
            tip={t("dsh.diag.caps.guide")}
          />
        ))}
        {/* dsh-ssh 家族（远程派发前置，FR-RD7）并入矩阵第七行：未装载 = 降级 + 行名气泡给装载
         * 指引；就绪 = 可用；未知（null）不显行——与六能力同款呈现 */}
        {sshFamily !== null && (
          <CapRow
            ok={sshFamily.ok}
            label={t("dsh.diag.caps.ssh")}
            tip={t("dsh.diag.sshMissing", { cmd: sshFamily.detail ?? "" })}
            testId="ssh-cap-row"
          />
        )}
      </ul>
    </div>
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
        /* LCD 日志屏（T2 ② 类目——LcdScreen 单源组件，与向导输出屏同件两落位） */
        <LcdScreen ariaLabel={t("diag.logTitle")} testId="log-screen">
          {entries.map((entry, index) => (
            <div key={`${entry.time}-${index}`} className={styles.logRow}>
              <div className={styles.logMeta}>
                <span className={styles.logTime}>{fmtLogTimeLocal(entry.time)}</span>
                <span className={styles.logLevel} data-level={entry.level}>
                  {entry.level}
                </span>
                <span className={styles.logTarget}>{entry.target}</span>
              </div>
              <div className={styles.logMsg}>{entry.message}</div>
            </div>
          ))}
        </LcdScreen>
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
