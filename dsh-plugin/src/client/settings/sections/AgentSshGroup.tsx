/**
 * Agent 配置卡拆件 · SSH 远程执行组（从 AgentEditForm 拆出，复杂度棘轮拆分）：
 * 开关（开给默认端口 22，关清 remote——主应用 toggleRemote 同口径）+ 展开组
 * （host/端口/私钥同行 + 反向隧道 + 常驻隧道）。
 */
import type { AgentConfig, AgentRemote } from "../../../host/domain/settings";
import { useT } from "../../i18n";
import { FormRow, TextInput, Toggle } from "../../ui/controls";
import styles from "../settings.module.css";

export function AgentSshGroup({
  form,
  setForm,
}: {
  form: AgentConfig;
  setForm: React.Dispatch<React.SetStateAction<AgentConfig>>;
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
    </>
  );
}
