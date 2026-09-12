<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { api, type NewTaskInput } from "./api";
import { spriteUrl, spriteFallback, type Category, type ImSuggestion, type Task } from "./types";
import {
  settings, sget, saveSettings as saveSettingsKeys, loadSettings,
  fmtDateTime, POKEMON_LIST,
} from "./settings";
import { useI18n } from "vue-i18n";
import { SUPPORTED_LOCALES } from "./i18n";
import DexSelect from "./DexSelect.vue";
import DexToggle from "./DexToggle.vue";
import DexDateTime from "./DexDateTime.vue";

const { t } = useI18n();

type Tab = "today" | "inbox" | "scheduled" | "done" | "im" | "settings";
// 菜单命名体系统一为"训练家旅程"：冒险/草丛/路线/图鉴/收音机
const tabs: { key: Tab; labelKey: string; descKey: string }[] = [
  { key: "today", labelKey: "tabs.today", descKey: "tabs.todayDesc" },
  { key: "inbox", labelKey: "tabs.inbox", descKey: "tabs.inboxDesc" },
  { key: "scheduled", labelKey: "tabs.scheduled", descKey: "tabs.scheduledDesc" },
  { key: "done", labelKey: "tabs.done", descKey: "tabs.doneDesc" },
  { key: "im", labelKey: "tabs.im", descKey: "tabs.imDesc" },
  { key: "settings", labelKey: "tabs.settings", descKey: "tabs.settingsDesc" },
];

const tab = ref<Tab>("today");
const curTab = computed(() => tabs.find((x) => x.key === tab.value) ?? tabs[0]);
const tasks = ref<Task[]>([]);
const categories = ref<Category[]>([]);
const imSuggestions = ref<ImSuggestion[]>([]);
const loading = ref(false);

const newTitle = ref("");
const newCategory = ref(1);
const newPriority = ref("normal");
const newDue = ref("");
// 默认值由设置 default_to_inbox 决定
const toInbox = ref(true);
// DexSelect 以字符串为值，分类 id 数字需要桥接
const newCategoryStr = computed({
  get: () => String(newCategory.value),
  set: (v: string) => {
    newCategory.value = Number(v);
  },
});
const categoryOptions = computed(() =>
  categories.value.map((c) => ({ value: String(c.id), label: c.name })));

const catById = computed(() => {
  const m = new Map<number, Category>();
  categories.value.forEach((c) => m.set(c.id, c));
  return m;
});
const catKey = computed(() => {
  const cls: Record<string, string> = { 工作: "work", 学习: "study", 生活: "life", 健康: "health", 社交: "social", 紧急: "urgent" };
  const m = new Map<number, string>();
  categories.value.forEach((c) => m.set(c.id, cls[c.name] ?? "work"));
  return (id: number) => m.get(id) ?? "work";
});

const visible = computed(() =>
  tasks.value.filter((t) => {
    if (tab.value === "inbox") return t.status === "inbox";
    if (tab.value === "scheduled") return t.status === "scheduled" || t.status === "paused";
    if (tab.value === "done") return t.status === "done";
    return t.status !== "done";
  }),
);

/** 今日捕捉进度：已完成 / 总数（当前页只加载 open 任务，完成数单独统计） */
const doneCount = ref(0);
const caught = computed(() => {
  const open = tasks.value.filter((t) => t.status !== "done").length;
  const total = open + doneCount.value;
  return { done: doneCount.value, total, pct: total ? Math.round((doneCount.value / total) * 100) : 0 };
});

async function reload() {
  loading.value = true;
  try {
    tasks.value = tab.value === "done" ? await api.listTasks("done") : await api.listTasks("open");
    doneCount.value = (await api.listTasks("done")).length;
    imSuggestions.value = await api.listImSuggestions("pending");
  } finally {
    loading.value = false;
  }
}

async function addTask() {
  const title = newTitle.value.trim();
  if (!title) return;
  const input: NewTaskInput = {
    title,
    categoryId: newCategory.value,
    priority: newPriority.value,
    dueAt: newDue.value || undefined,
    scheduled: !toInbox.value,
  };
  await api.createTask(input);
  newTitle.value = "";
  newDue.value = "";
  await reload();
}

