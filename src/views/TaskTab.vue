<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../api";
import { useTasksStore, type TaskTabKey } from "../stores/tasks";
import TaskCard from "../components/TaskCard.vue";
import AddTaskForm from "../components/AddTaskForm.vue";
import DexDateTime from "../components/DexDateTime.vue";
import type { Task } from "../types";

const props = defineProps<{ tab: TaskTabKey }>();

const { t } = useI18n();
const tasksStore = useTasksStore();
const addForm = ref<InstanceType<typeof AddTaskForm> | null>(null);

const visible = computed(() => tasksStore.visibleFor(props.tab));
const showAddForm = computed(() => props.tab !== "done");

async function reload() {
  await tasksStore.reload();
}

async function addTask(input: Parameters<typeof api.createTask>[0]) {
  await api.createTask(input);
  await reload();
}

async function start(task: Task) {
  await api.startTask(task.id);
  await reload();
}
async function pauseActive() {
  await api.pauseCurrentTask();
  await reload();
}
async function complete(task: Task) {
  await api.updateTask({ id: task.id, status: "done" });
  await reload();
}
async function uncomplete(task: Task) {
  await api.updateTask({ id: task.id, status: "scheduled" });
  await reload();
}
async function remove(task: Task) {
  await api.deleteTask(task.id);
  await reload();
}

// ---- 修改时间：图鉴风弹窗 + 日期时间选择器（原生 prompt 与整体风格不符） ----
const editing = ref<Task | null>(null);
const editDue = ref("");
function schedule(task: Task) {
  editing.value = task;
  editDue.value = task.dueAt ?? "";
}
function closeSchedule() {
  editing.value = null;
}
async function saveSchedule() {
  const task = editing.value;
  if (!task) return;
  editing.value = null;
  await api.updateTask({ id: task.id, dueAt: editDue.value || null, status: "scheduled" });
  await reload();
}

/** 快捷键"快速捕捉"：聚焦新增输入框（由 App 壳触发） */
function focusAddForm() {
  addForm.value?.focus();
}

defineExpose({ focusAddForm });
onMounted(reload);
</script>

<template>
  <div class="task-tab">
    <AddTaskForm v-if="showAddForm" ref="addForm" @submit="addTask" />
    <ul class="dex-list">
      <li v-if="!visible.length && !tasksStore.loading" class="empty">{{ t("entry.empty") }}</li>
      <TaskCard
        v-for="task in visible"
        :key="task.id"
        :task="task"
        @start="start"
        @pause="pauseActive"
        @complete="complete"
        @uncomplete="uncomplete"
        @schedule="schedule"
        @remove="remove"
      />
    </ul>

    <!-- 修改时间弹窗 -->
    <div v-if="editing" class="sched-mask" @click.self="closeSchedule">
      <div class="sched-card">
        <h3>📅 {{ t("promptSchedule") }}</h3>
        <DexDateTime v-model="editDue" />
        <div class="btn-row">
          <button class="btn" @click="saveSchedule">{{ t("save") }}</button>
          <button class="btn ghost" @click="closeSchedule">{{ t("cancel") }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.task-tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.dex-list {
  flex: 1;
  padding: 4px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  list-style: none;
  margin: 0;
}
.empty {
  color: #9a937f;
  text-align: center;
  padding: 48px 0;
  font-size: 14px;
  line-height: 2;
  list-style: none;
}

/* 修改时间弹窗：图鉴风卡片，日历弹层在卡片内层叠展示 */
.sched-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(28, 34, 68, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
}
.sched-card {
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 12px;
  box-shadow: 6px 6px 0 var(--dex-navy);
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 300px;
}
.sched-card h3 {
  margin: 0;
  font-size: 15px;
}
.sched-card .btn-row {
  display: flex;
  gap: 10px;
}
</style>
