/**
 * 远程部署卡（U23 · 背包·Agent 分区挂载）：远端机器的「图鉴条目」总览与操作入口——
 * - DeploymentRow 列表：别名（等宽编号位）/ 远端三元组（截断 + title 全文）/ 状态徽章四呈现
 *   （就绪 ● / 就绪（直连）● 琥珀点 / 未就绪 ● / 断开 ●；文字恒墨色仅状态点着色）+ 最近错误行
 *   + 「直连模式」角标（D31 留痕）+ 操作（开通 · 编辑 · 移除；断开态给「重连并检查」）。
 * - 「＋ 添加部署」→ DeployFormModal（新增保存后自动进向导——草稿→探测中）。
 * - 开通向导：provisionRun 单步同步 + provisionStatus 呈现（拉式步进）；Esc/✕ 关闭 =
 *   后台继续（卡面「向导执行中」中性徽章反映，M8）；[中止] 显式停止（幂等续跑）。
 * - SSH 家族缺失 → 整卡指引态（装载指引 + 复制指引按钮；添加入口并入指引态——无死入口）。
 * - 移除确认：关连接 + 远端 helper 托管自清理尽力说明（失败不阻塞）。
 * 只读模式：增删改与开通/中止/降级确认置灰（列表浏览与表单打开允许——§4.2 M7）。
 */
import { useCallback, useEffect, useState } from "react";
import type { DeploymentEntity, DeploymentListResult, SshFamilyView } from "../../rpc";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import { Modal } from "../../ui/Modal";
import ui from "../../ui/ui.module.css";
import cardStyles from "../settings.module.css";
import { DeployFormModal } from "./DeployFormModal";
import { DeploymentWizard } from "./DeploymentWizard";
import { useWizardRunner } from "./deploymentWizardRun";
import { DeploymentRowItem } from "./deploymentRow";
import styles from "./deploy.module.css";
import type { WizardState } from "./deploymentWizardRun";

/** SSH 家族缺失（整卡指引态判定；类型守卫收窄 null 态） */
function isSshMissing(sshFamily: SshFamilyView | null): sshFamily is SshFamilyView {
  return sshFamily !== null && !sshFamily.ok;
}

/** 指引命令正文（缺失详情缺省空串——插值与复制共用） */
function sshGuideCmd(detail: string | null | undefined): string {
  return detail ?? "";
}

/** 列表已加载（计数行呈现判定） */
function hasLoaded(list: DeploymentListResult | null): list is DeploymentListResult {
  return list !== null;
}

/** 向导挂靠实体（wizard null 安全查找） */
function wizardEntityOf(wizard: WizardState | null, list: DeploymentListResult | null): DeploymentEntity | undefined {
  return wizard !== null ? deploymentsOf(list).find((d) => d.id === wizard.id) : undefined;
}

/** 空列表态（有数据且零部署——添加入口独立呈现） */
function isEmptyList(list: DeploymentListResult | null): boolean {
  return list !== null && list.deployments.length === 0;
}

/** 列表行源（null 安全——未加载 = 空行） */
function deploymentsOf(list: DeploymentListResult | null): DeploymentEntity[] {
  return list?.deployments ?? [];
}

/** 向导开且实体在位（Modal 呈现面联合判定；类型守卫收窄 wizard 的 null 态） */
function wizardModalOpen(wizard: WizardState | null, entity: DeploymentEntity | undefined): wizard is WizardState {
  return wizard !== null && wizard.open && entity !== undefined;
}

