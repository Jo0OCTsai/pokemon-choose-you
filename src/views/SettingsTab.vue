<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { useI18n } from "vue-i18n";
import { api, errorMessage } from "../api";
import { EVENTS } from "../events";
import { fmtDateTime, SETTING_KEYS, POKEMON_LIST, useSettingsStore } from "../stores/settings";
import { useCategoriesStore } from "../stores/categories";
import { SUPPORTED_LOCALES } from "../i18n";
import DexSelect from "../components/DexSelect.vue";
import DexToggle from "../components/DexToggle.vue";

/** App 壳监听到 update-available 后传入的版本号（空串 = 无新版本） */
defineProps<{ latestVersion?: string }>();

const { t } = useI18n();
const settings = useSettingsStore();
const categories = useCategoriesStore();

const testMsg = ref("");
const testing = ref(false);

// 复选框 ↔ 字符串设置项 的双向绑定
function boolSetting(key: string) {
  return computed({
    get: () => settings.sget(key) === "true",
    set: (v: boolean) => (settings.values[key] = v ? "true" : "false"),
  });
}
const pomoOn = boolSetting("pomodoro_enabled");
const pomoNotify = boolSetting("pomodoro_notify");
const notifyOn = boolSetting("notifications_enabled");
const feishuOn = boolSetting("feishu_enabled");

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
  [15, 25, 45, 60].map((n) => ({ value: String(n), label: t("focus.minutes", { n }) })),
);
const breakOptions = computed(() => [
  { value: "0", label: t("focus.breakOff") },
  { value: "5", label: t("focus.minutes", { n: 5 }) },
  { value: "10", label: t("focus.minutes", { n: 10 }) },
]);
const remindAheadOptions = computed(() =>
  [0, 5, 15, 30].map((n) => ({
    value: String(n),
    label: n === 0 ? t("remind.onTime") : t("remind.aheadN", { n }),
  })),
);
const pokemonOptions = computed(() => POKEMON_LIST.map((p) => ({ value: p.key, label: p.name })));
const dateFormatOptions = computed(() =>
  ["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"].map((f) => ({ value: f, label: fmtDatePreview(f) })),
);
const timeFormatOptions = computed(() => [
  { value: "24h", label: t("display.h24") },
  { value: "12h", label: t("display.h12") },
]);
const languageOptions = SUPPORTED_LOCALES.map((l) => ({ value: l.value, label: l.label }));
const priorityOptions = computed(() =>
  (["low", "normal", "high", "urgent"] as const).map((p) => ({ value: p, label: t(`priority.${p}`) })),
);
const pollIntervalOptions = computed(() =>
  [1, 2, 5, 15].map((n) => ({ value: String(n * 60), label: t("focus.minutes", { n }) })),
);

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

async function saveSettings(msg?: string) {
  await settings.save(SETTING_KEYS);
  testMsg.value = msg ?? t("saved");
  setTimeout(() => (testMsg.value = ""), 2000);
}

/** 保存按钮提升到 App.vue 标题行右侧，经 ref 调用 */
defineExpose({ save: saveSettings });
async function runTest(fn: () => Promise<string>) {
  testing.value = true;
  testMsg.value = t("testing");
  try {
    await settings.save(SETTING_KEYS);
    testMsg.value = await fn();
  } catch (e) {
    testMsg.value = `❌ ${errorMessage(e)}`;
  } finally {
    testing.value = false;
  }
}

