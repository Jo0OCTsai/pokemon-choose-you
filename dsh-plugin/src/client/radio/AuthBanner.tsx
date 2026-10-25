/**
 * 授权横幅：未授权（收音机还没调频 + 授权登录）/ 授权失效（单次横幅 + 重新授权，
 * 不刷屏——轮询失败不重复弹出）。授权动作为即时动作（larkAuth）。
 */
import { useState } from "react";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import ui from "../ui/ui.module.css";
import styles from "./radio.module.css";

export function AuthBanner({
  expired,
  readonly,
  onChanged,
}: {
  /** true = 已授权但失效（单次横幅语义）；false = 从未授权 */
  expired: boolean;
  readonly: boolean;
  onChanged: () => void;
}): React.JSX.Element | null {
  const t = useT();
  const client = useClient();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  if (expired && dismissed) {
    return null;
  }
  return (
    <div className={styles.authBanner} role="status" data-testid="auth-banner">
      <span aria-hidden="true">📡</span>
      <span className="auth-text">{expired ? t("dsh.auth.expired") : t("dsh.auth.unauthorized")}</span>
      <button
        type="button"
        className={ui.button}
        disabled={readonly || busy}
        onClick={async () => {
          setBusy(true);
          await client.larkAuth();
          setBusy(false);
          onChanged();
        }}
      >
        {expired ? t("feishu.reauth") : t("feishu.auth")}
      </button>
      {expired && (
        <button type="button" className={ui.button} aria-label={t("im.collapse")} onClick={() => setDismissed(true)}>
          ✕
        </button>
      )}
    </div>
  );
}
