/**
 * 派发操作呈现件（DispatchOps 拆件，桌面抽屉 .dsp-row 同构）：状态徽章 / 手动收口行 /
 * 派发主体行（通道 + agent 改选下拉 + agent 徽章 + 工作目录 + ⚡派发钮）+ 派生文案 helper。
 */
import type { AgentConfig } from "../../host/domain/settings";
import type { Task } from "../../host/domain/tasks";
import { useT } from "../i18n";
import type { PanelData } from "../model";
import { Select } from "../ui/controls";
import ui from "../ui/ui.module.css";
import styles from "./tasks.module.css";

/** 派发状态徽章（null = 从未派发不渲染） */
export function StateBadge({ state }: { state: string | null }): React.JSX.Element | null {
  const t = useT();
  if (state === null) {
    return null;
  }
  return (
    <span className={styles.dispatchBadge} data-state={state}>
      {t(`dsh.dispatch.badge.${state}`)}
    </span>
  );
}

/** 手动收口行（桌面 dsp-mark 同位）：queued/running 才出（agent 未回传时的救援） */
export function MarkRow({
  state,
  readonly,
  busy,
  onMark,
}: {
  state: string | null;
  readonly: boolean;
  busy: boolean;
  onMark: (state: "done" | "failed" | "reset") => void;
}): React.JSX.Element | null {
  const t = useT();
  if (state !== "queued" && state !== "running") {
    return null;
  }
  return (
    <div className={styles.opsRow}>
      <MarkButton label={t("dispatch.markDone")} state="done" {...{ readonly, busy, onMark }} />
      <MarkButton label={t("dispatch.markFailed")} state="failed" {...{ readonly, busy, onMark }} />
      <MarkButton label={t("dispatch.markReset")} state="reset" danger {...{ readonly, busy, onMark }} />
    </div>
  );
}

function MarkButton({
  label,
  state,
  danger = false,
  readonly,
  busy,
  onMark,
}: {
  label: string;
  state: "done" | "failed" | "reset";
  danger?: boolean;
  readonly: boolean;
  busy: boolean;
  onMark: (state: "done" | "failed" | "reset") => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`${ui.button} ${styles.markMini} ${danger ? styles.markReset : ""}`}
      disabled={readonly || busy}
      onClick={() => onMark(state)}
    >
      {label}
    </button>
  );
}

/** 派发主体：无项目标签/无 agent 给引导 hint；否则 = 通道 + agent + 目录 + ⚡派发行
 *  （派生文案/禁用态由 DispatchOps 预计算，本组件只做纯呈现） */
export type Channel = "interactive" | "headless";

export function DispatchBody(props: {
  task: Task;
  route: PanelData["routes"][number] | undefined;
  agents: AgentConfig[];
  channel: Channel;
  agentId: string;
  busy: boolean;
  dispatchState: string | null;
  readonly: boolean;
  onChannel: (c: Channel) => void;
  onAgent: (id: string) => void;
  onDispatch: () => void;
}): React.JSX.Element {
  const t = useT();
  const { task, route, agents, channel, agentId, busy, dispatchState, readonly, onChannel, onAgent, onDispatch } =
    props;
  if (!hasProjectTag(task)) {
    return <p className={styles.drawerHint}>{t("dispatch.needTag")}</p>;
  }
  if (agents.length === 0) {
    return <p className={styles.drawerHint}>{t("dispatch.noAgent")}</p>;
  }
  const chosen = resolveChosen(agents, agentId, route);
  return (
    <>
      <div className={styles.opsRow}>
        <Select
          ariaLabel={t("dispatch.title")}
          value={channel}
          className={styles.dspChannel}
          options={[
            { value: "interactive", label: t("dispatch.chInteractive") },
            { value: "headless", label: t("dispatch.chHeadless") },
          ]}
          onChange={(v) => onChannel(v === "headless" ? "headless" : "interactive")}
        />
        {agents.length > 1 && <AgentSelect agents={agents} route={route} agentId={agentId} onAgent={onAgent} />}
        {chosen !== undefined && <AgentBadge name={chosen.name} host={chosen.remote?.host ?? null} />}
        <span className={styles.dspDir} title={t("dispatch.dir")}>
          📂 {workdirText(route, t)}
        </span>
        <GoButton {...{ readonly, busy, dispatchState, onDispatch }} />
      </div>
      {channel === "headless" && <p className={styles.drawerHint}>{t("dispatch.headlessHint")}</p>}
    </>
  );
}

/** agent 改选下拉（多 agent 才出；预填路由解析结果） */
function AgentSelect({
  agents,
  route,
  agentId,
  onAgent,
}: {
  agents: AgentConfig[];
  route: PanelData["routes"][number] | undefined;
  agentId: string;
  onAgent: (id: string) => void;
}): React.JSX.Element {
  const t = useT();
  const value = agentId === "" ? (route?.agentId ?? agents[0]?.id ?? "") : agentId;
  return (
    <Select
      ariaLabel={t("tags.metaAgentOff")}
      value={value}
      className={styles.dspAgent}
      options={agents.map((a) => ({ value: a.id, label: a.remote?.host ? `${a.name} · SSH` : a.name }))}
      onChange={onAgent}
    />
  );
}

/** ⚡派发主钮（running/queued 禁用；桌面 dsp-row .btn 同构） */
function GoButton({
  readonly,
  busy,
  dispatchState,
  onDispatch,
}: {
  readonly: boolean;
  busy: boolean;
  dispatchState: string | null;
  onDispatch: () => void;
}): React.JSX.Element {
  const t = useT();
  const blocked = dispatchState === "running" || dispatchState === "queued";
  return (
    <button
      type="button"
      className={ui.buttonDex}
      disabled={readonly || busy || blocked}
      title={dispatchState === "running" ? t("dsh.dispatch.tooltipRunning") : undefined}
      onClick={onDispatch}
    >
      {busy ? t("dispatch.working") : `⚡ ${t("dispatch.go")}`}
    </button>
  );
}

/** agent 徽章（SSH 标注；本机 = ai.local） */
function AgentBadge({ name, host }: { name: string; host: string | null }): React.JSX.Element {
  const t = useT();
  return (
    <span className={styles.dspAgentBadge} data-ssh={host !== null ? "true" : undefined}>
      {name} · {host !== null ? `SSH ${host}` : t("ai.local")}
    </span>
  );
}

/** 改选生效 agent（改选值优先，回落路由解析结果） */
function resolveChosen(
  agents: AgentConfig[],
  agentId: string,
  route: PanelData["routes"][number] | undefined,
): AgentConfig | undefined {
  return agents.find((a) => a.id === agentId) ?? agents.find((a) => a.id === route?.agentId);
}

/** 工作目录呈现（路由指定优先，回落 agent 默认目录） */
function workdirText(route: PanelData["routes"][number] | undefined, t: ReturnType<typeof useT>): string {
  if (route?.workdir !== undefined && route.workdir !== "") {
    return route.workdir;
  }
  return t("dispatch.dirDefault");
}

/** 项目维度标签在卡上（项目路由派发的前提） */
function hasProjectTag(task: Task): boolean {
  return task.tags.some((tag) => tag.dimension === "project");
}