async function start(t: Task) {
  await api.startTask(t.id);
  await reload();
}
async function pauseActive() {
  await api.pauseCurrentTask();
  await reload();
}
async function complete(t: Task) {
  await api.updateTask({ id: t.id, status: "done" });
  await reload();
}
async function uncomplete(t: Task) {
  await api.updateTask({ id: t.id, status: "scheduled" });
  await reload();
}
async function remove(t: Task) {
  await api.deleteTask(t.id);
  await reload();
}
async function schedule(task: Task) {
  const due = prompt(t("promptSchedule"), task.dueAt ?? "");
  if (due === null) return;
  await api.updateTask({ id: task.id, dueAt: due || null, status: "scheduled" });
  await reload();
}
async function acceptIm(id: number) {
  await api.acceptImSuggestion(id);
  await reload();
}
async function dismissIm(id: number) {
  await api.dismissImSuggestion(id);
  await reload();
}

// ---- 设置（共享模块） ----
const testMsg = ref("");
const testing = ref(false);

// 复选框 ↔ 字符串设置项 的双向绑定
function boolSetting(key: string) {
  return computed({
    get: () => sget(key) === "true",
    set: (v: boolean) => (settings[key] = v ? "true" : "false"),
  });
}
const pomoOn = boolSetting("pomodoro_enabled");
const pomoNotify = boolSetting("pomodoro_notify");
const notifyOn = boolSetting("notifications_enabled");
const feishuOn = boolSetting("feishu_enabled");
const inboxDefault = boolSetting("default_to_inbox");

// 设置分区选单（初代选项界面：上选单下内容）
const settingsTabs = [
  { key: "focus", labelKey: "stabs.focus" },
  { key: "cats", labelKey: "stabs.cats" },
  { key: "display", labelKey: "stabs.display" },
  { key: "integrations", labelKey: "stabs.integrations" },
  { key: "general", labelKey: "stabs.general" },
] as const;
const settingsTab = ref<(typeof settingsTabs)[number]["key"]>("focus");

// ---- 下拉选项（computed 保证语言切换后刷新） ----
const pomoMinutesOptions = computed(() =>
  [15, 25, 45, 60].map((n) => ({ value: String(n), label: t("focus.minutes", { n }) })));
const breakOptions = computed(() => [
  { value: "0", label: t("focus.breakOff") },
  { value: "5", label: t("focus.minutes", { n: 5 }) },
  { value: "10", label: t("focus.minutes", { n: 10 }) },
]);
const remindAheadOptions = computed(() =>
  [0, 5, 15, 30].map((n) => ({ value: String(n), label: n === 0 ? t("remind.onTime") : t("remind.aheadN", { n }) })));
const pokemonOptions = computed(() =>
  POKEMON_LIST.map((p) => ({ value: p.key, label: p.name })));
const dateFormatOptions = computed(() =>
  ["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"].map((f) => ({ value: f, label: fmtDatePreview(f) })));
const timeFormatOptions = computed(() => [
  { value: "24h", label: t("display.h24") },
  { value: "12h", label: t("display.h12") },
]);
const languageOptions = SUPPORTED_LOCALES.map((l) => ({ value: l.value, label: l.label }));
const priorityOptions = computed(() =>
  (["low", "normal", "high", "urgent"] as const).map((p) => ({ value: p, label: t(`priority.${p}`) })));
const pollIntervalOptions = computed(() =>
  [1, 2, 5, 15].map((n) => ({ value: String(n * 60), label: t("focus.minutes", { n }) })));

/** 按给定格式渲染今天的日期作为选项示例 */
function fmtDatePreview(fmt: string): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  if (fmt === "MM/DD/YYYY") return `${m}/${day}/${y}`;
  if (fmt === "DD/MM/YYYY") return `${day}/${m}/${y}`;
  return `${y}-${m}-${day}`;
}

const SETTING_KEYS = [
  "language",
  "pomodoro_enabled", "pomodoro_minutes", "break_minutes", "pomodoro_notify",
  "notifications_enabled", "remind_ahead_minutes",
  "date_format", "time_format",
  "default_priority", "default_to_inbox",
  "feishu_poll_interval",
  "ai_base_url", "ai_api_key", "ai_model",
  "feishu_app_id", "feishu_app_secret", "feishu_enabled",
  "todoist_token",
];

