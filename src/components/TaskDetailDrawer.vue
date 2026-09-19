<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorMessage } from "../api";
import { fmtDateTime } from "../stores/settings";
import { useCategoriesStore } from "../stores/categories";
import type { AgentSession, Task, TaskLog, TaskNote } from "../types";

/** 任务详情抽屉：点击任务卡片打开——属性总览 + 跟进记录 + Agent 执行 + 操作历史。
 * 只读查看为主（跟进记录可直接补充），改字段走「编辑」进全字段弹窗。 */
const props = defineProps<{ task: Task }>();
const emit = defineEmits<{ close: []; edit: [task: Task] }>();

const { t, te } = useI18n();
const categories = useCategoriesStore();

/** 有对应翻译键就用翻译（状态值 / 动作名），否则原样展示 */
function tx(key: string, fallback: string): string {
  return te(key) ? t(key) : fallback;
}

const catName = computed(() => categories.byId.get(props.task.categoryId)?.name ?? "—");
const statusText = computed(() => tx(`status.${props.task.status}`, props.task.status));
const prioText = computed(() => tx(`priority.${props.task.priority}`, props.task.priority));

// ---- 跟进记录 ----
const notes = ref<TaskNote[]>([]);
const newNote = ref("");
const noteBusy = ref(false);
const error = ref("");
async function loadNotes() {
  notes.value = await api.listTaskNotes(props.task.id);
}
async function addNote() {
  const content = newNote.value.trim();
  if (!content) return;
  noteBusy.value = true;
  try {
    await api.addTaskNote(props.task.id, content);
    newNote.value = "";
    await loadNotes();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    noteBusy.value = false;
  }
}
async function removeNote(id: number) {
  await api.deleteTaskNote(id);
  await loadNotes();
}

// ---- Agent 执行（只读）：会话回链与成本记录，可跳转会话转录 ----
const sessions = ref<AgentSession[]>([]);
const totalCost = computed(() => sessions.value.reduce((sum, x) => sum + (x.costUsd ?? 0), 0));
function fmtDuration(ms: number | null | undefined): string {
  if (!ms || ms < 1000) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}
function openTranscript(x: AgentSession) {
  Promise.resolve(api.openAgentHistory(x.agentId, x.sessionId ?? undefined)).catch(() => {});
}

// ---- 操作历史（只读，最新在前） ----
const logs = ref<TaskLog[]>([]);
function valueOf(field: string, v: string | null | undefined): string {
  if (v == null || v === "") return "—";
  return field === "status" ? tx(`status.${v}`, v) : v;
}