export function DeploymentCard({ onChanged }: { onChanged: () => void }): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [list, setList] = useState<DeploymentListResult | null>(null);
  const [sshFamily, setSshFamily] = useState<SshFamilyView | null>(null);
  const [readonly, setReadonly] = useState(false);
  const [form, setForm] = useState<{ entity?: DeploymentEntity } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<DeploymentEntity | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [saveHint, setSaveHint] = useState("");

  const reload = useCallback(() => {
    void client.deploymentList().then((result) => {
      if (result.ok) {
        setList(result.data);
      }
    });
  }, [client]);

  const { wizard, runWizard, abortRef, setWizard } = useWizardRunner({ client, reload, onChanged });

  useEffect(() => {
    reload();
    void client.dbStatus().then((result) => {
      if (result.ok) {
        setReadonly(result.data.mode === "ro");
      }
    });
    void client.diagnosticsSnapshot().then((result) => {
      if (result.ok) {
        setSshFamily(result.data.sshFamily ?? null);
      }
    });
  }, [reload, client]);

  const wizardEntity = wizardEntityOf(wizard, list);

  return (
    <div className={ui.card} data-testid="deploy-card">
      <h4 className={cardStyles.cardTitle} data-testid="deploy-card-title">
        {t("dsh.deploy.title")}
      </h4>
      {hasLoaded(list) && (
        <p className={styles.counts}>
          {t("dsh.deploy.counts", {
            ready: list.counts.ready,
            pending: list.counts.pending,
            broken: list.counts.broken,
          })}
        </p>
      )}
      {isSshMissing(sshFamily) ? (
        // SSH 家族缺失：整卡指引态（添加入口并入指引态——无死入口）
        <div className={styles.sshGuide} data-testid="deploy-ssh-guide">
          <p>{t("dsh.deploy.sshMissing", { cmd: sshGuideCmd(sshFamily.detail) })}</p>
          <button
            type="button"
            className={ui.button}
            onClick={() => {
              void navigator.clipboard?.writeText(sshGuideCmd(sshFamily.detail)).catch(() => undefined);
            }}
          >
            {t("dsh.deploy.copyGuide")}
          </button>
        </div>
      ) : isEmptyList(list) ? (
        <div className={styles.empty}>
          <p className={styles.emptyText}>{t("dsh.deploy.empty")}</p>
          <button
            type="button"
            className={ui.buttonDex}
            data-testid="deploy-add"
            disabled={readonly}
            onClick={() => setForm({})}
          >
            {t("dsh.deploy.add")}
          </button>
        </div>
      ) : (
        <>
          <ul className={styles.rowList}>
            {deploymentsOf(list).map((entity) => (
              <DeploymentRowItem
                key={entity.id}
                entity={entity}
                wizardRunning={wizard !== null && wizard.id === entity.id && wizard.running}
                readonly={readonly}
                onReconnect={() => {
                  void client.deploymentRecheck({ id: entity.id }).then(() => reload());
                }}
                onProvision={() => void runWizard(entity.id)}
                onEdit={() => setForm({ entity })}
                onRemove={() => setRemoveTarget(entity)}
              />
            ))}
          </ul>
          <div className={styles.addRow}>
            <button
              type="button"
              className={ui.button}
              data-testid="deploy-add"
              disabled={readonly}
              onClick={() => setForm({})}
            >
              {t("dsh.deploy.add")}
            </button>
            {saveHint !== "" && (
              <span className={ui.muted} role="status" data-testid="deploy-save-hint">
                {saveHint}
              </span>
            )}
          </div>
        </>
      )}
      {form !== null && (
        <DeployFormModal
          entity={form.entity}
          readonly={readonly}
          onClose={() => setForm(null)}
          onSaved={(deployment, created) => {
            reload();
            onChanged();
            if (created) {
              // 新增保存后自动进向导（草稿 → 探测中，与状态机一致）
              void runWizard(deployment.id);
            } else {
              setSaveHint(t("dsh.deploy.editFallback"));
            }
          }}
        />
      )}
      {removeTarget !== null && (
        <Modal
          title={t("dsh.deploy.removeTitle")}
          ariaLabel={t("dsh.deploy.removeTitle")}
          actions={[
            { label: t("cancel"), onChoose: () => setRemoveTarget(null) },
            {
              label: t("dsh.deploy.removeConfirm"),
              onChoose: () => {
                setRemoveBusy(true);
                void client.deploymentDelete({ id: removeTarget.id }).then((result) => {
                  setRemoveBusy(false);
                  if (result.ok) {
                    setRemoveTarget(null);
                    reload();
                    onChanged();
                  }
                });
              },
              variant: "danger",
              disabled: removeBusy || readonly,
            },
          ]}
          onClose={() => setRemoveTarget(null)}
        >
          {t("dsh.deploy.removeBody", { alias: removeTarget.alias })}
        </Modal>
      )}
      {wizardModalOpen(wizard, wizardEntity) && wizardEntity !== undefined && (
        <DeploymentWizard
          entity={wizardEntity}
          status={wizard.status}
          running={wizard.running}
          runningStep={wizard.runningStep}
          log={wizard.log}
          preCompleted={wizard.preCompleted}
          readonly={readonly}
          onRetry={() => void runWizard(wizard.id)}
          onAbort={() => {
            abortRef.current = true;
          }}
          onClose={() => setWizard((prev) => (prev !== null ? { ...prev, open: false } : prev))}
          onChanged={() => {
            reload();
            onChanged();
          }}
        />
      )}
    </div>
  );
}