async function saveSettings(msg?: string) {
  await saveSettingsKeys(SETTING_KEYS);
  testMsg.value = msg ?? t("saved");
  setTimeout(() => (testMsg.value = ""), 2000);
}
async function runTest(fn: () => Promise<string>) {
  testing.value = true;
  testMsg.value = t("testing");
  try {
    await saveSettingsKeys(SETTING_KEYS);
    testMsg.value = await fn();
  } catch (e) {
    testMsg.value = `❌ ${e}`;
  } finally {
    testing.value = false;
  }
}

// ---- 分类管理 ----
const editingCats = ref<{ id: number; name: string; pokemonKey: string }[]>([]);
function startEditCats() {
  editingCats.value = categories.value.map((c) => ({
    id: c.id,
    name: c.name,
    pokemonKey: c.sprite,
  }));
}
async function saveCat(row: { id: number; name: string; pokemonKey: string }) {
  const pk = POKEMON_LIST.find((p) => p.key === row.pokemonKey) ?? POKEMON_LIST[0];
  await api.updateCategory(row.id, row.name, pk.name, pk.key);
  categories.value = await api.listCategories();
  testMsg.value = t("catSaved");
  setTimeout(() => (testMsg.value = ""), 2000);
}
async function removeCat(row: { id: number; name: string }) {
  try {
    await api.deleteCategory(row.id);
    categories.value = await api.listCategories();
    startEditCats();
  } catch (e) {
    testMsg.value = `❌ ${e}`;
  }
}
async function addCat() {
  await api.createCategory(t("cats.newName"), POKEMON_LIST[0].name, POKEMON_LIST[0].key);
  categories.value = await api.listCategories();
  startEditCats();
}

// ---- 开机自启 ----
const autostart = ref(false);
async function loadAutostart() {
  try {
    const { isEnabled } = await import("@tauri-apps/plugin-autostart");
    autostart.value = await isEnabled();
  } catch {
    autostart.value = false;
  }
}
async function onAutostart(v: boolean | string | number) {
  autostart.value = Boolean(v);
  const { enable, disable } = await import("@tauri-apps/plugin-autostart");
  if (autostart.value) {
    await enable();
  } else {
    await disable();
  }
}

const today = new Date();

let unlisteners: UnlistenFn[] = [];
onMounted(async () => {
  categories.value = await api.listCategories();
  startEditCats();
  await reload();
  await loadSettings();
  toInbox.value = sget("default_to_inbox") === "true";
  newPriority.value = sget("default_priority");
  if (!settings.language) settings.language = "zh-Hans";
  await loadAutostart();

  // 桌宠窗口或后端同步（飞书/Todoist）改动数据时跟随刷新，保持两窗口状态一致
  unlisteners.push(await listen<null>("tasks-changed", () => reload()));
  unlisteners.push(await listen<null>("im-suggestions-changed", () => reload()));
});
onUnmounted(() => unlisteners.forEach((u) => u()));
</script>

