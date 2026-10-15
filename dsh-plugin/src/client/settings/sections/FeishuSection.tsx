/**
 * 飞书分区页（U20 原收音机段改组）：启用轮询/轮询间隔/我的称呼（保存制，U21）+
 * 授权登录/测试连接（即时动作）+ 会话过滤管理（对齐主应用 FeishuChatFilterManager：
 * 搜索/生效状态/偏好/类型三维前端筛选 + 汇总计数行 + 快照新鲜度（staleOk 时间行 /
 * 超 max(5, 2.5×轮询间隔) 分钟 staleWarn banner + 立即拉取一次）；行内乐观写——
 * 实体 CRUD，私聊固定跟随置灰只读，A23。快照时间 = host filterList 的 lastPollAt
 * （health 最近一次成功拉取）。
 */
import { useState } from "react";
import type { FilterItem } from "../../../host/domain/vocabulary-filters";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import { Select, TextInput } from "../../ui/controls";
import ui from "../../ui/ui.module.css";
import type { SectionProps } from "../sectionProps";
import { FEISHU_KEYS } from "../sectionKeys";
import { SectionShell } from "../SectionShell";
import { POLL_INTERVAL_SECS } from "../optionSets";
import styles from "../settings.module.css";
import { FeishuConnCard } from "./FeishuConnCard";

/** 生效/偏好/类型三维筛选档（dsh 数据面：state 即偏好——手动=always_*，生效口径跟随手动值） */
type EffFilter = "all" | "pull" | "filter";
type PrefFilter = "all" | "follow" | "manual";
type TypeFilter = "all" | "group" | "bot";

/** 生效档匹配（pull=always_pull / filter=always_filter / all 不筛） */
function matchesEffState(state: FilterItem["state"], eff: EffFilter): boolean {
  if (eff === "pull") {
    return state === "always_pull";
  }
  if (eff === "filter") {
    return state === "always_filter";
  }
  return true;
}

/** 偏好档匹配（follow=跟随 / manual=非 follow / all 不筛） */
function matchesPrefState(state: FilterItem["state"], pref: PrefFilter): boolean {
  if (pref === "follow") {
    return state === "follow";
  }
  if (pref === "manual") {
    return state !== "follow";
  }
  return true;
}

/** 名称搜索 + 生效/偏好/类型三维筛选（前端过滤，三维档各自独立匹配） */
function chatMatchesFilters(chat: FilterItem, q: string, eff: EffFilter, pref: PrefFilter, type: TypeFilter): boolean {
  if (q !== "" && !chat.chatName.toLowerCase().includes(q)) {
    return false;
  }
  if (!matchesEffState(chat.state, eff) || !matchesPrefState(chat.state, pref)) {
    return false;
  }
  return type === "all" || chat.chatType === type;
}

/** 快照年龄（分钟；仅启用且已拉取时计算，否则 null） */
function snapshotAgeMin(enabled: string | undefined, lastPoll: string | null): number | null {
  const pollMs = Date.parse(lastPoll ?? "");
  if (enabled !== "true" || !Number.isFinite(pollMs)) {
    return null;
  }
  return Math.round((Date.now() - pollMs) / 60_000);
}

/** 过期阈值（分钟；桌面同口径 = max(5, 2.5×轮询间隔秒/60)） */
function staleThresholdMin(interval: string | undefined): number {
  return Math.max(5, (2.5 * (Number(interval) || POLL_INTERVAL_SECS[1])) / 60);
}

/** 连接卡拆件 → FeishuConnCard.tsx */

