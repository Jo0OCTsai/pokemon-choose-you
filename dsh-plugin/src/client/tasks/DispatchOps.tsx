/**
 * 派发操作（桌面抽屉 .dsp-row 同构）：通道下拉（交互/无头）+ agent 改选下拉（多 agent
 * 时）+ agent 徽章（SSH 标注）+ 工作目录 + ⚡出发（running/queued 禁用）；排队中/执行中
 * 另有手动收口行（标记完成/失败/重置——agent 未回传时的救援）。无项目标签/无可用 agent
 * 给引导 hint；DISPATCH_ALREADY_ACTIVE 中性提示不弹窗。
 * 呈现拆件 → DispatchRow.tsx（状态徽章/收口行/派发行 + 派生 helper）。
 */
import { useState } from "react";
import type { Task } from "../../host/domain/tasks";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import type { PanelData } from "../model";
import ui from "../ui/ui.module.css";
import { DispatchBody, MarkRow, StateBadge } from "./DispatchRow";
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
  const route = data.routes.find((r) => task.tags.some((tag) => tag.name === r.tag));
  /** 改选值（预填路由解析结果；空串 = 跟随路由/全局默认） */
  const [agentId, setAgentId] = useState(route?.agentId ?? "");
  const agents = (data.agents ?? []).filter((a) => a.enabled);

  async function dispatch(): Promise<void> {
    setBusy(true);
    setConflict(null);
    setMessage(null);
    const override = agentId !== "" && agentId !== route?.agentId ? { routeOverride: { agentId } } : {};
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
    <div data-testid="dispatch-ops">
      <h4 className={styles.drawerSectionTitle}>
        {t("dispatch.title")} <StateBadge state={dispatchState} />
      </h4>
      <MarkRow
        state={dispatchState}
        readonly={readonly}
        busy={busy}
        onMark={(state: "done" | "failed" | "reset") => void mark(state)}
      />
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
      />
      {conflict !== null && (
        <div role="status" className={ui.muted}>
          {conflict}
        </div>
      )}
      {message !== null && <p className={styles.drawerErr}>{message}</p>}
    </div>
  );
}
