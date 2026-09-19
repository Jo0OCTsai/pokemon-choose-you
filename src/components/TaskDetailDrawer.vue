<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorMessage } from "../api";
import { fmtDateTime } from "../stores/settings";
import { useCategoriesStore } from "../stores/categories";
import type { AgentSession, Task, TaskDispatchTarget, TaskLog, TaskNote } from "../types";
import DexSelect from "./DexSelect.vue";

/** 任务详情抽屉：点击任务卡片打开——属性总览 + 跟进记录 + Agent 派发与执行 + 操作历史。
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

// ---- Agent 派发（交互/无头双通道）：project 标签路由 → 终端唤起 / 无头执行回传 ----
const hasProjectTag = computed(() => props.task.tags.some((r) => r.dimension === "project"));
const dispatchTarget = ref<TaskDispatchTarget | null>(null);
/** 确认行的改选值（加载时预填解析结果） */
const dispatchAgent = ref("");
/** 通道（interactive = 新终端人可观察；headless = 无头跑完自动回传状态） */
const dispatchChannel = ref("interactive");
const dispatchBusy = ref(false);
const dispatchMsg = ref("");
const dispatchErr = ref("");
/** 派发状态徽章（本地态：初始取任务行，派发/标记后即时更新；自动派发靠重开抽屉同步） */
const dispatchState = ref(props.task.dispatchState ?? null);

const channelOptions = computed(() => [
  { value: "interactive", label: t("dispatch.chInteractive") },
  { value: "headless", label: t("dispatch.chHeadless") },
]);

async function loadDispatch() {
  try {
    const target = await api.resolveTaskDispatch(props.task.id);
    dispatchTarget.value = target;
    dispatchAgent.value = target.agentId ?? "";
  } catch {
    dispatchTarget.value = null; // 非桌面环境（E2E mock）静默
  }
}

/** 改选下拉：启用的 agent；解析结果不在列表里（被停用）时补一项，避免显示裸 id */
const dispatchAgentOptions = computed(() => {
  const target = dispatchTarget.value;
  const opts = (target?.agents ?? []).map((a) => ({
    value: a.id,
    label: `${a.name}${a.sshHost ? " · SSH" : ""}`,
  }));
  if (target?.agentId && !opts.some((o) => o.value === target.agentId)) {
    opts.unshift({ value: target.agentId, label: `${target.agentName ?? target.agentId} · ${t("tags.metaAgentOff")}` });
  }
  return opts;
});

const chosenAgent = computed(() => {
  const target = dispatchTarget.value;
  const id = dispatchAgent.value || target?.agentId;
  const opt = target?.agents.find((a) => a.id === id);
  return { name: opt?.name ?? target?.agentName ?? "—", host: opt?.sshHost ?? target?.sshHost ?? null };
});
const workdirText = computed(() => dispatchTarget.value?.workdir || t("dispatch.dirDefault"));

const stateBadge = computed(() => {
  switch (dispatchState.value) {
    case "queued":
      return { cls: "queued", text: t("dispatch.stQueued") };
    case "running":
      return { cls: "running", text: t("dispatch.stRunning") };
    case "done":
      return { cls: "done", text: t("dispatch.stDone") };
    case "failed":
      return { cls: "failed", text: t("dispatch.stFailed") };
    default:
      return null;
  }
});

async function dispatchNow() {
  dispatchBusy.value = true;
  dispatchErr.value = "";
  dispatchMsg.value = "";
  try {
    const r = await api.dispatchTask(props.task.id, dispatchAgent.value || undefined, dispatchChannel.value);
    dispatchState.value = (r.state as typeof dispatchState.value) ?? null;
    dispatchMsg.value =
      r.note ??
      (r.channel === "headless"
        ? r.state === "failed"
          ? t("dispatch.headlessFailed", { agent: r.session.agentName })
          : t("dispatch.headlessDone", { agent: r.session.agentName })
        : t("dispatch.launched", { term: r.terminal ?? "?", agent: r.session.agentName }));
    sessions.value = await api.listAgentSessions(props.task.id).catch(() => sessions.value);
  } catch (e) {
    dispatchErr.value = errorMessage(e);
  } finally {
    dispatchBusy.value = false;
  }
}

