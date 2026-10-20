/**
 * 远程部署行条目（从 DeploymentCard.tsx 拆出——棘轮 max-lines，等量迁移）：别名
 * （等宽编号位）/ 远端三元组（截断 + title 全文）/ 状态徽章四呈现（就绪 ● /
 * 就绪（直连）● 琥珀点 / 未就绪 ● / 断开 ●；文字恒墨色仅状态点着色）+ 最近错误行
 * + 「直连模式」角标（D31 留痕）+ 操作（开通 · 编辑 · 移除；断开态给「重连并检查」
 * ——busy 态文字换「检查中…」+ 复核结局行内呈现（仍断开 status / RPC 失败 alert）
 * + 常驻「重装远端组件」恢复链接（restart 重跑向导，helper 卸载死锁出口）
 * + 就绪态「开通 pk 通道」（ADR-0003：远端 agent CLI 判定的写回通道，busy 文字换态））。
 */
import type { DeploymentEntity } from "../../rpc";
import { useT } from "../../i18n";
import ui from "../../ui/ui.module.css";
import styles from "./deploy.module.css";

/** 状态徽章呈现档（四呈现——tone → --pcy-deploy-* 语义别名） */
type BadgeTone = "ready" | "readyDirect" | "notReady" | "disconnected";

/** 重连复核行内反馈（父级按行 id 匹配下发；done 仅在仍断开时呈现） */
export type RecheckFeedback = { phase: "busy" } | { phase: "down" } | { phase: "error"; text: string };

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

/** 状态相关主操作（断开 → 重连并检查（busy 文字换态）；未就绪 → 开通向导；就绪 → 开通 pk 通道（ADR-0003，busy 文字换态）） */
function RowPrimaryAction({
  entity,
  recheck,
  readonly,
  wizardRunning,
  pkSetupBusy,
  onReconnect,
  onProvision,
  onSetupPk,
}: {
  entity: DeploymentEntity;
  recheck: RecheckFeedback | null;
  readonly: boolean;
  wizardRunning: boolean;
  pkSetupBusy: boolean;
  onReconnect: () => void;
  onProvision: () => void;
  onSetupPk: () => void;
}): React.JSX.Element | null {
  const t = useT();
  if (entity.status === "disconnected") {
    const busy = recheck?.phase === "busy";
    return (
      <button
        type="button"
        className={ui.button}
        data-testid="deploy-reconnect"
        disabled={readonly || busy || wizardRunning}
        onClick={onReconnect}
      >
        {busy ? t("dsh.deploy.rechecking") : t("dsh.deploy.reconnect")}
      </button>
    );
  }
  if (entity.status !== "ready") {
    return (
      <button
        type="button"
        className={ui.button}
        data-testid="deploy-provision"
        disabled={readonly}
        onClick={onProvision}
      >
        {t("dsh.deploy.provision")}
      </button>
    );
  }
  return (
    <button
      type="button"
      className={ui.button}
      data-testid="deploy-setup-pk"
      disabled={readonly || pkSetupBusy || wizardRunning}
      onClick={onSetupPk}
    >
      {pkSetupBusy ? t("dsh.deploy.settingUpPk") : t("dsh.deploy.setupPk")}
    </button>
  );
}

/** 断开态反馈区：复核结局行（仍断开 status / RPC 失败 alert）+ 常驻「重装远端组件」恢复链接 */
function DisconnectedFeedback({
  recheck,
  readonly,
  wizardRunning,
  onReinstall,
}: {
  recheck: RecheckFeedback | null;
  readonly: boolean;
  wizardRunning: boolean;
  onReinstall: () => void;
}): React.JSX.Element {
  const t = useT();
  return (
    <>
      {recheck?.phase === "down" && (
        <p className={ui.muted} role="status" data-testid="deploy-recheck-note">
          {t("dsh.deploy.recheckStillDown")}
        </p>
      )}
      {recheck?.phase === "error" && (
        <p className={styles.lastError} role="alert" data-testid="deploy-recheck-error">
          {recheck.text}
        </p>
      )}
      <button
        type="button"
        className={styles.reinstallLink}
        data-testid="deploy-reinstall"
        disabled={readonly || wizardRunning}
        onClick={onReinstall}
      >
        {t("dsh.deploy.reinstall")}
      </button>
    </>
  );
}

export function DeploymentRowItem({
  entity,
  wizardRunning,
  readonly,
  recheck,
  pkSetupBusy,
  onReconnect,
  onReinstall,
  onProvision,
  onSetupPk,
  onEdit,
  onRemove,
}: {
  entity: DeploymentEntity;
  wizardRunning: boolean;
  readonly: boolean;
  recheck: RecheckFeedback | null;
  pkSetupBusy: boolean;
  onReconnect: () => void;
  onReinstall: () => void;
  onProvision: () => void;
  onSetupPk: () => void;
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
        {entity.status === "disconnected" && (
          <DisconnectedFeedback
            recheck={recheck}
            readonly={readonly}
            wizardRunning={wizardRunning}
            onReinstall={onReinstall}
          />
        )}
      </div>
      <div className={styles.rowOps}>
        <RowPrimaryAction
          entity={entity}
          recheck={recheck}
          readonly={readonly}
          wizardRunning={wizardRunning}
          pkSetupBusy={pkSetupBusy}
          onReconnect={onReconnect}
          onProvision={onProvision}
          onSetupPk={onSetupPk}
        />
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
