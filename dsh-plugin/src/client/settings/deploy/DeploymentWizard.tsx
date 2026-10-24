/**
 * 开通向导 Modal（U24 · 四步条 × 四态 + LCD 输出屏 + D31 两分支降级确认）：
 * - WizardSteps：①免密探测 ②远端 Node ③helper 上传安装 ④摘要校验——每步
 *   等待/进行中/完成/失败/跳过（已完成）（文字状态优先，非仅 spinner）。
 * - WizardLog：LCD 输出屏（T2 ② 类目复用——LcdScreen 单源组件）追加日志行。
 * - StepFailure：失败步报告 + 步级指引（①ssh-copy-id / ②Node ≥18 / ③重试或「跳过安装，
 *   转直连」D31 第一分支 / ④摘要不符「转直连」D31 第二分支）。
 * - DegradeConfirm：D31 显式降级确认（风险 + 留痕声明）→ deploymentDegradeConfirm。
 * - 关闭语义（M8）：Esc/✕ = 向导后台继续（重开续看）；[中止] = 显式停止（部署停当前态，
 *   幂等续跑）。
 * 步进驱动 = provisionRun 单步同步 + provisionStatus 呈现（拉式，AD A34）。
 */
import { useState } from "react";
import type { DeploymentEntity, ProvisionStatus, ProvisionStep } from "../../rpc";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import { Modal, type ModalAction } from "../../ui/Modal";
import { LcdScreen } from "../../ui/LcdScreen";
import styles from "./deploy.module.css";

/** 四步固定序（呈现序 = 执行序，不可跳步；①—④ 丝印序号） */
const STEP_ORDER: readonly ProvisionStep[] = ["probe-ssh", "probe-node", "upload", "verify"];
const STEP_NUMBERS: readonly string[] = ["①", "②", "③", "④"];

/** 向导输出屏日志行 */
export interface WizardLogLine {
  step: ProvisionStep | "info";
  ok: boolean | null;
  text: string;
}

/** 步骤运行态标签键（§8：探测中…/安装中…/校验中…） */
function runningLabelKey(step: ProvisionStep): string {
  if (step === "upload") {
    return "dsh.deploy.wizard.state.installing";
  }
  if (step === "verify") {
    return "dsh.deploy.wizard.state.verifying";
  }
  return "dsh.deploy.wizard.state.probing";
}

/** 步骤显示态（跳过已完成 = 本轮开跑前已 ok 的步骤） */
export function stepDisplayState(
  step: ProvisionStep,
  status: ProvisionStatus | null,
  runningStep: ProvisionStep | null,
  preCompleted: ReadonlySet<ProvisionStep>,
): "pending" | "running" | "done" | "skipped" | "failed" {
  const view = status?.steps.find((s) => s.step === step);
  if (view === undefined || view.status === "pending") {
    return "pending";
  }
  if (view.status === "failed") {
    return "failed";
  }
  if (runningStep === step) {
    return "running";
  }
  return preCompleted.has(step) ? "skipped" : "done";
}

/** 按钮组（§8）：失败步出 [重试此步]；[中止] 为显式停止（执行中才有意义）；
 * [关闭] 恒在（与 Esc 同语义 = 后台继续，M8——不随执行态消失，readonly 只读也可关窗） */
function wizardActions(
  failedStep: ProvisionStep | null,
  t: (key: string) => string,
  onRetry: () => void,
  onAbort: () => void,
  onClose: () => void,
  readonly: boolean,
  running: boolean,
): ModalAction[] {
  const actions: ModalAction[] = [];
  if (failedStep !== null) {
    actions.push({ label: t("dsh.deploy.wizard.retry"), onChoose: onRetry, disabled: readonly });
  }
  actions.push({ label: t("dsh.deploy.wizard.abort"), onChoose: onAbort, disabled: readonly || !running });
  actions.push({ label: t("dsh.common.close"), onChoose: onClose });
  return actions;
}

/** 摘要复核步失败（D31 第二分支入口判定） */
function verifyStepFailed(status: ProvisionStatus | null): boolean {
  return status !== null && status.steps.find((s) => s.step === "verify")?.status === "failed";
}

/** 失败步详情文案（无详情 = null 不呈现） */
function failureDetail(status: ProvisionStatus | null, failedStep: ProvisionStep): string | null {
  return status?.steps.find((s) => s.step === failedStep)?.message ?? null;
}

/** 失败步报告（原因 + 步级指引 + D31 次级入口） */
function WizardFailure({
  status,
  failedStep,
  neverInstalled,
  onDegradeAsk,
}: {
  status: ProvisionStatus | null;
  failedStep: ProvisionStep;
  neverInstalled: boolean;
  onDegradeAsk: (kind: "skipInstall" | "mismatch") => void;
}): React.JSX.Element {
  const t = useT();
  const mismatch = verifyStepFailed(status);
  const detail = failureDetail(status, failedStep);
  return (
    <div className={styles.stepFailure} role="alert" data-testid="wizard-failure">
      <p className={styles.stepFailureText}>{t(`dsh.deploy.wizard.fail.${failedStep}`)}</p>
      {detail !== null && <p className={styles.stepFailureDetail}>{detail}</p>}
      {failedStep === "upload" && neverInstalled && (
        <button type="button" className={styles.degradeEntry} onClick={() => onDegradeAsk("skipInstall")}>
          {t("dsh.deploy.wizard.skipInstallEntry")}
        </button>
      )}
      {failedStep === "verify" && mismatch && (
        <button type="button" className={styles.degradeEntry} onClick={() => onDegradeAsk("mismatch")}>
          {t("dsh.deploy.wizard.mismatchEntry")}
        </button>
      )}
    </div>
  );
}

