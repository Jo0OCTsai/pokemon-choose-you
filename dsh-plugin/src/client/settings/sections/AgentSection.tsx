/**
 * Agent 分区页（🤖，U20：原派发段并入 + 判定执行方移入）：
 * - AgentConfigCard（agent 列表配置卡 CRUD：名称/命令/历史参数/技能根目录——卡自持保存，
 *   实体 CRUD 不走分区保存制；命令行内校验：空阻断；修订检测 SETTING_MODIFIED_ELSEWHERE）
 * - 判定执行方（ai_agent_id，保存制）/ 终端偏好（标「作用于主应用交互派发」，保存制）
 * - 项目派发路由（routeUpsert 实体 CRUD）/ 自动派发/并发/worktree（保存制）
 * - PromptOverrideEditor（4 处提示词查看/编辑覆盖/恢复默认——自持保存 + hint 自隐 4s）
 */
import { useEffect, useMemo, useState } from "react";
import type { AgentConfig } from "../../../host/domain/settings";
import type { Tag } from "../../../host/domain/vocabulary-tags";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import { Select, Toggle } from "../../ui/controls";
import type { PromptSpecInfo } from "../../../host/domain/prompt-overrides";
import ui from "../../ui/ui.module.css";
import { AgentConfigCard, RouteRow } from "./AgentConfigCard";
import { PromptOverrideEditor } from "./PromptOverrideEditor";
import type { SectionProps } from "../sectionProps";
import type { DispatchRoute } from "../../rpc";
import { SectionShell } from "../SectionShell";
import styles from "../settings.module.css";

/** 添加预设（主应用 AGENT_PRESETS 同值：{prompt} 占位符由执行层替换，见 src/stores/agents.ts） */
const AGENT_PRESETS: Record<string, Pick<AgentConfig, "name" | "command" | "args" | "historyArgs">> = {
  claude: {
    name: "Claude Code",
    command: "claude",
    args: "-p {prompt} --allowedTools Bash(pk:*) --output-format json",
    historyArgs: "--resume",
  },
  opencode: { name: "OpenCode", command: "opencode", args: "run {prompt}", historyArgs: "" },
  pi: { name: "pi", command: "pi", args: "-p {prompt}", historyArgs: "-r" },
  dsh: { name: "DeepSeek Harness", command: "dsh", args: "--profile headless", historyArgs: "" },
  custom: { name: "", command: "", args: "{prompt}", historyArgs: "" },
};

const PRESET_OPTIONS = (t: (key: string) => string): Array<{ value: string; label: string }> => [
  { value: "claude", label: "Claude Code" },
  { value: "opencode", label: "OpenCode" },
  { value: "pi", label: "pi" },
  { value: "dsh", label: "DeepSeek Harness" },
  { value: "custom", label: t("dsh.agents.presetCustom") },
];

