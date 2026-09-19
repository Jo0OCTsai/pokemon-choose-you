<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorMessage } from "../api";
import { fmtDateTime } from "../stores/settings";
import { useTasksStore } from "../stores/tasks";
import type { ChatMessage } from "../types";

const { t } = useI18n();
const tasksStore = useTasksStore();

// ---- 搜索（后端 LIKE 过滤） ----
const query = ref("");
const searched = ref<ChatMessage[] | null>(null);
const list = computed(() => searched.value ?? tasksStore.chatMessages);

watch(query, async (q) => {
  q = q.trim();
  if (!q) {
    searched.value = null;
    return;
  }
  searched.value = await api.listChatMessages(q);
});

async function reload() {
  if (searched.value !== null) {
    searched.value = await api.listChatMessages(query.value.trim() || undefined);
  } else {
    await tasksStore.reload();
  }
}

// ---- 分诊分组：待办信号要细审内容，无信号（none/error）只需快速清扫 ----
const isSignal = (m: ChatMessage) => m.aiStatus === "todo" || m.aiStatus === "update";
const signalList = computed(() => list.value.filter((m) => m.reviewStatus === "pending" && isSignal(m)));
const noiseList = computed(() => list.value.filter((m) => m.reviewStatus === "pending" && !isSignal(m)));
const caughtList = computed(() => list.value.filter((m) => m.reviewStatus === "accepted"));
const escapedList = computed(() => list.value.filter((m) => m.reviewStatus === "dismissed"));

// ---- 视图模式（⏱按状态分区 / 📡按会话分组）与分区折叠 ----
const mode = ref<"time" | "channel">("time");
const collapsed = ref(new Set<string>(["caught", "escaped"])); // 已处理默认收起

function toggleGroup(key: string) {
  const next = new Set(collapsed.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  collapsed.value = next;
}

/** 频道模式：按会话聚拢（老数据无 chatId 时按会话名），组内信号在前、已处理垫底 */
const channelGroups = computed(() => {
  const map = new Map<string, { key: string; name: string; list: ChatMessage[] }>();
  for (const m of list.value) {
    const key = m.chatId || m.chatName || "_";
    if (!map.has(key)) map.set(key, { key, name: m.chatName || "FEISHU", list: [] });
    map.get(key)!.list.push(m);
  }
  const rank = (m: ChatMessage) => (m.reviewStatus !== "pending" ? 2 : isSignal(m) ? 0 : 1);
  for (const g of map.values()) g.list.sort((a, b) => rank(a) - rank(b));
  return [...map.values()];
});

// ---- 选中与自动前进：处理完跳下一条（信号优先），选中项失效时回落队首 ----
const selectedId = ref<number | null>(null);
const selected = computed(() => list.value.find((m) => m.id === selectedId.value) ?? null);

watch(list, syncSelection, { immediate: true });
function syncSelection() {
  if (selectedId.value !== null && list.value.some((m) => m.id === selectedId.value)) return;
  selectedId.value = [...signalList.value, ...noiseList.value][0]?.id ?? list.value[0]?.id ?? null;
}
watch(selectedId, () => (escapeMenuId.value = null));

function advanceFrom(id: number) {
  const pool = [...signalList.value, ...noiseList.value];
  if (!pool.length) {
    selectedId.value = null;
    return;
  }
  const idx = pool.findIndex((m) => m.id === id);
  selectedId.value = (pool[idx + 1] ?? pool[Math.max(0, idx - 1)] ?? pool[0]).id;
  nextTick(() => document.querySelector(".rrow.sel")?.scrollIntoView({ block: "nearest" }));
}

// ---- 乐观 UI：5 秒撤销 toast（逃走/捕捉可撤销；更新补丁与批量不可安全回滚） ----
const toast = ref<{ text: string; undo?: () => void; error?: boolean } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function showToast(text: string, opts: { undo?: () => void; error?: boolean } = {}) {
  toast.value = { text, ...opts };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), 5000);
}

async function undoReview(id: number) {
  toast.value = null;
  clearTimeout(toastTimer);
  try {
    await api.undoChatReview(id);
    selectedId.value = id; // 撤销后停在该条，看得见它回来了
  } catch (e) {
    showToast(`❌ ${errorMessage(e)}`, { error: true });
  }
  await reload();
}

// ---- 分诊动作 ----
async function acceptIm(m: ChatMessage) {
  try {
    if (m.aiStatus === "update" && m.updateTaskId) {
      await api.applyChatMessageUpdate(m.id);
      showToast(t("im.updatedTask", { id: m.updateTaskId }));
    } else {
      const taskId = await api.acceptChatMessage(m.id);
      showToast(t("im.caughtTask", { id: taskId }), { undo: () => undoReview(m.id) });
    }
  } catch (e) {
    showToast(`❌ ${errorMessage(e)}`, { error: true });
    await reload();
    return;
  }
  advanceFrom(m.id);
  await reload();
}

