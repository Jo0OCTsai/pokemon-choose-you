/**
 * helper 系统能力降级横幅（U30 · FR-X9-4/NFR-12）：helper 未运行/运行时获取失败
 * （hello.caps 未达 → helperCaps null）时面板顶部静态横幅——与 SchemaBanner 同族不叠抢
 * （schema 拒绝优先在上，两者同时呈现时本横幅在其下）；零闪烁（静态常驻，无 animation）；
 * 「查看诊断」锚点跳到背包·诊断分区。helper 恢复即消失（重挂/刷新重查）。
 */
import { useEffect, useState } from "react";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import styles from "./app.module.css";

export function HelperBanner({ onOpenDiagnostics }: { onOpenDiagnostics: () => void }): React.JSX.Element | null {
  const t = useT();
  const client = useClient();
  const [degraded, setDegraded] = useState(false);
  useEffect(() => {
    void client.diagnosticsSnapshot().then((result) => {
      if (result.ok) {
        setDegraded(result.data.helperCaps === null);
      }
    });
  }, [client]);
  if (!degraded) {
    return null;
  }
  return (
    <div className={styles.helperBanner} role="status" data-testid="helper-banner">
      <span aria-hidden="true">🐾</span>
      <span>{t("dsh.helper.banner")}</span>
      <button type="button" className={styles.helperBannerLink} onClick={onOpenDiagnostics}>
        {t("dsh.helper.viewDiag")}
      </button>
    </div>
  );
}
