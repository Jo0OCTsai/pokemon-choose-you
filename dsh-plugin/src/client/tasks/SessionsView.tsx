/**
 * 日志分段（FR-C2 / U27）：会话账本的看图能力——
 * - SessionFilterBar：分组过滤胶囊四选（全部/收音机/派发/其他；M9 归组 host 侧完成，
 *   未知分组数据归「全部」），胶囊带分组计数；无命中空态「该分组暂无会话」。
 * - SessionPager：counts 汇总常显「共 N 条 · 第 p/总页 页」+ 上一页/下一页（翻页保留旧页
 *   不闪空——stale-while-revalidate）；每页条数 20/50/100（1–100 钳制在控件内）。
 * - 行内「回放」按钮（无 session_id 与 tmux 会话名的行不渲染）+ 执行世界徽章
 *   （本机 / 部署别名）+ 右对齐等宽时间（createdAt RFC3339 → 本地时区同形，诊断
 *   日志 fmtLogTimeLocal 同源）；已移除部署 = 回放时中性提示（host 侧判定）。本机回放
 *   handoff（宿主无第三方终端面板）：命令行复制到剪贴板（不可用 → 手动复制提示），
 *   命令行与工作目录常显可选中复制——零静默。
 */
import { useEffect, useState } from "react";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import { isErrorCode, displaySessionId, type SessionGroup, type SessionRow } from "../rpc";
import { EmptyState } from "./TaskList";
import { copyText, HandoffLine } from "./handoff";
import { fmtLogTimeLocal } from "../ui/dateTime";
import styles from "./tasks.module.css";
import ui from "../ui/ui.module.css";

const GROUPS: readonly SessionGroup[] = ["all", "radio", "dispatch", "other"];

/** 每页条数档（limit 钳 1–100 默认 20——档位在控件内，杜绝越界值） */
const LIMIT_OPTIONS = [20, 50, 100] as const;

/** 回放可发起判定（与 domain sessionReplayable 同口径：session_id 或 tmux 会话名任一非空） */
function replayable(row: SessionRow): boolean {
  return row.tmuxSession.trim() !== "" || (row.sessionId ?? "").trim() !== "";
}

/** 世界徽章显示名：host + 非默认端口（快照端口独立列——target 串自带冒号不重复拼） */
function worldLabelOf(row: SessionRow): string {
  const host = row.remoteHost.trim();
  if (host === "" || host.includes(":") || (row.remotePort !== 0 && row.remotePort !== 22)) {
    return host === "" || host.includes(":") ? host : `${host}:${row.remotePort}`;
  }
  return host;
}

/** 会话来源标签（既有键翻译；未知 kind 回落原值——legacy/新增来源） */
function kindLabel(t: ReturnType<typeof useT>, kind: string): string {
  const key = `sess.kind.${kind}`;
  const label = t(key);
  return label === key ? kind : label;
}