async function dismissIm(m: ChatMessage, reasonCode?: string) {
  escapeMenuId.value = null;
  try {
    await api.dismissChatMessage(m.id, reasonCode);
    showToast(t("im.released"), { undo: () => undoReview(m.id) });
  } catch (e) {
    showToast(`❌ ${errorMessage(e)}`, { error: true });
    await reload();
    return;
  }
  advanceFrom(m.id);
  await reload();
}

/** 已逃走分区的「恢复」：把消息拉回待处理（撤销窗口之外的后悔药，逃走不删数据所以随时可用） */
async function restoreIm(m: ChatMessage) {
  await undoReview(m.id);
}

const forcingId = ref<number | null>(null);
async function forceCreate(m: ChatMessage) {
  forcingId.value = m.id;
  try {
    await api.forceCreateTodo(m.id);
    showToast(t("im.forceDone"));
  } catch (e) {
    showToast(`❌ ${errorMessage(e)}`, { error: true });
  } finally {
    forcingId.value = null;
    await reload();
  }
}

// ---- 逃走原因（可选）：帮助 AI 判重与提示词迭代，直接点「✕ 逃走」则不填原因 ----
const ESCAPE_REASONS = ["duplicate", "not_task", "wrong_info", "noise", "outdated", "other"] as const;
const escapeMenuId = ref<number | null>(null);
function toggleEscapeMenu() {
  escapeMenuId.value = escapeMenuId.value === selected.value?.id ? null : (selected.value?.id ?? null);
}

// ---- 批量分诊：勾选信号区多条，一键捕捉 / 逃走；无信号区另有整组清空 ----
const checked = ref(new Set<number>());
const signalIds = computed(() => signalList.value.map((m) => m.id));
const allChecked = computed(() => signalIds.value.length > 0 && signalIds.value.every((id) => checked.value.has(id)));

function toggleOne(id: number) {
  const next = new Set(checked.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  checked.value = next;
}
function toggleAll() {
  checked.value = allChecked.value ? new Set() : new Set(signalIds.value);
}
function checkHighConfidence() {
  checked.value = new Set(signalList.value.filter((m) => m.suggestedConfidence === "high").map((m) => m.id));
}

const batching = ref(false);
async function batch(action: "accept" | "dismiss") {
  const ids = [...checked.value];
  if (!ids.length || batching.value) return;
  batching.value = true;
  try {
    const r = await api.batchReviewChatMessages(ids, action);
    showToast(
      r.failed.length ? t("im.batchPartial", { ok: r.ok, fail: r.failed.length }) : t("im.batchDone", { n: r.ok }),
    );
    checked.value = new Set();
  } catch (e) {
    showToast(`❌ ${errorMessage(e)}`, { error: true });
  } finally {
    batching.value = false;
    await reload();
  }
}

/** 一键清空无信号：噪音不需要逐条审，整组逃走并落 noise 原因 */
async function clearNoise() {
  const ids = noiseList.value.map((m) => m.id);
  if (!ids.length || batching.value) return;
  batching.value = true;
  try {
    const r = await api.batchReviewChatMessages(ids, "dismiss", "noise");
    showToast(
      r.failed.length ? t("im.batchPartial", { ok: r.ok, fail: r.failed.length }) : t("im.noiseCleared", { n: r.ok }),
    );
    if (ids.includes(selectedId.value ?? -1)) advanceFrom(selectedId.value!);
  } catch (e) {
    showToast(`❌ ${errorMessage(e)}`, { error: true });
  } finally {
    batching.value = false;
    await reload();
  }
}

// ---- 键盘流：↑↓/J/K 换条 · C 捕捉 · X 逃走 · F 强制 ----
function onKeydown(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  // 焦点在输入控件上时不劫持按键（target 可能是非元素，如 window）
  if (el && typeof el.matches === "function" && el.matches("input, textarea, select")) return;
  const key = e.key.toLowerCase();
  if (key === "escape") {
    escapeMenuId.value = null;
    return;
  }
  const pool = [...signalList.value, ...noiseList.value];
  if (["arrowdown", "j", "arrowup", "k"].includes(key)) {
    if (!pool.length) return;
    e.preventDefault();
    let i = pool.findIndex((m) => m.id === selectedId.value);
    i = key === "arrowdown" || key === "j" ? Math.min(pool.length - 1, i + 1) : Math.max(0, i - 1);
    if (i < 0) i = 0;
    selectedId.value = pool[i].id;
    nextTick(() => document.querySelector(".rrow.sel")?.scrollIntoView({ block: "nearest" }));
  } else if (key === "c" || key === "x" || key === "f") {
    const m = selected.value;
    if (!m || m.reviewStatus !== "pending" || batching.value || forcingId.value !== null) return;
    e.preventDefault();
    if (key === "c") {
      // C 只对信号生效：无信号没有「捕捉」可言，避免误建待办
      if (isSignal(m)) acceptIm(m);
    } else if (key === "x") {
      dismissIm(m);
    } else {
      forceCreate(m);
    }
  }
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  clearTimeout(toastTimer);
});