<template>
  <div class="dex">
  
    <!-- 机脊 -->
    <aside class="dex-spine">
      <div class="dex-head">
        <div class="dex-big-led" :class="{ alert: caught.total > 6 }"></div>
        <div class="dex-sub-leds"><i></i><i></i></div>
      </div>
      <div class="dex-title px">POKé-DEX<br />LET'S CATCH!</div>
      <nav class="menu">
        <button
          v-for="mi in tabs"
          :key="mi.key"
          class="menu-btn"
          :class="{ active: tab === mi.key }"
          @click="tab = mi.key; reload()"
        >
          <span class="cursor">▶</span>{{ t(mi.labelKey) }}
          <span v-if="mi.key === 'im' && imSuggestions.length" class="count px">{{ imSuggestions.length }}</span>
        </button>
      </nav>
      <div class="tip">{{ t("spine.tip1") }}<br />{{ t("spine.tip2") }}</div>
    </aside>

    <!-- 内容区 -->
    <main class="dex-main">
      <div class="dex-main-head">
        <div>
          <h1>{{ t(curTab.labelKey) }}</h1>
          <div class="sub">{{ t(curTab.descKey) }}</div>
          <div class="sub px">{{ today.toISOString().slice(0, 10).split("-").join(".") }}</div>
        </div>
        <div v-if="tab === 'today'" class="catch-progress">
          <div class="px">CAUGHT {{ caught.done }}/{{ caught.total }}</div>
          <div class="catch-bar"><i :style="{ width: caught.pct + '%' }"></i></div>
        </div>
      </div>

      <!-- 新增条目 -->
      <form v-if="tab !== 'im' && tab !== 'done' && tab !== 'settings'" class="add" @submit.prevent="addTask">
        <input v-model="newTitle" :placeholder="t('add.placeholder')" />
        <DexSelect v-model="newCategoryStr" :options="categoryOptions" />
        <DexSelect v-model="newPriority" :options="priorityOptions" />
        <DexDateTime v-model="newDue" />
        <DexToggle
          v-model="toInbox"
          :on-label="t('add.goGrass')"
          :off-label="t('add.goRoute')"
        />
        <button class="btn" type="submit">{{ t("add.submit") }}</button>
      </form>

      <!-- IM 信号：LCD 屏样式 -->
      <div v-if="tab === 'im'" class="im-list">
        <div v-if="!imSuggestions.length" class="empty">
          {{ t("im.empty1") }}<br />{{ t("im.empty2") }}
        </div>
        <div v-for="s in imSuggestions" :key="s.id" class="im-card">
          <div class="lcd im-screen">
            <div class="im-meta px">{{ s.chatName || "FEISHU" }} · {{ s.sender }}</div>
            <div class="im-content">{{ s.content }}</div>
          </div>
          <div class="im-suggest" v-if="s.suggestedTitle">
            {{ t("im.found") }}{{ s.suggestedTitle }}
            <span v-if="s.suggestedDue">（{{ s.suggestedDue }}）</span>
          </div>
          <div class="im-actions">
            <button class="btn" @click="acceptIm(s.id)">{{ t("im.catch") }}</button>
            <button class="btn ghost" @click="dismissIm(s.id)">{{ t("im.release") }}</button>
          </div>
        </div>
      </div>

      <!-- 设置中心：初代选项界面，上选单下内容 -->
      <div v-else-if="tab === 'settings'" class="settings">
        <nav class="settings-tabs">
          <button
            v-for="st in settingsTabs"
            :key="st.key"
            class="stab"
            :class="{ active: settingsTab === st.key }"
            @click="settingsTab = st.key"
          >
            <span class="cursor">▶</span>{{ t(st.labelKey) }}
          </button>
        </nav>

        <template v-if="settingsTab === 'focus'">
        <section class="set-card">
          <h3>{{ t("focus.title") }}</h3>
          <label>{{ t("focus.enable") }}<DexToggle v-model="pomoOn" /></label>
          <label>{{ t("focus.duration") }}
            <DexSelect v-model="settings.pomodoro_minutes" :options="pomoMinutesOptions" />
          </label>
          <label>{{ t("focus.break") }}
            <DexSelect v-model="settings.break_minutes" :options="breakOptions" />
          </label>
          <label>{{ t("focus.notify") }}<DexToggle v-model="pomoNotify" /></label>
        </section>

        <section class="set-card">
          <h3>{{ t("remind.title") }}</h3>
          <label>{{ t("remind.enable") }}<DexToggle v-model="notifyOn" /></label>
          <label>{{ t("remind.ahead") }}
            <DexSelect v-model="settings.remind_ahead_minutes" :options="remindAheadOptions" />
          </label>
        </section>
        </template>

        <template v-if="settingsTab === 'cats'">
        <section class="set-card">
          <h3>{{ t("cats.title") }}</h3>
          <div v-for="row in editingCats" :key="row.id" class="cat-row">
            <img class="cat-sprite" :src="`/pokemon/${row.pokemonKey}.gif`" @error="($event.target as HTMLImageElement).src = `/pokemon/${row.pokemonKey}.png`" />
            <input v-model="row.name" class="cat-name" />
            <DexSelect v-model="row.pokemonKey" :options="pokemonOptions" />
            <button class="btn ghost" @click="saveCat(row)">{{ t("cats.save") }}</button>
            <button class="btn ghost del" @click="removeCat(row)">{{ t("cats.release") }}</button>
          </div>
          <div class="btn-row">
            <button class="btn ghost" @click="addCat">{{ t("cats.new") }}</button>
          </div>
          <p class="hint">{{ t("cats.hint") }}</p>
        </section>
        </template>

        <template v-if="settingsTab === 'display'">
        <section class="set-card">
          <h3>{{ t("display.title") }}</h3>
          <label>{{ t("display.date") }}
            <DexSelect v-model="settings.date_format" :options="dateFormatOptions" />
          </label>
          <label>{{ t("display.time") }}
            <DexSelect v-model="settings.time_format" :options="timeFormatOptions" />
          </label>
                    <label>{{ t("display.language") }}
            <DexSelect v-model="settings.language" :options="languageOptions" />
          </label>
          <p class="hint">{{ t("display.preview", { v: fmtDateTime(today.toISOString()) }) }}</p>
        </section>

        <section class="set-card">
          <h3>{{ t("defaults.title") }}</h3>
          <label>{{ t("defaults.priority") }}
            <DexSelect v-model="settings.default_priority" :options="priorityOptions" />
          </label>
          <label>{{ t("defaults.toGrass") }}<DexToggle
              v-model="inboxDefault"
              :on-label="t('add.goGrass')"
              :off-label="t('add.goRoute')"
            /></label>
        </section>
        </template>

        <template v-if="settingsTab === 'integrations'">
        <section class="set-card">
          <h3>{{ t("ai.title") }}</h3>
          <label>Base URL<input v-model="settings.ai_base_url" placeholder="https://api.openai.com/v1" /></label>
          <label>API Key<input v-model="settings.ai_api_key" type="password" placeholder="sk-..." /></label>
          <label>Model<input v-model="settings.ai_model" placeholder="gpt-4o-mini / deepseek-chat / glm-4-flash ..." /></label>
          <p class="hint">{{ t("ai.hint") }}</p>
          <button class="btn ghost" :disabled="testing" @click="runTest(api.testAiConfig)">{{ t("ai.test") }}</button>
        </section>

        <section class="set-card">
          <h3>💬 {{ t("tabs.im") === "Radio" ? "Feishu" : "飞书" }}</h3>
          <label>App ID<input v-model="settings.feishu_app_id" /></label>
          <label>App Secret<input v-model="settings.feishu_app_secret" type="password" /></label>
          <label>{{ t("feishu.enable") }}<DexToggle v-model="feishuOn" /></label>
          <label>{{ t("feishu.interval") }}
            <DexSelect v-model="settings.feishu_poll_interval" :options="pollIntervalOptions" />
          </label>
          <p class="hint">{{ t("feishu.hint") }}</p>
          <div class="btn-row">
            <button class="btn ghost" :disabled="testing" @click="runTest(api.testFeishuConfig)">{{ t("feishu.test") }}</button>
            <button class="btn ghost" :disabled="testing" @click="runTest(async () => t('feishu.pollResult', { n: await api.triggerFeishuPoll() }))">{{ t("feishu.pollNow") }}</button>
          </div>
        </section>

        <section class="set-card">
          <h3>✅ Todoist</h3>
          <label>API Token<input v-model="settings.todoist_token" type="password" /></label>
          <p class="hint">{{ t("todoist.hint") }}</p>
          <div class="btn-row">
            <button class="btn ghost" :disabled="testing" @click="runTest(api.syncTodoist)">{{ t("todoist.sync") }}</button>
          </div>
        </section>
        </template>

        <template v-if="settingsTab === 'general'">
        <section class="set-card">
          <h3>⚙️ {{ t("stabs.general") }}</h3>
          <label>{{ t("general.autostart") }}<DexToggle :model-value="autostart" @update:model-value="onAutostart" /></label>
        </section>
        </template>

        <div class="set-actions">
          <button class="btn" @click="saveSettings()">{{ t("save") }}</button>
          <span class="test-msg">{{ testMsg }}</span>
        </div>
      </div>

      <!-- 图鉴条目列表 -->
      <ul v-else class="dex-list">
        <li v-if="!visible.length && !loading" class="empty">{{ t("entry.empty") }}</li>
        <li
          v-for="task in visible"
          :key="task.id"
          class="entry"
          :class="{ active: task.status === 'active', caught: task.status === 'done' }"
        >
          <div class="dex-no px">No.{{ String(task.id).padStart(3, "0") }}</div>
          <img
            class="sprite"
            :src="spriteUrl(catById.get(task.categoryId)?.sprite ?? 'pikachu')"
            :data-sprite="catById.get(task.categoryId)?.sprite ?? 'pikachu'"
            @error="spriteFallback"
          />
          <div class="info">
            <div class="row1">
              <span class="prio" :class="task.priority" />
              <span class="title">{{ task.title }}</span>
              <span v-if="task.status === 'active'" class="tag-now">{{ t("entry.catching") }}</span>
              <span v-if="task.status === 'paused'" class="tag-paused">{{ t("entry.paused") }}</span>
              <span class="badge" :class="'b-' + catKey(task.categoryId)">{{ catById.get(task.categoryId)?.name }}</span>
            </div>
            <div class="row2">
              <span v-if="task.dueAt">{{ t("entry.due", { v: fmtDateTime(task.dueAt) }) }}</span>
              <span v-if="task.remindAt">{{ t("entry.remind", { v: fmtDateTime(task.remindAt) }) }}</span>
              <span v-if="task.focusSeconds > 0">{{ t("entry.focus", { n: Math.round(task.focusSeconds / 60) }) }}</span>
              <span v-if="task.source !== 'local'">{{ t("entry.from", { src: task.source === "feishu" ? t("entry.feishu") : task.source }) }}</span>
            </div>
          </div>
          <div class="ops">
            <template v-if="task.status !== 'done'">
              <button v-if="task.status !== 'active'" class="btn" @click="start(task)">{{ t("entry.start") }}</button>
              <button v-else class="btn ghost" @click="pauseActive">{{ t("entry.pause") }}</button>
              <button class="btn ghost icon" @click="schedule(task)" :title="t('entry.route')">📅</button>
              <button class="btn" @click="complete(task)" :title="t('entry.done')">✔</button>
              <button class="btn ghost icon del" @click="remove(task)" :title="t('entry.release')">✕</button>
            </template>
            <template v-else>
              <span class="catch-mark">{{ t("entry.caught") }}</span>
              <button class="btn ghost" @click="uncomplete(task)">{{ t("entry.undo") }}</button>
            </template>
          </div>
        </li>
      </ul>
    </main>
  </div>
