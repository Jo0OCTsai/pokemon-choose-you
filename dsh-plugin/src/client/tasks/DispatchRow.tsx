/**
 * 派发操作呈现件（DispatchOps 拆件，桌面抽屉同构）：状态徽章 / 选择行（通道 + agent
 * 改选下拉 + agent 徽章 + 工作目录）/ 动作行（选择行下方留距：⚡派发 + 手动收口三钮）
 * + 派生文案 helper。
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

/** 手动收口三钮（并入动作行，桌面 dsp-mark 同款）：queued/running 才出（agent 未回传时的救援） */
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
    <>
      <MarkButton label={t("dispatch.markDone")} state="done" {...{ readonly, busy, onMark }} />
      <MarkButton label={t("dispatch.markFailed")} state="failed" {...{ readonly, busy, onMark }} />
      <MarkButton label={t("dispatch.markReset")} state="reset" danger {...{ readonly, busy, onMark }} />
    </>
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

/** 派发主体：无项目标签/无 agent 给引导 hint；否则 = 选择行（通道 + agent + 目录）+
 *  动作行（⚡派发 + 手动收口三钮；派生文案/禁用态由 DispatchOps 预计算，本组件只做纯呈现） */
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
  onMark: (state: "done" | "failed" | "reset") => void;
}): React.JSX.Element {
  const t = useT();
  const {
    task,
    route,
    agents,
    channel,
    agentId,
    busy,
    dispatchState,
    readonly,
    onChannel,
    onAgent,
    onDispatch,
    onMark,
  } = props;
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
      </div>
      {/* 动作行在选择行下方（留距）：⚡派发 + 手动收口（queued/running 救援） */}
      <div className={styles.dispatchActions}>
        <GoButton {...{ readonly, busy, dispatchState, onDispatch }} />
        <MarkRow state={dispatchState} readonly={readonly} busy={busy} onMark={onMark} />
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
export function resolveChosen(
  agents: AgentConfig[],
  agentId: string,
  route: PanelData["routes"][number] | undefined,
): AgentConfig | undefined {
  return agents.find((a) => a.id === agentId) ?? agents.find((a) => a.id === route?.agentId);
}

/** 工作目录呈现（路由指定优先，回落 agent 默认目录） */
export function workdirText(route: PanelData["routes"][number] | undefined, t: ReturnType<typeof useT>): string {
  if (route?.workdir !== undefined && route.workdir !== "") {
    return route.workdir;
  }
  return t("dispatch.dirDefault");
}

/** 项目维度标签在卡上（项目路由派发的前提） */
function hasProjectTag(task: Task): boolean {
  return task.tags.some((tag) => tag.dimension === "project");
}

/** 派发执行世界信息（U31/M1/M2：world 行 + 降级三枚举 + 占用探测条件行的数据面） */
export interface DispatchWorldInfo {
  /** null = 未解析（无路由/部署列表未达）→ 整组不渲染 */
  world: { kind: "local" } | { kind: "deployment"; alias: string; degraded: boolean } | null;
  /** 远端仍有该任务活动进程的会话 id（null = 无占用） */
  occupancySessionId: string | null;
  /** 交互通道降级（无终端面板能力 → 复制完整命令行） */
  interactiveDegraded: boolean;
  /** 目标非 POSIX 端点（仅支持无头直连派发） */
  nonPosix: boolean;
}

/** 执行世界行 + 降级三枚举明示 + 占用探测条件行（§8 派发确认文案；纯呈现，交互不变） */
export function DispatchWorldNotes({
  info,
  agentName,
  workdir,
}: {
  info: DispatchWorldInfo;
  agentName: string;
  workdir: string;
}): React.JSX.Element | null {
  const t = useT();
  if (info.world === null) {
    return null;
  }
  const worldText =
    info.world.kind === "local"
      ? t("dsh.dispatch.scopeLocal")
      : t("dsh.dispatch.worldDeployment", { alias: info.world.alias });
  return (
    <div className={styles.worldNotes} data-testid="dispatch-world-notes">
      <p className={styles.worldLine}>
        {t("dsh.dispatch.worldLine", { agent: agentName, world: worldText, dir: workdir })}
      </p>
      {info.world.kind === "deployment" && info.world.degraded && (
        <p className={styles.worldWarn}>⚠ {t("dsh.dispatch.degradeDirect")}</p>
      )}
      {info.interactiveDegraded && <p className={styles.worldWarn}>⚠ {t("dsh.dispatch.degradeInteractive")}</p>}
      {info.nonPosix && <p className={styles.worldWarn}>⚠ {t("dsh.dispatch.degradeNonPosix")}</p>}
      {info.occupancySessionId !== null && <p className={styles.worldWarn}>{t("dsh.dispatch.occupancy")}</p>}
    </div>
  );
}
