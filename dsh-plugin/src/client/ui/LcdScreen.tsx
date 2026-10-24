/**
 * LCD 输出屏共享容器（specs/dsh-plugin-style T2 ② 类目「只读诊断输出面」——UIUX §6.3
 * 组件单源：向导输出屏与诊断日志屏同一实现件两个落位，「全页仅三处 LCD」以单源保证）。
 * 样式：LCD 绿屏三件套 + 静态扫描线 + 内阴影（零 animation，NFR-6）。
 */
import type { ReactNode } from "react";
import styles from "./ui.module.css";

export function LcdScreen({
  children,
  ariaLabel,
  testId,
}: {
  children: ReactNode;
  ariaLabel: string;
  testId?: string;
}): React.JSX.Element {
  return (
    <div className={styles.lcd} role="log" aria-label={ariaLabel} data-testid={testId}>
      {children}
    </div>
  );
}