</template>

<style scoped>
#app, body { height: 100vh; }
.dex {
  display: flex; height: 100vh;
  background: var(--dex-body);
  overflow: hidden;
}

/* ---- 机脊 ---- */
.dex-spine {
  width: 200px; flex: none;
  background: linear-gradient(180deg, var(--dex-red) 0%, var(--dex-red) 78%, var(--dex-red-dark) 100%);
  border-right: 4px solid var(--dex-navy);
  padding: 18px 14px;
  color: #fff;
  display: flex; flex-direction: column;
  position: relative;
}
.dex-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.dex-big-led {
  width: 22px; height: 22px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #ff9d9d, #d01111 60%, #8f0b0b);
  border: 3px solid var(--dex-navy);
  animation: pk-breathe 2.5s infinite;
}
.dex-big-led.alert { animation: pk-blink 0.8s infinite; }
.dex-sub-leds { display: flex; gap: 5px; }
.dex-sub-leds i { width: 8px; height: 8px; border-radius: 50%; background: var(--poke-yellow); border: 2px solid var(--dex-navy); }
.dex-sub-leds i:last-child { background: #5be36b; }
.dex-title { font-size: 9px; line-height: 1.8; margin: 10px 0 16px; color: #ffe9e9; text-shadow: 1px 1px 0 rgba(0, 0, 0, 0.35); }
.menu { display: flex; flex-direction: column; gap: 8px; }
.menu-btn {
  display: flex; align-items: center; gap: 8px;
  background: rgba(0, 0, 0, 0.18);
  border: 3px solid transparent; border-radius: 8px;
  color: #fff; font-size: 15px; font-weight: 700;
  padding: 11px 12px; cursor: pointer;
  min-height: 44px; text-align: left; font-family: inherit;
}
.menu-btn .cursor { width: 12px; flex: none; opacity: 0; font-size: 12px; }
.menu-btn.active {
  background: var(--poke-yellow); color: var(--dex-navy);
  border-color: var(--dex-navy);
  box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.35);
}
.menu-btn.active .cursor { opacity: 1; }
.menu-btn .count {
  margin-left: auto; font-size: 10px;
  background: var(--dex-navy); color: #fff;
  border-radius: 4px; padding: 2px 5px;
}
.tip {
  margin-top: auto; font-size: 11px; line-height: 1.7;
  color: #ffd9d9; background: rgba(0, 0, 0, 0.15);
  border-radius: 8px; padding: 8px;
}

/* ---- 内容区 ---- */
.dex-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.dex-main-head { padding: 16px 20px 12px; display: flex; align-items: center; gap: 12px; }
.dex-main-head h1 { font-size: 16px; letter-spacing: 1px; }
.dex-main-head .sub { font-size: 10px; color: #7b7460; margin-top: 5px; }
.catch-progress { margin-left: auto; text-align: right; }
.catch-progress .px { font-size: 10px; }
.catch-bar {
  margin-top: 5px; width: 140px; height: 14px;
  border: 3px solid var(--dex-navy); border-radius: 7px; background: #fff; overflow: hidden;
}
.catch-bar i { display: block; height: 100%; background: var(--poke-yellow); border-right: 3px solid var(--dex-navy); transition: width 0.3s; }

.add { display: flex; gap: 8px; margin: 0 20px 14px; flex-wrap: wrap; align-items: center; }
.add input {
  /* 标题输入独占第一行 */
  flex: 1 1 100%; min-width: 0; padding: 8px 10px; border: 3px solid var(--dex-navy);
  border-radius: 8px; font-size: 14px; background: #fff; font-family: inherit;
  box-shadow: 3px 3px 0 var(--dex-navy);
  min-height: 38px;
}
.add .btn { min-height: 38px; padding: 6px 14px; }
.chk { font-size: 13px; display: flex; align-items: center; gap: 8px; color: #7b7460; font-weight: 700; }

.dex-list { flex: 1; padding: 4px 20px 20px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; list-style: none; margin: 0; }

/* 图鉴条目卡 */
.entry {
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 12px;
  box-shadow: 4px 4px 0 var(--dex-navy);
  padding: 12px 14px;
  display: flex; align-items: center; gap: 12px;
}
.entry.active { outline: 3px solid var(--poke-yellow); outline-offset: 2px; }
.dex-no { font-size: 9px; color: #9a937f; align-self: flex-start; margin-top: 3px; width: 50px; flex: none; }
.sprite { width: 52px; height: 52px; flex: none; image-rendering: pixelated; object-fit: contain; }
.entry.active .sprite { animation: pk-hop 1.6s ease-in-out infinite; }
.info { flex: 1; min-width: 0; }
.row1 { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.title { font-size: 16px; font-weight: 800; }
.tag-now { font-size: 11px; font-weight: 800; color: #fff; background: var(--dex-navy); border-radius: 4px; padding: 2px 7px; }
.tag-now::before { content: "♪ "; }
.tag-paused { font-size: 11px; font-weight: 800; color: #a1660a; background: var(--type-work); border: 2px solid var(--dex-navy); border-radius: 4px; padding: 1px 6px; }
.row2 { font-size: 12.5px; color: #7b7460; margin-top: 4px; display: flex; gap: 10px; flex-wrap: wrap; }
.row2 b { color: var(--dex-navy); }
.ops { display: flex; gap: 8px; flex: none; align-items: center; }
.ops .btn { padding: 8px 12px; font-size: 13px; min-height: 36px; }
.ops .btn.icon { padding: 8px 10px; }
.ops .btn.del { color: var(--dex-red); }

/* 已捕捉 */
.entry.caught { background: var(--lcd); box-shadow: 4px 4px 0 var(--lcd-dark); border-color: var(--lcd-text); }
.entry.caught .title { text-decoration: line-through; color: var(--lcd-text); }
.entry.caught .sprite { filter: grayscale(1) contrast(1.4) brightness(0.8); }
.entry.caught .badge, .entry.caught .prio, .entry.caught .row2 { filter: grayscale(0.7); }
.catch-mark { font-size: 14px; color: var(--lcd-text); font-weight: 800; }
.empty { color: #9a937f; text-align: center; padding: 48px 0; font-size: 14px; line-height: 2; }

/* IM 信号 */
.im-list { flex: 1; padding: 4px 20px 20px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; }
.im-card { display: flex; flex-direction: column; gap: 10px; }
.im-screen { padding: 12px; }
.im-meta { font-size: 9px; letter-spacing: 1px; margin-bottom: 8px; }
.im-content { font-size: 14px; font-weight: 700; line-height: 1.7; white-space: pre-wrap; max-height: 120px; overflow-y: auto; }
.im-suggest { font-size: 13px; font-weight: 700; color: var(--dex-navy); background: #fff; border: 3px solid var(--dex-navy); border-radius: 8px; padding: 6px 10px; box-shadow: 3px 3px 0 var(--dex-navy); }
.im-actions { display: flex; gap: 10px; }

/* 设置 */
.settings { flex: 1; padding: 4px 20px 20px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; max-width: 680px; }
/* 设置分区选单：初代菜单样式 */
.settings-tabs {
  display: flex; gap: 8px; flex-wrap: wrap;
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 10px;
  box-shadow: 4px 4px 0 var(--dex-navy);
  padding: 10px;
}
.stab {
  display: flex; align-items: center; gap: 6px;
  border: 3px solid var(--dex-navy); border-radius: 8px;
  background: var(--dex-body);
  font-size: 14px; font-weight: 700;
  padding: 8px 12px; min-height: 40px;
  cursor: pointer; font-family: inherit;
  box-shadow: 3px 3px 0 var(--dex-navy);
}
.stab .cursor { width: 12px; flex: none; opacity: 0; font-size: 11px; }
.stab.active { background: var(--poke-yellow); }
.stab.active .cursor { opacity: 1; }
.stab:active { transform: translate(1px, 1px); box-shadow: 2px 2px 0 var(--dex-navy); }

.set-card { background: #fff; border: 3px solid var(--dex-navy); border-radius: 12px; padding: 14px 16px; box-shadow: 4px 4px 0 var(--dex-navy); }
.set-card h3 { margin: 0 0 12px; font-size: 15px; }
/* 分类编辑行 */
.cat-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.cat-sprite { width: 36px; height: 36px; image-rendering: pixelated; object-fit: contain; flex: none; }
.cat-name { width: 110px; padding: 7px 9px; border: 3px solid var(--dex-navy); border-radius: 8px; font-size: 13px; font-family: inherit; }
.cat-row select { padding: 7px; border: 3px solid var(--dex-navy); border-radius: 8px; font-size: 13px; background: #fff; font-family: inherit; }
.cat-row .btn { padding: 7px 10px; min-height: 34px; font-size: 12px; }
.cat-row .btn.del { color: var(--dex-red); }
.set-card label { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 13px; color: #555; }
/* 初代选项屏的严格两栏：固定宽度标签列 + 控件统一左对齐（复选框行除外） */
.set-card label:not(.chk-line) {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}
.set-card label:not(.chk-line) .dex-select { justify-self: start; }
.set-card label:not(.chk-line) .dex-toggle { justify-self: start; }
.set-card label input:not([type="checkbox"]) {
  flex: 1; padding: 8px 10px; border: 3px solid var(--dex-navy); border-radius: 8px; font-size: 13px; font-family: inherit;
  min-height: 38px;
}
.chk-line { display: flex; align-items: center; gap: 6px; }
.hint { font-size: 12px; color: #9a937f; margin: 4px 0 12px; line-height: 1.7; }
.btn-row { display: flex; gap: 10px; }
.set-actions {
  position: sticky; bottom: 0;
  display: flex; align-items: center; gap: 12px;
  background: var(--dex-body);
  padding: 8px 0;
}
.test-msg { font-size: 13px; font-weight: 700; color: var(--dex-red); }
</style>