// ---- 分类管理 ----
const editingCats = ref<{ id: number; name: string; pokemonKey: string }[]>([]);
function startEditCats() {
  editingCats.value = categories.list.map((c) => ({
    id: c.id,
    name: c.name,
    pokemonKey: c.sprite,
  }));
}
async function saveCat(row: { id: number; name: string; pokemonKey: string }) {
  const pk = POKEMON_LIST.find((p) => p.key === row.pokemonKey) ?? POKEMON_LIST[0];
  await api.updateCategory(row.id, row.name, pk.name, pk.key);
  await categories.load();
  testMsg.value = t("catSaved");
  setTimeout(() => (testMsg.value = ""), 2000);
}
async function removeCat(row: { id: number; name: string }) {
  try {
    await api.deleteCategory(row.id);
    await categories.load();
    startEditCats();
  } catch (e) {
    testMsg.value = `❌ ${errorMessage(e)}`;
  }
}
async function addCat() {
  await api.createCategory(t("cats.newName"), POKEMON_LIST[0].name, POKEMON_LIST[0].key);
  await categories.load();
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

// ---- 自动更新 ----
const updateMsg = ref("");
const updating = ref(false);
const appVersion = ref("");
async function checkUpdate() {
  updating.value = true;
  updateMsg.value = t("update.checking");
  try {
    const v = await api.checkUpdate();
    updateMsg.value = v ? t("update.found", { v }) : t("update.upToDate");
  } catch (e) {
    updateMsg.value = `❌ ${errorMessage(e)}`;
  } finally {
    updating.value = false;
  }
}
async function installUpdate() {
  updating.value = true;
  updateMsg.value = t("update.installing");
  try {
    await api.installUpdate();
  } catch (e) {
    updateMsg.value = `❌ ${errorMessage(e)}`;
    updating.value = false;
  }
  // 成功路径应用会自动重启，无需恢复状态
}

const today = new Date();

const unlisteners: UnlistenFn[] = [];
onMounted(async () => {
  await loadAutostart();
  try {
    appVersion.value = await getVersion();
  } catch {
    /* 非桌面环境（E2E mock 未提供）静默 */
  }
  // 下载进度（Rust install_update 边下边推）
  unlisteners.push(
    await listen<{ downloaded: number; total: number }>(EVENTS.updateProgress, (e) => {
      if (e.payload.total > 0) {
        updateMsg.value = t("update.progress", {
          pct: Math.round((e.payload.downloaded / e.payload.total) * 100),
        });
      }
    }),
  );
});
onUnmounted(() => unlisteners.forEach((u) => u()));
</script>

<template>
  <div class="settings">
    <div class="set-body">
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
          <label>
            {{ t("focus.duration") }}
            <DexSelect v-model="settings.values.pomodoro_minutes" :options="pomoMinutesOptions" />
          </label>
          <label>
            {{ t("focus.break") }}
            <DexSelect v-model="settings.values.break_minutes" :options="breakOptions" />
          </label>
          <label>{{ t("focus.notify") }}<DexToggle v-model="pomoNotify" /></label>
        </section>

        <section class="set-card">
          <h3>{{ t("remind.title") }}</h3>
          <label>{{ t("remind.enable") }}<DexToggle v-model="notifyOn" /></label>
          <label>
            {{ t("remind.ahead") }}
            <DexSelect v-model="settings.values.remind_ahead_minutes" :options="remindAheadOptions" />
          </label>
        </section>
      </template>

      <template v-if="settingsTab === 'cats'">
        <section class="set-card">
          <h3>{{ t("cats.title") }}</h3>
          <div v-for="row in editingCats" :key="row.id" class="cat-row">
            <img
              class="cat-sprite"
              :src="`/pokemon/${row.pokemonKey}.gif`"
              @error="($event.target as HTMLImageElement).src = `/pokemon/${row.pokemonKey}.png`"
            />
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
          <label>
            {{ t("display.date") }}
            <DexSelect v-model="settings.values.date_format" :options="dateFormatOptions" />
          </label>
          <label>
            {{ t("display.time") }}
            <DexSelect v-model="settings.values.time_format" :options="timeFormatOptions" />
          </label>
          <label>
            {{ t("display.language") }}
            <DexSelect v-model="settings.values.language" :options="languageOptions" />
          </label>
          <p class="hint">{{ t("display.preview", { v: fmtDateTime(today.toISOString()) }) }}</p>
        </section>

        <section class="set-card">
          <h3>{{ t("defaults.title") }}</h3>
          <label>
            {{ t("defaults.priority") }}
            <DexSelect v-model="settings.values.default_priority" :options="priorityOptions" />
          </label>
        </section>
      </template>

      <template v-if="settingsTab === 'integrations'">
        <section class="set-card">
          <h3>{{ t("ai.title") }}</h3>
          <label>Base URL<input v-model="settings.values.ai_base_url" placeholder="https://api.openai.com/v1" /></label>
          <label>API Key<input v-model="settings.values.ai_api_key" type="password" placeholder="sk-..." /></label>
          <label
            >Model<input v-model="settings.values.ai_model" placeholder="gpt-4o-mini / deepseek-chat / glm-4-flash ..."
          /></label>
          <p class="hint">{{ t("ai.hint") }}</p>
          <button class="btn ghost" :disabled="testing" @click="runTest(api.testAiConfig)">
            {{ t("ai.test") }}
          </button>
        </section>

        <section class="set-card">
          <h3>💬 {{ t("tabs.im") === "Radio" ? "Feishu" : "飞书" }}</h3>
          <label>App ID<input v-model="settings.values.feishu_app_id" /></label>
          <label>App Secret<input v-model="settings.values.feishu_app_secret" type="password" /></label>
          <label>{{ t("feishu.enable") }}<DexToggle v-model="feishuOn" /></label>
          <label>
            {{ t("feishu.interval") }}
            <DexSelect v-model="settings.values.feishu_poll_interval" :options="pollIntervalOptions" />
          </label>
          <p class="hint">{{ t("feishu.hint") }}</p>
          <div class="btn-row">
            <button class="btn ghost" :disabled="testing" @click="runTest(api.testFeishuConfig)">
              {{ t("feishu.test") }}
            </button>
            <button
              class="btn ghost"
              :disabled="testing"
              @click="runTest(async () => t('feishu.pollResult', { n: await api.triggerFeishuPoll() }))"
            >
              {{ t("feishu.pollNow") }}
            </button>
          </div>
        </section>

        <section class="set-card">
          <h3>✅ Todoist</h3>
          <label>API Token<input v-model="settings.values.todoist_token" type="password" /></label>
          <p class="hint">{{ t("todoist.hint") }}</p>
          <div class="btn-row">
            <button class="btn ghost" :disabled="testing" @click="runTest(api.syncTodoist)">
              {{ t("todoist.sync") }}
            </button>
          </div>
        </section>
      </template>

      <template v-if="settingsTab === 'general'">
        <section class="set-card">
          <h3>⚙️ {{ t("stabs.general") }}</h3>
          <label
            >{{ t("general.autostart") }}<DexToggle :model-value="autostart" @update:model-value="onAutostart"
          /></label>
          <p class="hint">{{ t("general.shortcuts") }}</p>
        </section>

        <section class="set-card">
          <h3>⬆️ {{ t("update.title") }}</h3>
          <p v-if="appVersion" class="hint">{{ t("update.current", { v: appVersion }) }}</p>
          <p v-if="latestVersion" class="hint">{{ t("update.found", { v: latestVersion }) }}</p>
          <p v-if="updateMsg" class="hint">{{ updateMsg }}</p>
          <div class="btn-row">
            <button class="btn ghost" :disabled="updating" @click="checkUpdate">
              {{ t("update.check") }}
            </button>
            <button v-if="latestVersion" class="btn ghost" :disabled="updating" @click="installUpdate">
              {{ t("update.install") }}
            </button>
          </div>
          <p class="hint">{{ t("update.linuxHint") }}</p>
        </section>
      </template>
    </div>

    <!-- 底部固定：测试/错误信息 -->
    <div class="set-status">
      <span v-if="testMsg" class="test-msg">{{ testMsg }}</span>
    </div>
  </div>
</template>

<style scoped>
/* 设置：顶部保存栏 + 滚动内容 + 底部状态栏 */
.settings {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
/* 滚动容器占满主区宽度，滚动条贴住窗口右缘；限宽只约束内部内容列 */
.set-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 0 20px;
}
.settings-tabs,
.set-card {
  max-width: 680px;
  margin-left: 20px;
  margin-right: 20px;
}
/* 设置分区选单：初代菜单样式 */
.settings-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 10px;
  box-shadow: 4px 4px 0 var(--dex-navy);
  padding: 10px;
}
.stab {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  background: var(--dex-body);
  font-size: 14px;
  font-weight: 700;
  padding: 8px 12px;
  min-height: 40px;
  cursor: pointer;
  font-family: inherit;
  box-shadow: 3px 3px 0 var(--dex-navy);
}
.stab .cursor {
  width: 12px;
  flex: none;
  opacity: 0;
  font-size: 11px;
}
.stab.active {
  background: var(--poke-yellow);
}
.stab.active .cursor {
  opacity: 1;
}
.stab:active {
  transform: translate(1px, 1px);
  box-shadow: 2px 2px 0 var(--dex-navy);
}