onMounted(async () => {
  await loadNotes().catch(() => {
    notes.value = [];
  });
  sessions.value = await api.listAgentSessions(props.task.id).catch(() => []);
  logs.value = await api.listTaskLogs(props.task.id).catch(() => []);
});
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <aside class="drawer">
      <header class="d-head">
        <span class="d-no px">No.{{ String(task.id).padStart(3, "0") }}</span>
        <h3 class="d-title">{{ task.title }}</h3>
        <button class="d-close" type="button" @click="emit('close')">✕</button>
      </header>

      <div class="d-summary">
        <div class="kv">
          <span class="k">{{ t("edit.category") }}</span
          ><span class="v">{{ catName }}</span>
        </div>
        <div class="kv">
          <span class="k">{{ t("edit.priority") }}</span
          ><span class="v">{{ prioText }}</span>
        </div>
        <div class="kv">
          <span class="k">{{ t("detail.status") }}</span
          ><span class="v">{{ statusText }}</span>
        </div>
        <div class="kv">
          <span class="k">{{ t("edit.due") }}</span
          ><span class="v">{{ task.dueAt ? fmtDateTime(task.dueAt) : "—" }}</span>
        </div>
        <div class="kv">
          <span class="k">{{ t("edit.remind") }}</span
          ><span class="v">{{ task.remindAt ? fmtDateTime(task.remindAt) : "—" }}</span>
        </div>
        <div class="kv">
          <span class="k">{{ t("edit.tags") }}</span
          ><span class="v">{{
            task.tags.length
              ? task.tags.map((r) => (r.dimension === "project" ? `⛳ ${r.name}` : `# ${r.name}`)).join(" ")
              : "—"
          }}</span>
        </div>
        <div class="kv">
          <span class="k">{{ t("detail.source") }}</span
          ><span class="v">{{ task.source === "feishu" ? t("entry.feishu") : task.source }}</span>
        </div>
        <div class="kv">
          <span class="k">{{ t("detail.focus") }}</span
          ><span class="v">{{ Math.round(task.focusSeconds / 60) }} min</span>
        </div>
        <div class="kv">
          <span class="k">{{ t("detail.created") }}</span
          ><span class="v px">{{ fmtDateTime(task.createdAt) }}</span>
        </div>
        <div class="kv">
          <span class="k">{{ task.status === "cancelled" ? t("detail.escaped") : t("detail.completed") }}</span>
          <span class="v px">{{ fmtDateTime(task.completedAt ?? task.cancelledAt) }}</span>
        </div>
      </div>
      <p v-if="task.note" class="d-note">{{ task.note }}</p>

      <!-- 跟进记录 -->
      <div class="notes">
        <div class="notes-head">{{ t("edit.followUps") }}</div>
        <ul class="note-list">
          <li v-if="!notes.length" class="note-empty">{{ t("edit.noFollowUps") }}</li>
          <li v-for="n in notes" :key="n.id" class="note-item">
            <span v-if="n.source === 'ai'" class="note-src">AI</span>
            <span class="note-time px">{{ fmtDateTime(n.createdAt) }}</span>
            <span class="note-content">{{ n.content }}</span>
            <button class="note-del" type="button" @click="removeNote(n.id)">✕</button>
          </li>
        </ul>
        <form class="note-add" @submit.prevent="addNote">
          <input v-model="newNote" :placeholder="t('edit.followUpPlaceholder')" :disabled="noteBusy" />
          <button class="btn ghost" type="submit" :disabled="noteBusy || !newNote.trim()">
            {{ t("edit.addFollowUp") }}
          </button>
        </form>
      </div>

      <!-- Agent 执行：这个任务花了多少钱、跑了几次 -->
      <div v-if="sessions.length" class="notes">
        <div class="notes-head">
          {{ t("edit.agentRuns") }}<span class="run-cost"> ${{ totalCost.toFixed(2) }}</span>
        </div>
        <ul class="note-list">
          <li v-for="x in sessions" :key="x.id" class="note-item">
            <span class="note-src" :class="{ err: x.status === 'error' }">{{ x.agentName }}</span>
            <span class="note-time px">{{ fmtDateTime(x.createdAt) }}</span>
            <span class="note-content">
              {{ t("edit.runDuration", { v: fmtDuration(x.durationMs) }) }}
              <template v-if="x.costUsd != null">· ${{ x.costUsd.toFixed(2) }}</template>
              <template v-if="x.exitCode != null">· exit {{ x.exitCode }}</template>
              <template v-if="x.command">· {{ x.command }}</template>
            </span>
            <button
              v-if="x.sessionId"
              class="note-del run-open"
              type="button"
              :title="t('edit.openTranscript')"
              @click="openTranscript(x)"
            >
              ▶
            </button>
          </li>
        </ul>
      </div>

      <!-- 操作历史 -->
      <div class="notes">
        <div class="notes-head">{{ t("edit.history") }}</div>
        <ul class="note-list log-list">
          <li v-if="!logs.length" class="note-empty">{{ t("edit.noHistory") }}</li>
          <li v-for="l in logs" :key="l.id" class="note-item">
            <span class="note-src">{{ l.origin }}</span>
            <span class="note-time px">{{ fmtDateTime(l.createdAt) }}</span>
            <span class="note-content">
              {{ tx(`log.${l.action}`, l.action)
              }}<template v-if="l.field"
                >· {{ l.field }}: {{ valueOf(l.field, l.oldValue) }} → {{ valueOf(l.field, l.newValue) }}</template
              >
            </span>
          </li>
        </ul>
      </div>

      <p v-if="error" class="err">❌ {{ error }}</p>
      <div class="btn-row">
        <button class="btn" @click="emit('edit', task)">✎ {{ t("detail.edit") }}</button>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: rgba(28, 34, 68, 0.42);
}
.drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 400px;
  max-width: calc(100vw - 24px);
  background: #fff;
  border-left: 4px solid var(--dex-navy);
  border-radius: 16px 0 0 16px;
  box-shadow: -8px 0 0 var(--dex-navy);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  animation: slide-in var(--t-act) var(--e-snap);
}
@keyframes slide-in {
  from {
    transform: translateX(40px);
    opacity: 0.4;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
.d-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.d-no {
  flex: none;
  font-size: 8px;
  color: var(--ink-soft);
}
.d-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 16px;
  word-break: break-all;
}
.d-close {
  flex: none;
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  background: #fff;
  color: var(--dex-navy);
  font-weight: 800;
  cursor: pointer;
  padding: 2px 8px;
  font-family: inherit;
  transition:
    background var(--t-tap),
    transform var(--t-tap);
}
.d-close:hover {
  background: var(--hover);
}
.d-close:active {
  transform: translate(1px, 1px);
}
.d-summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 14px;
  background: var(--lcd);
  border: 3px solid var(--dex-navy);
  border-radius: 4px;
  padding: 10px 12px;
}
.kv {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12.5px;
  min-width: 0;
}
.kv .k {
  flex: none;
  font-weight: 800;
  color: var(--dex-navy);
}
.kv .v {
  min-width: 0;
  word-break: break-all;
}
.d-note {
  margin: 0;
  font-size: 12.5px;
  background: var(--dex-body);
  border: 2px dashed var(--dex-navy);
  border-radius: 8px;
  padding: 8px 10px;
  word-break: break-all;
}
/* 跟进记录 / Agent 执行 / 操作历史 */
.notes {
  border-top: 2px dashed var(--ink-faint);
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.notes-head {
  font-size: 13px;
  font-weight: 800;
  color: var(--dex-navy);
}
.note-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 180px;
  overflow-y: auto;
}
.note-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  background: var(--lcd);
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 12.5px;
}
.note-src {
  font-size: 11px;
  font-weight: 800;
  color: #fff;
  background: var(--dex-navy);
  border-radius: 4px;
  padding: 1px 5px;
  flex: none;
}
.note-src.err {
  background: var(--dex-red);
}
.note-time {
  font-size: 8px;
  color: var(--lcd-text);
  flex: none;
}
.note-content {
  flex: 1;
  min-width: 0;
  word-break: break-all;
}
.note-del {
  border: none;
  background: none;
  color: var(--danger);
  cursor: pointer;
  font-size: 12px;
  padding: 0 2px;
  flex: none;
}
.note-empty {
  font-size: 12px;
  color: var(--ink-soft);
  padding: 4px 2px;
}
.note-add {
  display: flex;
  gap: 8px;
}
.note-add input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  min-height: 38px;
  box-shadow: 3px 3px 0 var(--dex-navy);
}
.note-add .btn {
  padding: 7px 10px;
  min-height: 38px;
  font-size: 13px;
}
.log-list .note-content {
  font-size: 12px;
}
.run-cost {
  color: var(--danger);
}
.run-open {
  color: var(--dex-navy);
  font-weight: 800;
}
.err {
  margin: 0;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--danger);
}
.btn-row {
  display: flex;
  gap: 10px;
  margin-top: auto;
}
</style>