export function LogSegment({ readonly }: { readonly: boolean }): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [group, setGroup] = useState<SessionGroup>("all");
  const [limit, setLimit] = useState<number>(20);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<{ rows: SessionRow[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  // 本机回放 handoff 载荷（命令行 + 工作目录——宿主无第三方终端面板，复制执行）
  const [replayLine, setReplayLine] = useState<string | null>(null);
  const [replayDir, setReplayDir] = useState<string>("");

  // 分组/翻页/条数变化即重查（旧页保留到新页到达——不闪空）
  useEffect(() => {
    let alive = true;
    setLoading(true);
    void client
      .sessionsPage({ group, limit, offset })
      .then((result) => {
        if (!alive) {
          return;
        }
        if (result.ok) {
          setPage({ rows: result.data.rows, total: result.data.total });
        } else {
          setPage((prev) => prev ?? { rows: [], total: 0 });
        }
      })
      .finally(() => {
        if (alive) {
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [client, group, limit, offset]);

  const rows = page?.rows ?? [];
  const total = page?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / limit));
  const current = Math.min(pages, Math.floor(offset / limit) + 1);

  /**
   * 行内回放：按落库执行世界快照路由——本机 handoff（宿主无第三方可驱动的终端面板）
   * → 命令行复制到剪贴板（失败走手动复制提示）；注入形态 → 终端面板已打开；已移除
   * 部署 → 中性提示。
   */
  async function replay(row: SessionRow): Promise<void> {
    setNote(null);
    setReplayLine(null);
    setReplayDir("");
    const result = await client.sessionReplay({ rowId: row.id });
    if (result.ok) {
      const world = result.data.routed.world;
      const worldLabel =
        world === "local"
          ? t("dsh.sess.worldLocal")
          : "sshTarget" in world
            ? t("dsh.sess.worldSsh", { target: world.sshTarget })
            : t("dsh.sess.worldDeployment", { alias: world.deploymentAlias });
      if (world === "local" && result.data.routed.opened === false && result.data.routed.line !== undefined) {
        setReplayLine(result.data.routed.line);
        setReplayDir(result.data.routed.workdir ?? "");
        const copied = await copyText(result.data.routed.line);
        setNote(
          copied
            ? t("dsh.sess.replayCopied", { world: worldLabel })
            : t("dsh.sess.replayManual", { world: worldLabel }),
        );
        return;
      }
      setNote(t("dsh.sess.replayOpened", { world: worldLabel }));
      return;
    }
    if (isErrorCode(result.error, "DEPLOYMENT_NOT_READY")) {
      setNote(t("dsh.sess.replayGone"));
      return;
    }
    setNote(`❌ ${result.error.message}`);
  }

  return (
    <section className={`${styles.segmentWrap} ${styles.logSegment}`} data-testid="segment-logs">
      <div className={styles.dexFilters} role="group" aria-label={t("sess.filter_all")}>
        {GROUPS.map((key) => (
          <button
            key={key}
            type="button"
            className={styles.filterButton}
            aria-pressed={group === key}
            onClick={() => {
              setGroup(key);
              setOffset(0);
            }}
          >
            {t(`dsh.sess.group.${key}`)}
          </button>
        ))}
      </div>
      {/* 记录列表占满剩余高内滚（填充形态 segmentFill 定高，收音机 listBox 同构口径）：
       * 过滤行/分页器常驻可视，翻页/长列表不出页面滚动条 */}
      <div className={styles.sessListBox} data-testid="session-list">
        {total === 0 && !loading ? (
          group === "all" ? (
            <EmptyState kind="dispatch" />
          ) : (
            <p className={styles.emptyState} data-testid="session-group-empty">
              {t("dsh.sess.emptyGroup")}
            </p>
          )
        ) : (
          rows.map((session) => (
            <div key={session.id} className={styles.ledger} data-testid="session-row">
              <span className={styles.ledgerAgent}>{session.agentName || session.agentId}</span>
              <span>{kindLabel(t, session.kind)}</span>
              {session.remoteHost.trim() === "" ? (
                <span className={styles.worldBadge}>{t("dsh.sess.worldLocal")}</span>
              ) : (
                <span className={styles.worldBadge} title={session.remoteHost}>
                  {worldLabelOf(session)}
                </span>
              )}
              {session.durationMs !== null && <span>{Math.round(session.durationMs / 1000)}s</span>}
              {session.costUsd !== null && <span>${session.costUsd.toFixed(3)}</span>}
              {session.exitCode !== null && (
                <span className={styles.ledgerExit} data-ok={session.exitCode === 0}>
                  exit {session.exitCode}
                </span>
              )}
              {displaySessionId(session.sessionId) !== null && (
                <span className={ui.muted}>{displaySessionId(session.sessionId)}</span>
              )}
              <span className={styles.ledgerTime}>{fmtLogTimeLocal(session.createdAt)}</span>
              {replayable(session) && (
                <button
                  type="button"
                  className={ui.button}
                  data-testid="session-replay"
                  disabled={readonly}
                  onClick={() => void replay(session)}
                >
                  {t("dsh.sess.replay")}
                </button>
              )}
            </div>
          ))
        )}
      </div>
      {/* counts 汇总常显（不随翻页变化）+ 分页器（首页/末页置灰；命中区 ≥32px） */}
      <div className={styles.sessPager} data-testid="session-pager">
        <span className={styles.sessCounts}>{t("dsh.sess.counts", { n: total, page: current, pages })}</span>
        <button
          type="button"
          className={ui.button}
          disabled={current <= 1}
          onClick={() => setOffset(Math.max(0, offset - limit))}
        >
          {t("sess.prev")}
        </button>
        <button
          type="button"
          className={ui.button}
          disabled={current >= pages}
          onClick={() => setOffset(offset + limit)}
        >
          {t("sess.next")}
        </button>
        <select
          className={ui.select}
          aria-label={t("dsh.sess.limitLabel")}
          value={String(limit)}
          onChange={(event) => {
            setLimit(Number(event.target.value));
            setOffset(0);
          }}
        >
          {LIMIT_OPTIONS.map((n) => (
            <option key={n} value={String(n)}>
              {t("dsh.sess.limitN", { n })}
            </option>
          ))}
        </select>
      </div>
      {note !== null && (
        <p className={styles.sessNote} role="status" data-testid="session-note">
          {note}
        </p>
      )}
      {replayLine !== null && <ReplayHandoff line={replayLine} dir={replayDir} />}
    </section>
  );
}

/** 回放 handoff 命令行 + 工作目录标注（共享 HandoffLine 的会话段封装） */
function ReplayHandoff({ line, dir }: { line: string; dir: string }): React.JSX.Element {
  const t = useT();
  return (
    <HandoffLine
      line={line}
      aside={dir === "" ? undefined : t("dsh.sess.replayDir", { dir })}
      testId="session-replay-line"
    />
  );
}