// ---- 展示辅助 ----
const aiStatusKey = (m: ChatMessage) => `im.status.${m.aiStatus}`;
const chatTypeLabel = (m: ChatMessage) => (m.chatType ? t(`im.type.${m.chatType}`) : "");
const taskTitle = (id: number) => tasksStore.open.find((tk) => tk.id === id)?.title ?? "";
const snippet = (m: ChatMessage) => m.content.split("\n")[0] ?? "";

/** 内置维度的展示名（自定义维度回落 key）；建议卡 chip 的 title 提示用 */
const dimLabel = (key: string) => (["project", "context", "person", "topic"].includes(key) ? t(`dim.${key}`) : key);
/** 建议标签 chip 的悬浮说明：拟新建的标签标明「接受时才会创建」 */
const chipTitle = (tag: { name: string; dimension: string; isNew: boolean }) =>
  tag.isNew ? t("im.tagNew", { dim: dimLabel(tag.dimension) }) : dimLabel(tag.dimension);
</script>

<template>
  <div class="im-split">
    <!-- 左栏：电波列表 -->
    <section class="im-left">
      <div class="im-toolbar">
        <input v-model="query" class="search-input" :placeholder="t('im.search')" />
        <div class="view-toggle" role="group" :aria-label="t('im.viewMode')">
          <button type="button" :class="{ on: mode === 'time' }" @click="mode = 'time'">
            {{ t("im.viewTime") }}
          </button>
          <button type="button" :class="{ on: mode === 'channel' }" @click="mode = 'channel'">
            {{ t("im.viewChannel") }}
          </button>
        </div>
      </div>

      <div class="im-list-box">
        <div v-if="!list.length" class="empty">{{ t("im.empty1") }}<br />{{ t("im.empty2") }}</div>

        <template v-else-if="mode === 'time'">
          <!-- 待办信号：AI 挑出的待办/更新建议，要细审 -->
          <section class="list-group" data-group="pending">
            <button type="button" class="lg-head" @click="toggleGroup('pending')">
              <span class="lg-caret">{{ collapsed.has("pending") ? "▸" : "▾" }}</span>
              {{ t("im.groupSignal") }}
              <span class="lg-count hot">{{ signalList.length }}</span>
              <span class="lg-state">{{ collapsed.has("pending") ? t("im.expand") : t("im.collapse") }}</span>
            </button>
            <div v-if="!collapsed.has('pending')" class="lg-body">
              <div v-if="!signalList.length" class="pending-empty">{{ t("im.signalAllDone") }}</div>
              <div
                v-for="m in signalList"
                :key="m.id"
                class="rrow"
                :class="{ sel: m.id === selectedId }"
                @click="selectedId = m.id"
              >
                <input
                  type="checkbox"
                  class="im-check"
                  :checked="checked.has(m.id)"
                  :aria-label="t('im.selectAll')"
                  @click.stop
                  @change="toggleOne(m.id)"
                />
                <div class="r-main">
                  <div class="r-line1">
                    <span v-if="m.chatType || m.chatName" class="chat-badge">
                      {{ chatTypeLabel(m) ? `${chatTypeLabel(m)}·` : "" }}{{ m.chatName || "FEISHU" }}
                    </span>
                    <span class="r-sender">{{ m.sender }}</span>
                    <span v-if="m.aiStatus === 'update'" class="chat-badge">🔧 {{ t("im.chipUpdate") }}</span>
                    <span
                      class="conf"
                      :class="m.suggestedConfidence || 'low'"
                      :title="t(`im.confidence.${m.suggestedConfidence || 'low'}`)"
                    ></span>
                    <span class="r-time">{{ fmtDateTime(m.createdAt) }}</span>
                  </div>
                  <div class="r-snippet">{{ snippet(m) }}</div>
                </div>
              </div>
            </div>
          </section>

          <!-- 无信号：不是任务（或判定失败），一键清扫 -->
          <section v-if="noiseList.length" class="list-group" data-group="noise">
            <button type="button" class="lg-head" @click="toggleGroup('noise')">
              <span class="lg-caret">{{ collapsed.has("noise") ? "▸" : "▾" }}</span>
              {{ t("im.groupNoise") }}
              <span class="lg-count">{{ noiseList.length }}</span>
              <span class="lg-state">{{ collapsed.has("noise") ? t("im.expand") : t("im.collapse") }}</span>
              <span
                v-if="!collapsed.has('noise')"
                class="clear-noise"
                role="button"
                :title="t('im.clearNoiseTitle')"
                @click.stop="clearNoise"
              >
                {{ t("im.clearNoise") }}
              </span>
            </button>
            <div v-if="!collapsed.has('noise')" class="lg-body">
              <div
                v-for="m in noiseList"
                :key="m.id"
                class="rrow"
                :class="{ sel: m.id === selectedId }"
                @click="selectedId = m.id"
              >
                <input
                  type="checkbox"
                  class="im-check"
                  :checked="checked.has(m.id)"
                  :aria-label="t('im.selectAll')"
                  @click.stop
                  @change="toggleOne(m.id)"
                />
                <div class="r-main">
                  <div class="r-line1">
                    <span v-if="m.chatType || m.chatName" class="chat-badge">
                      {{ chatTypeLabel(m) ? `${chatTypeLabel(m)}·` : "" }}{{ m.chatName || "FEISHU" }}
                    </span>
                    <span class="r-sender">{{ m.sender }}</span>
                    <span class="r-time">{{ fmtDateTime(m.createdAt) }}</span>
                  </div>
                  <div class="r-snippet">{{ snippet(m) }}</div>
                </div>
              </div>
            </div>
          </section>

          <!-- 已捕捉：默认收起，回看用 -->
          <section
            v-if="caughtList.length"
            class="list-group"
            :class="{ collapsed: collapsed.has('caught') }"
            data-group="caught"
          >
            <button type="button" class="lg-head" @click="toggleGroup('caught')">
              <span class="lg-caret">{{ collapsed.has("caught") ? "▸" : "▾" }}</span>
              {{ t("im.groupCaught") }}
              <span class="lg-count">{{ caughtList.length }}</span>
              <span class="lg-state">{{ collapsed.has("caught") ? t("im.expand") : t("im.collapse") }}</span>
            </button>
            <div class="lg-body">
              <div
                v-for="m in caughtList"
                :key="m.id"
                class="rrow dim"
                :class="{ sel: m.id === selectedId }"
                @click="selectedId = m.id"
              >
                <div class="r-main">
                  <div class="r-line1">
                    <span v-if="m.chatType || m.chatName" class="chat-badge">
                      {{ chatTypeLabel(m) ? `${chatTypeLabel(m)}·` : "" }}{{ m.chatName || "FEISHU" }}
                    </span>
                    <span class="r-sender">{{ m.sender }}</span>
                    <span class="r-time">{{ fmtDateTime(m.createdAt) }}</span>
                  </div>
                  <div class="r-snippet">{{ snippet(m) }}</div>
                </div>
                <span class="r-mark ok">
                  {{ m.followupTaskId ? t("im.markMerged", { id: m.followupTaskId }) : `✔ No.${m.taskId}` }}
                </span>
              </div>
            </div>
          </section>

          <!-- 已逃走：默认收起 -->
          <section
            v-if="escapedList.length"
            class="list-group"
            :class="{ collapsed: collapsed.has('escaped') }"
            data-group="escaped"
          >
            <button type="button" class="lg-head" @click="toggleGroup('escaped')">
              <span class="lg-caret">{{ collapsed.has("escaped") ? "▸" : "▾" }}</span>
              {{ t("im.groupEscaped") }}
              <span class="lg-count">{{ escapedList.length }}</span>
              <span class="lg-state">{{ collapsed.has("escaped") ? t("im.expand") : t("im.collapse") }}</span>
            </button>
            <div class="lg-body">
              <div
                v-for="m in escapedList"
                :key="m.id"
                class="rrow dim"
                :class="{ sel: m.id === selectedId }"
                @click="selectedId = m.id"
              >
                <div class="r-main">
                  <div class="r-line1">
                    <span v-if="m.chatType || m.chatName" class="chat-badge">
                      {{ chatTypeLabel(m) ? `${chatTypeLabel(m)}·` : "" }}{{ m.chatName || "FEISHU" }}
                    </span>
                    <span class="r-sender">{{ m.sender }}</span>
                    <span class="r-time">{{ fmtDateTime(m.createdAt) }}</span>
                  </div>
                  <div class="r-snippet">{{ snippet(m) }}</div>
                </div>
                <span class="r-mark no">✕</span>
              </div>
            </div>
          </section>
        </template>

        <!-- 频道模式：按会话聚拢，组内信号在前 -->
        <template v-else>
          <section v-for="g in channelGroups" :key="g.key" class="list-group">
            <button type="button" class="lg-head" @click="toggleGroup('ch:' + g.key)">
              <span class="lg-caret">{{ collapsed.has("ch:" + g.key) ? "▸" : "▾" }}</span>
              📡 {{ g.name }}
              <span class="lg-count" :class="{ hot: g.list.some((m) => m.reviewStatus === 'pending' && isSignal(m)) }">
                {{
                  t("im.chanPending", { n: g.list.filter((m) => m.reviewStatus === "pending" && isSignal(m)).length })
                }}
              </span>
              <span class="lg-state">{{ t("im.chanTotal", { n: g.list.length }) }}</span>
            </button>
            <div class="lg-body">
              <div
                v-for="m in g.list"
                :key="m.id"
                class="rrow"
                :class="{ sel: m.id === selectedId, dim: m.reviewStatus !== 'pending' }"
                @click="selectedId = m.id"
              >
                <input
                  v-if="m.reviewStatus === 'pending'"
                  type="checkbox"
                  class="im-check"
                  :checked="checked.has(m.id)"
                  :aria-label="t('im.selectAll')"
                  @click.stop
                  @change="toggleOne(m.id)"
                />
                <div class="r-main">
                  <div class="r-line1">
                    <span class="r-sender">{{ m.sender }}</span>
                    <span v-if="m.aiStatus === 'update' && m.reviewStatus === 'pending'" class="chat-badge">
                      🔧 {{ t("im.chipUpdate") }}
                    </span>
                    <span v-if="!isSignal(m) && m.reviewStatus === 'pending'" class="chat-badge"
                      >🔇 {{ t("im.chipNoise") }}</span
                    >
                    <span
                      v-if="m.reviewStatus === 'pending' && isSignal(m)"
                      class="conf"
                      :class="m.suggestedConfidence || 'low'"
                    ></span>
                    <span class="r-time">{{ fmtDateTime(m.createdAt) }}</span>
                  </div>
                  <div class="r-snippet">{{ snippet(m) }}</div>
                </div>
                <span v-if="m.followupTaskId" class="r-mark ok">{{
                  t("im.markMerged", { id: m.followupTaskId })
                }}</span>
                <span v-else-if="m.taskId" class="r-mark ok">✔ No.{{ m.taskId }}</span>
                <span v-else-if="m.reviewStatus === 'dismissed'" class="r-mark no">✕</span>
              </div>
            </div>
          </section>
        </template>
      </div>

      <!-- 批量条：跟着勾选走（勾选只作用于信号区 + 无信号区手选） -->
      <div class="batch-bar">
        <label class="batch-check">
          <input type="checkbox" :checked="allChecked" @change="toggleAll" />
          {{ t("im.selectAll") }}
        </label>
        <button class="hi-conf-btn" type="button" @click="checkHighConfidence">{{ t("im.hiConf") }}</button>
        <button class="btn" :disabled="!checked.size || batching" @click="batch('accept')">
          {{ t("im.batchCatch") }}{{ checked.size ? `（${checked.size}）` : "" }}
        </button>
        <button class="btn ghost" :disabled="!checked.size || batching" @click="batch('dismiss')">
          {{ t("im.batchRelease") }}{{ checked.size ? `（${checked.size}）` : "" }}
        </button>
      </div>
    </section>

    <!-- 右栏：详情与操作（按钮位置固定，不随消息滚动） -->
    <section class="im-right">
      <div v-if="!selected" class="d-empty">{{ t("im.selectHint") }}</div>
      <div v-else class="d-body">
        <div class="d-meta">
          <span v-if="selected.chatType" class="type-badge">{{ chatTypeLabel(selected) }}</span>
          <span
            >{{ selected.chatName || "FEISHU" }} · {{ selected.sender }} · {{ fmtDateTime(selected.createdAt) }}</span
          >
          <span class="ai-status">{{ t(aiStatusKey(selected)) }}</span>
        </div>
        <div class="lcd d-content im-content">{{ selected.content }}</div>

        <!-- AI 建议：新待办 -->
        <div
          v-if="selected.suggestedTitle && selected.aiStatus !== 'update' && selected.reviewStatus === 'pending'"
          class="im-suggest"
        >
          {{ t("im.found") }}{{ selected.suggestedTitle }}
          <span v-if="selected.suggestedDue">（{{ t("entry.due", { v: fmtDateTime(selected.suggestedDue) }) }}）</span>
          <span v-if="selected.suggestedPriority" class="sug-prio">{{
            t(`priority.${selected.suggestedPriority}`)
          }}</span>
          <span v-if="selected.suggestedConfidence" class="sug-conf" :class="'c-' + selected.suggestedConfidence">
            {{ t(`im.confidence.${selected.suggestedConfidence}`) }}
          </span>
          <span
            v-for="tag in selected.suggestedTags"
            :key="tag.dimension + ':' + tag.name"
            class="sug-tag"
            :class="{ 'sug-new': tag.isNew, ['sug-dim-' + tag.dimension]: true }"
            :title="chipTitle(tag)"
            >{{ tag.isNew ? "＋" : "#" }} {{ tag.name }}</span
          >
          <span v-if="selected.suggestedReason" class="sug-reason">💡 {{ selected.suggestedReason }}</span>
        </div>

        <!-- AI 建议：更新已有待办（只展示明确给出的变更字段） -->
        <div
          v-if="selected.aiStatus === 'update' && selected.updateTaskId && selected.reviewStatus === 'pending'"
          class="im-suggest update"
        >
          {{ t("im.updateFound", { id: selected.updateTaskId })
          }}<span v-if="taskTitle(selected.updateTaskId)">「{{ taskTitle(selected.updateTaskId) }}」</span>
          <span v-if="selected.suggestedTitle">{{ t("edit.title") }} → {{ selected.suggestedTitle }}</span>
          <span v-if="selected.suggestedDue">（{{ t("entry.due", { v: fmtDateTime(selected.suggestedDue) }) }}）</span>
          <span v-if="selected.suggestedPriority" class="sug-prio">{{
            t(`priority.${selected.suggestedPriority}`)
          }}</span>
          <span v-if="selected.suggestedConfidence" class="sug-conf" :class="'c-' + selected.suggestedConfidence">
            {{ t(`im.confidence.${selected.suggestedConfidence}`) }}
          </span>
          <span
            v-for="tag in selected.suggestedTags"
            :key="tag.dimension + ':' + tag.name"
            class="sug-tag"
            :class="{ 'sug-new': tag.isNew, ['sug-dim-' + tag.dimension]: true }"
            :title="chipTitle(tag)"
            >{{ tag.isNew ? "＋" : "#" }} {{ tag.name }}</span
          >
          <span v-if="selected.suggestedReason" class="sug-reason">💡 {{ selected.suggestedReason }}</span>
        </div>

        <!-- 无信号说明 -->
        <div v-if="!isSignal(selected) && selected.reviewStatus === 'pending'" class="im-suggest none">
          🔇 {{ t(`im.status.${selected.aiStatus}`)
          }}<span v-if="selected.suggestedReason"> · {{ selected.suggestedReason }}</span>
        </div>

        <!-- 已处理状态条 -->
        <div v-if="selected.followupTaskId" class="done-banner">
          ✔ {{ t("im.followedTask", { id: selected.followupTaskId }) }}
          <span v-if="taskTitle(selected.followupTaskId)" class="caught-sub"
            >「{{ taskTitle(selected.followupTaskId) }}」</span
          >
        </div>
        <div v-else-if="selected.reviewStatus === 'accepted'" class="done-banner">
          ✔ {{ t("im.caughtTask", { id: selected.taskId ?? 0 }) }}
        </div>
        <div v-else-if="selected.reviewStatus === 'dismissed'" class="done-banner dim-banner">
          ✕ {{ t("im.released") }}
        </div>

        <!-- 操作区 -->
        <div class="im-actions">
          <template v-if="selected.reviewStatus === 'pending' && selected.aiStatus === 'update'">
            <button class="btn" :disabled="forcingId === selected.id" @click="acceptIm(selected)">
              {{ forcingId === selected.id ? t("im.forcing") : t("im.applyUpdate") }}<span class="kbd">C</span>
            </button>
            <button class="btn red" @click="dismissIm(selected)">
              {{ t("im.release") }}<span class="kbd">X</span>
            </button>
            <button
              class="btn ghost er-toggle"
              :title="t('im.escapeWhy')"
              :aria-label="t('im.escapeWhy')"
              @click="toggleEscapeMenu"
            >
              ▾
            </button>
          </template>
          <template v-else-if="selected.reviewStatus === 'pending' && selected.aiStatus === 'todo'">
            <button class="btn" @click="acceptIm(selected)">{{ t("im.catch") }}<span class="kbd">C</span></button>
            <button class="btn red" @click="dismissIm(selected)">
              {{ t("im.release") }}<span class="kbd">X</span>
            </button>
            <button
              class="btn ghost er-toggle"
              :title="t('im.escapeWhy')"
              :aria-label="t('im.escapeWhy')"
              @click="toggleEscapeMenu"
            >
              ▾
            </button>
            <button class="btn ghost force" :disabled="forcingId === selected.id" @click="forceCreate(selected)">
              {{ forcingId === selected.id ? t("im.forcing") : t("im.force") }}<span class="kbd">F</span>
            </button>
          </template>
          <template v-else-if="selected.reviewStatus === 'pending'">
            <!-- 无信号/判定失败：逃走或强制捕捉 -->
            <button class="btn red" @click="dismissIm(selected)">
              {{ t("im.release") }}<span class="kbd">X</span>
            </button>
            <button
              class="btn ghost er-toggle"
              :title="t('im.escapeWhy')"
              :aria-label="t('im.escapeWhy')"
              @click="toggleEscapeMenu"
            >
              ▾
            </button>
            <button class="btn ghost force" :disabled="forcingId === selected.id" @click="forceCreate(selected)">
              {{ forcingId === selected.id ? t("im.forcing") : t("im.force") }}<span class="kbd">F</span>
            </button>
          </template>
          <template v-else-if="selected.reviewStatus === 'dismissed'">
            <button class="btn ghost" @click="restoreIm(selected)">↩ {{ t("im.restore") }}</button>
            <button class="btn ghost force" :disabled="forcingId === selected.id" @click="forceCreate(selected)">
              {{ forcingId === selected.id ? t("im.forcing") : t("im.force") }}<span class="kbd">F</span>
            </button>
          </template>
          <template v-else>
            <button class="btn ghost force" :disabled="forcingId === selected.id" @click="forceCreate(selected)">
              {{ forcingId === selected.id ? t("im.forcing") : t("im.force") }}<span class="kbd">F</span>
            </button>
          </template>

          <!-- 逃走原因弹层（可选）：选原因码再逃走，帮 AI 越判越准 -->
          <div v-if="escapeMenuId === selected.id" class="escape-pop">
            <div class="er-label">{{ t("im.escapeWhy") }}</div>
            <button v-for="code in ESCAPE_REASONS" :key="code" class="er-chip" @click="dismissIm(selected, code)">
              {{ t(`im.escapeReasons.${code}`) }}
            </button>
            <button class="er-chip just" @click="dismissIm(selected)">{{ t("im.justEscape") }}</button>
          </div>
        </div>
        <div v-if="escapeMenuId === selected.id" class="pop-mask" @click="escapeMenuId = null"></div>
      </div>
    </section>
  </div>

  <!-- 撤销 toast：处理完立即生效，5 秒内可反悔 -->
  <div v-if="toast" class="toast" :class="{ error: toast.error }">
    <span>{{ toast.text }}</span>
    <button v-if="toast.undo" @click="toast.undo()">{{ t("im.undo") }}</button>
  </div>