export function DeploymentWizard({
  entity,
  status,
  running,
  runningStep,
  log,
  preCompleted,
  readonly,
  onRetry,
  onAbort,
  onClose,
  onChanged,
}: {
  entity: DeploymentEntity;
  status: ProvisionStatus | null;
  running: boolean;
  /** 当前执行中的步骤（呈现「进行中」；null = 非执行期） */
  runningStep: ProvisionStep | null;
  log: WizardLogLine[];
  /** 本轮开跑前已完成的步骤集（重跑呈现「跳过（已完成）」） */
  preCompleted: ReadonlySet<ProvisionStep>;
  readonly: boolean;
  /** 步级重试（从失败步幂等续跑） */
  onRetry: () => void;
  /** 显式中止（部署停当前态，可幂等续跑） */
  onAbort: () => void;
  /** Esc/✕：向导后台继续（M8） */
  onClose: () => void;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [degradeAsk, setDegradeAsk] = useState<"skipInstall" | "mismatch" | null>(null);
  const [degradeBusy, setDegradeBusy] = useState(false);
  const failedStep = status?.failedStep ?? null;
  // D31 第一分支：步③失败且 helper 从未安装（helperPath 空）→「跳过安装，转直连」入口
  const neverInstalled = entity.helperPath.trim() === "";
  const actions = wizardActions(failedStep, t, onRetry, onAbort, onClose, readonly, running);

  async function confirmDegrade(): Promise<void> {
    if (degradeAsk === null) {
      return;
    }
    setDegradeBusy(true);
    const result = await client.deploymentDegradeConfirm({ id: entity.id, acknowledgedRisk: true });
    setDegradeBusy(false);
    if (result.ok) {
      setDegradeAsk(null);
      onChanged();
      onClose();
    }
  }

  return (
    <Modal
      title={`${t("dsh.deploy.wizard.title")} · ${entity.alias}`}
      ariaLabel={t("dsh.deploy.wizard.title")}
      actions={actions}
      onClose={onClose}
    >
      <div data-testid="deploy-wizard">
        {/* 并发重入 = 中性提示态（provisionRun 单步同步客户端驱动消解——纪要③） */}
        {running && (
          <p className={styles.wizardRunning} role="status">
            {t("dsh.deploy.wizard.concurrent")}
          </p>
        )}
        <ol className={styles.steps} data-testid="wizard-steps">
          {STEP_ORDER.map((step, index) => {
            const state = stepDisplayState(step, status, runningStep, preCompleted);
            return (
              <li key={step} className={styles.stepItem} data-state={state}>
                <span className={styles.stepDot} data-state={state} aria-hidden="true" />
                <span className={styles.stepName}>
                  {STEP_NUMBERS[index]} {t(`dsh.deploy.wizard.step.${step}`)}
                </span>
                <span className={styles.stepState}>
                  {state === "running" ? t(runningLabelKey(step)) : t(`dsh.deploy.wizard.state.${state}`)}
                </span>
              </li>
            );
          })}
        </ol>
        {/* 失败步报告（原因 + 步级指引 + D31 次级入口） */}
        {failedStep !== null && !running && (
          <WizardFailure
            status={status}
            failedStep={failedStep}
            neverInstalled={neverInstalled}
            onDegradeAsk={setDegradeAsk}
          />
        )}
        {/* 向导输出屏（LCD ② 类目复用） */}
        <LcdScreen ariaLabel={t("dsh.deploy.wizard.logTitle")} testId="wizard-log">
          {log.length === 0 ? (
            <span className={styles.logEmpty}>{t("dsh.deploy.wizard.logEmpty")}</span>
          ) : (
            log.map((line, index) => (
              <div key={index} className={styles.logLine} data-ok={line.ok === null ? undefined : String(line.ok)}>
                <span className={styles.logStep}>
                  {line.step === "info" ? "···" : t(`dsh.deploy.wizard.step.${line.step}`)}
                </span>
                <span className={styles.logText}>{line.text}</span>
              </div>
            ))
          )}
        </LcdScreen>
        <p className={styles.wizardCloseHint}>{t("dsh.deploy.wizard.closeHint")}</p>
        {degradeAsk !== null && (
          <Modal
            title={t("dsh.deploy.degrade.title")}
            ariaLabel={t("dsh.deploy.degrade.title")}
            actions={[
              { label: t("cancel"), onChoose: () => setDegradeAsk(null) },
              {
                label: t("dsh.deploy.degrade.confirm"),
                onChoose: () => void confirmDegrade(),
                variant: "danger",
                disabled: degradeBusy || readonly,
              },
            ]}
            onClose={() => setDegradeAsk(null)}
          >
            {t("dsh.deploy.degrade.body")}
          </Modal>
        )}
      </div>
    </Modal>
  );
}
