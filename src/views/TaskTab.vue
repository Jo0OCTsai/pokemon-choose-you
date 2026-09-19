<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../api";
import { useSettingsStore } from "../stores/settings";
import { useTasksStore, type TaskTabKey } from "../stores/tasks";
import TaskCard from "../components/TaskCard.vue";
import AddTaskForm from "../components/AddTaskForm.vue";
import DexDateTime from "../components/DexDateTime.vue";
import TaskEditModal from "../components/TaskEditModal.vue";
import TaskDetailDrawer from "../components/TaskDetailDrawer.vue";
import ReviewWizard from "../components/ReviewWizard.vue";
import type { Task } from "../types";

const props = defineProps<{ tab: TaskTabKey }>();

const { t } = useI18n();
const tasksStore = useTasksStore();
const settings = useSettingsStore();
const addForm = ref<InstanceType<typeof AddTaskForm> | null>(null);

const visible = computed(() => tasksStore.visibleFor(props.tab));

// ---- 逾期 fresh start（反羞耻）：逾期不原样堆显，折叠为一行「昨天有几只溜走了」 ----
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** 冒险页里逾期的路线任务（未开始、非进行中）——羞耻墙的来源 */
const overdueScheduled = computed(() =>
  props.tab === "today"
    ? visible.value.filter((t) => t.status === "scheduled" && Boolean(t.dueAt) && t.dueAt!.slice(0, 10) < todayStr())
    : [],
);
const overdueMode = () => settings.sget("overdue_mode") || "collapse";
/** 折叠模式：逾期行收起；点击展开本会话有效 */
const overdueExpanded = ref(false);
/** 其余条目 = 当前页可见 - 被折叠的逾期 */
const entryList = computed(() => {
  if (props.tab !== "today" || overdueMode() !== "collapse" || overdueExpanded.value) return visible.value;
  const hidden = new Set(overdueScheduled.value.map((t) => t.id));
  return visible.value.filter((t) => !hidden.has(t.id));
});
const freshStarting = ref(false);
/** 一键归草丛：清逾期任务的截止时间（不变量自动回 inbox）——fresh start 按钮就在折叠行上 */
async function freshStartOverdue() {
  if (freshStarting.value || !overdueScheduled.value.length) return;
  freshStarting.value = true;
  try {
    for (const t of overdueScheduled.value) {
      await api.updateTask({ id: t.id, dueAt: null });
    }
    overdueExpanded.value = false;
    await tasksStore.reload();
  } finally {
    freshStarting.value = false;
  }
}
const showAddForm = computed(() => props.tab !== "done");
const dexFilters = ["all", "done", "cancelled"] as const;

// ---- 图鉴页统计页头：累计捕捉/逃走 + 里程碑贺词（全量口径，不随列表截断） ----
const dexStats = ref<{ caught: number; escaped: number } | null>(null);
async function loadDexStats() {
  if (props.tab !== "done") return;
  try {
    dexStats.value = await api.dexStats();
  } catch {
    dexStats.value = null; // 统计拿不到就不展示页头，不挡列表
  }
}
const dexMilestone = computed(() => {
  const n = dexStats.value?.caught ?? 0;
  if (n >= 200) return "m200";
  if (n >= 100) return "m100";
  if (n >= 50) return "m50";
  if (n >= 10) return "m10";
  if (n >= 1) return "m1";
  return "m0";
});

