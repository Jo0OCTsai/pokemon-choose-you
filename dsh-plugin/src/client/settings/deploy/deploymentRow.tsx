/**
 * 远程部署行条目（从 DeploymentCard.tsx 拆出——棘轮 max-lines，等量迁移）：别名
 * （等宽编号位）/ 远端三元组（截断 + title 全文）/ 状态徽章四呈现（就绪 ● /
 * 就绪（直连）● 琥珀点 / 未就绪 ● / 断开 ●；文字恒墨色仅状态点着色）+ 最近错误行
 * + 「直连模式」角标（D31 留痕）+ 操作（开通 · 编辑 · 移除；断开态给「重连并检查」）。
 */
import type { DeploymentEntity } from "../../rpc";
import { useT } from "../../i18n";
import ui from "../../ui/ui.module.css";
import styles from "./deploy.module.css";

/** 状态徽章呈现档（四呈现——tone → --pcy-deploy-* 语义别名） */
type BadgeTone = "ready" | "readyDirect" | "notReady" | "disconnected";

function badgeOf(entity: DeploymentEntity): { tone: BadgeTone; key: string } {
  if (entity.status === "ready") {
    return entity.degraded
      ? { tone: "readyDirect", key: "dsh.deploy.status.readyDirect" }
      : { tone: "ready", key: "dsh.deploy.status.ready" };
  }
  if (entity.status === "disconnected") {
    return { tone: "disconnected", key: "dsh.deploy.status.disconnected" };
  }
  return { tone: "notReady", key: "dsh.deploy.status.notReady" };
}

export function DeploymentRowItem({
  entity,
  wizardRunning,
  readonly,
  onReconnect,
  onProvision,
  onEdit,
  onRemove,
}: {
  entity: DeploymentEntity;
  wizardRunning: boolean;
  readonly: boolean;
  onReconnect: () => void;
  onProvision: () => void;
  onEdit: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const t = useT();
  const badge = badgeOf(entity);
  return (
    <li className={styles.row} data-testid="deploy-row">
      <div className={styles.rowMain}>
        <div className={styles.rowHead}>
          <span className={styles.alias} title={entity.alias}>
            {entity.alias}
          </span>
          <span className={styles.badge} data-tone={badge.tone}>
            <span className={styles.badgeDot} data-tone={badge.tone} aria-hidden="true" />
            {t(badge.key)}
          </span>
          {wizardRunning && (
            <span className={styles.badge} data-tone="running" data-testid="deploy-wizard-running">
              {t("dsh.deploy.wizardRunning")}
            </span>
          )}
          {entity.degraded && <span className={styles.directTag}>{t("dsh.deploy.directTag")}</span>}
        </div>
        <div
          className={styles.triple}
          title={`${entity.nodePath}\n${entity.workdir}${entity.note !== "" ? `\n${entity.note}` : ""}`}
        >
          <span className={styles.mono}>{entity.nodePath}</span>
          <span className={styles.mono}>{entity.workdir}</span>
          {entity.note !== "" && <span>{entity.note}</span>}
        </div>
        {entity.lastError !== null && (
          <p className={styles.lastError}>{t("dsh.deploy.lastError", { summary: entity.lastError })}</p>
        )}
      </div>
      <div className={styles.rowOps}>
        {entity.status === "disconnected" ? (
          <button
            type="button"
            className={ui.button}
            data-testid="deploy-reconnect"
            disabled={readonly}
            onClick={onReconnect}
          >
            {t("dsh.deploy.reconnect")}
          </button>
        ) : (
          entity.status !== "ready" && (
            <button
              type="button"
              className={ui.button}
              data-testid="deploy-provision"
              disabled={readonly}
              onClick={onProvision}
            >
              {t("dsh.deploy.provision")}
            </button>
          )
        )}
        <button type="button" className={ui.button} disabled={readonly} onClick={onEdit}>
          {t("dsh.deploy.edit")}
        </button>
        <button type="button" className={ui.button} disabled={readonly} onClick={onRemove}>
          {t("dsh.deploy.remove")}
        </button>
      </div>
    </li>
  );
}
