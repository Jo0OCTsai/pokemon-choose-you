<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorMessage } from "../api";
import { useTasksStore } from "../stores/tasks";
import type { ChatMessage } from "../types";
import CaptureBar from "../components/radio/CaptureBar.vue";
import ClearNoiseActions from "../components/radio/ClearNoiseActions.vue";
import ImDetailPanel from "../components/radio/ImDetailPanel.vue";
import ImListGroup from "../components/radio/ImListGroup.vue";
import ImMessageRow from "../components/radio/ImMessageRow.vue";
import UndoToast from "../components/radio/UndoToast.vue";

const { t } = useI18n();
const tasksStore = useTasksStore();

// ---- 快速捕捉：一句话自然语言 → AI 判定属性 → todo 直接建待办（可撤销），判重类留待确认 ----
const captureText = ref("");
const capturing = ref(false);
const captureBar = ref<InstanceType<typeof CaptureBar> | null>(null);

async function submitCapture() {
  const text = captureText.value.trim();
  if (!text || capturing.value) return;
  capturing.value = true;
  try {
    const r = await api.captureTodo(text);
    captureText.value = "";
    query.value = ""; // 清掉搜索过滤，让新电波看得见
    await reload();
    selectedId.value = r.message.id;
    if (r.taskId) {
      showToast(t("im.caughtTask", { id: r.taskId }), { undo: () => undoReview(r.message.id) });
    } else {
      // 判重命中现有待办（update / followUp / none）：建议已生成，等人工裁决
      showToast(t("im.capturePending"));
    }
  } catch (e) {
    showToast(`❌ ${errorMessage(e)}`, { error: true });
    await reload(); // 判定失败的消息也进了列表（error 态，可强制捕捉/逃走）
  } finally {
    capturing.value = false;
  }
}

/** 快捷键"快速捕捉"：切到收音机后聚焦捕捉输入框 */
function focusCapture() {
  captureBar.value?.focus();
}

defineExpose({ focusCapture });

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

// ---- 逃走原因弹层（EscapeReasonPop 渲染选项，开合状态留在本视图） ----
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

// ---- 判定失败重判：error 消息重新送 AI 判定（无信号区一键批量 / 详情单条） ----
const failedList = computed(() => noiseList.value.filter((m) => m.aiStatus === "error"));
const retrying = ref(false);
async function retryFailed(ids: number[]) {
  if (!ids.length || retrying.value) return;
  retrying.value = true;
  try {
    const r = await api.retryAiJudgment(ids);
    showToast(
      r.failed.length ? t("im.retryPartial", { ok: r.ok, fail: r.failed.length }) : t("im.retryDone", { n: r.ok }),
    );
  } catch (e) {
    showToast(`❌ ${errorMessage(e)}`, { error: true });
  } finally {
    retrying.value = false;
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
</script>

<template>
  <div class="im-split">
    <div class="im-main">
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
            <ImListGroup
              data-group="pending"
              :title="t('im.groupSignal')"
              :count="signalList.length"
              count-hot
              :collapsed="collapsed.has('pending')"
              @toggle="toggleGroup('pending')"
            >
              <div v-if="!signalList.length" class="pending-empty">{{ t("im.signalAllDone") }}</div>
              <ImMessageRow
                v-for="m in signalList"
                :key="m.id"
                v-model:selected-id="selectedId"
                variant="signal"
                :message="m"
                :checked="checked.has(m.id)"
                @toggle-check="toggleOne"
              />
            </ImListGroup>

            <!-- 无信号：不是任务（或判定失败），一键清扫 -->
            <ImListGroup
              v-if="noiseList.length"
              data-group="noise"
              :title="t('im.groupNoise')"
              :head-title="t('im.groupNoiseTitle')"
              :count="noiseList.length"
              :collapsed="collapsed.has('noise')"
              @toggle="toggleGroup('noise')"
            >
              <template #actions>
                <ClearNoiseActions
                  :expanded="!collapsed.has('noise')"
                  :failed-count="failedList.length"
                  :retrying="retrying"
                  @retry="retryFailed(failedList.map((m) => m.id))"
                  @clear="clearNoise"
                />
              </template>
              <ImMessageRow
                v-for="m in noiseList"
                :key="m.id"
                v-model:selected-id="selectedId"
                variant="noise"
                :message="m"
                :checked="checked.has(m.id)"
                @toggle-check="toggleOne"
              />
            </ImListGroup>

            <!-- 已捕捉：默认收起，回看用 -->
            <ImListGroup
              v-if="caughtList.length"
              data-group="caught"
              css-collapse
              :title="t('im.groupCaught')"
              :count="caughtList.length"
              :collapsed="collapsed.has('caught')"
              @toggle="toggleGroup('caught')"
            >
              <ImMessageRow
                v-for="m in caughtList"
                :key="m.id"
                v-model:selected-id="selectedId"
                variant="caught"
                :message="m"
              />
            </ImListGroup>

            <!-- 已逃走：默认收起 -->
            <ImListGroup
              v-if="escapedList.length"
              data-group="escaped"
              css-collapse
              :title="t('im.groupEscaped')"
              :count="escapedList.length"
              :collapsed="collapsed.has('escaped')"
              @toggle="toggleGroup('escaped')"
            >
              <ImMessageRow
                v-for="m in escapedList"
                :key="m.id"
                v-model:selected-id="selectedId"
                variant="escaped"
                :message="m"
              />
            </ImListGroup>
          </template>

          <!-- 频道模式：按会话聚拢，组内信号在前 -->
          <template v-else>
            <ImListGroup
              v-for="g in channelGroups"
              :key="g.key"
              css-collapse
              :title="`📡 ${g.name}`"
              :count="
                t('im.chanPending', { n: g.list.filter((m) => m.reviewStatus === 'pending' && isSignal(m)).length })
              "
              :count-hot="g.list.some((m) => m.reviewStatus === 'pending' && isSignal(m))"
              :state-label="t('im.chanTotal', { n: g.list.length })"
              :collapsed="collapsed.has('ch:' + g.key)"
              @toggle="toggleGroup('ch:' + g.key)"
            >
              <ImMessageRow
                v-for="m in g.list"
                :key="m.id"
                v-model:selected-id="selectedId"
                variant="channel"
                :message="m"
                :checked="checked.has(m.id)"
                @toggle-check="toggleOne"
              />
            </ImListGroup>
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
      <ImDetailPanel
        :message="selected"
        :forcing-id="forcingId"
        :retrying="retrying"
        :menu-open="escapeMenuId === selected?.id"
        @accept="acceptIm"
        @dismiss="dismissIm"
        @force="forceCreate"
        @restore="restoreIm"
        @retry="retryFailed"
        @toggle-menu="toggleEscapeMenu"
        @close-menu="escapeMenuId = null"
      />
    </div>

    <CaptureBar ref="captureBar" v-model="captureText" :capturing="capturing" @submit="submitCapture" />
  </div>

  <!-- 撤销 toast：处理完立即生效，5 秒内可反悔 -->
  <UndoToast v-if="toast" :toast="toast" @undo="toast?.undo?.()" />
</template>

<style scoped>
/* 收音机：上收听下发送——两栏收听区（约 3:2，左列最小 360px）+ 底部通栏捕捉条 */
.im-split {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 20px 20px;
}
.im-main {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 14px;
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
</style>
