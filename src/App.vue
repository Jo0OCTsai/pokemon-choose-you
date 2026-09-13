<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useI18n } from "vue-i18n";
import { i18n } from "./i18n";
import { api } from "./api";
import { EVENTS } from "./events";
import { useSettingsStore } from "./stores/settings";
import { useCategoriesStore } from "./stores/categories";
import { useTagsStore } from "./stores/tags";
import { useTasksStore, type TaskTabKey } from "./stores/tasks";
import TaskTab from "./views/TaskTab.vue";
import RadioTab from "./views/RadioTab.vue";
import SettingsTab from "./views/SettingsTab.vue";
import DexContextMenu from "./components/DexContextMenu.vue";
import { openEditableContextMenu } from "./contextMenu";

const { t, tm } = useI18n();
const settings = useSettingsStore();
const categoriesStore = useCategoriesStore();
const tagsStore = useTagsStore();
const tasksStore = useTasksStore();

type Tab = TaskTabKey | "im" | "settings";
// 菜单命名体系统一为"训练家旅程"：冒险/路线/草丛/图鉴/收音机
const tabs: { key: Tab; labelKey: string; descKey: string }[] = [
  { key: "today", labelKey: "tabs.today", descKey: "tabs.todayDesc" },
  { key: "scheduled", labelKey: "tabs.scheduled", descKey: "tabs.scheduledDesc" },
  { key: "inbox", labelKey: "tabs.inbox", descKey: "tabs.inboxDesc" },
  { key: "done", labelKey: "tabs.done", descKey: "tabs.doneDesc" },
  { key: "im", labelKey: "tabs.im", descKey: "tabs.imDesc" },
  { key: "settings", labelKey: "tabs.settings", descKey: "tabs.settingsDesc" },
];

const tab = ref<Tab>("today");
const curTab = computed(() => tabs.find((x) => x.key === tab.value) ?? tabs[0]);
// 机脊小贴士：语录池随机一条，启动与每次切页换一条（语言切换后重抽，保持同池随机）
const spineTip = ref("");
function rollSpineTip() {
  const tips = tm("spine.tips") as unknown[];
  const arr = tips.map((x) => String(x));
  if (arr.length) spineTip.value = arr[Math.floor(Math.random() * arr.length)];
}
watch(tab, rollSpineTip);
watch(
  () => i18n.global.locale.value,
  () => rollSpineTip(),
);
const isTaskTab = computed(() => ["today", "inbox", "scheduled", "done"].includes(tab.value));
// 模板里 isTaskTab 的 v-if 收窄不了模板表达式的类型，这里集中收窄一次
const activeTaskTab = computed<TaskTabKey>(() => (isTaskTab.value ? (tab.value as TaskTabKey) : "today"));
const taskTab = ref<InstanceType<typeof TaskTab> | null>(null);
const settingsTab = ref<InstanceType<typeof SettingsTab> | null>(null);

// 后端发现新版本时广播，设置页展示安装入口
const latestVersion = ref("");

const today = new Date();

/** 全局快捷键"快速捕捉"：切到冒险页并聚焦新增输入框 */
async function quickCapture() {
  tab.value = "today";
  await nextTick();
  taskTab.value?.focusAddForm();
}

const unlisteners: UnlistenFn[] = [];
onMounted(async () => {
  // 文本输入框的默认右键菜单（剪切/复制/粘贴/全选）；组件级 @contextmenu.prevent 已处理的目标会让位
  window.addEventListener("contextmenu", openEditableContextMenu);
  rollSpineTip();
  // 先挂事件监听再首拉：首拉失败（如某个查询报错）也不至于让窗口“失聪”，后续数据变更仍能触发刷新
  unlisteners.push(await listen<null>(EVENTS.tasksChanged, () => tasksStore.reload()));
  unlisteners.push(await listen<null>(EVENTS.chatMessagesChanged, () => tasksStore.reload()));
  unlisteners.push(await listen<null>(EVENTS.categoriesChanged, () => categoriesStore.load()));
  unlisteners.push(await listen<null>(EVENTS.tagsChanged, () => tagsStore.load()));
  unlisteners.push(await listen<null>(EVENTS.quickCapture, quickCapture));
  unlisteners.push(await listen<null>(EVENTS.showSettings, () => (tab.value = "settings")));
  unlisteners.push(await listen<string>(EVENTS.updateAvailable, (e) => (latestVersion.value = e.payload)));

  try {
    await Promise.all([settings.load(), categoriesStore.load(), tagsStore.load(), tasksStore.reload()]);
  } catch (e) {
    console.error("初始加载失败", e);
  }

  // Linux 上主窗口销毁重建时事件会被错过，挂载时补领快捷键请求
  if (await api.consumeQuickCapture()) {
    await quickCapture();
  }
});
onUnmounted(() => {
  unlisteners.forEach((u) => u());
  window.removeEventListener("contextmenu", openEditableContextMenu);
});
</script>

