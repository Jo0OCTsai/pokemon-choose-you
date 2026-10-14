/**
 * 飞书分区页（U20 原收音机段改组）：启用轮询/轮询间隔/我的称呼（保存制，U21）+
 * 授权登录/测试连接（即时动作）+ 会话过滤三态（行内乐观写——实体 CRUD，私聊固定跟随
 * 置灰只读，A23）。
 */
import { useState } from "react";
import type { FilterItem } from "../../../host/domain/vocabulary-filters";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import { Select, TextInput, Toggle } from "../../ui/controls";
import ui from "../../ui/ui.module.css";
import type { SectionProps } from "../sectionProps";
import { FEISHU_KEYS } from "../sectionKeys";
import { SectionShell } from "../SectionShell";
import { POLL_INTERVAL_SECS } from "../optionSets";
import styles from "../settings.module.css";

export function FeishuSection({ filters, ...props }: SectionProps & { filters: FilterItem[] }): React.JSX.Element {
  const { draft, saved, onField, onSavedKeys } = props;
  const t = useT();
  const client = useClient();
  const [chatList, setChatList] = useState(filters);
  const [authBusy, setAuthBusy] = useState(false);
  const [testState, setTestState] = useState<{ busy: boolean; identity: string | null; failed: boolean }>({
    busy: false,
    identity: null,
    failed: false,
  });

  async function setFilter(chatId: string, state: FilterItem["state"]): Promise<void> {
    // 行内乐观写：即时生效（不进保存制），失败回读
    setChatList((list) => list.map((c) => (c.chatId === chatId ? { ...c, state } : c)));
    const result = await client.filterUpsert({ chatId, state });
    if (!result.ok) {
      const fresh = await client.filterList();
      if (fresh.ok) {
        setChatList(fresh.data.chats);
      }
    }
  }

  return (
    <SectionShell
      title={`📡 ${t("stabs.feishu")}`}
      keys={FEISHU_KEYS}
      draft={draft}
      saved={saved}
      onSavedKeys={onSavedKeys}
    >
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
      <div className={ui.card}>
        <h4 className={styles.cardTitle}>{t("feishu.filter.title")}</h4>
        <p className={styles.cardHint}>{t("feishu.filter.hint")}</p>
        <div className={styles.entityList}>
          {chatList.map((chat) => (
            <div key={chat.chatId} className={styles.filterRow} data-testid="filter-row">
              <span className={styles.filterChatName}>{chat.chatName}</span>
              {chat.chatType === "p2p" ? (
                <span className={ui.muted} title={t("dsh.filter.p2pLocked")}>
                  {t("feishu.filter.prefFollow")} · {t("dsh.filter.p2pLocked")}
                </span>
              ) : (
                <span
                  className={styles.triStateGroup}
                  role="group"
                  aria-label={`${chat.chatName}：${t("feishu.filter.prefGroupLabel", { name: "" })}`}
                >
                  {(
                    [
                      ["follow", t("feishu.filter.prefFollow")],
                      ["always_pull", t("feishu.filter.prefPull")],
                      ["always_filter", t("feishu.filter.prefFilter")],
                    ] as const
                  ).map(([state, label]) => (
                    <button
                      key={state}
                      type="button"
                      className={styles.triStateButton}
                      aria-pressed={chat.state === state}
                      onClick={() => void setFilter(chat.chatId, state)}
                    >
                      {label}
                    </button>
                  ))}
                </span>
              )}
            </div>
          ))}
        </div>
        <p className={styles.cardHint}>{t("feishu.filter.footImmediate")}</p>
      </div>
    </SectionShell>
  );
}