export function AgentSection({
  agents,
  routes,
  tags,
  promptSpecs,
  onChanged,
  ...props
}: SectionProps & {
  agents: AgentConfig[];
  routes: DispatchRoute[];
  /** 标签清单（项目派发行 = 全部 project 维度标签，桌面 TagDispatchCard 同构） */
  tags: Tag[];
  /** promptList 结果（适配层预取注入；空数组时面板内自取） */
  promptSpecs: PromptSpecInfo[];
  /** 路由保存成功后的数据刷新（面板重拉——项目派发状态行跟新） */
  onChanged: () => void;
}): React.JSX.Element {
  const { draft, onField } = props;
  const t = useT();
  const client = useClient();
  const [agentPreset, setAgentPreset] = useState("claude");
  const [specs, setSpecs] = useState<PromptSpecInfo[]>(promptSpecs);
  useEffect(() => {
    if (specs.length === 0) {
      void client.promptList().then((r) => {
        if (r.ok) {
          setSpecs(r.data.specs);
        }
      });
    }
  }, [specs.length, client]);

  /**
   * 本地面板态：渲染列表（持久卡 + 乐观幽灵卡）与 CAS 基线分离（回归：幽灵新 id
   * 混入 expectedAgentIds → 首存必然 SETTING_MODIFIED_ELSEWHERE 且污染全列表基线，
   * 编辑/删除全部死锁）。幽灵卡 = 列表中有、基线中没有的 id。
   */
  const [panel, setPanel] = useState<{ list: AgentConfig[]; persistedIds: string[] }>(() => ({
    list: agents,
    persistedIds: agents.map((a) => a.id),
  }));
  useEffect(() => {
    const idSet = new Set(agents.map((a) => a.id));
    setPanel((prev) => ({
      persistedIds: agents.map((a) => a.id),
      // 面板重拉：持久卡整列跟进服务端；未保存幽灵卡保留（无关刷新不丢草稿）
      list: [...agents, ...prev.list.filter((a) => !idSet.has(a.id) && !prev.persistedIds.includes(a.id))],
    }));
  }, [agents]);

  /** agent 写成功（upsert/delete）：整列跟进服务端响应 + 基线刷新；未保存幽灵卡保留；
   *  同步请求面板重拉（onChanged 契约——写命令成功后刷新快照，分段重挂才读得到新值） */
  function handleSaved(next: AgentConfig[]): void {
    const idSet = new Set(next.map((a) => a.id));
    setPanel((prev) => ({
      persistedIds: next.map((a) => a.id),
      list: [...next, ...prev.list.filter((a) => !idSet.has(a.id) && !prev.persistedIds.includes(a.id))],
    }));
    onChanged();
  }

  /** 幽灵卡纯本地移除（编辑取消/未落库删除——不发服务端命令） */
  function removeLocal(id: string): void {
    setPanel((prev) => ({ ...prev, list: prev.list.filter((a) => a.id !== id) }));
  }

  const persistedIdSet = new Set(panel.persistedIds);
  const agentList = panel.list;

  const agentOptions = [
    { value: "", label: t("ai.primaryNone") },
    ...agentList.map((a) => ({ value: a.id, label: a.name })),
  ];

  /** 项目派发行（桌面 TagDispatchCard 同构：全部 project 维度标签各一行一目了然，
   * 已配置路由按标签名并入；未配置行 = 空路由，agent 留空即按全局默认派发） */
  const routeRows = useMemo(() => {
    const byTag = new Map(routes.map((route) => [route.tag, route]));
    return tags
      .filter((tag) => tag.dimension === "project")
      .map((tag) => byTag.get(tag.name) ?? { tag: tag.name, agentId: "", workdir: "", context: "" });
  }, [routes, tags]);

  /** 预设名已被占用时加序号后缀（同类型配多个时列表仍可辨——主应用 dedupeName 同口径） */
  function dedupeName(base: string): string {
    if (base === "" || !agentList.some((a) => a.name === base)) {
      return base;
    }
    let n = 2;
    while (agentList.some((a) => a.name === `${base} ${n}`)) {
      n++;
    }
    return `${base} ${n}`;
  }

  /** 按预设新增 agent（选中预设预填 name/command/args/historyArgs；未知键回落 custom；
   *  乐观追加进列表但不计入 CAS 基线——基线仍为服务端已知 id 集） */
  function addAgent(presetKey: string): void {
    const preset = AGENT_PRESETS[presetKey] ?? AGENT_PRESETS.custom;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `agent-${Date.now().toString(36)}`;
    setPanel((prev) => ({
      ...prev,
      list: [
        ...prev.list,
        {
          id,
          name: dedupeName(preset.name),
          command: preset.command,
          args: preset.args,
          historyArgs: preset.historyArgs,
          workdir: "",
          timeoutSecs: 120,
          enabled: true,
        },
      ],
    }));
  }

  return (
    <SectionShell>
      <div className={ui.card}>
        <h4 className={styles.cardTitle} data-tip={t("ai.hint")}>
          {t("ai.title")}
        </h4>
        <div className={styles.entityList}>
          {agentList.map((agent) => (
            <AgentConfigCard
              key={agent.id}
              agent={agent}
              expectedIds={panel.persistedIds}
              isNew={!persistedIdSet.has(agent.id)}
              onSaved={handleSaved}
              onRemoveNew={removeLocal}
            />
          ))}
        </div>
        <div className={styles.filterRow}>
          <Select
            ariaLabel={t("dsh.agents.presetLabel")}
            value={agentPreset}
            options={PRESET_OPTIONS(t)}
            onChange={setAgentPreset}
          />
          <button type="button" className={ui.button} onClick={() => addAgent(agentPreset)}>
            {t("ai.add")}
          </button>
        </div>
      </div>
      <div className={ui.card}>
        <h4 className={styles.cardTitle} data-tip={t("dispatchCfg.hint")}>
          {t("dispatchCfg.title")}
        </h4>
        <Select
          label={t("ai.primary")}
          tip={t("dsh.settings.judgeSource")}
          value={draft["ai_agent_id"]}
          options={agentOptions}
          onChange={(v) => onField("ai_agent_id", v)}
        />
        <Select
          label={t("ai.terminal")}
          tip={t("ai.terminalDesc")}
          badge={t("dsh.badge.dispatch")}
          value={draft["terminal_preference"]}
          options={[
            { value: "default", label: t("ai.termBuiltin") },
            { value: "iterm2", label: "iTerm2" },
            { value: "ghostty", label: "Ghostty" },
            { value: "windows-terminal", label: "Windows Terminal" },
          ]}
          onChange={(v) => onField("terminal_preference", v)}
        />
        <Toggle
          label={t("dispatchCfg.auto")}
          tip={t("dispatchCfg.autoDesc")}
          checked={draft["dispatch_auto_enabled"] === "true"}
          onChange={(v) => onField("dispatch_auto_enabled", String(v))}
        />
        <Select
          label={t("dispatchCfg.maxConcurrent")}
          tip={t("dispatchCfg.maxConcurrentDesc")}
          value={draft["dispatch_max_concurrent"]}
          options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: t("dispatchCfg.mcN", { n }) }))}
          onChange={(v) => onField("dispatch_max_concurrent", v)}
        />
        <Toggle
          label={t("dispatchCfg.worktree")}
          tip={t("dispatchCfg.worktreeDesc")}
          checked={draft["dispatch_worktree"] === "true"}
          onChange={(v) => onField("dispatch_worktree", String(v))}
        />
      </div>
      <div className={ui.card}>
        <h4 className={styles.cardTitle} data-tip={`${t("tagDispatch.hint")}\n${t("tagDispatch.foot")}`}>
          {t("tagDispatch.title")}
        </h4>
        {routeRows.length === 0 ? (
          <p className={ui.muted}>{t("tagDispatch.empty")}</p>
        ) : (
          routeRows.map((route) => <RouteRow key={route.tag} route={route} agents={agentList} onSaved={onChanged} />)
        )}
      </div>
      <PromptOverrideEditor specs={specs} onSpecChange={setSpecs} />
    </SectionShell>
  );
}