<template>
  <div class="dex">
    <!-- 机脊 -->
    <aside class="dex-spine">
      <div class="dex-head">
        <div class="dex-big-led" :class="{ alert: tasksStore.caught.total > 6 }"></div>
        <div class="dex-sub-leds"><i></i><i></i></div>
      </div>
      <div class="dex-title px">POKé-DEX<br />LET'S CATCH!</div>
      <nav class="menu">
        <button
          v-for="mi in tabs"
          :key="mi.key"
          class="menu-btn"
          :class="{ active: tab === mi.key }"
          @click="tab = mi.key"
        >
          <span class="cursor">▶</span>{{ t(mi.labelKey) }}
          <span v-if="mi.key === 'im' && tasksStore.pendingSuggestions" class="count px">
            {{ tasksStore.pendingSuggestions }}
          </span>
        </button>
      </nav>
      <div class="tip">{{ spineTip }}</div>
    </aside>

    <!-- 内容区 -->
    <main class="dex-main">
      <div class="dex-main-head">
        <div>
          <h1>{{ t(curTab.labelKey) }}</h1>
          <div class="sub">{{ t(curTab.descKey) }}</div>
          <div v-if="tab === 'today'" class="sub px">
            {{ today.toISOString().slice(0, 10).split("-").join(".") }}
          </div>
        </div>
        <div v-if="tab === 'today'" class="catch-progress">
          <div class="px">CAUGHT {{ tasksStore.caught.done }}/{{ tasksStore.caught.total }}</div>
          <div class="catch-bar"><i :style="{ width: tasksStore.caught.pct + '%' }"></i></div>
        </div>
        <!-- 设置页保存按钮与标题同行，靠右 -->
        <button v-else-if="tab === 'settings'" class="btn head-save" @click="settingsTab?.save()">
          {{ t("save") }}
        </button>
      </div>

      <TaskTab v-if="isTaskTab" ref="taskTab" :tab="activeTaskTab" />
      <RadioTab v-else-if="tab === 'im'" />
      <SettingsTab v-else ref="settingsTab" :latest-version="latestVersion" />
    </main>

    <!-- 全局右键菜单（输入框默认菜单 + 组件自定义菜单共用渲染） -->
    <DexContextMenu />
  </div>
</template>

<style scoped>
#app,
body {
  height: 100vh;
}
.dex {
  display: flex;
  height: 100vh;
  background: var(--dex-body);
  overflow: hidden;
}

/* ---- 机脊 ---- */
.dex-spine {
  width: 200px;
  flex: none;
  background: linear-gradient(180deg, var(--dex-red) 0%, var(--dex-red) 78%, var(--dex-red-dark) 100%);
  border-right: 4px solid var(--dex-navy);
  padding: 18px 14px;
  color: #fff;
  display: flex;
  flex-direction: column;
  position: relative;
}
.dex-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.dex-big-led {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #ff9d9d, #d01111 60%, #8f0b0b);
  border: 3px solid var(--dex-navy);
  animation: pk-breathe 2.5s infinite;
}
.dex-big-led.alert {
  animation: pk-blink 0.8s infinite;
}
.dex-sub-leds {
  display: flex;
  gap: 5px;
}
.dex-sub-leds i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--poke-yellow);
  border: 2px solid var(--dex-navy);
}
.dex-sub-leds i:last-child {
  background: #5be36b;
}
.dex-title {
  font-size: 9px;
  line-height: 1.8;
  margin: 10px 0 16px;
  color: #ffe9e9;
  text-shadow: 1px 1px 0 rgba(0, 0, 0, 0.35);
}
.menu {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.menu-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.18);
  border: 3px solid transparent;
  border-radius: 8px;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  padding: 11px 12px;
  cursor: pointer;
  min-height: 44px;
  text-align: left;
  font-family: inherit;
}
.menu-btn .cursor {
  width: 12px;
  flex: none;
  opacity: 0;
  font-size: 12px;
}
.menu-btn.active {
  background: var(--poke-yellow);
  color: var(--dex-navy);
  border-color: var(--dex-navy);
  box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.35);
}
.menu-btn.active .cursor {
  opacity: 1;
}
.menu-btn .count {
  margin-left: auto;
  font-size: 10px;
  background: var(--dex-navy);
  color: #fff;
  border-radius: 4px;
  padding: 2px 5px;
}
.tip {
  margin-top: auto;
  font-size: 11px;
  line-height: 1.7;
  color: #ffd9d9;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 8px;
  padding: 8px;
}

/* ---- 内容区 ---- */
.dex-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.dex-main-head {
  padding: 16px 20px 12px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.dex-main-head h1 {
  font-size: 16px;
  letter-spacing: 1px;
}
.dex-main-head .sub {
  font-size: 10px;
  color: #7b7460;
  margin-top: 5px;
}
.catch-progress {
  margin-left: auto;
  text-align: right;
}
/* 设置页保存按钮：与标题同行靠右，对齐标题首行 */
.head-save {
  margin-left: auto;
  align-self: flex-start;
  margin-top: 4px;
}
.catch-progress .px {
  font-size: 10px;
}
.catch-bar {
  margin-top: 5px;
  width: 140px;
  height: 14px;
  border: 3px solid var(--dex-navy);
  border-radius: 7px;
  background: #fff;
  overflow: hidden;
}
.catch-bar i {
  display: block;
  height: 100%;
  background: var(--poke-yellow);
  border-right: 3px solid var(--dex-navy);
  transition: width 0.3s;
}
</style>