async function reload() {
  await tasksStore.reload();
  await loadDexStats();
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
async function cancel(task: Task) {
  await api.updateTask({ id: task.id, status: "cancelled" });
  await reload();
}
async function remove(task: Task) {
  await api.deleteTask(task.id);
  await reload();
}

// ---- 修改时间：图鉴风弹窗 + 日期时间选择器（原生 prompt 与整体风格不符） ----
const scheduling = ref<Task | null>(null);
const editDue = ref("");
function schedule(task: Task) {
  scheduling.value = task;
  editDue.value = task.dueAt ?? "";
}
function closeSchedule() {
  scheduling.value = null;
}
async function saveSchedule() {
  const task = scheduling.value;
  if (!task) return;
  scheduling.value = null;
  await api.updateTask({ id: task.id, dueAt: editDue.value || null, status: "scheduled" });
  await reload();
}

// ---- 全字段编辑弹窗 ----
const editing = ref<Task | null>(null);
function edit(task: Task) {
  editing.value = task;
}
async function onSaved() {
  await reload();
}

// ---- 详情抽屉：点击任务卡片打开；任务从 store 里按 id 取，编辑保存后内容跟随刷新 ----
const detailId = ref<number | null>(null);
const detailTask = computed(() => {
  const id = detailId.value;
  if (id == null) return null;
  return tasksStore.open.find((x) => x.id === id) ?? tasksStore.done.find((x) => x.id === id) ?? null;
});
function openDetail(task: Task) {
  detailId.value = task.id;
}

// ---- 每周复盘（训练家复盘）：图鉴页入口 ----
const reviewOpen = ref(false);

// ---- 搜索：跨页关键词查询（标题/备注/标签/跟进记录） ----
const searchQuery = ref("");
const searchResults = ref<Task[]>([]);
const searching = ref(false);
const searchMode = computed(() => searchQuery.value.trim() !== "");
const displayList = computed(() => (searchMode.value ? searchResults.value : visible.value));

watch(searchQuery, async (q) => {
  q = q.trim();
  if (!q) {
    searchResults.value = [];
    return;
  }
  searching.value = true;
  try {
    searchResults.value = await api.searchTasks(q);
  } finally {
    searching.value = false;
  }
});

/** 快捷键"快速捕捉"：聚焦新增输入框（由 App 壳触发） */
function focusAddForm() {
  addForm.value?.focus();
}

defineExpose({ focusAddForm });
onMounted(reload);
</script>

<template>
  <div class="task-tab">
    <AddTaskForm v-if="showAddForm" ref="addForm" :allow-schedule="tab === 'inbox'" @submit="addTask" />

    <!-- 搜索栏 -->
    <div class="search-bar">
      <input v-model="searchQuery" class="search-input" :placeholder="t('search.placeholder')" />
      <span v-if="searchMode" class="search-hint">
        {{ searching ? t("search.searching") : t("search.resultCount", { n: searchResults.length }) }}
      </span>
    </div>

    <!-- 图鉴页统计页头：成就汇总 + 里程碑贺词 -->
    <div v-if="tab === 'done' && dexStats" class="dex-stats lcd">
      <div class="stats-line">{{ t("dexStats.line", dexStats) }}</div>
      <div class="stats-milestone">{{ t(`dexStats.milestone.${dexMilestone}`, { n: dexStats.caught }) }}</div>
    </div>

    <!-- 图鉴筛选：全部 / 已捕捉 / 已逃走（沿用设置页分区选单 stab 的控件语言） -->
    <div v-if="tab === 'done' && !searchMode" class="dex-filter">
      <button
        v-for="f in dexFilters"
        :key="f"
        class="filter-btn"
        :class="{ on: tasksStore.dexFilter === f }"
        @click="tasksStore.dexFilter = f"
      >
        <span class="cursor">▶</span>{{ t(`dexFilter.${f}`) }}
      </button>
      <button class="filter-btn review-btn" @click="reviewOpen = true">🧢 {{ t("review.entry") }}</button>
    </div>

    <!-- 逾期折叠行（反羞耻）：不堆「羞耻墙」，一行带过，点击才展开 -->
    <div v-if="tab === 'today' && overdueMode() === 'collapse' && overdueScheduled.length" class="overdue-row">
      <button class="overdue-toggle" @click="overdueExpanded = !overdueExpanded">
        🎒 {{ overdueExpanded ? t("overdue.collapse") : t("overdue.leaked", { n: overdueScheduled.length }) }}
      </button>
      <button class="btn ghost overdue-fresh" :disabled="freshStarting" @click="freshStartOverdue">
        {{ freshStarting ? t("overdue.freshing") : t("overdue.fresh") }}
      </button>
    </div>

    <ul class="dex-list">
      <li v-if="!displayList.length && !tasksStore.loading" class="empty">
        {{
          searchMode
            ? t("search.empty")
            : tab === "done"
              ? t(`dexFilter.empty.${tasksStore.dexFilter}`)
              : tab === "today"
                ? t("entry.emptyToday")
                : tab === "scheduled"
                  ? t("entry.emptyRoute")
                  : t("entry.empty")
        }}
      </li>
      <TaskCard
        v-for="task in tab === 'today' ? entryList : displayList"
        :key="task.id"
        :task="task"
        :allow-schedule="tab === 'inbox'"
        @start="start"
        @pause="pauseActive"
        @complete="complete"
        @uncomplete="uncomplete"
        @cancel="cancel"
        @schedule="schedule"
        @edit="edit"
        @detail="openDetail"
        @remove="remove"
      />
    </ul>

    <!-- 修改时间弹窗 -->
    <div v-if="scheduling" class="sched-mask" @click.self="closeSchedule">
      <div class="sched-card">
        <h3>📅 {{ t("promptSchedule") }}</h3>
        <DexDateTime v-model="editDue" />
        <div class="btn-row">
          <button class="btn" @click="saveSchedule">{{ t("save") }}</button>
          <button class="btn ghost" @click="closeSchedule">{{ t("cancel") }}</button>
        </div>
      </div>
    </div>

    <!-- 详情抽屉：点击任务卡片打开（记录类内容都在这里） -->
    <TaskDetailDrawer v-if="detailTask" :task="detailTask" @close="detailId = null" @edit="edit" />

    <!-- 全字段编辑弹窗 -->
    <TaskEditModal v-if="editing" :task="editing" @close="editing = null" @saved="onSaved" />

    <!-- 每周复盘向导 -->
    <ReviewWizard v-if="reviewOpen" @close="reviewOpen = false" />
  </div>
</template>

<style scoped>
.task-tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.search-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 20px 12px;
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
.search-hint {
  flex: none;
  font-size: 12px;
  color: var(--ink-soft);
  font-weight: 700;
}
/* 图鉴页统计页头：复用 .lcd 复古屏，配色走 LCD 令牌 */
.dex-stats {
  margin: 0 20px 10px;
  padding: 8px 12px;
}
.stats-line {
  font-weight: 700;
  font-size: 13px;
  color: var(--lcd-text);
}
.stats-milestone {
  margin-top: 2px;
  font-size: 12px;
  color: var(--lcd-text);
}
/* 图鉴筛选：与设置页 stab 分区选单同一套控件语言 */
.dex-filter {
  display: flex;
  gap: 8px;
  margin: 0 20px 12px;
}
.filter-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  background: var(--dex-body);
  color: var(--dex-navy);
  font-size: 13px;
  font-weight: 700;
  font-family: inherit;
  padding: 6px 12px;
  min-height: 38px;
  cursor: pointer;
  box-shadow: 3px 3px 0 var(--dex-navy);
  transition:
    transform var(--t-tap),
    box-shadow var(--t-tap),
    background var(--t-tap);
}
.filter-btn .cursor {
  width: 10px;
  flex: none;
  opacity: 0;
  font-size: 10px;
}
.filter-btn.on {
  background: var(--poke-yellow);
}
.filter-btn.review-btn {
  margin-left: auto;
  background: var(--poke-yellow);
}
.filter-btn.on .cursor {
  opacity: 1;
}
.filter-btn:hover {
  background: var(--hover);
}
.filter-btn.on:hover,
.filter-btn.review-btn:hover {
  background: var(--poke-yellow);
}
.filter-btn:active {
  transform: translate(2px, 2px);
  box-shadow: 1px 1px 0 var(--dex-navy);
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
  color: var(--ink-soft);
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
  background: rgba(28, 34, 68, 0.42);
  display: flex;
  align-items: center;
  justify-content: center;
}
.sched-card {
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 12px;
  box-shadow: 4px 4px 0 var(--dex-navy);
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 300px;
}
.sched-card h3 {
  margin: 0;
  font-size: 16px;
}
.sched-card .btn-row {
  display: flex;
  gap: 10px;
}

/* 逾期折叠行：低调一行，可展开可一键归草丛 */
.overdue-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 20px 12px;
  padding: 8px 12px;
  border: 2px dashed var(--ink-faint);
  border-radius: 4px;
  background: var(--dex-body);
  font-size: 13px;
}
.overdue-toggle {
  border: none;
  background: none;
  color: var(--ink-soft);
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  padding: 0;
}
.overdue-toggle:hover {
  color: var(--dex-navy);
}
.overdue-fresh {
  margin-left: auto;
  min-height: 32px;
  font-size: 12px;
}
</style>
