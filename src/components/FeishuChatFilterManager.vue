<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useI18n } from "vue-i18n";
import { api, errorMessage } from "../api";
import { EVENTS } from "../events";
import { fmtDateTime, useSettingsStore } from "../stores/settings";
import type { FeishuChatFilterOverview, FeishuChatFilterPreference, FeishuChatFilterView } from "../types";

/**
 * 飞书会话过滤管理卡（设置 · 集成 stab，飞书卡正下方）。
 * 自取数组件（AD §3.2 就地决策：单一消费者不建 Pinia store）：
 * - 挂载 / feishu-chat-filter-changed 事件 → 重读总览（纯本地读，保留当前搜索词与筛选档）；
 * - 偏好点击即写库即时生效（不进设置页保存缓冲），乐观更新后用命令返回值校正；
 * - feishu_enabled 停用联动：设置 store 响应式读取（开关就在上方，草稿态即联动）。
 */

const { t } = useI18n();
const settings = useSettingsStore();

// ---- 数据与工具行状态 ----
const overview = ref<FeishuChatFilterOverview | null>(null);
const loading = ref(false);
const loadedOnce = ref(false);
const loadError = ref("");
const query = ref("");
const filter = ref<"all" | "filtered" | "manual">("all");
/** 写入中的行（防连点：三段 busy 视觉 + 点击/键盘守卫） */
const writingIds = ref(new Set<string>());
const polling = ref(false);

// ---- toast（写入失败 / 拉取结果，5s 自动消失；role=status 读屏播报） ----
const toast = ref<{ text: string; error?: boolean } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(text: string, error = false) {
  toast.value = { text, error };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), 5000);
}

/** 错误两层结构的「技术原文」层（不叠图鉴机前缀，由外层文案自带前缀句式） */
function rawError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---- 联动与陈旧阈值（读设置 store：feishu_enabled / feishu_poll_interval 秒） ----
const feishuEnabled = computed(() => settings.sget("feishu_enabled") === "true");
const thresholdMin = computed(() => Math.max(5, (2.5 * settings.sgetNum("feishu_poll_interval", 120)) / 60));

// ---- 面板状态机（uiux §4；停用联动置顶：任意态 → 空·未启用） ----
type PanelState = "disabled" | "loading" | "error" | "noSnapshot" | "snapEmpty" | "ready";
const state = computed<PanelState>(() => {
  if (!feishuEnabled.value) return "disabled";
  if (loading.value && !loadedOnce.value) return "loading";
  if (loadError.value) return "error";
  if (!overview.value) return "loading";
  // 空态区分（契约收敛）：无快照键 = 从未成功拉取；有键空表 = 零会话账号
  if (overview.value.snapshotAt == null) return "noSnapshot";
  if (!overview.value.chats.length) return "snapEmpty";
  return "ready";
});

// ---- 取数 ----
async function load() {
  if (!feishuEnabled.value) return; // 停用态是引导启用态，不取数
  loading.value = true;
  try {
    overview.value = await api.getFeishuChatFilterOverview();
    loadedOnce.value = true;
    loadError.value = "";
  } catch (e) {
    // 首次读取失败 → 错误行 + 重试；已有数据时的后台刷新失败 → toast 不打散列表
    if (overview.value) showToast(t("feishu.filter.loadFail", { err: rawError(e) }), true);
    else loadError.value = rawError(e);
  } finally {
    loading.value = false;
  }
}

/** 立即拉取一次（空态与陈旧横幅共用；与飞书卡同名按钮 busy 态不联动，并发由后端守卫兜底） */
async function pollNow() {
  if (polling.value) return;
  polling.value = true;
  try {
    const n = await api.triggerFeishuPoll();
    await load();
    showToast(t("feishu.pollResult", { n }));
  } catch (e) {
    showToast(errorMessage(e), true);
  } finally {
    polling.value = false;
  }
}

