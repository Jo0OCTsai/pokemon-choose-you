<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorMessage } from "../api";
import { fmtDateTime } from "../stores/settings";
import { useCategoriesStore } from "../stores/categories";
import { useTagsStore } from "../stores/tags";
import type { Task, TaskLog, TaskNote } from "../types";
import DexSelect from "./DexSelect.vue";
import DexDateTime from "./DexDateTime.vue";

/** 任务全字段编辑弹窗：属性编辑 + 标签 + 跟进记录 + 操作历史（状态由动作驱动，不在此编辑） */
const props = defineProps<{ task: Task }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const { t, te } = useI18n();
const categories = useCategoriesStore();
const tagsStore = useTagsStore();

// ---- 可编辑字段（全部；状态不提供手动修改） ----
const title = ref(props.task.title);
const note = ref(props.task.note ?? "");
const categoryStr = ref(String(props.task.categoryId));
const priority = ref(props.task.priority);
const dueAt = ref(props.task.dueAt ?? "");
const remindAt = ref(props.task.remindAt ?? "");
const selectedTagIds = ref<number[]>(
  props.task.tags.map((name) => tagsStore.list.find((g) => g.name === name)?.id).filter((v): v is number => v != null),
);
const saving = ref(false);
const error = ref("");

// 打开期间标签/分类可能在别的窗口被更新，拉一次保证 name → id 映射完整
onMounted(async () => {
  await tagsStore.load().catch(() => {});
  selectedTagIds.value = props.task.tags
    .map((name) => tagsStore.list.find((g) => g.name === name)?.id)
    .filter((v): v is number => v != null);
});

// 分类选项：只列启用中的分类；任务自身所属分类若已停用则保留（否则下拉显示不出名字）
const categoryOptions = computed(() => {
  const list = categories.list.filter((c) => c.enabled || c.id === props.task.categoryId);
  return list.map((c) => ({ value: String(c.id), label: c.name }));
});
const priorityOptions = computed(() =>
  (["low", "normal", "high", "urgent"] as const).map((p) => ({ value: p, label: t(`priority.${p}`) })),
);

function toggleTag(id: number) {
  const i = selectedTagIds.value.indexOf(id);
  if (i >= 0) selectedTagIds.value.splice(i, 1);
  else selectedTagIds.value.push(id);
}

// ---- 跟进记录 ----
const notes = ref<TaskNote[]>([]);
const newNote = ref("");
const noteBusy = ref(false);
async function loadNotes() {
  notes.value = await api.listTaskNotes(props.task.id);
}
onMounted(loadNotes);
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

// 弹窗内直接回车提交跟进记录
watch(newNote, () => (error.value = ""));

async function save() {
  if (!title.value.trim()) {
    error.value = t("edit.titleRequired");
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    await api.updateTask({
      id: props.task.id,
      title: title.value.trim(),
      note: note.value || null,
      categoryId: Number(categoryStr.value),
      priority: priority.value,
      // DexDateTime 空串转 null 表示清空；状态不手动改，由后端不变量归位
      dueAt: dueAt.value || null,
      remindAt: remindAt.value || null,
      tagIds: selectedTagIds.value,
    });
    emit("saved");
    emit("close");
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

// ---- 操作历史（只读，最新在前） ----
const logs = ref<TaskLog[]>([]);
onMounted(async () => {
  logs.value = await api.listTaskLogs(props.task.id).catch(() => []);
});
/** 有对应翻译键就用翻译（状态值 / 动作名），否则原样展示 */
function tx(key: string, fallback: string): string {
  return te(key) ? t(key) : fallback;
}
function valueOf(field: string, v: string | null | undefined): string {
  if (v == null || v === "") return "—";
  return field === "status" ? tx(`status.${v}`, v) : v;
}
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="card">
      <h3>✎ No.{{ String(task.id).padStart(3, "0") }} {{ t("edit.title") }}</h3>

      <div class="form">
        <label class="row title-row">
          <span class="lbl">{{ t("edit.taskTitle") }}</span>
          <input v-model="title" />
        </label>
        <label class="row">
          <span class="lbl">{{ t("edit.note") }}</span>
          <textarea v-model="note" rows="2" />
        </label>
        <div class="row">
          <span class="lbl">{{ t("edit.category") }}</span>
          <DexSelect v-model="categoryStr" :options="categoryOptions" />
        </div>
        <div class="row">
          <span class="lbl">{{ t("edit.priority") }}</span>
          <DexSelect v-model="priority" :options="priorityOptions" />
        </div>
        <div class="row">
          <span class="lbl">{{ t("edit.due") }}</span>
          <DexDateTime v-model="dueAt" />
        </div>
        <div class="row">
          <span class="lbl">{{ t("edit.remind") }}</span>
          <DexDateTime v-model="remindAt" />
        </div>
        <div class="row">
          <span class="lbl">{{ t("edit.tags") }}</span>
          <div class="tag-pick">
            <button
              v-for="g in tagsStore.list"
              :key="g.id"
              type="button"
              class="tag-chip"
              :class="{ on: selectedTagIds.includes(g.id) }"
              :title="g.description"
              @click="toggleTag(g.id)"
            >
              {{ g.name }}
            </button>
            <span v-if="!tagsStore.list.length" class="no-tags">{{ t("edit.noTags") }}</span>
          </div>
        </div>
      </div>

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
        <button class="btn" :disabled="saving" @click="save">{{ t("save2") }}</button>
        <button class="btn ghost" @click="emit('close')">{{ t("cancel") }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(28, 34, 68, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
}
.card {
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 12px;
  box-shadow: 6px 6px 0 var(--dex-navy);
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 460px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 40px);
  overflow-y: auto;
}
.card h3 {
  margin: 0;
  font-size: 15px;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.row {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #555;
}
.lbl {
  flex: none;
  font-weight: 700;
}
.row input,
.row textarea {
  width: 100%;
  padding: 8px 10px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  min-height: 36px;
  box-sizing: border-box;
}
.row textarea {
  resize: vertical;
}
.tag-pick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tag-chip {
  border: 2px solid var(--dex-navy);
  border-radius: 999px;
  background: #fff;
  color: var(--dex-navy);
  font-size: 12px;
  font-weight: 700;
  padding: 4px 10px;
  cursor: pointer;
  font-family: inherit;
}
.tag-chip.on {
  background: var(--poke-yellow);
  box-shadow: 2px 2px 0 var(--dex-navy);
}
.no-tags {
  font-size: 12px;
  color: #9a937f;
}
/* 跟进记录 */
.notes {
  border-top: 2px dashed #d8d2c0;
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
  max-height: 150px;
  overflow-y: auto;
}
.note-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  background: var(--lcd);
  border: 2px solid var(--dex-navy);
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 12.5px;
}
.note-src {
  font-size: 9px;
  font-weight: 800;
  color: #fff;
  background: var(--dex-navy);
  border-radius: 4px;
  padding: 1px 5px;
  flex: none;
}
.note-time {
  font-size: 9px;
  color: #7b7460;
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
  color: var(--dex-red);
  cursor: pointer;
  font-size: 12px;
  padding: 0 2px;
  flex: none;
}
.note-empty {
  font-size: 12px;
  color: #9a937f;
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
}
.note-add .btn {
  padding: 7px 10px;
  min-height: 34px;
  font-size: 12px;
}
/* 操作历史 */
.log-list .note-content {
  font-size: 12px;
}
.err {
  margin: 0;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--dex-red);
}
.btn-row {
  display: flex;
  gap: 10px;
}
</style>
