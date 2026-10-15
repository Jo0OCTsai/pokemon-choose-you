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
  const [testState, setTestState] = useState<{ busy: boolean; identity: string | null; failed: boolean }>({
    busy: false,
    identity: null,
    failed: false,
  });
  return (
    <div className={ui.card}>
      <h4 className={styles.cardTitle}>{t("stabs.feishu")}</h4>
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
      <p className={styles.cardHint}>{t("feishu.hint")}</p>
      <div className={styles.filterRow}>
        <span style={{ flex: 1 }}>{t("feishu.myNames")}</span>
        <TextInput
          ariaLabel={t("feishu.myNames")}
          value={draft["feishu_my_names"]}
          onChange={(v) => onField("feishu_my_names", v)}
          placeholder={t("feishu.myNamesPh")}
        />
      </div>
      <p className={styles.cardHint}>{t("feishu.myNamesDesc")}</p>
      <div className={styles.filterRow}>
        <button
          type="button"
          className={ui.button}
          disabled={authBusy}
          onClick={async () => {
            setAuthBusy(true);
            await client.larkAuth();
            setAuthBusy(false);
          }}
        >
          {t("feishu.auth")}
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
        {testState.busy && <span className={ui.muted}>{t("testing")}</span>}
        {testState.identity !== null && <span>{t("feishu.authorized", { name: testState.identity })}</span>}
        {testState.failed && <span className={styles.saveFailHint}>{t("feishu.unauthorized")}</span>}
      </div>
    </div>
  );
}
