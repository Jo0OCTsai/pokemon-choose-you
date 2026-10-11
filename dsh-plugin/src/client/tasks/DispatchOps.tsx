/**
 * 派发操作：交互/无头双通道（路由确认弹层——可临时改选不回写路由）+ 收口三键 +
 * 取消排队 + 重派（续接）；互斥冲突（DISPATCH_ALREADY_ACTIVE）中性提示不弹窗。
 */
import { useState } from "react";
import type { Task } from "../../host/domain/tasks";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import type { PanelData } from "../model";
import { Modal } from "../ui/Modal";
import ui from "../ui/ui.module.css";
import styles from "./tasks.module.css";

/** 派发操作：交互/无头双通道（路由确认弹层）+ 收口三键 + 取消排队 + 重派 */
/** 单个派发操作（command 直发或 channel 先弹确认层） */
interface DispatchOp {
  labelKey: string;
  channel?: "interactive" | "headless";
  command?: string;
  queuedOnly?: boolean;
  run?: (client: import("../rpc").HostClient, taskId: number) => Promise<unknown>;
}

const OPS: readonly DispatchOp[] = [
  { labelKey: "dispatch.chInteractive", channel: "interactive" },
  { labelKey: "dispatch.chHeadless", channel: "headless" },
  { labelKey: "dsh.dispatch.redo", command: "dispatchRedo", run: (c, id) => c.dispatchRedo({ taskId: id }) },
  {
    labelKey: "dispatch.markDone",
    command: "dispatchClose",
    run: (c, id) => c.dispatchClose({ taskId: id, result: "done" }),
  },
  {
    labelKey: "dispatch.markFailed",
    command: "dispatchClose",
    run: (c, id) => c.dispatchClose({ taskId: id, result: "failed" }),
  },
  { labelKey: "dispatch.markReset", command: "dispatchReset", run: (c, id) => c.dispatchReset({ taskId: id }) },
  {
    labelKey: "dsh.dispatch.cancelQueued",
    command: "dispatchCancel",
    queuedOnly: true,
    run: (c, id) => c.dispatchCancel({ taskId: id }),
  },
];

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
  const [channel, setChannel] = useState<"interactive" | "headless" | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const route = data.routes.find((r) => task.tags.some((tag) => tag.name === r.tag));
  const agentId = route?.agentId ?? "";

  async function dispatch(): Promise<void> {
    if (channel === null) {
      return;
    }
    setBusy(true);
    const result =
      channel === "interactive"
        ? await client.dispatchInteractive({ taskId: task.id })
        : await client.dispatchHeadless({ taskId: task.id });
    setBusy(false);
    setChannel(null);
    if (!result.ok && result.error.code === "DISPATCH_ALREADY_ACTIVE") {
      setConflict(t("dsh.toast.dispatchBusy"));
    } else {
      setConflict(null);
    }
    onChanged();
  }

  async function runOp(op: DispatchOp): Promise<void> {
    if (op.command !== undefined && op.run !== undefined) {
      setBusy(true);
      await op.run(client, task.id);
      setBusy(false);
      onChanged();
      return;
    }
    setChannel(op.channel === "headless" ? "headless" : "interactive");
  }

  const routeInfo =
    route === undefined
      ? { agent: t("dispatchCfg.auto"), dir: t("dispatch.dirDefault"), project: t("dsh.dispatch.sourceDefault") }
      : {
          agent: agentId === "" ? t("dispatchCfg.auto") : agentId,
          dir: route.workdir === "" ? t("dispatch.dirDefault") : route.workdir,
          project: route.tag,
        };
  return (
    <div data-testid="dispatch-ops">
      <h4 className={styles.drawerSectionTitle}>{t("dispatch.title")}</h4>
      <div className={styles.opsRow}>
        {OPS.map((op) => (
          <button
            key={op.labelKey}
            type="button"
            className={ui.button}
            disabled={readonly || busy || (op.queuedOnly === true && task.dispatchState !== "queued")}
            onClick={() => void runOp(op)}
          >
            {t(op.labelKey)}
          </button>
        ))}
      </div>
      {conflict !== null && (
        <div role="status" className={ui.muted}>
          {conflict}
        </div>
      )}
      {channel !== null && (
        <DispatchConfirm routeInfo={routeInfo} onCancel={() => setChannel(null)} onConfirm={() => void dispatch()} />
      )}
    </div>
  );
}

/** 路由确认弹层（可临时改选不回写路由；交互通道在终端面板启动说明） */
function DispatchConfirm({
  routeInfo,
  onCancel,
  onConfirm,
}: {
  routeInfo: { agent: string; dir: string; project: string };
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const t = useT();
  return (
    <Modal
      title={t("dispatch.title")}
      actions={[
        { label: t("cancel"), onChoose: onCancel },
        { label: t("dispatch.go"), onChoose: onConfirm, variant: "primary" },
      ]}
      onClose={onCancel}
    >
      {t("dsh.dispatch.confirm", { ...routeInfo, scope: t("dsh.dispatch.scopeLocal") })}
    </Modal>
  );
}
