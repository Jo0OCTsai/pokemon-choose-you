/**
 * 卡内快捷操作（随状态呈现：出发/暂停/完成——U12 卡尾溢出菜单承接其余操作）。
 */
import type { Task } from "../../host/domain/tasks";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import ui from "../ui/ui.module.css";
import styles from "./tasks.module.css";

/** 卡内快捷操作（随状态呈现：出发/暂停/完成——U12 卡尾溢出菜单承接其余操作） */
export function TaskQuickOps({
  task,
  readonly,
  onChanged,
}: {
  task: Task;
  readonly: boolean;
  onChanged: () => void;
}): React.JSX.Element {
  const client = useClient();
  const canStart = task.status === "inbox" || task.status === "scheduled" || task.status === "paused";
  const canPause = task.status === "active";
  const canDone = task.status !== "done" && task.status !== "cancelled";
  return (
    <span className={styles.quickOps}>
      {canStart && <StartButton task={task} readonly={readonly} onChanged={onChanged} client={client} />}
      {canDone && <DoneButton task={task} readonly={readonly} onChanged={onChanged} client={client} />}
      {canPause && <PauseButton task={task} readonly={readonly} onChanged={onChanged} client={client} />}
    </span>
  );
}

type OpsClient = ReturnType<typeof useClient>;

function StartButton({
  task,
  readonly,
  onChanged,
  client,
}: {
  task: Task;
  readonly: boolean;
  onChanged: () => void;
  client: OpsClient;
}): React.JSX.Element {
  const t = useT();
  return (
    <button
      type="button"
      className={ui.button}
      disabled={readonly}
      onClick={(event) => {
        event.stopPropagation();
        void client.taskStart({ taskId: task.id }).then(() => onChanged());
      }}
    >
      {t("entry.start")}
    </button>
  );
}

function DoneButton({
  task,
  readonly,
  onChanged,
  client,
}: {
  task: Task;
  readonly: boolean;
  onChanged: () => void;
  client: OpsClient;
}): React.JSX.Element {
  const t = useT();
  return (
    <button
      type="button"
      className={ui.button}
      disabled={readonly}
      onClick={(event) => {
        event.stopPropagation();
        void client.taskComplete({ taskId: task.id }).then(() => onChanged());
      }}
    >
      {t("entry.done")}
    </button>
  );
}

function PauseButton({
  task,
  readonly,
  onChanged,
  client,
}: {
  task: Task;
  readonly: boolean;
  onChanged: () => void;
  client: OpsClient;
}): React.JSX.Element {
  const t = useT();
  return (
    <button
      type="button"
      className={ui.button}
      disabled={readonly}
      onClick={(event) => {
        event.stopPropagation();
        void client.taskPause({ taskId: task.id }).then(() => onChanged());
      }}
    >
      {t("entry.pause")}
    </button>
  );
}
