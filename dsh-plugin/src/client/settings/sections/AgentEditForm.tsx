/**
 * Agent 配置卡拆件 · 编辑态表单（从 AgentConfigCard 等量迁出，复杂度棘轮拆分）：
 * 首行名称+命令同行（桌面 agent-row）+ 128px 标签列字段行（附加参数/工作目录/历史
 * 参数/技能根目录/pk 技能状态行/超时——桌面 SettingRow label-width 128 同构）+
 * SSH 远程执行组（host/端口/私钥同行 + 反向隧道/常驻隧道）+ 绑定部署下拉（执行世界
 * 单源——2026-10-19 裁决：派发到绑定部署执行，空 = 本机）+ 保存/取消/测试动作行。
 * pk 技能行拆 AgentSkillRow.tsx（自持状态）；连接测试为即时动作。
 */
import { useEffect, useState } from "react";
import type { AgentConfig } from "../../../host/domain/settings";
import type { DeploymentEntity } from "../../../host/remote/deployments";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import { FormRow, Select, TextInput } from "../../ui/controls";
import ui from "../../ui/ui.module.css";
import styles from "../settings.module.css";
import { AgentSkillRow } from "./AgentSkillRow";
import { AgentSshGroup } from "./AgentSshGroup";

/** 编辑态表单（form 状态由父卡自持；保存/取消动作经回调上抛；冲突时出「仍要覆盖」
 *  force 重发钮——A24 确认覆盖出口，不再是只提示无出口的死胡同） */
export function AgentEditForm({
  agentId,
  form,
  setForm,
  busy,
  error,
  conflict,
  commandInvalid,
  onSave,
  onForceSave,
  onCancel,
}: {
  agentId: string;
  form: AgentConfig;
  setForm: React.Dispatch<React.SetStateAction<AgentConfig>>;
  busy: boolean;
  error: string | null;
  /** 修订检测冲突已提示（SETTING_MODIFIED_ELSEWHERE）→ 显示 force 重发钮 */
  conflict: boolean;
  commandInvalid: boolean;
  onSave: () => void;
  onForceSave: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  async function runTest(): Promise<void> {
    setTesting(true);
    setTestMsg(null);
    const result = await client.agentTest({ agentId });
    setTesting(false);
    setTestMsg(result.ok ? result.data.message : result.error.message);
  }
  return (
    <>
      {/* 首行：名称 + 命令同行（桌面 agent-row 同构——名称定宽、命令占满） */}
      <div className={styles.entityLine}>
        <TextInput
          className={styles.w120}
          ariaLabel={t("ai.namePh")}
          value={form.name}
          onChange={(name) => setForm({ ...form, name })}
          placeholder={t("ai.namePh")}
        />
        <TextInput
          className={styles.grow}
          ariaLabel={t("ai.cmdPh")}
          value={form.command}
          onChange={(command) => setForm({ ...form, command })}
          placeholder={t("ai.cmdPh")}
        />
      </div>
      <FormRow label={t("ai.args")} labelWidth={128} wide>
        <TextInput
          ariaLabel={t("ai.args")}
          value={form.args}
          onChange={(args) => setForm({ ...form, args })}
          placeholder={t("dsh.agents.argsPh")}
        />
      </FormRow>
      <FormRow label={t("ai.workdir")} labelWidth={128} wide>
        <TextInput
          ariaLabel={t("ai.workdir")}
          value={form.workdir}
          onChange={(workdir) => setForm({ ...form, workdir })}
          placeholder={t("ai.workdirPh")}
        />
      </FormRow>
      <FormRow label={t("ai.historyArgs")} labelWidth={128} wide>
        <TextInput
          ariaLabel={t("ai.historyArgs")}
          value={form.historyArgs}
          onChange={(historyArgs) => setForm({ ...form, historyArgs })}
          placeholder="--resume"
        />
      </FormRow>
      <FormRow label={t("ai.skillDir")} labelWidth={128} wide>
        <TextInput
          ariaLabel={t("ai.skillDir")}
          value={form.skillDir ?? ""}
          onChange={(skillDir) => setForm({ ...form, skillDir })}
          placeholder={t("ai.skillDirPh")}
        />
      </FormRow>
      <AgentSkillRow
        agentId={agentId}
        command={form.command}
        dir={form.skillDir ?? ""}
        commandInvalid={commandInvalid}
      />
      <FormRow label={t("ai.timeout")} labelWidth={128}>
        <TextInput
          ariaLabel={t("ai.timeout")}
          value={String(form.timeoutSecs)}
          onChange={(v) => setForm({ ...form, timeoutSecs: Number(v) || 0 })}
        />
      </FormRow>
      <AgentSshGroup form={form} setForm={setForm} />
      <AgentDeploymentRow form={form} setForm={setForm} />
      {commandInvalid && <span className={styles.saveFailHint}>{t("dsh.agents.commandRequired")}</span>}
      {error !== null && <span className={styles.saveFailHint}>{error}</span>}
      {conflict && (
        <button
          type="button"
          className={ui.button}
          disabled={busy}
          data-testid="agent-force-save"
          onClick={onForceSave}
        >
          {t("dsh.prompts.forceOverwriteConfirm")}
        </button>
      )}
      {testMsg !== null && (
        <p className={styles.cardHint} data-testid="agent-test-msg">
          {testMsg}
        </p>
      )}
      <div className={styles.cardActions}>
        <button type="button" className={ui.button} disabled={busy || commandInvalid} onClick={onSave}>
          {t("ai.save")}
        </button>
        <button type="button" className={ui.button} disabled={testing} onClick={() => void runTest()}>
          {testing ? t("testing") : t("ai.test")}
        </button>
        <button type="button" className={ui.button} onClick={onCancel}>
          {t("prompts.cancel")}
        </button>
      </div>
    </>
  );
}

/** 绑定部署下拉（执行世界单源——2026-10-19 裁决：派发到绑定部署执行，空 = 本机）。
 *  部署选项一次拉取（挂载期；失败静默不渲染行——promptSpecs 同款容错口径） */
function AgentDeploymentRow({
  form,
  setForm,
}: {
  form: AgentConfig;
  setForm: React.Dispatch<React.SetStateAction<AgentConfig>>;
}): React.JSX.Element | null {
  const t = useT();
  const client = useClient();
  const [deployments, setDeployments] = useState<DeploymentEntity[] | null>(null);
  useEffect(() => {
    void client.deploymentList().then((result) => {
      if (result.ok) {
        setDeployments(result.data.deployments);
      }
    });
  }, [client]);
  if (deployments === null) {
    return null;
  }
  return (
    <FormRow label={t("dsh.agents.deployment")} labelWidth={128}>
      <Select
        ariaLabel={t("dsh.agents.deployment")}
        value={form.deployment ?? ""}
        options={[
          { value: "", label: t("dsh.agents.deploymentNone") },
          ...deployments.map((d) => ({ value: d.alias, label: d.alias })),
        ]}
        onChange={(v) => setForm({ ...form, deployment: v === "" ? null : v })}
      />
    </FormRow>
  );
}