</template>

<style scoped>
/* 收音机两栏：左列表右详情，约 3:2 分栏（左列最小 360px） */
.im-split {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 14px;
  padding: 4px 20px 20px;
}
.im-left {
  flex: 3 1 0;
  min-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}
.im-toolbar {
  display: flex;
  gap: 8px;
}
.search-input {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-size: 13px;
  background: #fff;
  font-family: inherit;
  box-shadow: 3px 3px 0 var(--dex-navy);
  min-height: 38px;
}
/* ⏱时间 / 📡频道 切换 */
.view-toggle {
  display: flex;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 3px 3px 0 var(--dex-navy);
  background: #fff;
  flex: none;
}
.view-toggle button {
  border: 0;
  background: transparent;
  padding: 0 10px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  color: var(--dex-navy);
  font-family: inherit;
  min-height: 38px;
}
.view-toggle button.on {
  background: var(--poke-yellow);
}

/* 列表容器 */
.im-list-box {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  background: #fff;
  box-shadow: 3px 3px 0 var(--dex-navy);
  padding: 6px;
}
.list-group + .list-group {
  margin-top: 6px;
}
.list-group.collapsed .lg-body {
  display: none;
}
.lg-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  font-size: 12px;
  font-weight: 800;
  padding: 6px;
  cursor: pointer;
  user-select: none;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: var(--dex-navy);
  font-family: inherit;
  text-align: left;
}
.lg-head:hover {
  background: var(--hover);
}
.lg-caret {
  font-size: 10px;
  width: 12px;
  flex: none;
}
.lg-count {
  font-size: 11px;
  background: var(--dex-navy);
  color: #fff;
  border-radius: 4px;
  padding: 1px 5px;
}
.lg-count.hot {
  background: var(--danger);
}
.lg-state {
  margin-left: auto;
  font-size: 11px;
  color: var(--ink-soft);
  font-weight: 700;
}
/* 无信号组头的一键清空 */
.clear-noise {
  font-size: 11px;
  font-weight: 700;
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  background: #fff;
  padding: 2px 8px;
  cursor: pointer;
  transition:
    background var(--t-tap),
    transform var(--t-tap);
}
.clear-noise:hover {
  background: var(--hover);
}
.clear-noise:active {
  transform: translate(1px, 1px);
}

