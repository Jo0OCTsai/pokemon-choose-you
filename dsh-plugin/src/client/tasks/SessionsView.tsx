/**
 * 日志分段（FR-C2 / U27）：会话账本的看图能力——
 * - SessionFilterBar：分组过滤胶囊四选（全部/收音机/派发/其他；M9 归组 host 侧完成，
 *   未知分组数据归「全部」），胶囊带分组计数；无命中空态「该分组暂无会话」。
 * - SessionPager：counts 汇总常显「共 N 条 · 第 p/总页 页」+ 上一页/下一页（翻页保留旧页
 *   不闪空——stale-while-revalidate）；每页条数 20/50/100（1–100 钳制在控件内）。
 * - 行内「回放」按钮（无 session_id 与 tmux 会话名的行不渲染）+ 执行世界徽章
 *   （本机 / 部署别名）；快照指向已移除部署 = 徽章删除线 + 回放中性提示。
 */
import { useEffect, useState } from "react";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import { isErrorCode, type DeploymentListResult, type SessionGroup, type SessionRow } from "../rpc";
import { EmptyState } from "./TaskList";
import styles from "./tasks.module.css";
import ui from "../ui/ui.module.css";

const GROUPS: readonly SessionGroup[] = ["all", "radio", "dispatch", "other"];

/** 每页条数档（limit 钳 1–100 默认 20——档位在控件内，杜绝越界值） */
const LIMIT_OPTIONS = [20, 50, 100] as const;

/** 回放可发起判定（session_id 或 tmux 会话名任一非空才有回放句柄） */
function replayable(row: SessionRow): boolean {
  return row.tmuxSession.trim() !== "" || (row.sessionId ?? "").trim() !== "";
}

/** 已移除部署判定：远端快照别名不在部署列表（拉 deploymentList 一次对照） */
function deploymentGone(alias: string, list: DeploymentListResult | null): boolean {
  if (alias === "" || list === null) {
    return false;
  }
  return !list.deployments.some((d) => d.alias === alias);
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
  const [deployments, setDeployments] = useState<DeploymentListResult | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // 部署列表对照（执行世界徽章删除线判定；拉一次，快照压过当前配置——列表变化由刷新广播重拉）
  useEffect(() => {
    void client.deploymentList().then((result) => {
      if (result.ok) {
        setDeployments(result.data);
      }
    });
  }, [client]);

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

  /** 行内回放：按落库执行世界快照路由（本机 → 终端面板；远端 → 部署唤起；已移除 → 中性提示） */
  async function replay(row: SessionRow): Promise<void> {
    setNote(null);
    const result = await client.sessionReplay({ rowId: row.id });
    if (result.ok) {
      const world = result.data.routed.world;
      setNote(
        world === "local"
          ? t("dsh.sess.replayOpened", { world: t("dsh.sess.worldLocal") })
          : t("dsh.sess.replayOpened", {
              world: t("dsh.sess.worldDeployment", { alias: world.deploymentAlias }),
            }),
      );
      return;
    }
    if (isErrorCode(result.error, "DEPLOYMENT_NOT_READY")) {
      setNote(t("dsh.sess.replayGone"));
      return;
    }
    setNote(`❌ ${result.error.message}`);
  }

  return (
    <section className={styles.segmentWrap} data-testid="segment-logs">
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
      {total === 0 && !loading ? (
        group === "all" ? (
          <EmptyState kind="dispatch" />
        ) : (
          <p className={styles.emptyState} data-testid="session-group-empty">
            {t("dsh.sess.emptyGroup")}
          </p>
        )
      ) : (
        rows.map((session) => {
          const gone = deploymentGone(session.remoteHost.trim(), deployments);
          return (
            <div key={session.id} className={styles.ledger} data-testid="session-row">
              <span className={styles.ledgerAgent}>{session.agentName || session.agentId}</span>
              <span>{kindLabel(t, session.kind)}</span>
              {session.remoteHost.trim() === "" ? (
                <span className={styles.worldBadge}>{t("dsh.sess.worldLocal")}</span>
              ) : (
                <span className={styles.worldBadge} data-gone={gone ? "true" : undefined} title={session.remoteHost}>
                  {session.remoteHost}
                </span>
              )}
              {session.durationMs !== null && <span>{Math.round(session.durationMs / 1000)}s</span>}
              {session.costUsd !== null && <span>${session.costUsd.toFixed(3)}</span>}
              {session.exitCode !== null && (
                <span className={styles.ledgerExit} data-ok={session.exitCode === 0}>
                  exit {session.exitCode}
                </span>
              )}
              {session.sessionId !== null && <span className={ui.muted}>{session.sessionId}</span>}
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
          );
        })
      )}
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
    </section>
  );
}