// ---- 摘要计数（后端行视图的本地汇总：effective/preference 均为后端合并直出） ----
const counts = computed(() => {
  const chats = overview.value?.chats ?? [];
  const pulling = chats.filter((c) => c.effective === "pull").length;
  return {
    total: chats.length,
    pulling,
    filtered: chats.length - pulling,
    manual: chats.filter((c) => c.preference !== "follow").length,
  };
});

// ---- 筛选 chips（全部/被过滤/手动设置；计数为 0 禁用；选中档降 0 自动回退全部） ----
const chipCounts = computed(() => ({
  all: counts.value.total,
  filtered: counts.value.filtered,
  manual: counts.value.manual,
}));
watch(chipCounts, (c) => {
  if (filter.value !== "all" && c[filter.value] === 0) filter.value = "all";
});
const chipDefs = computed(() => [
  { key: "all" as const, labelKey: "feishu.filter.fAll", count: chipCounts.value.all },
  { key: "filtered" as const, labelKey: "feishu.filter.fFiltered", count: chipCounts.value.filtered },
  { key: "manual" as const, labelKey: "feishu.filter.fManual", count: chipCounts.value.manual },
]);

// ---- 列表：搜索（名称子串本地过滤）+ 筛选 + 排序（手动置顶 → 类型 → 名称） ----
const TYPE_ORDER: Record<string, number> = { group: 0, p2p: 1, bot: 2 };
const visibleRows = computed(() => {
  const q = query.value.trim().toLowerCase();
  const chats = overview.value?.chats ?? [];
  return [...chats]
    .filter((c) => {
      if (q && !c.chatName.toLowerCase().includes(q)) return false;
      if (filter.value === "filtered") return c.effective === "filter";
      if (filter.value === "manual") return c.preference !== "follow";
      return true;
    })
    .sort((a, b) => {
      const am = a.preference === "follow" ? 1 : 0;
      const bm = b.preference === "follow" ? 1 : 0;
      if (am !== bm) return am - bm;
      const at = TYPE_ORDER[a.chatType] ?? 3;
      const bt = TYPE_ORDER[b.chatType] ?? 3;
      if (at !== bt) return at - bt;
      return a.chatName.localeCompare(b.chatName, "zh");
    });
});
/** 空·无匹配仅由搜索词触发（0 计数筛选档已禁用 + 选中档降 0 回退，uiux §3.2） */
const noMatch = computed(() => state.value === "ready" && visibleRows.value.length === 0 && !!query.value.trim());

// ---- 快照新鲜度（阈值 = max(5 分钟, 2.5 × 轮询间隔)，uiux §3.2 陈旧度呈现） ----
const snapTime = computed(() => overview.value?.snapshotAt ?? null);
const snapshotAgeMin = computed(() => {
  const snap = snapTime.value;
  if (!snap) return null;
  const ms = Date.now() - new Date(snap).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms / 60000;
});
const isStale = computed(
  () => state.value === "ready" && snapshotAgeMin.value !== null && snapshotAgeMin.value > thresholdMin.value,
);
const staleMin = computed(() => Math.round(snapshotAgeMin.value ?? 0));

// ---- 三段选择器（radiogroup；roving tabindex 键盘处方 uiux §6.2） ----
const SEGS: { value: FeishuChatFilterPreference; labelKey: string; titleKey: string }[] = [
  { value: "follow", labelKey: "feishu.filter.prefFollow", titleKey: "feishu.filter.prefFollowTitle" },
  { value: "always_pull", labelKey: "feishu.filter.prefPull", titleKey: "feishu.filter.prefPullTitle" },
  { value: "always_filter", labelKey: "feishu.filter.prefFilter", titleKey: "feishu.filter.prefFilterTitle" },
];

/** 乐观写入：三段选中态即时切换 → 成功用返回行视图校正；失败回滚 + 错误 toast。
 *  keyboard = 经键盘触发时，写入/回滚后焦点跟随当前选中段（保 roving 不丢焦） */