export function FeishuSection({
  filters,
  lastPollAt,
  ...props
}: SectionProps & { filters: FilterItem[]; lastPollAt?: string | null }): React.JSX.Element {
  const { draft, saved, onField, onSavedKeys } = props;
  const t = useT();
  const client = useClient();
  const [chatList, setChatList] = useState(filters);
  const [query, setQuery] = useState("");
  const [effFilter, setEffFilter] = useState<EffFilter>("all");
  const [prefFilter, setPrefFilter] = useState<PrefFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  /** 汇总计数（全量口径：拉取=always_pull、过滤=always_filter、手动=非 follow——前端计数） */
  const counts = {
    total: chatList.length,
    pulling: chatList.filter((c) => c.state === "always_pull").length,
    filtered: chatList.filter((c) => c.state === "always_filter").length,
    manual: chatList.filter((c) => c.state !== "follow").length,
  };
  const visibleChats = chatList.filter((chat) =>
    chatMatchesFilters(chat, query.trim().toLowerCase(), effFilter, prefFilter, typeFilter),
  );

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

  /** 快照新鲜度呈现（staleWarn banner / staleOk 时间行） */
  const [polling, setPolling] = useState(false);
  const [lastPoll, setLastPoll] = useState<string | null>(lastPollAt ?? null);
  const ageMin = snapshotAgeMin(draft["feishu_enabled"], lastPoll);
  const stale = ageMin !== null && ageMin > staleThresholdMin(draft["feishu_poll_interval"]);

  async function pollNowAndRefresh(): Promise<void> {
    setPolling(true);
    await client.pollNow();
    const fresh = await client.filterList();
    if (fresh.ok) {
      setChatList(fresh.data.chats);
      setLastPoll(fresh.data.lastPollAt);
    }
    setPolling(false);
  }

  return (
    <SectionShell
      title={`📡 ${t("stabs.feishu")}`}
      keys={FEISHU_KEYS}
      draft={draft}
      saved={saved}
      onSavedKeys={onSavedKeys}
    >
      <FeishuConnCard draft={draft} onField={onField} />
      <div className={ui.card}>
        <h4 className={styles.cardTitle}>{t("feishu.filter.title")}</h4>
        <p className={styles.cardHint}>{t("feishu.filter.hint")}</p>
        <p className={styles.cardHint} data-testid="filter-summary">
          {t("feishu.filter.summary", {
            total: counts.total,
            pulling: counts.pulling,
            filtered: counts.filtered,
            manual: counts.manual,
          })}
        </p>
        {ageMin !== null &&
          (stale ? (
            <div className={styles.filterRow} data-testid="filter-stale" role="alert">
              <span style={{ flex: 1 }}>{t("feishu.filter.staleWarn", { min: ageMin })}</span>
              <button type="button" className={ui.button} disabled={polling} onClick={() => void pollNowAndRefresh()}>
                {t("feishu.pollNow")}
              </button>
            </div>
          ) : (
            <p className={styles.cardHint} data-testid="filter-snaptime">
              {t("feishu.filter.staleOk", { time: (lastPoll ?? "").slice(0, 16).replace("T", " ") })}
            </p>
          ))}
        <div className={styles.filterRow}>
          <TextInput
            ariaLabel={t("feishu.filter.searchLabel")}
            value={query}
            onChange={setQuery}
            placeholder={t("feishu.filter.searchPh")}
          />
          <Select
            ariaLabel={t("feishu.filter.chipsLabel")}
            value={effFilter}
            options={[
              { value: "all", label: t("feishu.filter.fAll", { n: counts.total }) },
              { value: "pull", label: t("feishu.filter.fPull", { n: counts.pulling }) },
              { value: "filter", label: t("feishu.filter.fFiltered", { n: counts.filtered }) },
            ]}
            onChange={(v) => setEffFilter(v as EffFilter)}
          />
          <Select
            ariaLabel={t("feishu.filter.prefChipsLabel")}
            value={prefFilter}
            options={[
              { value: "all", label: t("feishu.filter.pAll", { n: counts.total }) },
              { value: "follow", label: t("feishu.filter.fFollow", { n: counts.total - counts.manual }) },
              { value: "manual", label: t("feishu.filter.fManual", { n: counts.manual }) },
            ]}
            onChange={(v) => setPrefFilter(v as PrefFilter)}
          />
          <Select
            ariaLabel={t("feishu.filter.typeChipsLabel")}
            value={typeFilter}
            options={[
              {
                value: "all",
                label: t("feishu.filter.tAll", { n: counts.total }),
              },
              {
                value: "group",
                label: t("feishu.filter.tGroup", { n: chatList.filter((c) => c.chatType === "group").length }),
              },
              {
                value: "bot",
                label: t("feishu.filter.tBot", { n: chatList.filter((c) => c.chatType === "bot").length }),
              },
            ]}
            onChange={(v) => setTypeFilter(v as TypeFilter)}
          />
        </div>
        <div className={styles.entityList}>
          {visibleChats.map((chat) => (
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