/* 单行消息 */
.rrow {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 7px 8px;
  border-radius: 8px;
  cursor: pointer;
  border: 3px solid transparent;
}
.rrow:hover {
  background: var(--hover);
}
.rrow.sel {
  background: var(--hover);
  border-color: var(--dex-navy);
  box-shadow: 2px 2px 0 var(--dex-navy);
}
.rrow.dim {
  opacity: 0.6;
}
.im-check {
  width: 16px;
  height: 16px;
  margin-top: 2px;
  accent-color: var(--dex-navy);
  cursor: pointer;
  flex: none;
}
.r-main {
  flex: 1;
  min-width: 0;
}
.r-line1 {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
}
.chat-badge {
  flex: none;
  font-size: 11px;
  font-weight: 800;
  color: var(--ink-soft);
  border: 2px solid var(--ink-faint);
  border-radius: 4px;
  padding: 0 4px;
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.r-sender {
  flex: none;
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.r-time {
  margin-left: auto;
  flex: none;
  font-size: 11px;
  color: var(--ink-soft);
  font-weight: 500;
}
.r-snippet {
  margin-top: 3px;
  font-size: 12px;
  color: var(--ink-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.r-mark {
  flex: none;
  margin-top: 2px;
  font-size: 11px;
  font-weight: 800;
}
.r-mark.ok {
  color: var(--dex-navy);
}
.r-mark.no {
  color: var(--ink-soft);
}
/* 置信色点（行内紧凑版） */
.conf {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 2px solid var(--dex-navy);
  flex: none;
}
.conf.high {
  background: var(--ok-bright);
}
.conf.medium {
  background: var(--poke-yellow);
}
.conf.low {
  background: var(--conf-low);
}
.pending-empty {
  padding: 18px 10px;
  text-align: center;
  font-size: 13px;
  color: var(--ink-soft);
  line-height: 2;
}
.empty {
  color: var(--ink-soft);
  text-align: center;
  padding: 48px 0;
  font-size: 14px;
  line-height: 2;
}

/* 批量条（左栏底部） */
.batch-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  background: #fff;
  box-shadow: 3px 3px 0 var(--dex-navy);
  padding: 6px 8px;
}
.batch-bar .btn {
  padding: 4px 8px;
  font-size: 12px;
  min-height: 38px;
}
.batch-check {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  user-select: none;
}
.hi-conf-btn {
  font-size: 11px;
  font-weight: 700;
  border: 0;
  background: transparent;
  color: var(--warn-ink);
  cursor: pointer;
  padding: 4px 2px;
  text-decoration: underline;
  text-underline-offset: 3px;
  font-family: inherit;
}

/* 右栏详情 */
.im-right {
  flex: 2 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.d-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-soft);
  font-size: 14px;
  line-height: 2;
  text-align: center;
}
.d-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.d-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--ink-soft);
  flex-wrap: wrap;
}
.d-meta .type-badge {
  color: var(--dex-navy);
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 11px;
  background: #fff;
}
.d-content {
  padding: 14px;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.8;
  white-space: pre-wrap;
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
}
.ai-status {
  margin-left: auto;
  font-size: 11px;
  font-weight: 800;
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  padding: 1px 6px;
  background: #fff;
  color: var(--dex-navy);
  flex: none;
}
.im-suggest {
  font-size: 13px;
  font-weight: 700;
  color: var(--dex-navy);
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  padding: 6px 10px;
  box-shadow: 3px 3px 0 var(--dex-navy);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.im-suggest.update {
  background: var(--conf-mid-soft);
}
.im-suggest.none {
  background: var(--conf-low-soft);
  color: var(--ink-soft);
  font-weight: 600;
}
.sug-prio {
  font-size: 11px;
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  padding: 0 6px;
}
.sug-tag {
  font-size: 11px;
  color: var(--dex-navy);
  background: var(--tag-pill);
  border: 2px solid var(--dex-navy);
  border-radius: 999px;
  padding: 0 7px;
}
/* 项目维度是主位信息：黄色；拟新建的标签用虚线描边 + 前缀 ＋ */
.sug-tag.sug-dim-project {
  background: var(--poke-yellow);
  color: var(--dex-navy);
}
.sug-tag.sug-new {
  border-style: dashed;
  font-weight: 800;
}
/* 置信档位：高=绿 / 中=琥珀 / 低=灰 */
.sug-conf {
  font-size: 11px;
  font-weight: 800;
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  padding: 0 6px;
}
.sug-conf.c-high {
  color: var(--ok-ink);
  background: var(--ok-soft);
}
.sug-conf.c-medium {
  color: var(--warn-ink);
  background: var(--conf-mid-soft);
}
.sug-conf.c-low {
  color: var(--ink-soft);
  background: var(--conf-low-soft);
}
.sug-reason {
  flex-basis: 100%;
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-soft);
}
.done-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 800;
  color: var(--dex-navy);
  background: var(--ok-soft);
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  box-shadow: 3px 3px 0 var(--dex-navy);
  padding: 10px 12px;
  flex-wrap: wrap;
}
.done-banner.dim-banner {
  background: var(--conf-low-soft);
  color: var(--ink-soft);
}
.caught-sub {
  font-size: 12px;
  color: var(--ink-soft);
}

