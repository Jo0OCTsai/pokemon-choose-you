<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorMessage } from "../api";
import { fmtDateTime } from "../stores/settings";
import { useTasksStore } from "../stores/tasks";
import type { ChatMessage } from "../types";

const { t } = useI18n();
const tasksStore = useTasksStore();

// ---- 搜索（后端 LIKE 过滤） ----
const query = ref("");
const searching = ref(false);
const searched = ref<ChatMessage[] | null>(null);
const list = computed(() => searched.value ?? tasksStore.chatMessages);

watch(query, async (q) => {
  q = q.trim();
  if (!q) {
    searched.value = null;
    return;
  }
  searching.value = true;
  try {
    searched.value = await api.listChatMessages(q);
  } finally {
    searching.value = false;
  }
});

async function reload() {
  if (searched.value !== null) {
    searched.value = await api.listChatMessages(query.value.trim() || undefined);
  } else {
    await tasksStore.reload();
  }
}

async function acceptIm(m: ChatMessage) {
  await api.acceptChatMessage(m.id);
  await reload();
}
async function dismissIm(m: ChatMessage) {
  await api.dismissChatMessage(m.id);
  await reload();
}

// 强制捕捉：让 AI 为消息建待办（先判重，重复/跟进会返回说明）
const forcingId = ref<number | null>(null);
const forceMsg = ref("");
async function forceCreate(m: ChatMessage) {
  forcingId.value = m.id;
  forceMsg.value = "";
  try {
    await api.forceCreateTodo(m.id);
    forceMsg.value = t("im.forceDone");
    await reload();
  } catch (e) {
    forceMsg.value = `❌ ${errorMessage(e)}`;
    await reload();
  } finally {
    forcingId.value = null;
    setTimeout(() => (forceMsg.value = ""), 5000);
  }
}

const aiStatusKey = (m: ChatMessage) => `im.status.${m.aiStatus}`;
const chatTypeLabel = (m: ChatMessage) => (m.chatType ? t(`im.type.${m.chatType}`) : "");
/** 建议（更新/跟进）的目标待办标题（图鉴列表里查；已完成/删除的查不到就空） */
const taskTitle = (id: number) => tasksStore.open.find((tk) => tk.id === id)?.title ?? "";

async function applyUpdate(m: ChatMessage) {
  forcingId.value = m.id;
  forceMsg.value = "";
  try {
    await api.applyChatMessageUpdate(m.id);
    forceMsg.value = t("im.updatedTask", { id: m.updateTaskId ?? 0 });
    await reload();
  } catch (e) {
    forceMsg.value = `❌ ${errorMessage(e)}`;
    await reload();
  } finally {
    forcingId.value = null;
    setTimeout(() => (forceMsg.value = ""), 5000);
  }
}

// ---- 批量分诊：勾选多条 pending 建议，一键捕捉 / 逃走 ----
const selected = ref(new Set<number>());
const pendingIds = computed(() => list.value.filter((m) => m.reviewStatus === "pending").map((m) => m.id));
const allSelected = computed(
  () => pendingIds.value.length > 0 && pendingIds.value.every((id) => selected.value.has(id)),
);