.set-card {
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 12px;
  padding: 14px 16px;
  box-shadow: 4px 4px 0 var(--dex-navy);
}
.set-card h3 {
  margin: 0 0 12px;
  font-size: 15px;
}
/* 分类编辑行 */
.cat-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.cat-sprite {
  width: 36px;
  height: 36px;
  image-rendering: pixelated;
  object-fit: contain;
  flex: none;
}
.cat-name {
  width: 110px;
  padding: 7px 9px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
}
.cat-row .btn {
  padding: 7px 10px;
  min-height: 34px;
  font-size: 12px;
}
.cat-row .btn.del {
  color: var(--dex-red);
}
.set-card label {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  font-size: 13px;
  color: #555;
}
/* 初代选项屏的严格两栏：固定宽度标签列 + 控件统一左对齐（复选框行除外） */
.set-card label:not(.chk-line) {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}
.set-card label:not(.chk-line) .dex-select {
  justify-self: start;
}
.set-card label:not(.chk-line) .dex-toggle {
  justify-self: start;
}
.set-card label input:not([type="checkbox"]) {
  flex: 1;
  padding: 8px 10px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  min-height: 38px;
}
.hint {
  font-size: 12px;
  color: #9a937f;
  margin: 4px 0 12px;
  line-height: 1.7;
}
.btn-row {
  display: flex;
  gap: 10px;
}
/* 底部状态栏：常驻高度避免消息出现时内容跳动 */
.set-status {
  min-height: 26px;
  padding: 4px 20px 8px;
  display: flex;
  align-items: center;
}
.test-msg {
  font-size: 13px;
  font-weight: 700;
  color: var(--dex-red);
}
</style>