/** 手动标记（交互会话 agent 未回传时的救援）：完成 / 失败 / 重置 */
async function markDispatch(state: "done" | "failed" | "idle") {
  dispatchErr.value = "";
  try {
    await api.markDispatch(props.task.id, state);
    dispatchState.value = state === "idle" ? null : state;
    dispatchMsg.value = t("dispatch.marked");
    setTimeout(() => (dispatchMsg.value = ""), 2000);
  } catch (e) {
    dispatchErr.value = errorMessage(e);
  }
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
  if (hasProjectTag.value) await loadDispatch();
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
          ><span class="v">{{
            task.source === "feishu" ? t("entry.feishu") : task.source === "capture" ? t("entry.capture") : task.source
          }}</span>
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

      <!-- Agent 派发：project 标签路由 → 交互终端 / 无头执行 + 状态回传 -->
      <div class="notes">
        <div class="notes-head">
          {{ t("dispatch.title") }}
          <span v-if="stateBadge" class="badge dsp-state" :class="stateBadge.cls">{{ stateBadge.text }}</span>
        </div>
        <!-- 状态徽章行：queued/running 可手动收口（agent 未回传时的救援） -->
        <div v-if="stateBadge && ['queued', 'running'].includes(stateBadge.cls)" class="dsp-mark">
          <button class="btn ghost mini" @click="markDispatch('done')">{{ t("dispatch.markDone") }}</button>
          <button class="btn ghost mini" @click="markDispatch('failed')">{{ t("dispatch.markFailed") }}</button>
          <button class="btn ghost mini del" @click="markDispatch('idle')">{{ t("dispatch.markReset") }}</button>
        </div>
        <p v-if="!hasProjectTag" class="d-hint">{{ t("dispatch.needTag") }}</p>
        <template v-else-if="dispatchTarget">
          <p v-if="!dispatchTarget.agentId" class="d-hint">{{ t("dispatch.noAgent") }}</p>
          <template v-else>
            <div class="dsp-row">
              <DexSelect v-model="dispatchChannel" :options="channelOptions" class="dsp-channel" />
              <DexSelect
                v-if="dispatchAgentOptions.length > 1"
                v-model="dispatchAgent"
                :options="dispatchAgentOptions"
                class="dsp-agent"
              />
              <span class="badge dsp-agent-badge" :class="{ ssh: !!chosenAgent.host }">
                {{ chosenAgent.name }} · {{ chosenAgent.host ? `SSH ${chosenAgent.host}` : t("ai.local") }}
              </span>
              <span class="dsp-dir" :title="t('dispatch.dir')">📂 {{ workdirText }}</span>
              <button
                class="btn"
                :disabled="dispatchBusy || dispatchState === 'running' || dispatchState === 'queued'"
                :title="dispatchState === 'running' ? t('dispatch.busyHint') : ''"
                @click="dispatchNow()"
              >
                {{ dispatchBusy ? t("dispatch.working") : `⚡ ${t("dispatch.go")}` }}
              </button>
            </div>
            <p class="d-hint">
              {{
                dispatchChannel === "headless"
                  ? t("dispatch.headlessHint")
                  : t("dispatch.hint", {
                      tag: dispatchTarget.projectTag ?? "",
                      src: dispatchTarget.source === "tag" ? t("dispatch.srcTag") : t("dispatch.srcDefault"),
                    })
              }}
            </p>
          </template>
        </template>
        <p v-if="dispatchMsg" class="dsp-ok">✅ {{ dispatchMsg }}</p>
        <p v-if="dispatchErr" class="err">❌ {{ dispatchErr }}</p>
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
/* Agent 派发操作行 */
.dsp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dsp-agent :deep(.ds-btn) {
  min-width: 130px;
  padding: 6px 9px;
  font-size: 12px;
}
.dsp-channel :deep(.ds-btn) {
  min-width: 96px;
  padding: 6px 9px;
  font-size: 12px;
}
/* 派发状态徽章：queued 琥珀 / running 蓝 / done 绿 / failed 红 */
.dsp-state {
  margin-left: 6px;
  font-size: 11px;
}
.dsp-state.queued {
  background: var(--warn-soft);
  color: var(--warn-ink);
}
.dsp-state.running {
  background: var(--rest-blue);
  color: #fff;
}
.dsp-state.done {
  background: var(--ok-soft);
  color: var(--ok-ink);
}
.dsp-state.failed {
  background: var(--dex-red);
  color: #fff;
}
/* 手动标记行（救援）：mini 档按钮 */
.dsp-mark {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.dsp-mark .btn {
  padding: 4px 10px;
  min-height: 30px;
  font-size: 12px;
}
.dsp-mark .btn.del {
  color: var(--danger);
}
.dsp-agent-badge.ssh {
  background: var(--rest-blue);
  color: #fff;
}
.dsp-dir {
  flex: 1;
  min-width: 120px;
  font-size: 12px;
  color: var(--ink-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsp-row .btn {
  padding: 7px 12px;
  font-size: 13px;
  min-height: 36px;
}
.d-hint {
  margin: 0;
  font-size: 11.5px;
  color: var(--ink-soft);
}
.dsp-ok {
  margin: 0;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ok-ink);
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