async function setPref(row: FeishuChatFilterView, preference: FeishuChatFilterPreference, keyboard = false) {
  if (row.preference === preference || writingIds.value.has(row.chatId)) return;
  const prev = row.preference;
  writingIds.value.add(row.chatId);
  row.preference = preference; // 乐观（不等命令返回；生效 chip/计数待返回值校正）
  try {
    const fresh = await api.setFeishuChatFilter(row.chatId, preference);
    Object.assign(row, fresh); // 后端合并后的该行最新状态（前端零合并逻辑）
  } catch (e) {
    row.preference = prev; // 回滚（不弹跳不闪烁，错误反馈走 toast）
    showToast(t("feishu.filter.writeFail", { err: rawError(e) }), true);
  } finally {
    writingIds.value.delete(row.chatId);
  }
  if (keyboard) void focusSelectedSeg(row.chatId);
}

/** 键盘处方：方向键循环移动并即选即写（与点击同一路径），Home/End 跳首末段 */
function onSegKeydown(e: KeyboardEvent, row: FeishuChatFilterView) {
  if (writingIds.value.has(row.chatId)) return;
  const order: FeishuChatFilterPreference[] = SEGS.map((s) => s.value);
  const cur = order.indexOf(row.preference);
  let next: number;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (cur + 1) % order.length;
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (cur - 1 + order.length) % order.length;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = order.length - 1;
  else return;
  e.preventDefault();
  const val = order[next];
  if (val === row.preference) {
    (e.currentTarget as HTMLElement | null)?.querySelectorAll("button")[next]?.focus();
  } else {
    void setPref(row, val, true);
  }
}

// ---- 生效 chip（系统决策预演：拉取/过滤 × 手动/跟随/降级） ----
function effClass(row: FeishuChatFilterView): string {
  if (row.source === "followDegraded") return "degraded";
  return row.effective === "pull" ? "pull" : "mute";
}
function effSourceKey(row: FeishuChatFilterView): string {
  if (row.source === "manual") return "feishu.filter.srcManual";
  if (row.source === "follow") return "feishu.filter.srcFollow";
  return "feishu.filter.srcDegraded";
}
function effText(row: FeishuChatFilterView): string {
  const base = t(row.effective === "pull" ? "feishu.filter.effPull" : "feishu.filter.effFilter");
  const src = t(effSourceKey(row));
  return row.source === "followDegraded" ? `${base} · ${src} ⚠` : `${base} · ${src}`;
}
function effTitle(row: FeishuChatFilterView): string {
  if (row.source === "followDegraded") return t("feishu.filter.srcDegradedTitle");
  if (row.source === "manual")
    return t(row.preference === "always_pull" ? "feishu.filter.prefPullTitle" : "feishu.filter.prefFilterTitle");
  return t("feishu.filter.prefFollowTitle");
}

// ---- 键盘写入后的焦点跟随（重渲/回滚后焦点回到当前选中段） ----
const rootEl = ref<HTMLElement | null>(null);
async function focusSelectedSeg(chatId: string) {
  await nextTick();
  const sel = ` .cf-row[data-id="${chatId.replace(/"/g, '\\"')}"] .cf-seg button[aria-checked="true"]`;
  rootEl.value?.querySelector<HTMLElement>(sel)?.focus();
}

// ---- 事件驱动刷新（保留搜索词与筛选档：只重算数据不重置工具行） ----
// settings-changed 不动 settings store：同窗草稿已由响应式读取联动，
// restore/import 等批量流程由 SettingsTab 自行 load()；此处只刷新总览。
const unlisteners: UnlistenFn[] = [];
onMounted(async () => {
  void load();
  unlisteners.push(await listen(EVENTS.feishuChatFilterChanged, () => void load()));
  unlisteners.push(await listen(EVENTS.settingsChanged, () => void load()));
});
// 草稿态开关联动：关闭即转空·未启用（computed）；重新启用时重读总览
watch(feishuEnabled, (on) => {
  if (on) void load();
});
onUnmounted(() => {
  unlisteners.forEach((u) => u());
  clearTimeout(toastTimer);
});
</script>

