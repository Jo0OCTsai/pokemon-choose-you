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
import { useEffect, useState } from "react";
import type { AgentConfig } from "../../../host/domain/settings";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import type { DispatchRoute } from "../../rpc";
import { ConfirmDialog } from "../../ui/Modal";
import { FormRow, Select, TextInput, Toggle } from "../../ui/controls";
import ui from "../../ui/ui.module.css";
import styles from "../settings.module.css";
import { SAVED_HINT_MS } from "../SectionShell";
import { AgentEditForm } from "./AgentEditForm";

/** agent 配置卡（自持保存，A24 修订检测：expectedAgentIds 基线；冲突 →「仍要覆盖」
 *  force 重发；幽灵卡取消/删除纯本地） */
export function AgentConfigCard({
  agent,
  expectedIds,
  isNew,
  onSaved,
  onRemoveNew,
}: {
  agent: AgentConfig;
  expectedIds: string[];
  /** 幽灵卡（乐观新增未落库）：取消/删除纯本地，不发服务端命令 */
  isNew: boolean;
  onSaved: (agents: AgentConfig[]) => void;
  onRemoveNew: (id: string) => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [editing, setEditing] = useState(agent.name === "");
  const [form, setForm] = useState(agent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteConflict, setDeleteConflict] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const commandInvalid = form.command.trim() === "";
  /** 保存（force=true = 冲突后确认覆盖整值重发，A24）；失败时展开编辑态——折叠卡的
   *  开关即时保存无处呈错，编辑态错误行 + 「仍要覆盖」是统一出口 */
  async function save(next: AgentConfig = form, force = false): Promise<void> {
    setBusy(true);
    const result = await client.agentUpsert({
      agent: next,
      expectedAgentIds: force ? undefined : expectedIds,
      force,
    });
    setBusy(false);
    if (result.ok) {
      onSaved(result.data.agents);
      setError(null);
      setConflict(false);
      setEditing(false);
    } else if (result.error.code === "SETTING_MODIFIED_ELSEWHERE") {
      setConflict(true);
      setError(t("dsh.prompts.forceOverwrite"));
      setEditing(true);
    } else {
      setError(result.error.message);
      setEditing(true);
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
          conflict={conflict}
          commandInvalid={commandInvalid}
          onSave={() => void save()}
          onForceSave={() => void save(form, true)}
          onCancel={() => (isNew ? onRemoveNew(agent.id) : setEditing(false))}
        />
      ) : (
        <>
          {/* 标识行：名称 + 命令摘要（SSH 位置/绑定部署/技能根目录）+ 启用开关 + 操作同行 */}
          <span className={styles.entityName}>{agent.name}</span>
          <AgentSummary agent={agent} t={t} />
          <Toggle
            compact
            label={t("ai.enabled")}
            checked={form.enabled}
            onChange={(enabled) => {
              setForm({ ...form, enabled });
              // 持久卡开关即时落库（分类停用/启用同款即时语义）；幽灵卡只记本地，
              // 随显式保存落库（开关不应替用户落半成品配置）
              if (!isNew && !busy) {
                void save({ ...form, enabled });
              }
            }}
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
          body={deleteError ?? `${agent.name} · ${agent.command}`}
          confirmLabel={deleteConflict ? t("dsh.prompts.forceOverwriteConfirm") : t("ai.remove")}
          danger
          onCancel={() => {
            setConfirmDelete(false);
            setDeleteConflict(false);
            setDeleteError(null);
          }}
          onConfirm={() => {
            // 幽灵卡未落库：纯本地移除（服务端无此 id，agentDelete 只会报不存在）
            if (isNew) {
              setConfirmDelete(false);
              onRemoveNew(agent.id);
              return;
            }
            void client
              .agentDelete({
                id: agent.id,
                expectedAgentIds: deleteConflict ? undefined : expectedIds,
                force: deleteConflict,
              })
              .then((result) => {
                if (result.ok) {
                  setConfirmDelete(false);
                  setDeleteConflict(false);
                  setDeleteError(null);
                  onSaved(result.data.agents);
                } else if (result.error.code === "SETTING_MODIFIED_ELSEWHERE") {
                  // 冲突：对话框停留提示，确认钮转「仍要覆盖」（再点即 force 删除）
                  setDeleteConflict(true);
                  setDeleteError(t("dsh.prompts.forceOverwrite"));
                } else {
                  setDeleteError(result.error.message);
                }
              });
          }}
        />
      )}
    </div>
  );
}

/** 折叠态命令摘要段（命令 · SSH 位置 · 绑定部署 · 技能根目录——条件段拆件） */
function AgentSummary({ agent, t }: { agent: AgentConfig; t: ReturnType<typeof useT> }): React.JSX.Element {
  return (
    <span className={`${styles.entitySub} ${ui.muted}`}>
      {agent.command}
      {agent.remote != null && agent.remote.host.trim() !== "" ? ` · SSH ${agent.remote.host}` : ""}
      {agent.deployment != null && agent.deployment.trim() !== ""
        ? ` · ${t("dsh.agents.deployment")} ${agent.deployment}`
        : ""}{" "}
      · {t("ai.skillDir")}: {agent.skillDir ?? "-"}
    </span>
  );
}

/** 项目派发路由行（routeUpsert 实体 CRUD；桌面 dispatch-block 同构：头行标签+配置状态，
 * 128px 标签列字段行 = 派发 agent 下拉 / 工作目录。configured 口径同桌面：agent 或目录
 * 任一指定 = 已配置；都留空按全局默认派发。保存走结果检查 + 成功/失败行内 hint（桌面
 * 「改动即时生效」语义：下拉选中即存；按钮提交工作目录）+ onSaved 触发面板重拉（真机
 * 踩坑：库已写入但 UI 沉默、状态行不刷新，用户侧即「无法保存」）。 */
export function RouteRow({
  route,
  agents,
  onSaved,
}: {
  route: DispatchRoute;
  agents: AgentConfig[];
  /** 保存成功回调（面板重拉路由——状态行/⚡ chip 更新） */
  onSaved: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [workdir, setWorkdir] = useState(route.workdir);
  const [agentId, setAgentId] = useState(route.agentId);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState<"saved" | { failed: string } | null>(null);
  const configured = route.agentId.trim() !== "" || route.workdir.trim() !== "";
  // 成功 hint 4s 自隐（分区保存控件同口径；失败 hint 常驻保留草稿可重试）
  useEffect(() => {
    if (hint !== "saved") {
      return;
    }
    const timer = setTimeout(() => setHint(null), SAVED_HINT_MS);
    return () => clearTimeout(timer);
  }, [hint]);
  async function save(next: DispatchRoute): Promise<void> {
    if (saving) {
      return;
    }
    setSaving(true);
    const result = await client.routeUpsert({ route: next });
    setSaving(false);
    if (result.ok) {
      setHint("saved");
      onSaved();
    } else {
      setHint({ failed: result.error.message });
    }
  }
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
        {hint === "saved" && (
          <span className={styles.savedHint} role="status">
            {t("dsh.settings.saved")}
          </span>
        )}
        {typeof hint === "object" && hint !== null && (
          <span className={styles.saveFailHint} role="alert">
            {t("dsh.settings.saveFailed", { reason: hint.failed })}
          </span>
        )}
        <button
          type="button"
          className={ui.button}
          disabled={saving}
          onClick={() => void save({ ...route, agentId, workdir })}
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
            void save({ ...route, agentId: v, workdir });
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