function toggleAll() {
  selected.value = allSelected.value ? new Set() : new Set(pendingIds.value);
}
function toggleOne(id: number) {
  const next = new Set(selected.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  selected.value = next;
}

const batching = ref(false);
const batchMsg = ref("");
async function batch(action: "accept" | "dismiss") {
  const ids = [...selected.value];
  if (!ids.length || batching.value) return;
  batching.value = true;
  batchMsg.value = "";
  try {
    const r = await api.batchReviewChatMessages(ids, action);
    batchMsg.value = r.failed.length
      ? t("im.batchPartial", { ok: r.ok, fail: r.failed.length })
      : t("im.batchDone", { n: r.ok });
    selected.value = new Set();
    await reload();
  } catch (e) {
    batchMsg.value = `❌ ${errorMessage(e)}`;
  } finally {
    batching.value = false;
    setTimeout(() => (batchMsg.value = ""), 5000);
  }
}
</script>

<template>
  <div class="im-list">
    <div class="im-toolbar">
      <input v-model="query" class="search-input" :placeholder="t('im.search')" />
      <span v-if="forceMsg" class="force-msg">{{ forceMsg }}</span>
    </div>

    <div v-if="pendingIds.length" class="batch-bar">
      <label class="batch-check">
        <input type="checkbox" :checked="allSelected" @change="toggleAll" />
        {{ t("im.selectAll") }}（{{ pendingIds.length }}）
      </label>
      <button class="btn ghost" :disabled="!selected.size || batching" @click="batch('accept')">
        {{ t("im.batchCatch") }}{{ selected.size ? `（${selected.size}）` : "" }}
      </button>
      <button class="btn ghost" :disabled="!selected.size || batching" @click="batch('dismiss')">
        {{ t("im.batchRelease") }}{{ selected.size ? `（${selected.size}）` : "" }}
      </button>
      <span v-if="batchMsg" class="force-msg">{{ batchMsg }}</span>
    </div>

    <div v-if="!list.length" class="empty">{{ t("im.empty1") }}<br />{{ t("im.empty2") }}</div>

    <div v-for="m in list" :key="m.id" class="im-card" :class="{ dim: m.reviewStatus === 'dismissed' }">
      <div class="lcd im-screen">
        <div class="im-meta px">
          <span v-if="m.chatType" class="chat-badge">{{ chatTypeLabel(m) }}</span>
          {{ m.chatName || "FEISHU" }} · {{ m.sender }} · {{ fmtDateTime(m.createdAt) }}
        </div>
        <div class="im-content">{{ m.content }}</div>
        <span class="ai-status" :class="'s-' + m.aiStatus">{{ t(aiStatusKey(m)) }}</span>
      </div>

      <!-- AI 建议：新待办 -->
      <div v-if="m.suggestedTitle && m.aiStatus !== 'update'" class="im-suggest">
        {{ t("im.found") }}{{ m.suggestedTitle }}
        <span v-if="m.suggestedDue">（{{ t("entry.due", { v: fmtDateTime(m.suggestedDue) }) }}）</span>
        <span v-if="m.suggestedPriority" class="sug-prio">{{ t(`priority.${m.suggestedPriority}`) }}</span>
        <span v-for="tag in m.suggestedTags" :key="tag" class="sug-tag"># {{ tag }}</span>
      </div>

      <!-- AI 建议：更新已有待办（只展示明确给出的变更字段） -->
      <div v-if="m.aiStatus === 'update' && m.updateTaskId" class="im-suggest update">
        {{ t("im.updateFound", { id: m.updateTaskId })
        }}<span v-if="taskTitle(m.updateTaskId)">「{{ taskTitle(m.updateTaskId) }}」</span>
        <span v-if="m.suggestedTitle">{{ t("edit.title") }} → {{ m.suggestedTitle }}</span>
        <span v-if="m.suggestedDue">（{{ t("entry.due", { v: fmtDateTime(m.suggestedDue) }) }}）</span>
        <span v-if="m.suggestedPriority" class="sug-prio">{{ t(`priority.${m.suggestedPriority}`) }}</span>
        <span v-for="tag in m.suggestedTags" :key="tag" class="sug-tag"># {{ tag }}</span>
      </div>

      <div class="im-actions">
        <input
          v-if="m.reviewStatus === 'pending'"
          type="checkbox"
          class="im-check"
          :checked="selected.has(m.id)"
          :aria-label="t('im.selectAll')"
          @change="toggleOne(m.id)"
        />
        <template v-if="m.taskId">
          <span class="caught-mark">✔ {{ t("im.caughtTask", { id: m.taskId }) }}</span>
        </template>
        <template v-else-if="m.reviewStatus === 'accepted' && m.aiStatus === 'update'">
          <span class="caught-mark">✔ {{ t("im.updatedTask", { id: m.updateTaskId ?? 0 }) }}</span>
        </template>
        <template v-else-if="m.aiStatus === 'followup' && m.followupTaskId">
          <span class="caught-mark">✔ {{ t("im.followedTask", { id: m.followupTaskId }) }}</span>
          <span v-if="taskTitle(m.followupTaskId)" class="caught-sub">「{{ taskTitle(m.followupTaskId) }}」</span>
        </template>
        <template v-else-if="m.reviewStatus === 'pending' && m.aiStatus === 'update'">
          <button class="btn" :disabled="forcingId === m.id" @click="applyUpdate(m)">
            {{ forcingId === m.id ? t("im.forcing") : t("im.applyUpdate") }}
          </button>
          <button class="btn ghost" @click="dismissIm(m)">{{ t("im.release") }}</button>
        </template>
        <template v-else-if="m.reviewStatus === 'pending' && m.aiStatus === 'todo'">
          <button class="btn" @click="acceptIm(m)">{{ t("im.catch") }}</button>
          <button class="btn ghost" @click="dismissIm(m)">{{ t("im.release") }}</button>
          <button class="btn ghost force" :disabled="forcingId === m.id" @click="forceCreate(m)">
            {{ forcingId === m.id ? t("im.forcing") : t("im.force") }}
          </button>
        </template>
        <template v-else>
          <button class="btn ghost force" :disabled="forcingId === m.id" @click="forceCreate(m)">
            {{ forcingId === m.id ? t("im.forcing") : t("im.force") }}
          </button>
          <span v-if="m.reviewStatus === 'dismissed'" class="dim-mark">{{ t("im.released") }}</span>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* IM 信号 */
.im-list {
  flex: 1;
  padding: 4px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
}
.im-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}
/* 批量分诊条：全选 + 批量捕捉/逃走 */
.batch-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.batch-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
  color: var(--dex-navy);
  cursor: pointer;
}
.im-check {
  width: 18px;
  height: 18px;
  accent-color: var(--dex-navy);
  cursor: pointer;
  flex: none;
}
.caught-sub {
  font-size: 12px;
  color: #9a937f;
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
  min-height: 36px;
}
.force-msg {
  flex: none;
  font-size: 12px;
  font-weight: 700;
  color: var(--dex-red);
  max-width: 55%;
  text-align: right;
}
.im-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.im-card.dim {
  opacity: 0.55;
}
.im-screen {
  padding: 12px;
  position: relative;
}
.im-meta {
  font-size: 9px;
  letter-spacing: 1px;
  margin-bottom: 8px;
}
.chat-badge {
  display: inline-block;
  margin-right: 6px;
  padding: 0 5px;
  border: 1px solid var(--lcd-text);
  border-radius: 4px;
  font-weight: 800;
}
.im-content {
  font-size: 14px;
  font-weight: 700;
  line-height: 1.7;
  white-space: pre-wrap;
  max-height: 120px;
  overflow-y: auto;
  padding-right: 84px;
}
.ai-status {
  position: absolute;
  top: 10px;
  right: 10px;
  font-size: 10px;
  font-weight: 800;
  color: var(--lcd-text);
  border: 2px solid var(--lcd-text);
  border-radius: 4px;
  padding: 1px 6px;
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
  background: #fff8e6;
}
.sug-prio {
  font-size: 11px;
  color: #a1660a;
  background: var(--type-work);
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  padding: 0 6px;
}
.sug-tag {
  font-size: 11px;
  color: #fff;
  background: #8a97b8;
  border: 2px solid var(--dex-navy);
  border-radius: 999px;
  padding: 0 7px;
}
.im-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}
.im-actions .force {
  color: var(--dex-navy);
}
.caught-mark {
  font-size: 13px;
  font-weight: 800;
  color: var(--dex-navy);
}
.dim-mark {
  font-size: 12px;
  color: #9a937f;
}
.empty {
  color: #9a937f;
  text-align: center;
  padding: 48px 0;
  font-size: 14px;
  line-height: 2;
}
</style>
