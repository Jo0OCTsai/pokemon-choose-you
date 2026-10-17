/**
 * 飞书分区拆件 · 连接卡（从 FeishuSection 等量迁出）：启用轮询/轮询间隔/我的称呼
 * （保存制字段）+ 授权登录/测试连接（即时动作，测试回显身份或未授权提示）。
 */
import { useState } from "react";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import { Select, TextInput, Toggle } from "../../ui/controls";
import ui from "../../ui/ui.module.css";
import { POLL_INTERVAL_SECS } from "../optionSets";
import styles from "../settings.module.css";

/** 连接卡：启用轮询/轮询间隔/我的称呼（保存制字段）+ 授权登录/测试连接（即时动作） */
export function FeishuConnCard({
  draft,
  onField,
}: {
  draft: Record<string, string>;
  onField: (key: string, value: string) => void;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [authBusy, setAuthBusy] = useState(false);
  const [authLaunched, setAuthLaunched] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [testState, setTestState] = useState<{ busy: boolean; identity: string | null; failed: boolean }>({
    busy: false,
    identity: null,
    failed: false,
  });
  return (
    <div className={ui.card}>
      <h4 className={styles.cardTitle} data-tip={t("feishu.hint")}>
        {t("stabs.feishu")}
      </h4>
      <Toggle
        label={t("feishu.enable")}
        checked={draft["feishu_enabled"] === "true"}
        onChange={(v) => onField("feishu_enabled", String(v))}
      />
      <Select
        label={t("feishu.interval")}
        value={draft["feishu_poll_interval"]}
        options={POLL_INTERVAL_SECS.map((secs) => ({
          value: String(secs),
          label: t("focus.minutes", { n: secs / 60 }),
        }))}
        onChange={(v) => onField("feishu_poll_interval", v)}
      />
      <div className={styles.filterRow}>
        <span style={{ flex: 1 }} data-tip={t("feishu.myNamesDesc")}>
          {t("feishu.myNames")}
        </span>
        {/* 定宽 250 右档（背包设置页统一口径，与设置行下拉同宽） */}
        <TextInput
          className={styles.w250}
          ariaLabel={t("feishu.myNames")}
          value={draft["feishu_my_names"]}
          onChange={(v) => onField("feishu_my_names", v)}
          placeholder={t("feishu.myNamesPh")}
        />
      </div>
      <div className={styles.filterRow}>
        {/* U28：授权登录升级为终端面板一键启动（larkLoginStart——FR-C3；登录态查询走测试连接） */}
        <button
          type="button"
          className={ui.button}
          data-testid="lark-login-btn"
          disabled={authBusy}
          onClick={async () => {
            setAuthBusy(true);
            setAuthLaunched(false);
            setAuthError(null);
            const result = await client.larkLoginStart();
            if (result.ok && result.data.ok) {
              setAuthLaunched(true);
            } else {
              setAuthError(result.ok ? result.data.note : result.error.message);
            }
            setAuthBusy(false);
          }}
        >
          {t("dsh.lark.login")}
        </button>
        <button
          type="button"
          className={ui.button}
          disabled={testState.busy}
          onClick={async () => {
            setTestState({ busy: true, identity: null, failed: false });
            const result = await client.larkTest();
            setTestState(
              result.ok
                ? { busy: false, identity: result.data.identity, failed: false }
                : { busy: false, identity: null, failed: true },
            );
          }}
        >
          {t("feishu.test")}
        </button>
        {authBusy && <span className={ui.muted}>{t("testing")}</span>}
        {authLaunched && <span data-testid="lark-launched">{t("dsh.lark.launched")}</span>}
        {authError !== null && (
          <span className={styles.saveFailHint} data-testid="lark-launch-failed">
            {t("dsh.lark.launchFailed", { reason: authError })}
          </span>
        )}
        {testState.busy && <span className={ui.muted}>{t("testing")}</span>}
        {testState.identity !== null && <span>{t("feishu.authorized", { name: testState.identity })}</span>}
        {testState.failed && <span className={styles.saveFailHint}>{t("feishu.unauthorized")}</span>}
      </div>
    </div>
  );
}
