/**
 * 派发操作（桌面抽屉同构）：选择行 = 通道下拉（交互/无头）+ agent 改选下拉（多 agent
 * 时）+ agent 徽章（SSH 标注）+ 工作目录；动作行在选择行下方（留距）= ⚡派发
 * （running/queued 禁用）+ 手动收口三钮（标记完成/失败/重置——agent 未回传时的救援）。
 * 无项目标签/无可用 agent 给引导 hint；DISPATCH_ALREADY_ACTIVE 中性提示不弹窗。
 * full-parity 增量（U31/U32）：执行世界行 + 降级三枚举明示 + 占用探测条件行（纯呈现，
 * 交互不变——世界 = 所选 agent 的部署绑定解析（2026-10-19 裁决单源）；占用/交互降级/
 * 非 POSIX 数据面由 host 派发期回填，client 侧先以条件行组件承接）。
 * 呈现拆件 → DispatchRow.tsx（状态徽章/收口行/派发行 + 世界行 + 派生 helper）。
 */
import { useEffect, useMemo, useState } from "react";
import type { Task } from "../../host/domain/tasks";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import type { PanelData } from "../model";
import ui from "../ui/ui.module.css";
import {
  DispatchBody,
  DispatchWorldNotes,
  StateBadge,
  resolveChosen,
  workdirText,
  type DispatchWorldInfo,
} from "./DispatchRow";
import { copyText, HandoffLine } from "./handoff";
import styles from "./tasks.module.css";

type Channel = "interactive" | "headless";

export function DispatchOps({
  task,
  data,
  readonly,
  onChanged,
}: {
  task: Task;
  data: PanelData;
  readonly: boolean;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [channel, setChannel] = useState<Channel>("interactive");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dispatchState, setDispatchState] = useState(task.dispatchState);
  // 本机交互派发 handoff 载荷（宿主无第三方终端面板——命令行回传复制执行）
  const [handoff, setHandoff] = useState<{ note: string; line: string } | null>(null);
  const route = data.routes.find((r) => task.tags.some((tag) => tag.name === r.tag));
  /** 改选值（预填路由解析结果；空串 = 跟随路由/全局默认） */
  const [agentId, setAgentId] = useState(route?.agentId ?? "");
  const agents = (data.agents ?? []).filter((a) => a.enabled);
  /** 部署列表（执行世界行解析；拉一次） */
  const [deployments, setDeployments] = useState<import("../rpc").DeploymentListResult | null>(null);
  useEffect(() => {
    void client.deploymentList().then((result) => {
      if (result.ok) {
        setDeployments(result.data);
      }
    });
  }, [client]);

  const chosen = resolveChosen(agents, agentId, route);

  /** 执行世界信息（所选 agent 的部署绑定 → 部署解析——执行世界单源在 agent；本机/未解析不整组渲染） */
  const worldInfo: DispatchWorldInfo = useMemo(() => {
    const none: DispatchWorldInfo = {
      world: null,
      occupancySessionId: null,
      interactiveDegraded: false,
      nonPosix: false,
    };
    const alias = chosen?.deployment?.trim() ?? "";
    if (alias === "") {
      return none;
    }
    const dep = deployments?.deployments.find((d) => d.alias === alias);
    if (dep === undefined) {
      return none;
    }
    return {
      world: { kind: "deployment", alias, degraded: dep.degraded && dep.status === "ready" },
      occupancySessionId: null,
      interactiveDegraded: false,
      nonPosix: false,
    };
  }, [chosen, deployments]);

  async function dispatch(): Promise<void> {
    setBusy(true);
    setConflict(null);
    setMessage(null);
    setHandoff(null);
    const override = agentId !== "" && agentId !== route?.agentId ? { routeOverride: agentId } : {};
    const result =
      channel === "interactive"
        ? await client.dispatchInteractive({ taskId: task.id, ...override })
        : await client.dispatchHeadless({ taskId: task.id, ...override });
    setBusy(false);
    if (!result.ok) {
      if (result.error.code === "DISPATCH_ALREADY_ACTIVE") {
        setConflict(t("dsh.toast.dispatchBusy"));
      } else {
        setMessage(`❌ ${result.error.message}`);
      }
      return;
    }
    setDispatchState(result.data.state);
    // 本机 handoff（宿主无第三方终端面板）：命令行复制到剪贴板 + 常显可手抄——
    // 任务已置 running 等回传，粘贴执行后 agent 经工具回传收口
    if (result.data.handedOff === true && result.data.line != null) {
      const line = result.data.line;
      const copied = await copyText(line);
      setHandoff({ note: handoffNote(result.data.handoffReason, copied, t), line });
    }
    onChanged();
  }

  /** 手动收口（救援）：完成/失败/重置 */
  async function mark(state: "done" | "failed" | "reset"): Promise<void> {
    setBusy(true);
    const result =
      state === "reset"
        ? await client.dispatchReset({ taskId: task.id })
        : await client.dispatchClose({ taskId: task.id, result: state });
    setBusy(false);
    if (result.ok) {
      setDispatchState(result.data.state);
      onChanged();
    }
  }

  return (
    <div className={styles.drawerSection} data-testid="dispatch-ops">
      <h4 className={styles.drawerSectionTitle}>
        {t("dispatch.title")} <StateBadge state={dispatchState} />
      </h4>
      <DispatchBody
        task={task}
        route={route}
        agents={agents}
        channel={channel}
        agentId={agentId}
        busy={busy}
        dispatchState={dispatchState}
        readonly={readonly}
        onChannel={setChannel}
        onAgent={setAgentId}
        onDispatch={() => void dispatch()}
        onMark={(state: "done" | "failed" | "reset") => void mark(state)}
      />
      <DispatchWorldNotes
        info={worldInfo}
        agentName={chosen?.name ?? route?.agentId ?? ""}
        workdir={workdirText(route, t)}
      />
      {conflict !== null && (
        <div role="status" className={ui.muted}>
          {conflict}
        </div>
      )}
      <DispatchHandoff handoff={handoff} />
      {message !== null && <p className={styles.drawerErr}>{message}</p>}
    </div>
  );
}

/** 派发 handoff 呈现（null = 零占位；note + 命令行常显——共享 HandoffLine） */
function DispatchHandoff({ handoff }: { handoff: { note: string; line: string } | null }): React.JSX.Element | null {
  if (handoff === null) {
    return null;
  }
  return (
    <div role="status">
      <p className={styles.sessNote} data-testid="dispatch-handoff-note">
        {handoff.note}
      </p>
      <HandoffLine line={handoff.line} testId="dispatch-handoff-line" />
    </div>
  );
}

/** handoff note 文案选择（web-carrier → Web 提示；已复制/手动复制两态兜底） */
function handoffNote(
  reason: "web-carrier" | "no-terminal" | "spawn-failed" | undefined,
  copied: boolean,
  t: ReturnType<typeof useT>,
): string {
  if (reason === "web-carrier") {
    return t("dsh.dispatch.handoffWeb");
  }
  return copied ? t("dsh.dispatch.handoffCopied") : t("dsh.dispatch.handoffManual");
}
