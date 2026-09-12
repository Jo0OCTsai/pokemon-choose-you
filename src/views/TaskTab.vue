<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../api";
import { useTasksStore, type TaskTabKey } from "../stores/tasks";
import TaskCard from "../components/TaskCard.vue";
import AddTaskForm from "../components/AddTaskForm.vue";
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
async function schedule(task: Task) {
  const due = prompt(t("promptSchedule"), task.dueAt ?? "");
  if (due === null) return;
  await api.updateTask({ id: task.id, dueAt: due || null, status: "scheduled" });
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
</style>
