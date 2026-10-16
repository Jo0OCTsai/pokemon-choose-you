/**
 * Agent 配置卡（agent 列表条级 CRUD，A24：整读-改-整写 + expectedAgentIds 修订检测；
 * 卡自持保存——实体 CRUD 不走分区页保存制）。布局对齐主应用 AgentConfigCard：
 * 编辑态 = 首行名称+命令同行（桌面 agent-row）+ 128px 标签列字段行（附加参数/工作目录/
 * 历史参数/技能根目录/超时——桌面 SettingRow label-width 128 同构）+ SSH 远程执行组
 * （host/端口/私钥同行 + 反向隧道/常驻隧道——remote=null 未开）+ 卡底动作行；
 * 折叠态 = 名称 + 命令摘要（SSH 位置）+ 启用开关 + 编辑/移除同行。编辑态表单拆件 →
 * AgentEditForm.tsx。
 * pk 技能行/测试/历史/一键配置远程/隧道状态显示待 host 命令支持 + 项目派发路由行（routeUpsert）。
 */
import { useState } from "react";
import type { AgentConfig } from "../../../host/domain/settings";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import type { DispatchRoute } from "../../rpc";
import { ConfirmDialog } from "../../ui/Modal";
import { FormRow, Select, TextInput, Toggle } from "../../ui/controls";
import ui from "../../ui/ui.module.css";
import styles from "../settings.module.css";
import { AgentEditForm } from "./AgentEditForm";

/** agent 配置卡（自持保存，A24 修订检测：expectedAgentIds 基线） */
export function AgentConfigCard({
  agent,
  expectedIds,
  onSaved,
}: {
  agent: AgentConfig;
  expectedIds: string[];
  onSaved: (agents: AgentConfig[]) => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [editing, setEditing] = useState(agent.name === "");
  const [form, setForm] = useState(agent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const commandInvalid = form.command.trim() === "";
  async function save(): Promise<void> {
    setBusy(true);
    const result = await client.agentUpsert({ agent: form, expectedAgentIds: expectedIds });
    setBusy(false);
    if (result.ok) {
      onSaved(result.data.agents);
      setError(null);
      setEditing(false);
    } else if (result.error.code === "SETTING_MODIFIED_ELSEWHERE") {
      setError(t("dsh.prompts.forceOverwrite"));
    } else {
      setError(result.error.message);
    }
  }
  return (
    <div
      className={editing ? styles.entityCardStack : styles.entityCard}
      data-testid="agent-ui.card"
      data-off={form.enabled ? undefined : "true"}
    >
      {editing ? (
        <AgentEditForm
          agentId={agent.id}
          form={form}
          setForm={setForm}
          busy={busy}
          error={error}
          commandInvalid={commandInvalid}
          onSave={() => void save()}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          {/* 标识行：名称 + 命令摘要（SSH 位置/技能根目录）+ 启用开关 + 操作同行 */}
          <span className={styles.entityName}>{agent.name}</span>
          <span className={`${styles.entitySub} ${ui.muted}`}>
            {agent.command}
            {agent.remote != null && agent.remote.host.trim() !== "" ? ` · SSH ${agent.remote.host}` : ""} ·{" "}
            {t("ai.skillDir")}: {agent.skillDir ?? "-"}
          </span>
          <Toggle
            compact
            label={t("ai.enabled")}
            checked={form.enabled}
            onChange={(enabled) => setForm({ ...form, enabled })}
          />
          <button type="button" className={ui.button} onClick={() => setEditing(true)}>
            {t("prompts.edit")}
          </button>
          <button type="button" className={ui.button} onClick={() => setConfirmDelete(true)}>
            {t("ai.remove")}
          </button>
        </>
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={t("ai.remove")}
          body={`${agent.name} · ${agent.command}`}
          confirmLabel={t("ai.remove")}
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            void client.agentDelete({ id: agent.id, expectedAgentIds: expectedIds }).then((result) => {
              setConfirmDelete(false);
              if (result.ok) {
                onSaved(result.data.agents);
              } else {
                setError(t("dsh.prompts.forceOverwrite"));
              }
            });
          }}
        />
      )}
    </div>
  );
}

/** 项目派发路由行（routeUpsert 实体 CRUD；桌面 dispatch-block 同构：头行标签+配置状态，
 * 128px 标签列字段行 = 派发 agent 下拉 / 工作目录。configured 口径同桌面：agent 或目录
 * 任一指定 = 已配置；都留空按全局默认派发） */
export function RouteRow({ route, agents }: { route: DispatchRoute; agents: AgentConfig[] }): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [workdir, setWorkdir] = useState(route.workdir);
  const [agentId, setAgentId] = useState(route.agentId);
  const configured = route.agentId.trim() !== "" || route.workdir.trim() !== "";
  return (
    <div className={styles.entityCardStack} data-testid="route-row">
      <div className={styles.entityLine}>
        <b>{route.tag}</b>
        <span className={`${styles.grow} ${ui.muted}`}>
          {configured
            ? route.context !== ""
              ? route.context
              : t("tagDispatch.configured")
            : t("tagDispatch.unconfigured")}
        </span>
        <button
          type="button"
          className={ui.button}
          onClick={() => void client.routeUpsert({ route: { ...route, agentId, workdir } })}
        >
          {t("tags.save")}
        </button>
      </div>
      <FormRow label={t("tagDispatch.agent")} labelWidth={128}>
        <Select
          ariaLabel={t("tagDispatch.agent")}
          value={agentId}
          options={[
            { value: "", label: t("tagDispatch.agentNone") },
            ...agents.map((a) => ({ value: a.id, label: a.name })),
          ]}
          onChange={(v) => {
            setAgentId(v);
            void client.routeUpsert({ route: { ...route, agentId: v, workdir } });
          }}
        />
      </FormRow>
      <FormRow label={t("tagDispatch.workdir")} labelWidth={128} wide>
        <TextInput
          ariaLabel={t("tagDispatch.workdir")}
          value={workdir}
          onChange={setWorkdir}
          placeholder={t("tagDispatch.workdirPh")}
        />
      </FormRow>
    </div>
  );
}