<template>
  <section ref="rootEl" class="set-card cf-card">
    <h3>📡 {{ t("feishu.filter.title") }}</h3>
    <p class="set-sub">{{ t("feishu.filter.hint") }}</p>

    <!-- 就绪：摘要行 + 工具行 + 列表（搜索无命中时列表区换空态文案） -->
    <template v-if="state === 'ready'">
      <div class="cf-summary">
        <span class="cf-counts">{{
          t("feishu.filter.summary", {
            total: counts.total,
            pulling: counts.pulling,
            filtered: counts.filtered,
            manual: counts.manual,
          })
        }}</span>
        <span v-if="!isStale" class="cf-snaptime">{{
          t("feishu.filter.staleOk", { time: fmtDateTime(snapTime) })
        }}</span>
        <div v-else class="cf-stale-banner">
          <span>{{ t("feishu.filter.staleWarn", { min: staleMin }) }}</span>
          <button type="button" class="btn ghost cf-link" :disabled="polling" @click="pollNow">
            {{ t("feishu.pollNow") }}
          </button>
        </div>
      </div>

      <div class="cf-toolbar">
        <input
          v-model="query"
          class="cf-search"
          type="text"
          :placeholder="t('feishu.filter.searchPh')"
          :aria-label="t('feishu.filter.searchLabel')"
        />
        <div class="cf-chips" role="group" :aria-label="t('feishu.filter.chipsLabel')">
          <button
            v-for="def in chipDefs"
            :key="def.key"
            type="button"
            class="cf-chip"
            :class="{ on: filter === def.key }"
            :aria-pressed="filter === def.key"
            :disabled="def.count === 0"
            @click="filter = def.key"
          >
            {{ t(def.labelKey, { n: def.count }) }}
          </button>
        </div>
      </div>

      <div v-if="visibleRows.length" class="cf-list-box">
        <div v-for="row in visibleRows" :key="row.chatId" class="cf-row" :data-id="row.chatId">
          <span class="cf-badge">{{ t(`im.type.${row.chatType}`) }}</span>
          <span class="cf-name" :title="row.chatName">{{ row.chatName }}</span>
          <span class="cf-eff" :class="effClass(row)" :title="effTitle(row)">{{ effText(row) }}</span>
          <!-- 降级说明的键盘/读屏通道：sr-only 节点 + 同行三段 aria-describedby（title 只是鼠标通道） -->
          <span v-if="row.source === 'followDegraded'" :id="`cf-dg-${row.chatId}`" class="sr-only">
            {{ t("feishu.filter.srcDegradedTitle") }}
          </span>
          <div
            class="cf-seg"
            :class="{ busy: writingIds.has(row.chatId) }"
            role="radiogroup"
            :aria-label="t('feishu.filter.prefGroupLabel', { name: row.chatName })"
            :aria-describedby="row.source === 'followDegraded' ? `cf-dg-${row.chatId}` : undefined"
            @keydown="onSegKeydown($event, row)"
          >
            <button
              v-for="seg in SEGS"
              :key="seg.value"
              type="button"
              role="radio"
              :aria-checked="row.preference === seg.value"
              :tabindex="row.preference === seg.value ? 0 : -1"
              :title="t(seg.titleKey)"
              @click="setPref(row, seg.value)"
            >
              {{ t(seg.labelKey) }}
            </button>
          </div>
        </div>
      </div>
      <div v-else-if="noMatch" class="cf-statebox">
        <span>{{ t("feishu.filter.emptySearch", { q: query.trim() }) }}</span>
      </div>
    </template>

    <!-- 空·未启用（含未授权变体：文案指向上方启用开关/授权按钮） -->
    <div v-else-if="state === 'disabled'" class="cf-statebox">
      <span>{{ t("feishu.filter.emptyDisabled") }}</span>
    </div>

    <!-- 空·无快照：唯一带「立即拉取一次」的空态 -->
    <div v-else-if="state === 'noSnapshot'" class="cf-statebox">
      <span>{{ t("feishu.filter.emptyNoSnap") }}</span
      ><br />
      <button type="button" class="btn ghost" :disabled="polling" @click="pollNow">{{ t("feishu.pollNow") }}</button>
    </div>

    <!-- 空·快照为空（零会话账号）：同样提供手动重试拉取 -->
    <div v-else-if="state === 'snapEmpty'" class="cf-statebox">
      <span>{{ t("feishu.filter.emptySnapEmpty") }}</span
      ><br />
      <button type="button" class="btn ghost" :disabled="polling" @click="pollNow">{{ t("feishu.pollNow") }}</button>
    </div>

    <!-- loading（本地读为瞬时，单行占位不做骨架屏） -->
    <div v-else-if="state === 'loading'" class="cf-statebox">
      <span>{{ t("feishu.filter.loading") }}</span>
    </div>

    <!-- 读取失败：错误行 + 重试 -->
    <div v-else-if="state === 'error'" class="cf-statebox">
      <span class="cf-err">{{ t("feishu.filter.loadFail", { err: loadError }) }}</span
      ><br />
      <button type="button" class="btn ghost" @click="load">{{ t("feishu.filter.retry") }}</button>
    </div>

    <!-- 脚注 ×2：即时生效语义 / 不回补不追溯 -->
    <div class="cf-foot">
      <p>{{ t("feishu.filter.footImmediate") }}</p>
      <p>{{ t("feishu.filter.footNoBackfill") }}</p>
    </div>

    <!-- 写入失败 / 拉取结果 toast（role=status 经隐式 aria-live 播报） -->
    <div v-if="toast" class="cf-toast" :class="{ error: toast.error }" role="status">
      <span>{{ toast.text }}</span>
    </div>
  </section>
