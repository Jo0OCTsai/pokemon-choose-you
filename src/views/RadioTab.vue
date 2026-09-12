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
</script>

<template>
  <div class="im-list">
    <div class="im-toolbar">
      <input v-model="query" class="search-input" :placeholder="t('im.search')" />
      <span v-if="forceMsg" class="force-msg">{{ forceMsg }}</span>
    </div>

    <div v-if="!list.length" class="empty">{{ t("im.empty1") }}<br />{{ t("im.empty2") }}</div>

    <div v-for="m in list" :key="m.id" class="im-card" :class="{ dim: m.reviewStatus === 'dismissed' }">
      <div class="lcd im-screen">
        <div class="im-meta px">{{ m.chatName || "FEISHU" }} · {{ m.sender }} · {{ fmtDateTime(m.createdAt) }}</div>
        <div class="im-content">{{ m.content }}</div>
        <span class="ai-status" :class="'s-' + m.aiStatus">{{ t(aiStatusKey(m)) }}</span>
      </div>

      <!-- AI 建议 -->
      <div v-if="m.suggestedTitle" class="im-suggest">
        {{ t("im.found") }}{{ m.suggestedTitle }}
        <span v-if="m.suggestedDue">（{{ t("entry.due", { v: fmtDateTime(m.suggestedDue) }) }}）</span>
        <span v-if="m.suggestedPriority" class="sug-prio">{{ t(`priority.${m.suggestedPriority}`) }}</span>
        <span v-for="tag in m.suggestedTags" :key="tag" class="sug-tag"># {{ tag }}</span>
      </div>

      <div class="im-actions">
        <template v-if="m.taskId">
          <span class="caught-mark">✔ {{ t("im.caughtTask", { id: m.taskId }) }}</span>
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
