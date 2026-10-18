/**
 * 命令行 handoff 共享件（debt ③ 诚实化）：dsh 宿主无第三方可驱动的终端面板，
 * 本机派发/回放的命令行由 host 回传、客户端复制执行——剪贴板 best-effort +
 * 命令行常显可手抄（零静默兜底）。回放（SessionsView）与派发（DispatchOps）共用。
 */
import ui from "../ui/ui.module.css";
import styles from "./tasks.module.css";

/** 剪贴板 best-effort（不可用/权限拒绝 → false——调用方走手动复制提示，零静默） */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** handoff 命令行常显（code 可选中手抄）+ 可选标注（如回放的工作目录） */
export function HandoffLine({
  line,
  aside,
  testId,
}: {
  line: string;
  aside?: string;
  testId: string;
}): React.JSX.Element {
  return (
    <p className={styles.sessNote} data-testid={testId}>
      <code>{line}</code>
      {aside !== undefined && aside !== "" ? <span className={ui.muted}> · {aside}</span> : undefined}
    </p>
  );
}