</template>

<style scoped>
/* 卡片本体与副标题需自备同款（宿主 scoped 样式够不到二层子组件，见 src/AGENTS.md） */
.set-card {
  width: 100%;
  max-width: 920px;
  margin-left: auto;
  margin-right: auto;
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 12px;
  padding: 14px 16px;
  box-shadow: 4px 4px 0 var(--dex-navy);
}
.set-card h3 {
  margin: 0 0 12px;
  font-size: 16px;
}
.set-sub {
  margin: -6px 0 12px;
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.7;
}
.cf-foot {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 2px dashed var(--ink-faint);
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.7;
}
.cf-foot p {
  margin: 0 0 4px;
}
.cf-foot p:last-child {
  margin-bottom: 0;
}

/* 仅读屏可见（降级说明的键盘/读屏通道，uiux §6.2） */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
  padding: 0;
}

/* 摘要行 */
.cf-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.cf-counts {
  font-size: 12px;
  font-weight: 700;
  color: var(--ink-soft);
}
.cf-snaptime {
  margin-left: auto;
  font-size: 11px;
  color: var(--ink-soft);
  font-weight: 600;
}
.cf-stale-banner {
  width: 100%;
  background: var(--warn-soft);
  border: 2px solid var(--warn-ink);
  border-radius: 4px;
  color: var(--warn-ink);
  font-size: 12px;
  font-weight: 700;
  padding: 6px 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
/* 横幅内小按钮（沿用 btn ghost 质感，收窄为小件档） */
.cf-link {
  box-shadow: none;
  border-width: 2px;
  padding: 4px 10px;
  font-size: 12px;
  min-height: 32px;
}

/* 工具行：搜索 + 筛选 chips */
.cf-toolbar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.cf-search {
  flex: 1 1 200px;
  min-width: 0;
  min-height: 38px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  background: #fff;
  box-shadow: 3px 3px 0 var(--dex-navy);
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
}
.cf-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.cf-chip {
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  background: #fff;
  color: var(--dex-navy);
  font-size: 11px;
  font-weight: 800;
  font-family: inherit;
  padding: 6px 10px;
  min-height: 32px;
  cursor: pointer;
  box-shadow: 2px 2px 0 var(--dex-navy);
  transition:
    transform var(--t-tap),
    box-shadow var(--t-tap),
    background var(--t-tap);
}
.cf-chip:active:not(:disabled) {
  transform: translate(1px, 1px);
  box-shadow: 1px 1px 0 var(--dex-navy);
}
.cf-chip:not(.on):not(:disabled):hover {
  background: var(--hover);
}
.cf-chip:disabled {
  opacity: 0.55;
  cursor: default;
  box-shadow: 2px 2px 0 var(--ink-faint);
  border-color: var(--ink-faint);
}
.cf-chip.on {
  background: var(--poke-yellow);
}

/* 列表容器（max-height 内滚，与收音机列表同模式） */
.cf-list-box {
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  background: #fff;
  box-shadow: 3px 3px 0 var(--dex-navy);
  max-height: 420px;
  overflow-y: auto;
  padding: 6px;
}
.cf-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 8px;
  min-height: 44px;
}
.cf-row:hover {
  background: var(--hover);
}
.cf-row + .cf-row {
  margin-top: 2px;
}
.cf-badge {
  flex: none;
  font-size: 11px;
  font-weight: 800;
  color: var(--ink-soft);
  border: 2px solid var(--ink-faint);
  border-radius: 4px;
  padding: 0 4px;
}
.cf-name {
  flex: 1 1 auto;
  min-width: 80px;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 生效 chip（浅底深字；语义色映射 uiux §6.1：拉取=ok 系 / 过滤=中性弱化 / 降级=warn 系） */
.cf-eff {
  flex: none;
  font-size: 11px;
  font-weight: 800;
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  padding: 2px 6px;
  white-space: nowrap;
  background: #fff;
  color: var(--ink);
  transition:
    background var(--t-pop),
    color var(--t-pop);
}
.cf-eff.pull {
  background: var(--ok-soft);
  color: var(--ok-ink);
}
.cf-eff.mute {
  background: var(--conf-low-soft);
  color: var(--ink-soft);
}
.cf-eff.degraded {
  background: var(--warn-soft);
  color: var(--warn-ink);
}

/* 三段选择器（radiogroup；选中 = 全局唯一选中黄 --poke-yellow） */
.cf-seg {
  flex: none;
  display: flex;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  background: #fff;
  box-shadow: 3px 3px 0 var(--dex-navy);
  overflow: hidden;
}
.cf-seg button {
  border: 0;
  background: transparent;
  color: var(--dex-navy);
  font-size: 12px;
  font-weight: 700;
  font-family: inherit;
  padding: 0 12px;
  min-height: 38px;
  cursor: pointer;
  transition: background var(--t-pop);
}
.cf-seg button + button {
  border-left: 2px solid var(--dex-navy);
}
.cf-seg button:hover:not([aria-checked="true"]) {
  background: var(--hover);
}
.cf-seg button[aria-checked="true"] {
  background: var(--poke-yellow);
}
.cf-seg.busy {
  opacity: 0.55;
  pointer-events: none;
}

/* 空 / loading / 错误态盒子 */
.cf-statebox {
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  background: #fff;
  box-shadow: 3px 3px 0 var(--dex-navy);
  padding: 36px 12px;
  text-align: center;
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 2;
}
.cf-statebox .btn {
  margin-top: 8px;
}
.cf-err {
  color: var(--danger);
  font-weight: 700;
  word-break: break-all;
}

/* toast（5s 自动消失；右下角与全局 toast 同方位） */
.cf-toast {
  position: fixed;
  right: 24px;
  bottom: 96px;
  z-index: 100;
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  box-shadow: 4px 4px 0 var(--dex-navy);
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 700;
  max-width: 70%;
}
.cf-toast.error {
  color: var(--danger);
}

/* 黄底上下文焦点环改 navy 描边（黄环在黄底上近乎不可见；uiux §6.2 焦点环对比度注记） */
.cf-chip.on:focus-visible,
.cf-seg button[aria-checked="true"]:focus-visible {
  outline-color: var(--dex-navy);
}

/* 断点（uiux §7）：<640 行折两行（三段右对齐保 38px 命中）；<480 工具行纵向堆叠 */
@media (max-width: 640px) {
  .cf-row {
    flex-wrap: wrap;
  }
  .cf-seg {
    order: 5;
    margin-left: auto;
  }
}
@media (max-width: 480px) {
  .cf-toolbar {
    flex-direction: column;
  }
  .cf-search {
    flex: 1 1 auto;
  }
}
</style>
