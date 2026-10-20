/**
 * pk 通道开通 · 触发与报告呈现（从 DeploymentCard.tsx 拆出——棘轮 max-lines/complexity，
 * 等量迁移；ADR-0003 §3）：runPkSetup 收口调用与结局分流（成功端口已写回实体 → 刷新；
 * RPC 失败信封进报告 alert）；PkReportModal 分步呈现（失败步标红——host 报告自带分步指引）。
 */
import type { DeploymentEntity, PkSetupReportView } from "../../rpc";
import type { HostClient } from "../../rpc";
import { useT } from "../../i18n";
import { Modal } from "../../ui/Modal";
import ui from "../../ui/ui.module.css";
import styles from "./deploy.module.css";

/** 开通报告呈现态（report = 命令成功面；errorText = RPC 失败信封——两者互斥） */
export interface PkReportState {
  alias: string;
  report: PkSetupReportView | null;
  errorText: string | null;
}

/** 触发开通并收口结局（busy 标记 + 报告呈现 + 成功刷新由调用方注入） */
export function runPkSetup(deps: {
  client: HostClient;
  entity: DeploymentEntity;
  onBusy: (id: string | null) => void;
  onReport: (state: PkReportState) => void;
  onReload: () => void;
  onChanged: () => void;
}): void {
  const { client, entity } = deps;
  deps.onBusy(entity.id);
  void client.deploymentSetupPk({ id: entity.id }).then((result) => {
    deps.onBusy(null);
    if (result.ok) {
      deps.onReport({ alias: entity.alias, report: result.data.report, errorText: null });
      deps.onReload();
      deps.onChanged();
    } else {
      const message =
        result.error.hint !== undefined ? `${result.error.message} — ${result.error.hint}` : result.error.message;
      deps.onReport({ alias: entity.alias, report: null, errorText: message });
    }
  });
}

export function PkReportModal({
  pkReport,
  onClose,
}: {
  pkReport: PkReportState;
  onClose: () => void;
}): React.JSX.Element {
  const t = useT();
  const title = t("dsh.deploy.pkReportTitle", { alias: pkReport.alias });
  return (
    <Modal
      title={title}
      ariaLabel={title}
      actions={[{ label: t("dsh.common.close"), onChoose: onClose }]}
      onClose={onClose}
    >
      {pkReport.errorText !== null ? (
        <p className={styles.lastError} role="alert" data-testid="deploy-pk-report-error">
          {pkReport.errorText}
        </p>
      ) : (
        pkReport.report !== null && (
          <div data-testid="deploy-pk-report">
            <p className={ui.muted}>
              {pkReport.report.ok ? t("dsh.deploy.pkReportOk") : t("dsh.deploy.pkReportFail")}
              {pkReport.report.version !== null ? ` · ${pkReport.report.version}` : ""}
            </p>
            <ul className={styles.pkSteps}>
              {pkReport.report.steps.map((step, i) => (
                <li key={`${step.name}-${i}`} data-status={step.status}>
                  <span className={styles.pkStepName}>{step.name}</span>
                  <span className={styles.pkStepDetail}>{step.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      )}
    </Modal>
  );
}
