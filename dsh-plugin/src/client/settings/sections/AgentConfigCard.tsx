/**
 * Agent 配置卡（agent 列表条级 CRUD，A24：整读-改-整写 + expectedAgentIds 修订检测；
 * 卡自持保存——实体 CRUD 不走分区页保存制）+ 项目派发路由行（routeUpsert）。
 */
import { useState } from "react";
import type { AgentConfig } from "../../../host/domain/settings";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import type { DispatchRoute } from "../../rpc";
import { ConfirmDialog } from "../../ui/Modal";
import { Select, TextInput, Toggle } from "../../ui/controls";
import ui from "../../ui/ui.module.css";
import styles from "../settings.module.css";

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
    <div className={styles.entityCard} data-testid="agent-ui.card">
      <Toggle
        label={editing ? "" : `${agent.name} · ${agent.command}`}
        checked={form.enabled}
        onChange={(enabled) => {
          setForm({ ...form, enabled });
        }}
      />
      {editing ? (
        <div className={styles.entityMain}>
          <TextInput
            ariaLabel={t("ai.namePh")}
            value={form.name}
            onChange={(name) => setForm({ ...form, name })}
            placeholder={t("ai.namePh")}
          />
          <TextInput
            ariaLabel={t("ai.cmdPh")}
            value={form.command}
            onChange={(command) => setForm({ ...form, command })}
            placeholder={t("ai.cmdPh")}
          />
          <TextInput
            ariaLabel={t("ai.historyArgs")}
            value={form.historyArgs}
            onChange={(historyArgs) => setForm({ ...form, historyArgs })}
          />
          <TextInput
            ariaLabel={t("ai.skillDir")}
            value={form.skillDir ?? ""}
            onChange={(skillDir) => setForm({ ...form, skillDir })}
            placeholder={t("ai.skillDirPh")}
          />
          {commandInvalid && <span className={styles.saveFailHint}>{t("dsh.agents.commandRequired")}</span>}
          {error !== null && <span className={styles.saveFailHint}>{error}</span>}
        </div>
      ) : (
        <div className={styles.entityMain}>
          <span>{agent.name}</span>
          <span className={ui.muted}>
            {agent.command} · {t("ai.skillDir")}: {agent.skillDir ?? "-"}
          </span>
        </div>
      )}
      {editing ? (
        <>
          <button type="button" className={ui.button} disabled={busy || commandInvalid} onClick={() => void save()}>
            {t("ai.save")}
          </button>
          <button type="button" className={ui.button} onClick={() => setEditing(false)}>
            {t("prompts.cancel")}
          </button>
        </>
      ) : (
        <>
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

/** 项目派发路由行（routeUpsert 实体 CRUD） */
export function RouteRow({ route, agents }: { route: DispatchRoute; agents: AgentConfig[] }): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [workdir, setWorkdir] = useState(route.workdir);
  const [agentId, setAgentId] = useState(route.agentId);
  return (
    <div className={styles.entityCard} data-testid="route-row">
      <div className={styles.entityMain}>
        <b>{route.tag}</b>
        <span className={ui.muted}>{route.context === "" ? t("tagDispatch.unconfigured") : route.context}</span>
      </div>
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
      <TextInput
        ariaLabel={t("tagDispatch.workdir")}
        value={workdir}
        onChange={setWorkdir}
        placeholder={t("tagDispatch.workdirPh")}
      />
      <button
        type="button"
        className={ui.button}
        onClick={() => void client.routeUpsert({ route: { ...route, agentId, workdir } })}
      >
        {t("tags.save")}
      </button>
    </div>
  );
}
