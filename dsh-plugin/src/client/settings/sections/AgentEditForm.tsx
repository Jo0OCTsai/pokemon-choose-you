/**
 * Agent 配置卡拆件 · 编辑态表单（从 AgentConfigCard 等量迁出，复杂度棘轮拆分）：
 * 首行名称+命令同行（桌面 agent-row）+ 128px 标签列字段行（附加参数/工作目录/历史
 * 参数/技能根目录/超时——桌面 SettingRow label-width 128 同构）+ SSH 远程执行组
 * （host/端口/私钥同行 + 反向隧道/常驻隧道）+ 保存/取消动作行。
 */
import type { AgentConfig, AgentRemote } from "../../../host/domain/settings";
import { useT } from "../../i18n";
import { FormRow, TextInput, Toggle } from "../../ui/controls";
import ui from "../../ui/ui.module.css";
import styles from "../settings.module.css";

/** 编辑态表单（form 状态由父卡自持；保存/取消动作经回调上抛） */
export function AgentEditForm({
  form,
  setForm,
  busy,
  error,
  commandInvalid,
  onSave,
  onCancel,
}: {
  form: AgentConfig;
  setForm: React.Dispatch<React.SetStateAction<AgentConfig>>;
  busy: boolean;
  error: string | null;
  commandInvalid: boolean;
  onSave: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const t = useT();
  /** 开 SSH 给默认值（端口 22）；关清空 remote（主应用 toggleRemote 同口径） */
  function toggleRemote(on: boolean): void {
    setForm({ ...form, remote: on ? { host: "", port: 22, keyPath: "", tunnel: null, persistent: false } : null });
  }
  /** SSH 子字段局部改（remote 未开时忽略） */
  function patchRemote(patch: Partial<AgentRemote>): void {
    if (form.remote === undefined || form.remote === null) {
      return;
    }
    setForm({ ...form, remote: { ...form.remote, ...patch } });
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
      <FormRow label={t("ai.timeout")} labelWidth={128}>
        <TextInput
          ariaLabel={t("ai.timeout")}
          value={String(form.timeoutSecs)}
          onChange={(v) => setForm({ ...form, timeoutSecs: Number(v) || 0 })}
        />
      </FormRow>
      <Toggle label={t("ai.sshOn")} checked={form.remote != null} onChange={toggleRemote} />
      {form.remote != null && (
        <div className={styles.sshGroup}>
          {/* host + 端口 + 私钥同行（桌面 ssh-row 同构：host/私钥占满、端口定宽） */}
          <div className={styles.entityLine}>
            <TextInput
              className={styles.grow}
              ariaLabel={t("dsh.agents.sshHostPh")}
              value={form.remote.host}
              onChange={(host) => patchRemote({ host })}
              placeholder={t("dsh.agents.sshHostPh")}
            />
            <TextInput
              className={styles.w84}
              ariaLabel={t("ai.sshPort")}
              value={String(form.remote.port)}
              onChange={(v) => patchRemote({ port: Number(v) || 0 })}
            />
            <TextInput
              className={styles.grow}
              ariaLabel={t("ai.sshKeyPh")}
              value={form.remote.keyPath ?? ""}
              onChange={(keyPath) => patchRemote({ keyPath })}
              placeholder={t("ai.sshKeyPh")}
            />
          </div>
          <FormRow label={t("ai.sshTunnel")} labelWidth={128}>
            <TextInput
              ariaLabel={t("ai.sshTunnel")}
              value={form.remote.tunnel === null || form.remote.tunnel === undefined ? "" : String(form.remote.tunnel)}
              onChange={(v) => patchRemote({ tunnel: v.trim() === "" ? null : Number(v) || null })}
              placeholder="10022"
            />
          </FormRow>
          <Toggle
            label={t("ai.sshKeepAlive")}
            checked={form.remote.persistent}
            onChange={(persistent) => patchRemote({ persistent })}
          />
          <p className={styles.cardHint}>{t("ai.sshKeepAliveDesc")}</p>
        </div>
      )}
      {commandInvalid && <span className={styles.saveFailHint}>{t("dsh.agents.commandRequired")}</span>}
      {error !== null && <span className={styles.saveFailHint}>{error}</span>}
      <div className={styles.cardActions}>
        <button type="button" className={ui.button} disabled={busy || commandInvalid} onClick={onSave}>
          {t("ai.save")}
        </button>
        <button type="button" className={ui.button} onClick={onCancel}>
          {t("prompts.cancel")}
        </button>
      </div>
    </>
  );
}
