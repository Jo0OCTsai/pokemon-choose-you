/**
 * AX 授权引导块（U26 · FR-A9/D32）：输入响应的授权门槛引导——
 * - 未授权：说明（只统计按键频率——不记录键值、键名、窗口或应用）+ helper 二进制路径
 *   code[点击复制]（⌘⇧G 手动兜底提示）+ [去授权] 直达系统设置辅助功能面板。
 * - 失效（开关开启但授权被中途撤销）：提示「授权已失效，需重新授权。授权恢复前输入响应保持停止」
 *   + 指引块（重新授权入口）。
 * - 已授权：整块消失（授权是开关的伴随态，不是独立设置）。
 * 非 macOS 平台输入响应整卡隐藏（D32 终局口径——非置灰）；授权状态 = 查询 + 聚焦复查。
 */
import { useT } from "../../i18n";
import ui from "../../ui/ui.module.css";
import styles from "../settings.module.css";

/** 平台判定（D32：输入响应 = macOS 辅助功能专属能力；测试可覆写 navigator.platform） */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  const platform = navigator.platform ?? "";
  return platform.toLowerCase().includes("mac") || /Macintosh/.test(navigator.userAgent ?? "");
}

export function AxPermHint({
  granted,
  revoked,
  helperPath,
  onAuthorize,
}: {
  granted: boolean;
  /** 开关开启但授权缺失 = 中途撤销（失效态文案前置） */
  revoked: boolean;
  helperPath: string;
  onAuthorize: () => void;
}): React.JSX.Element | null {
  const t = useT();
  if (granted) {
    return null;
  }
  return (
    <div className={styles.axPermHint} data-testid="ax-perm-hint">
      {revoked && (
        <p className={styles.axPermRevoked} role="alert" data-testid="ax-perm-revoked">
          {t("dsh.ax.revoked")}
        </p>
      )}
      <p>{t("dsh.ax.guide")}</p>
      <p className={styles.axPermPathRow}>
        <button
          type="button"
          className={styles.axPermPath}
          title={t("dsh.ax.copyPath")}
          onClick={() => {
            void navigator.clipboard?.writeText(helperPath).catch(() => undefined);
          }}
        >
          {helperPath}
        </button>
      </p>
      <p className={styles.axPermPathHint}>{t("dsh.ax.pathHint", { path: helperPath })}</p>
      <button type="button" className={ui.buttonDex} onClick={onAuthorize}>
        {t("dsh.ax.authorize")}
      </button>
    </div>
  );
}