/* 操作区（固定在详情底部，不随消息滚动） */
.im-actions {
  flex: none;
  display: flex;
  gap: 10px;
  align-items: center;
  position: relative;
  flex-wrap: wrap;
}
.im-actions .force {
  color: var(--dex-navy);
}
.im-actions .red {
  background: var(--dex-red);
  color: #fff;
}
/* 快捷键提示 chip（NN/g：快捷键标在按钮上，用着用着就学会了） */
.kbd {
  display: inline-block;
  font-family: "Press Start 2P", monospace;
  font-size: 8px;
  background: #fff;
  border: 2px solid var(--dex-navy);
  border-bottom-width: 3px;
  border-radius: 4px;
  padding: 2px 5px;
  margin-left: 6px;
  vertical-align: 1px;
}
.im-actions .red .kbd {
  background: rgba(255, 255, 255, 0.25);
}
.er-toggle {
  padding: 8px 10px;
}

/* 逃走原因弹层 */
.escape-pop {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 60;
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  box-shadow: 4px 4px 0 var(--dex-navy);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 200px;
}
.escape-pop .er-label {
  font-size: 11px;
  font-weight: 800;
  color: var(--ink-soft);
  padding: 2px 6px 6px;
}
.er-chip {
  border: 2px solid var(--dex-navy);
  background: #fff;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 700;
  padding: 6px 10px;
  min-height: 32px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: var(--dex-navy);
  transition:
    background var(--t-tap),
    transform var(--t-tap);
}
.er-chip:hover {
  background: var(--hover);
}
.er-chip:active {
  transform: translate(1px, 1px);
}
.er-chip.just {
  border-style: dashed;
  color: var(--ink-soft);
}
/* 弹层背板：点外面收起 */
.pop-mask {
  position: fixed;
  inset: 0;
  z-index: 50;
}

/* 撤销 toast */
.toast {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  box-shadow: 4px 4px 0 var(--dex-navy);
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 700;
  max-width: 70%;
}
.toast.error {
  color: var(--danger);
}
.toast button {
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  background: var(--poke-yellow);
  font-size: 12px;
  font-weight: 800;
  padding: 4px 10px;
  cursor: pointer;
  font-family: inherit;
  flex: none;
  transition: transform var(--t-tap);
}
.toast button:active {
  transform: translate(1px, 1px);
}
</style>
