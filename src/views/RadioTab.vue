<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { api } from "../api";
import { useTasksStore } from "../stores/tasks";

const { t } = useI18n();
const tasksStore = useTasksStore();

async function acceptIm(id: number) {
  await api.acceptImSuggestion(id);
  await tasksStore.reload();
}
async function dismissIm(id: number) {
  await api.dismissImSuggestion(id);
  await tasksStore.reload();
}
</script>

<template>
  <div class="im-list">
    <div v-if="!tasksStore.imSuggestions.length" class="empty">{{ t("im.empty1") }}<br />{{ t("im.empty2") }}</div>
    <div v-for="s in tasksStore.imSuggestions" :key="s.id" class="im-card">
      <div class="lcd im-screen">
        <div class="im-meta px">{{ s.chatName || "FEISHU" }} · {{ s.sender }}</div>
        <div class="im-content">{{ s.content }}</div>
      </div>
      <div v-if="s.suggestedTitle" class="im-suggest">
        {{ t("im.found") }}{{ s.suggestedTitle }}
        <span v-if="s.suggestedDue">（{{ s.suggestedDue }}）</span>
      </div>
      <div class="im-actions">
        <button class="btn" @click="acceptIm(s.id)">{{ t("im.catch") }}</button>
        <button class="btn ghost" @click="dismissIm(s.id)">{{ t("im.release") }}</button>
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
.im-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.im-screen {
  padding: 12px;
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
}
.im-actions {
  display: flex;
  gap: 10px;
}
.empty {
  color: #9a937f;
  text-align: center;
  padding: 48px 0;
  font-size: 14px;
  line-height: 2;
}
</style>
