<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { useI18n } from "vue-i18n";
import { api, errorMessage } from "../api";
import { EVENTS } from "../events";
import { fmtDateTime, SETTING_KEYS, useSettingsStore } from "../stores/settings";
import { useCategoriesStore } from "../stores/categories";
import { useTagsStore } from "../stores/tags";
import { useTasksStore } from "../stores/tasks";
import type { AgentConfig, BackupInfo, FeishuOauthStatus, IntegrationHealth, LogEntry, RemotePkReport } from "../types";
import { SUPPORTED_LOCALES } from "../i18n";
import { BUNDLED_POKEMON, POKEMON_BY_KEY, mergePokemonQuotes, pokemonQuotesFor } from "../pokemon";
import { clipWrite, openContextMenu } from "../contextMenu";
import DexSelect from "../components/DexSelect.vue";
import DexToggle from "../components/DexToggle.vue";
import SettingRow from "../components/SettingRow.vue";
import PokemonPicker from "../components/PokemonPicker.vue";

/** App 壳监听到 update-available 后传入的版本号（空串 = 无新版本） */
defineProps<{ latestVersion?: string }>();

const { t } = useI18n();
const settings = useSettingsStore();
const categories = useCategoriesStore();
const tagsStore = useTagsStore();
const tasksStore = useTasksStore();

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
const chimeOn = boolSetting("pomodoro_chime");
const feishuOn = boolSetting("feishu_enabled");
const nlCaptureOn = boolSetting("nl_capture_enabled");
const closeToTrayOn = boolSetting("close_to_tray");
const dueRelativeOn = boolSetting("due_relative");
const reduceMotionOn = boolSetting("reduce_motion");
const quietOn = boolSetting("quiet_hours_enabled");
const overdueModeOptions = computed(() => [
  { value: "collapse", label: t("overdue.modeCollapse") },
  { value: "auto_grass", label: t("overdue.modeAuto") },
  { value: "show", label: t("overdue.modeShow") },
]);
const reviewOn = boolSetting("review_enabled");
const reviewDowOptions = computed(() =>
  [1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: String(d), label: t(`reviewDow.${d}`) })),
);

// ---- 数据备份：每日快照滚动保留 + 手动备份 + 从备份恢复 ----
const backupOn = boolSetting("backup_enabled");
const backups = ref<BackupInfo[]>([]);
const backupsLoaded = ref(false);
const backingUp = ref(false);
const backupMsg = ref("");
const restoreConfirmFile = ref("");
let restoreConfirmTimer: ReturnType<typeof setTimeout> | undefined;
const backupKeepOptions = computed(() =>
  [3, 7, 14, 30].map((n) => ({ value: String(n), label: t("backup.keepN", { n }) })),
);

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function loadBackups() {
  try {
    backups.value = await api.listBackups();
  } catch {
    /* 非桌面环境静默 */
  } finally {
    backupsLoaded.value = true;
  }
}

async function backupNow() {
  if (backingUp.value) return;
  backingUp.value = true;
  backupMsg.value = "";
  try {
    const file = await api.createBackupNow();
    backupMsg.value = t("backup.done", { v: file });
    await loadBackups();
  } catch (e) {
    backupMsg.value = `❌ ${errorMessage(e)}`;
  } finally {
    backingUp.value = false;
    setTimeout(() => (backupMsg.value = ""), 6000);
  }
}

/** 两段式确认：点「恢复」变红字「确认覆盖恢复？」（4 秒内再点生效），避免误触 */
function askRestore(file: string) {
  restoreConfirmFile.value = file;
  clearTimeout(restoreConfirmTimer);
  restoreConfirmTimer = setTimeout(() => (restoreConfirmFile.value = ""), 4000);
}

async function doRestore(file: string) {
  restoreConfirmFile.value = "";
  backupMsg.value = t("backup.restoring");
  try {
    await api.restoreBackup(file);
    // 恢复回滚了全部数据：设置页 + 各 store 重新拉取（桌宠窗口由广播事件自行刷新）
    await Promise.all([settings.load(), categories.load(), tagsStore.load(), tasksStore.reload(), loadBackups()]);
    backupMsg.value = t("backup.restored");
  } catch (e) {
    backupMsg.value = `❌ ${errorMessage(e)}`;
  }
}

// ---- 数据导出 / 导入：全量 JSON（可回导）/ 任务 CSV / 日报 Markdown ----
const exporting = ref(false);
const exportMsg = ref("");
const importConfirm = ref(false);
let importConfirmTimer: ReturnType<typeof setTimeout> | undefined;
/** 待导入文件内容（file input 读取后暂存，确认后才真正提交） */
const importPending = ref<{ name: string; content: string } | null>(null);
const importBusy = ref(false);

async function runExport(action: () => Promise<string>) {
  if (exporting.value) return;
  exporting.value = true;
  exportMsg.value = "";
  try {
    const file = await action();
    exportMsg.value = t("export.done", { v: file });
  } catch (e) {
    exportMsg.value = `❌ ${errorMessage(e)}`;
  } finally {
    exporting.value = false;
    setTimeout(() => (exportMsg.value = ""), 6000);
  }
}

/** 另存为：系统保存对话框自选位置（与后端 stamp_now 同款时间戳做缺省文件名） */
async function exportAs(kind: "json" | "csv" | "md") {
  if (exporting.value) return;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const now = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
  const preset = {
    json: { name: `pokemon-choose-you-full-${stamp}.json`, ext: "json" },
    csv: { name: `pokemon-choose-you-tasks-${stamp}.csv`, ext: "csv" },
    md: { name: `pokemon-choose-you-daily-${stamp}.md`, ext: "md" },
  }[kind];
  const dest = await save({
    defaultPath: preset.name,
    filters: [{ name: preset.ext.toUpperCase(), extensions: [preset.ext] }],
  });
  if (!dest) return; // 对话框取消
  exporting.value = true;
  exportMsg.value = "";
  try {
    const path =
      kind === "json"
        ? await api.exportJson(dest)
        : kind === "csv"
          ? await api.exportTasksCsv(dest)
          : await api.exportDailyMd(undefined, dest);
    exportMsg.value = t("export.savedTo", { v: path });
  } catch (e) {
    exportMsg.value = `❌ ${errorMessage(e)}`;
  } finally {
    exporting.value = false;
    setTimeout(() => (exportMsg.value = ""), 6000);
  }
}

function onImportFileChosen(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ""; // 允许重复选择同一文件
  if (!file) return;
  if (!file.name.endsWith(".json")) {
    exportMsg.value = `❌ ${t("export.notJson")}`;
    setTimeout(() => (exportMsg.value = ""), 5000);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    importPending.value = { name: file.name, content: String(reader.result ?? "") };
    exportMsg.value = "";
  };
  reader.readAsText(file);
}

/** 两段式确认：导入会整体覆盖数据 */
function askImport() {
  importConfirm.value = true;
  clearTimeout(importConfirmTimer);
  importConfirmTimer = setTimeout(() => (importConfirm.value = false), 4000);
}

async function doImport() {
  const pending = importPending.value;
  if (!pending || importBusy.value) return;
  importConfirm.value = false;
  importBusy.value = true;
  exportMsg.value = t("export.importing");
  try {
    const n = await api.importJson(pending.content);
    importPending.value = null;
    await Promise.all([settings.load(), categories.load(), tagsStore.load(), tasksStore.reload(), loadBackups()]);
    exportMsg.value = t("export.imported", { n, v: pending.name });
  } catch (e) {
    exportMsg.value = `❌ ${errorMessage(e)}`;
  } finally {
    importBusy.value = false;
    setTimeout(() => (exportMsg.value = ""), 8000);
  }
}

// 设置分区选单（初代选项界面：上选单下内容）
const settingsTabs = [
  { key: "focus", labelKey: "stabs.focus" },
  { key: "cats", labelKey: "stabs.cats" },
  { key: "tags", labelKey: "stabs.tags" },
  { key: "display", labelKey: "stabs.display" },
  { key: "integrations", labelKey: "stabs.integrations" },
  { key: "diag", labelKey: "stabs.diag" },
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
/** 勿扰时段边界：整点下拉（跨零点区间如 22:00–08:00 由后端判断） */
const quietTimeOptions = Array.from({ length: 24 }, (_, h) => {
  const hh = String(h).padStart(2, "0");
  return { value: `${hh}:00`, label: hh };
});
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
const editingCats = ref<{ id: number; name: string; pokemonKey: string; enabled: boolean }[]>([]);
function startEditCats() {
  editingCats.value = categories.list.map((c) => ({
    id: c.id,
    name: c.name,
    pokemonKey: c.sprite,
    enabled: c.enabled,
  }));
}
async function saveCat(row: { id: number; name: string; pokemonKey: string }) {
  // 全量名录里挑的宝可梦：库存简中名（显示层按语言本地化），未知 key 回退内置第一位
  const entry = POKEMON_BY_KEY.get(row.pokemonKey);
  const fallback = BUNDLED_POKEMON[0];
  await api.updateCategory(row.id, row.name, entry?.hans ?? fallback.name, entry?.key ?? fallback.key);
  await categories.load();
  testMsg.value = t("catSaved");
  setTimeout(() => (testMsg.value = ""), 2000);
}
/** 停用/启用：停用后分类不进新建、编辑与 AI 选项（至少保留一个启用分类） */
async function toggleCat(row: { id: number; enabled: boolean }, v: boolean | string | number) {
  row.enabled = Boolean(v);
  try {
    await api.setCategoryEnabled(row.id, row.enabled);
    await categories.load();
    startEditCats();
  } catch (e) {
    row.enabled = !row.enabled;
    testMsg.value = `❌ ${errorMessage(e)}`;
  }
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
  await api.createCategory(t("cats.newName"), BUNDLED_POKEMON[0].name, BUNDLED_POKEMON[0].key);
  await categories.load();
  startEditCats();
}

// ---- 主宝可梦 + 每宝可梦自定义台词 ----
/** 主宝可梦：选中即存（桌宠空闲展示即时生效，桌宠窗口经 settings-changed 跟随） */
async function saveMainPokemon(key: string) {
  settings.values.main_pokemon = key;
  await settings.save(["main_pokemon"]);
  testMsg.value = t("saved");
  setTimeout(() => (testMsg.value = ""), 2000);
}

/** 台词编辑器当前选中的宝可梦（默认跟主宝可梦，没设则皮卡丘） */
const quotePokemon = ref("");
const quoteText = ref("");
/** 从设置载入该宝可梦的台词到编辑框（切换选中时跟随已保存内容） */
function loadQuoteText() {
  quotePokemon.value = settings.sget("main_pokemon") || BUNDLED_POKEMON[0].key;
  quoteText.value = pokemonQuotesFor(settings.sget, quotePokemon.value).join("\n");
}
function onQuotePokemonChange(key: string) {
  quotePokemon.value = key;
  quoteText.value = pokemonQuotesFor(settings.sget, key).join("\n");
}
const quoteCount = computed(
  () =>
    quoteText.value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean).length,
);
async function saveQuotes() {
  settings.values.pokemon_quotes = mergePokemonQuotes(settings.sget, quotePokemon.value, quoteText.value);
  await settings.save(["pokemon_quotes"]);
  testMsg.value = t("saved");
  setTimeout(() => (testMsg.value = ""), 2000);
}

// ---- 标签管理（按维度分组；维度少而稳，标签在维度内开放生长） ----
interface EditingTag {
  id: number;
  name: string;
  description: string;
  dimension: string;
}
const editingTags = ref<EditingTag[]>([]);
function startEditTags() {
  editingTags.value = tagsStore.list.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    dimension: g.dimension || "topic",
  }));
}
/** 编辑行按维度分组渲染（维度序 = tagsStore.dimensions 的 sort） */
const editingGroups = computed(() =>
  tagsStore.dimensions.map((d) => ({
    dim: d,
    rows: editingTags.value.filter((r) => r.dimension === (d.key || "topic")),
  })),
);
/** 行内维度迁移下拉的选项（停用维度不进选项） */
const dimOptions = computed(() => tagsStore.enabledDimensions.map((d) => ({ value: d.key, label: d.name })));
async function saveTag(row: EditingTag) {
  try {
    await api.updateTag(row.id, row.name, row.description, row.dimension);
    await tagsStore.load();
    startEditTags();
    testMsg.value = t("tagSaved");
    setTimeout(() => (testMsg.value = ""), 2000);
  } catch (e) {
    testMsg.value = `❌ ${errorMessage(e)}`;
  }
}
async function removeTag(id: number) {
  try {
    await api.deleteTag(id);
    await tagsStore.load();
    startEditTags();
  } catch (e) {
    testMsg.value = `❌ ${errorMessage(e)}`;
  }
}
async function addTag(dimKey: string) {
  try {
    await api.createTag(t("tags.newName"), "", dimKey);
    await tagsStore.load();
    startEditTags();
  } catch (e) {
    testMsg.value = `❌ ${errorMessage(e)}`;
  }
}

// ---- 维度管理（改名 / 上限 / 停用；key 与单多选建后不可改） ----
const editingDims = ref<{ id: number; key: string; name: string; maxTags: number; enabled: boolean }[]>([]);
function startEditDims() {
  editingDims.value = tagsStore.dimensions.map((d) => ({
    id: d.id,
    key: d.key,
    name: d.name,
    maxTags: d.maxTags,
    enabled: d.enabled,
  }));
}
async function saveDim(row: { id: number; name: string; maxTags: number; enabled: boolean }) {
  try {
    await api.updateTagDimension(row.id, row.name, row.maxTags, row.enabled);
    await tagsStore.load();
    startEditDims();
    startEditTags();
    testMsg.value = t("tagSaved");
    setTimeout(() => (testMsg.value = ""), 2000);
  } catch (e) {
    testMsg.value = `❌ ${errorMessage(e)}`;
  }
}
const newDimName = ref("");
/** 新维度 key：名称转小写 ascii slug，非 ascii 回落 dim-N */
async function addDim() {
  const name = newDimName.value.trim();
  if (!name) return;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const key = slug || `dim-${Date.now().toString(36)}`;
  try {
    await api.createTagDimension(key, name);
    newDimName.value = "";
    await tagsStore.load();
    startEditDims();
    startEditTags();
  } catch (e) {
    testMsg.value = `❌ ${errorMessage(e)}`;
  }
}

// ---- 飞书用户授权（lark-cli 登录态，凭证由 lark-cli 保管） ----
const feishuAuth = ref<FeishuOauthStatus | null>(null);
const oauthBusy = ref(false);

async function loadFeishuAuth() {
  try {
    feishuAuth.value = await api.feishuOauthStatus();
  } catch {
    feishuAuth.value = null; // 非桌面环境（E2E mock）静默
  }
}
async function feishuLogin() {
  oauthBusy.value = true;
  testMsg.value = t("feishu.authing");
  try {
    // 在系统终端里跑 lark-cli 登录（首次会先 config init 创建应用）
    testMsg.value = await api.feishuOauthLogin();
    await loadFeishuAuth();
  } catch (e) {
    testMsg.value = `❌ ${errorMessage(e)}`;
  } finally {
    oauthBusy.value = false;
  }
}

// ---- AI agent CLI 管理 ----
/** 无头调用约定的预设：{prompt} 占位符由应用替换为提示词；没有占位符时提示词经标准输入传入（kiro-cli 即此方式） */
const AGENT_PRESETS: Record<string, Omit<AgentConfig, "id" | "timeoutSecs" | "enabled">> = {
  claude: {
    name: "Claude Code",
    command: "claude",
    args: "-p {prompt} --allowedTools Bash(pk:*)",
    historyArgs: "--resume",
  },
  opencode: { name: "OpenCode", command: "opencode", args: "run {prompt}", historyArgs: "" },
  kiro: {
    name: "Kiro CLI",
    command: "kiro-cli",
    args: "chat --no-interactive --trust-all-tools",
    historyArgs: "--resume",
  },
  custom: { name: "", command: "", args: "{prompt}", historyArgs: "" },
};
const presetOptions = [
  { value: "claude", label: "Claude Code" },
  { value: "opencode", label: "OpenCode" },
  { value: "kiro", label: "Kiro CLI" },
  { value: "custom", label: "Custom" },
];
const agentPreset = ref("claude");
const agents = ref<AgentConfig[]>([]);
/** 用于收音机分类的 agent（分区级单选，与其他表单行同一套下拉控件）；空 = 不指定 */
const primaryAgentOptions = computed(() => [
  { value: "", label: t("ai.primaryNone") },
  ...agents.value.filter((a) => a.enabled).map((a) => ({ value: a.id, label: a.name || a.command })),
]);

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `ag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadAgents() {
  try {
    const parsed = JSON.parse(settings.sget("ai_agents") || "[]");
    // 旧配置无 workdir 字段：归一成空串，输入框受控；残留的 mode 字段（对接方式已下线）忽略
    agents.value = Array.isArray(parsed)
      ? parsed.map((a: AgentConfig): AgentConfig => ({ ...a, workdir: a.workdir ?? "" }))
      : [];
  } catch {
    agents.value = [];
  }
}

/** 把本地编辑的 agent 列表序列化进设置并落库（隧道端口空值归一成 null，空串会让后端反序列化失败） */
async function saveAgents() {
  settings.values.ai_agents = JSON.stringify(
    agents.value.map((a) => ({
      ...a,
      remote: a.remote ? { ...a.remote, tunnel: a.remote.tunnel || null } : null,
    })),
  );
  await settings.save(["ai_agents", "ai_agent_id"]);
}

/** 开/关 SSH 远程执行：开启给默认值（端口 22），关闭清空 */
function toggleRemote(ag: AgentConfig, on: boolean) {
  ag.remote = on ? { host: "", port: 22, keyPath: "" } : null;
}

function addAgent() {
  const preset = AGENT_PRESETS[agentPreset.value] ?? AGENT_PRESETS.custom;
  agents.value.push({ id: newId(), timeoutSecs: 120, enabled: true, workdir: "", ...preset });
}

function removeAgent(id: string) {
  agents.value = agents.value.filter((a) => a.id !== id);
  if (settings.values.ai_agent_id === id) settings.values.ai_agent_id = "";
}

async function testAgent(ag: AgentConfig) {
  testing.value = true;
  testMsg.value = t("testing");
  try {
    await saveAgents();
    testMsg.value = await api.testAiConfig(ag.id);
  } catch (e) {
    testMsg.value = `❌ ${errorMessage(e)}`;
  } finally {
    testing.value = false;
  }
}

/** 历史记录由 agent 工具自带（claude --resume 等），这里只负责在新终端唤起 */
async function openHistory(ag: AgentConfig) {
  testing.value = true;
  testMsg.value = t("ai.openingHistory");
  try {
    await saveAgents();
    testMsg.value = await api.openAgentHistory(ag.id);
  } catch (e) {
    testMsg.value = `❌ ${errorMessage(e)}`;
  } finally {
    testing.value = false;
  }
}

/** 一键配置远程 pk：后端读的是已保存配置，先把表单落库再触发；成功后刷新设置与表单 */
async function setupRemotePkFor(ag: AgentConfig) {
  testing.value = true;
  testMsg.value = t("ai.settingUp");
  try {
    await saveAgents();
    const port = Number(ag.remote?.tunnel) || 10022;
    const report = await api.setupRemotePk(ag.id, port);
    testMsg.value = renderSetupReport(report);
    if (report.ok) {
      await settings.load();
      loadAgents();
    }
  } catch (e) {
    testMsg.value = `❌ ${errorMessage(e)}`;
  } finally {
    testing.value = false;
  }
}

function renderSetupReport(r: RemotePkReport): string {
  if (r.ok) {
    return t("ai.setupDone", { v: r.version || "?" });
  }
  const failed = r.steps.find((s) => s.status === "fail");
  return failed ? `❌ ${failed.name}：${failed.detail}` : `❌ ${t("ai.setupFailed")}`;
}

watch(settingsTab, (tab) => {
  if (tab === "cats") {
    startEditCats();
    loadQuoteText();
  }
  if (tab === "tags") {
    if (!editingTags.value.length) startEditTags();
    if (!editingDims.value.length) startEditDims();
  }
  if (tab === "integrations" && !agents.value.length) loadAgents();
  if (tab === "diag") loadDiagnostics();
});

// ---- 诊断：集成健康 + 运行日志 ----
const health = ref<IntegrationHealth[]>([]);
async function loadHealth() {
  try {
    health.value = await api.getIntegrationHealth();
  } catch {
    health.value = []; // 非桌面环境（单元测试 mock）静默
  }
}

/** 一键重试：飞书立即拉取（完成后刷新健康面板） */
async function retryProvider(provider: string) {
  testing.value = true;
  try {
    if (provider === "feishu") {
      await api.triggerFeishuPoll();
    }
    await loadHealth();
  } catch (e) {
    testMsg.value = `❌ ${errorMessage(e)}`;
  } finally {
    testing.value = false;
  }
}

const fmtEpoch = (ms: number) => fmtDateTime(new Date(ms).toISOString());

const logLevel = ref("");
const logSource = ref("");
const logEntries = ref<LogEntry[]>([]);
const logsLoading = ref(false);
const logLevelOptions = computed(() => [
  { value: "", label: t("diag.allLevels") },
  { value: "info", label: "INFO" },
  { value: "warn", label: "WARN" },
  { value: "error", label: "ERROR" },
]);
async function loadLogs() {
  logsLoading.value = true;
  try {
    logEntries.value = await api.listLogEntries(500, logLevel.value || undefined);
  } catch {
    logEntries.value = [];
  } finally {
    logsLoading.value = false;
  }
}
/** 来源过滤在本地做（target / message 包含匹配）；倒序展示，最新在最上 */
const filteredLogs = computed(() => {
  const src = logSource.value.trim().toLowerCase();
  const hit = src
    ? logEntries.value.filter((e) => e.target.toLowerCase().includes(src) || e.message.toLowerCase().includes(src))
    : logEntries.value;
  return [...hit].reverse();
});

function logLineText(e: LogEntry): string {
  return `${e.time} ${e.level.toUpperCase()} ${e.target} ${e.message}`;
}

/** 复制单行日志（悬停按钮或右键），结果借用支持报告的提示位反馈 */
async function copyLogLine(e: LogEntry) {
  const ok = await clipWrite(logLineText(e));
  reportMsg.value = ok ? t("ctx.copied") : t("diag.reportFailed");
  setTimeout(() => (reportMsg.value = ""), 2000);
}

function onLogContextMenu(ev: MouseEvent, e: LogEntry) {
  openContextMenu(ev, [{ key: "copyLine", label: t("ctx.copyLine"), action: () => void copyLogLine(e) }]);
}

function loadDiagnostics() {
  void loadHealth();
  void loadLogs();
}

const reportMsg = ref("");
async function copyReport() {
  try {
    const text = await api.buildSupportReport();
    await navigator.clipboard.writeText(text);
    reportMsg.value = t("diag.reportCopied");
  } catch {
    reportMsg.value = t("diag.reportFailed");
  } finally {
    setTimeout(() => (reportMsg.value = ""), 4000);
  }
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
/** 平台限定的说明只在对应平台渲染（DESIGN_SYSTEM.md §4.4 说明文字四层归属） */
const isLinux = /linux/i.test(navigator.userAgent);

const unlisteners: UnlistenFn[] = [];
onMounted(async () => {
  await loadAutostart();
  await loadFeishuAuth();
  await loadBackups();
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
  // 链路健康变化（后台轮询成功/失败）→ 停在诊断页时跟随刷新
  unlisteners.push(
    await listen(EVENTS.integrationHealthChanged, () => {
      if (settingsTab.value === "diag") void loadHealth();
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
          <SettingRow :label="t('focus.enable')" :desc="t('focus.enableDesc')">
            <DexToggle v-model="pomoOn" />
          </SettingRow>
          <SettingRow :label="t('focus.duration')">
            <DexSelect v-model="settings.values.pomodoro_minutes" :options="pomoMinutesOptions" />
          </SettingRow>
          <SettingRow :label="t('focus.break')">
            <DexSelect v-model="settings.values.break_minutes" :options="breakOptions" />
          </SettingRow>
          <SettingRow :label="t('focus.notify')">
            <DexToggle v-model="pomoNotify" />
          </SettingRow>
          <SettingRow :label="t('focus.chime')" :desc="t('focus.chimeDesc')">
            <DexToggle v-model="chimeOn" />
          </SettingRow>
        </section>

        <section class="set-card">
          <h3>{{ t("remind.title") }}</h3>
          <SettingRow :label="t('remind.enable')" :desc="t('remind.enableDesc')">
            <DexToggle v-model="notifyOn" />
          </SettingRow>
          <SettingRow :label="t('remind.ahead')">
            <DexSelect v-model="settings.values.remind_ahead_minutes" :options="remindAheadOptions" />
          </SettingRow>
          <SettingRow :label="t('remind.quiet')" :desc="t('remind.quietDesc')">
            <DexToggle v-model="quietOn" />
          </SettingRow>
          <SettingRow :label="t('remind.quietStart')">
            <DexSelect v-model="settings.values.quiet_start" :options="quietTimeOptions" />
          </SettingRow>
          <SettingRow :label="t('remind.quietEnd')">
            <DexSelect v-model="settings.values.quiet_end" :options="quietTimeOptions" />
          </SettingRow>
        </section>
      </template>

      <template v-if="settingsTab === 'cats'">
        <section class="set-card">
          <h3>{{ t("cats.mainTitle") }}</h3>
          <SettingRow :label="t('cats.mainLabel')" :desc="t('cats.mainDesc')">
            <PokemonPicker
              :model-value="settings.values.main_pokemon"
              :allow-empty-label="t('cats.mainFollow')"
              @update:model-value="saveMainPokemon"
            />
          </SettingRow>
          <p class="set-foot">{{ t("cats.spriteHint") }}</p>
        </section>

        <section class="set-card">
          <h3>{{ t("cats.quotesTitle") }}</h3>
          <p class="set-sub">{{ t("cats.quotesHint") }}</p>
          <div class="quotes-controls">
            <PokemonPicker :model-value="quotePokemon" @update:model-value="onQuotePokemonChange" />
            <span class="quotes-count">{{ t("cats.quotesCount", { n: quoteCount }) }}</span>
            <button class="btn ghost" @click="saveQuotes">{{ t("cats.quotesSave") }}</button>
          </div>
          <textarea v-model="quoteText" class="quotes-editor" rows="4" :placeholder="t('cats.quotesPh')" />
        </section>

        <section class="set-card">
          <h3>{{ t("cats.title") }}</h3>
          <div v-for="row in editingCats" :key="row.id" class="cat-row" :class="{ off: !row.enabled }">
            <input v-model="row.name" class="cat-name" />
            <PokemonPicker v-model="row.pokemonKey" />
            <DexToggle
              :model-value="row.enabled"
              :title="t('cats.toggle')"
              @update:model-value="(v) => toggleCat(row, v)"
            />
            <button class="btn ghost" @click="saveCat(row)">{{ t("cats.save") }}</button>
            <button class="btn ghost del" @click="removeCat(row)">{{ t("cats.release") }}</button>
          </div>
          <div class="btn-row">
            <button class="btn ghost" @click="addCat">{{ t("cats.new") }}</button>
          </div>
          <p class="set-foot">{{ t("cats.hint") }}</p>
          <p class="set-foot">{{ t("cats.disableHint") }}</p>
        </section>
      </template>

      <template v-if="settingsTab === 'tags'">
        <section class="set-card">
          <h3>{{ t("tags.title") }}</h3>
          <p class="set-sub">{{ t("tags.hint") }}</p>
          <div v-for="group in editingGroups" :key="group.dim.key" class="tag-dim-group">
            <div class="tag-dim-head">
              <b>{{ group.dim.name }}</b>
              <span class="tag-dim-meta">
                {{ t("tags.dimCount", { used: group.rows.length, max: group.dim.maxTags }) }}
                <template v-if="group.dim.cardinality === 'single'"> · {{ t("tags.single") }}</template>
              </span>
              <button
                class="btn ghost mini"
                :disabled="group.rows.length >= group.dim.maxTags"
                @click="addTag(group.dim.key)"
              >
                ＋
              </button>
            </div>
            <div v-for="row in group.rows" :key="row.id" class="tag-row">
              <input v-model="row.name" class="tag-name" :placeholder="t('tags.namePh')" />
              <input v-model="row.description" class="tag-desc" :placeholder="t('tags.descPh')" />
              <DexSelect v-model="row.dimension" :options="dimOptions" class="tag-dim-select" />
              <button class="btn ghost" @click="saveTag(row)">{{ t("tags.save") }}</button>
              <button class="btn ghost del" @click="removeTag(row.id)">{{ t("tags.release") }}</button>
            </div>
          </div>
          <p class="set-foot">{{ t("tags.dimHint") }}</p>
        </section>

        <section class="set-card">
          <h3>{{ t("tags.dimTitle") }}</h3>
          <div v-for="row in editingDims" :key="row.id" class="tag-row dim-row">
            <span class="dim-key" :title="row.key">{{ row.key }}</span>
            <input v-model="row.name" class="tag-name" />
            <input
              v-model.number="row.maxTags"
              class="dim-max"
              type="number"
              min="1"
              max="200"
              :title="t('tags.maxTags')"
              :aria-label="t('tags.maxTags')"
            />
            <DexToggle v-model="row.enabled" :title="t('cats.toggle')" />
            <button class="btn ghost" @click="saveDim(row)">{{ t("tags.save") }}</button>
          </div>
          <div class="btn-row">
            <input v-model="newDimName" class="tag-name" :placeholder="t('tags.dimNamePh')" />
            <button class="btn ghost" @click="addDim">{{ t("tags.dimNew") }}</button>
          </div>
          <p class="set-foot">{{ t("tags.dimManageHint") }}</p>
        </section>
      </template>

      <template v-if="settingsTab === 'display'">
        <section class="set-card">
          <h3>{{ t("display.title") }}</h3>
          <SettingRow :label="t('display.date')">
            <DexSelect v-model="settings.values.date_format" :options="dateFormatOptions" />
          </SettingRow>
          <SettingRow :label="t('display.time')">
            <DexSelect v-model="settings.values.time_format" :options="timeFormatOptions" />
          </SettingRow>
          <SettingRow :label="t('display.dueRelative')" :desc="t('display.dueRelativeDesc')">
            <DexToggle v-model="dueRelativeOn" />
          </SettingRow>
          <SettingRow :label="t('display.reduceMotion')" :desc="t('display.reduceMotionDesc')">
            <DexToggle v-model="reduceMotionOn" />
          </SettingRow>
          <SettingRow :label="t('display.overdueMode')">
            <DexSelect v-model="settings.values.overdue_mode" :options="overdueModeOptions" />
          </SettingRow>
          <SettingRow :label="t('display.language')">
            <DexSelect v-model="settings.values.language" :options="languageOptions" />
          </SettingRow>
          <p class="set-foot">{{ t("display.preview", { v: fmtDateTime(today.toISOString()) }) }}</p>
        </section>

        <section class="set-card">
          <h3>{{ t("defaults.title") }}</h3>
          <SettingRow :label="t('defaults.priority')">
            <DexSelect v-model="settings.values.default_priority" :options="priorityOptions" />
          </SettingRow>
        </section>
      </template>

      <template v-if="settingsTab === 'integrations'">
        <section class="set-card">
          <h3>{{ t("ai.title") }}</h3>
          <p class="set-sub">{{ t("ai.hint") }}</p>
          <SettingRow :label="t('ai.primary')">
            <DexSelect v-model="settings.values.ai_agent_id" :options="primaryAgentOptions" />
          </SettingRow>
          <div v-for="ag in agents" :key="ag.id" class="agent-block" :class="{ off: !ag.enabled }">
            <div class="agent-row">
              <input v-model="ag.name" class="agent-name" :placeholder="t('ai.namePh')" />
              <input v-model="ag.command" class="agent-cmd" :placeholder="t('ai.cmdPh')" />
              <DexToggle v-model="ag.enabled" :title="t('ai.enabled')" />
              <button class="btn ghost del" @click="removeAgent(ag.id)">{{ t("ai.remove") }}</button>
            </div>
            <SettingRow :label="t('ai.args')" wide :label-width="128">
              <input v-model="ag.args" :placeholder="t('ai.argsPh')" />
            </SettingRow>
            <SettingRow :label="t('ai.workdir')" wide :label-width="128">
              <input v-model="ag.workdir" :placeholder="t('ai.workdirPh')" />
            </SettingRow>
            <SettingRow :label="t('ai.historyArgs')" wide :label-width="128">
              <input v-model="ag.historyArgs" placeholder="--resume" />
            </SettingRow>
            <SettingRow :label="t('ai.timeout')">
              <input v-model.number="ag.timeoutSecs" type="number" min="10" step="10" />
            </SettingRow>
            <SettingRow :label="t('ai.sshOn')">
              <DexToggle :model-value="!!ag.remote" @update:model-value="(v) => toggleRemote(ag, Boolean(v))" />
            </SettingRow>
            <template v-if="ag.remote">
              <div class="agent-row ssh-row">
                <input v-model="ag.remote.host" class="agent-cmd" :placeholder="t('ai.sshHostPh')" />
                <input
                  v-model.number="ag.remote.port"
                  class="ssh-port"
                  type="number"
                  min="1"
                  max="65535"
                  :title="t('ai.sshPort')"
                  :aria-label="t('ai.sshPort')"
                />
                <input v-model="ag.remote.keyPath" class="agent-cmd" :placeholder="t('ai.sshKeyPh')" />
              </div>
              <SettingRow :label="t('ai.sshTunnel')" :label-width="128">
                <input v-model.number="ag.remote.tunnel" type="number" min="1" max="65535" placeholder="10022" />
              </SettingRow>
              <div class="btn-row">
                <button class="btn ghost" :disabled="testing" @click="setupRemotePkFor(ag)">
                  {{ t("ai.setupRemote") }}
                </button>
              </div>
            </template>
            <div class="btn-row">
              <button class="btn ghost" @click="saveAgents">{{ t("ai.save") }}</button>
              <button class="btn ghost" :disabled="testing" @click="testAgent(ag)">
                {{ t("ai.test") }}
              </button>
              <button class="btn ghost" :disabled="testing" @click="openHistory(ag)">
                {{ t("ai.history") }}
              </button>
            </div>
          </div>
          <div class="btn-row add-agent">
            <DexSelect v-model="agentPreset" :options="presetOptions" />
            <button class="btn ghost" @click="addAgent">{{ t("ai.add") }}</button>
          </div>
          <p class="set-foot">{{ t("ai.cliHint") }}</p>
        </section>

        <section class="set-card">
          <h3>💬 {{ t("tabs.im") === "Radio" ? "Feishu" : "飞书" }}</h3>
          <p class="set-sub">{{ t("feishu.hint") }}</p>
          <div class="auth-line">
            <span class="auth-state">
              {{
                feishuAuth?.authorized
                  ? t("feishu.authorized", { name: feishuAuth.userName || "?" })
                  : t("feishu.unauthorized")
              }}
            </span>
            <button class="btn ghost" :disabled="oauthBusy || testing" @click="feishuLogin">
              {{ oauthBusy ? t("feishu.authing") : feishuAuth?.authorized ? t("feishu.reauth") : t("feishu.auth") }}
            </button>
          </div>
          <SettingRow :label="t('feishu.enable')">
            <DexToggle v-model="feishuOn" />
          </SettingRow>
          <SettingRow :label="t('feishu.interval')">
            <DexSelect v-model="settings.values.feishu_poll_interval" :options="pollIntervalOptions" />
          </SettingRow>
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
      </template>

      <template v-if="settingsTab === 'diag'">
        <section class="set-card">
          <h3>{{ t("diag.healthTitle") }}</h3>
          <p class="set-sub">{{ t("diag.healthHint") }}</p>
          <div v-for="h in health" :key="h.provider" class="health-item">
            <div class="health-row">
              <span class="health-dot" :class="'h-' + h.status">●</span>
              <span class="health-name">{{ t(`diag.provider.${h.provider}`) }}</span>
              <span class="health-state" :class="'hs-' + h.status">{{ t(`diag.status.${h.status}`) }}</span>
              <span class="health-meta">
                {{ h.lastSuccessAt ? t("diag.lastSuccess", { v: fmtDateTime(h.lastSuccessAt) }) : t("diag.never") }}
                <template v-if="h.nextPollAt"> · {{ t("diag.nextPoll", { v: fmtEpoch(h.nextPollAt) }) }}</template>
                <template v-if="h.provider === 'feishu' && h.pendingCount">
                  · {{ t("diag.pending", { n: h.pendingCount }) }}</template
                >
                <template v-if="h.provider === 'ai' && h.primaryAgent">
                  · {{ t("diag.primaryAgent", { name: h.primaryAgent }) }}</template
                >
              </span>
              <button
                v-if="h.provider === 'feishu' && h.configured"
                class="btn ghost"
                :disabled="testing"
                @click="retryProvider('feishu')"
              >
                {{ t("diag.pollNow") }}
              </button>
            </div>
            <p v-if="h.lastError" class="hint health-err">{{ fmtDateTime(h.lastErrorAt ?? "") }} · {{ h.lastError }}</p>
          </div>
        </section>

        <section class="set-card">
          <h3>{{ t("diag.logTitle") }}</h3>
          <div class="log-controls">
            <label>
              {{ t("diag.logLevel") }}
              <DexSelect v-model="logLevel" :options="logLevelOptions" />
            </label>
            <input
              v-model="logSource"
              class="log-source"
              :placeholder="t('diag.logSource')"
              @keydown.enter="loadLogs"
            />
            <button class="btn ghost" :disabled="logsLoading" @click="loadLogs">{{ t("diag.refresh") }}</button>
            <button class="btn ghost" @click="copyReport">{{ t("diag.copyReport") }}</button>
          </div>
          <p v-if="reportMsg" class="hint">{{ reportMsg }}</p>
          <div class="log-view lcd">
            <div v-if="!filteredLogs.length" class="log-empty">{{ t("diag.logEmpty") }}</div>
            <div
              v-for="(e, i) in filteredLogs"
              :key="i"
              class="log-line"
              :class="'lv-' + e.level"
              @contextmenu.prevent.stop="onLogContextMenu($event, e)"
            >
              <span class="log-time">{{ e.time }}</span>
              <span class="log-lv">{{ e.level.toUpperCase() }}</span>
              <span class="log-target">{{ e.target }}</span>
              <span class="log-msg">{{ e.message }}</span>
              <button class="log-copy" :title="t('ctx.copyLine')" @click.stop="copyLogLine(e)">⧉</button>
            </div>
          </div>
        </section>
      </template>

      <template v-if="settingsTab === 'general'">
        <section class="set-card">
          <h3>⚙️ {{ t("stabs.general") }}</h3>
          <SettingRow :label="t('general.autostart')" :desc="t('general.autostartDesc')">
            <DexToggle :model-value="autostart" @update:model-value="onAutostart" />
          </SettingRow>
          <SettingRow :label="t('general.closeToTray')" :desc="t('general.closeToTrayDesc')">
            <DexToggle v-model="closeToTrayOn" />
          </SettingRow>
          <SettingRow :label="t('general.nlCapture')" :desc="t('general.nlCaptureDesc')">
            <DexToggle v-model="nlCaptureOn" />
          </SettingRow>
          <p class="set-foot">{{ t("general.shortcuts") }}</p>
        </section>

        <section class="set-card">
          <h3>💾 {{ t("backup.title") }}</h3>
          <SettingRow :label="t('backup.enable')" :desc="t('backup.enableDesc')">
            <DexToggle v-model="backupOn" />
          </SettingRow>
          <div class="backup-controls">
            <span class="inline-label">{{ t("backup.keep") }}</span>
            <DexSelect v-model="settings.values.backup_keep" :options="backupKeepOptions" />
            <button class="btn ghost" :disabled="backingUp" @click="backupNow">
              {{ backingUp ? t("backup.working") : t("backup.now") }}
            </button>
          </div>
          <p v-if="backupMsg" class="hint">{{ backupMsg }}</p>
          <ul v-if="backups.length" class="backup-list">
            <li v-for="b in backups" :key="b.file" class="backup-row">
              <span class="b-file">{{ b.file }}</span>
              <span class="b-meta">{{ fmtDateTime(b.createdAt) }} · {{ fmtSize(b.size) }}</span>
              <button
                class="btn ghost"
                :class="{ danger: restoreConfirmFile === b.file }"
                @click="restoreConfirmFile === b.file ? doRestore(b.file) : askRestore(b.file)"
              >
                {{ restoreConfirmFile === b.file ? t("backup.confirmRestore") : t("backup.restore") }}
              </button>
            </li>
          </ul>
          <p v-else-if="backupsLoaded" class="hint">{{ t("backup.empty") }}</p>
          <p class="set-foot">{{ t("backup.hint") }}</p>
        </section>

        <section class="set-card">
          <h3>{{ t("reviewCfg.title") }}</h3>
          <SettingRow :label="t('reviewCfg.enable')" :desc="t('reviewCfg.enableDesc')">
            <DexToggle v-model="reviewOn" />
          </SettingRow>
          <SettingRow :label="t('reviewCfg.dow')">
            <DexSelect v-model="settings.values.review_dow" :options="reviewDowOptions" />
          </SettingRow>
        </section>

        <section class="set-card">
          <h3>📤 {{ t("export.title") }}</h3>
          <div class="backup-controls">
            <button class="btn ghost" :disabled="exporting" @click="runExport(() => api.exportJson())">
              {{ t("export.json") }}
            </button>
            <button class="btn ghost" :disabled="exporting" @click="runExport(() => api.exportTasksCsv())">
              {{ t("export.csv") }}
            </button>
            <button class="btn ghost" :disabled="exporting" @click="runExport(() => api.exportDailyMd())">
              {{ t("export.md") }}
            </button>
            <button class="btn ghost" @click="api.openExportsDir()">{{ t("export.openDir") }}</button>
          </div>
          <div class="backup-controls">
            <button class="btn ghost" :disabled="exporting" @click="exportAs('json')">
              {{ t("export.saveJson") }}
            </button>
            <button class="btn ghost" :disabled="exporting" @click="exportAs('csv')">
              {{ t("export.saveCsv") }}
            </button>
            <button class="btn ghost" :disabled="exporting" @click="exportAs('md')">
              {{ t("export.saveMd") }}
            </button>
          </div>
          <div class="backup-controls">
            <label class="btn ghost import-label">
              {{ importPending ? t("export.chosen", { v: importPending.name }) : t("export.pick") }}
              <input type="file" accept=".json,application/json" class="import-input" @change="onImportFileChosen" />
            </label>
            <button
              v-if="importPending"
              class="btn ghost"
              :class="{ danger: importConfirm }"
              :disabled="importBusy"
              @click="importConfirm ? doImport() : askImport()"
            >
              {{
                importBusy ? t("export.importing") : importConfirm ? t("export.confirmImport") : t("export.doImport")
              }}
            </button>
          </div>
          <p v-if="exportMsg" class="hint">{{ exportMsg }}</p>
          <p class="set-foot">{{ t("export.hint") }}</p>
        </section>

        <section class="set-card">
          <h3>⬆️ {{ t("update.title") }}</h3>
          <p v-if="appVersion" class="set-sub">{{ t("update.current", { v: appVersion }) }}</p>
          <p v-if="latestVersion" class="set-sub">{{ t("update.found", { v: latestVersion }) }}</p>
          <p v-if="updateMsg" class="hint">{{ updateMsg }}</p>
          <div class="btn-row">
            <button class="btn ghost" :disabled="updating" @click="checkUpdate">
              {{ t("update.check") }}
            </button>
            <button v-if="latestVersion" class="btn ghost" :disabled="updating" @click="installUpdate">
              {{ t("update.install") }}
            </button>
          </div>
          <p v-if="isLinux" class="set-foot">{{ t("update.linuxHint") }}</p>
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
  padding: 4px 20px 20px;
}
/* 跟随窗口伸缩，超过阅读舒适宽度后收口居中（水平留白移到 .set-body 的 padding） */
.settings-tabs,
.set-card {
  width: 100%;
  max-width: 920px;
  margin-left: auto;
  margin-right: auto;
}
/* 设置分区选单：初代菜单样式 */
.settings-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
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
  min-height: 38px;
  cursor: pointer;
  font-family: inherit;
  box-shadow: 3px 3px 0 var(--dex-navy);
  transition:
    transform var(--t-tap),
    box-shadow var(--t-tap),
    background var(--t-tap);
}
.stab .cursor {
  width: 12px;
  flex: none;
  opacity: 0;
  font-size: 10px;
}
.stab:hover:not(.active) {
  background: var(--hover);
}
.stab.active {
  background: var(--poke-yellow);
}
.stab.active .cursor {
  opacity: 1;
}
.stab:active {
  transform: translate(2px, 2px);
  box-shadow: 1px 1px 0 var(--dex-navy);
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
  font-size: 16px;
}
/* 台词编辑器 */
.quotes-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.quotes-count {
  font-size: 12px;
  color: var(--ink-soft);
}
.quotes-editor {
  width: 100%;
  padding: 8px 10px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.7;
  resize: vertical;
  min-height: 96px;
  box-shadow: 3px 3px 0 var(--dex-navy);
}
/* 分类编辑行 */
.cat-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.cat-row.off {
  opacity: 0.5;
}
.cat-name {
  width: 110px;
  padding: 7px 9px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  min-height: 38px;
  box-shadow: 3px 3px 0 var(--dex-navy);
}
.cat-row .btn {
  padding: 7px 10px;
  min-height: 38px;
  font-size: 13px;
}
.cat-row .btn.del {
  color: var(--danger);
}
/* 标签编辑行 */
.tag-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.tag-row input {
  padding: 7px 9px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  min-height: 38px;
  box-shadow: 3px 3px 0 var(--dex-navy);
}
.tag-name {
  width: 110px;
  flex: none;
}
.tag-desc {
  flex: 1;
  min-width: 0;
}
.tag-row .btn {
  padding: 7px 10px;
  min-height: 38px;
  font-size: 13px;
}
/* 维度分组管理 */
.tag-dim-group {
  margin-bottom: 14px;
}
.tag-dim-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 13px;
}
.tag-dim-meta {
  font-size: 11px;
  color: var(--ink-soft);
}
/* mini 档统一走 dex.css 的 .btn.mini（32px） */
.tag-dim-select {
  width: 92px;
  flex: none;
}
.dim-row .dim-key {
  flex: none;
  width: 84px;
  font-size: 11px;
  font-weight: 800;
  color: var(--ink-soft);
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 维度新增行：新维度名称输入框不在 .tag-row 内，单独补齐与 tag-row 同款控件质感 */
.btn-row .tag-name {
  padding: 7px 9px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  min-height: 38px;
  box-shadow: 3px 3px 0 var(--dex-navy);
}
.dim-max {
  width: 64px;
  flex: none;
}
.set-card .btn.del {
  color: var(--danger);
}
/* AI agent 配置块 */
.agent-block {
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  background: #fff;
}
.agent-block.off {
  opacity: 0.55;
}
.agent-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.agent-row input {
  padding: 7px 9px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  min-height: 38px;
  box-shadow: 3px 3px 0 var(--dex-navy);
}
.agent-name {
  width: 120px;
  flex: none;
}
.agent-cmd {
  flex: 1;
  min-width: 0;
}
.agent-row .btn {
  padding: 7px 10px;
  min-height: 38px;
  font-size: 13px;
}
.agent-block .btn-row {
  margin-top: 10px;
}
.add-agent {
  align-items: center;
}
/* 说明文字四层归属的页面两层（行内 desc 在 SettingRow 组件内）：区块副标题 + 卡片脚注 */
.set-sub {
  margin: -6px 0 12px;
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.7;
}
.set-foot {
  margin: 12px 0 0;
  padding-top: 10px;
  border-top: 2px dashed var(--ink-faint);
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.7;
}
.set-foot + .set-foot {
  margin-top: 6px;
  padding-top: 0;
  border-top: none;
}
/* 瞬时反馈信息（保存结果 / 错误 / 空态），不是常驻说明 */
.hint {
  font-size: 12px;
  color: var(--ink-soft);
  margin: 8px 0 0;
  line-height: 1.7;
}
.btn-row {
  display: flex;
  gap: 10px;
}
/* 飞书授权状态行：状态文字 + 授权按钮同行 */
.auth-line {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0 4px;
}
.auth-state {
  font-size: 12px;
  font-weight: 700;
  color: var(--dex-navy);
}
/* 诊断：集成健康行 */
.health-item {
  margin-bottom: 10px;
}
.health-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.health-dot {
  font-size: 14px;
  line-height: 1;
}
/* 三档状态：绿=正常/待运行，黄=降级/暂停，红=故障；灰=未配置 */
.h-ok,
.h-idle {
  color: var(--ok);
}
.h-degraded,
.h-paused {
  color: var(--warn);
}
.h-down {
  color: var(--dex-red);
  animation: health-blink 1.2s steps(2) infinite;
}
.h-off {
  color: var(--ink-soft);
}
@keyframes health-blink {
  50% {
    opacity: 0.35;
  }
}
.health-name {
  font-size: 13px;
  font-weight: 800;
  color: var(--dex-navy);
}
.health-state {
  font-size: 12px;
  font-weight: 700;
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  padding: 1px 8px;
  background: #fff;
}
.hs-down {
  background: var(--danger);
  color: #fff;
}
.hs-degraded {
  background: var(--warn-soft);
}
.health-meta {
  font-size: 12px;
  color: var(--ink-soft);
  flex: 1;
  min-width: 200px;
}
.health-err {
  margin: 4px 0 0 24px;
  color: var(--danger);
}
/* 诊断：日志查看器 */
.log-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.log-controls label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 13px;
  color: var(--ink-soft);
}
.log-source {
  flex: 1;
  min-width: 140px;
  padding: 8px 10px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  min-height: 38px;
  box-shadow: 3px 3px 0 var(--dex-navy);
}
.log-view {
  max-height: 320px;
  overflow-y: auto;
  padding: 10px 12px;
  font-family: monospace;
  font-size: 12px;
  line-height: 1.7;
}
.log-empty {
  color: var(--lcd-text);
  opacity: 0.8;
  text-align: center;
  padding: 18px 0;
}
.log-line {
  display: flex;
  gap: 8px;
  align-items: baseline;
}
/* 行内复制按钮：悬停行时出现，不挤占日志文本 */
.log-copy {
  flex: none;
  border: 2px solid var(--lcd-text);
  border-radius: 4px;
  background: transparent;
  color: var(--lcd-text);
  font-size: 11px;
  line-height: 1;
  padding: 2px 5px;
  cursor: pointer;
  font-family: inherit;
  opacity: 0;
  align-self: center;
}
.log-line:hover .log-copy,
.log-copy:focus-visible {
  opacity: 0.85;
}
.log-copy:hover {
  opacity: 1;
  background: var(--lcd-text);
  color: var(--lcd);
}
.log-time {
  flex: none;
  opacity: 0.75;
}
.log-lv {
  flex: none;
  width: 44px;
  font-weight: 800;
}
.log-target {
  flex: none;
  opacity: 0.75;
  word-break: break-all;
}
.log-msg {
  flex: 1;
  min-width: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.lv-error .log-lv {
  color: var(--log-error);
}
.lv-warn .log-lv {
  color: var(--log-warn);
}
.lv-debug {
  opacity: 0.65;
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
  color: var(--danger);
}

/* 备份管理 */
.backup-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.inline-label {
  font-size: 13px;
  color: var(--dex-navy);
  font-weight: 700;
}
.backup-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.backup-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 12px;
}
.b-file {
  font-weight: 800;
  color: var(--dex-navy);
  font-family: monospace;
}
.b-meta {
  color: var(--ink-soft);
  margin-right: auto;
}
.btn.ghost.danger {
  color: #fff;
  background: var(--danger);
  border-color: var(--dex-navy);
}

/* 导入文件按钮：input 隐藏叠在 label 下 */
.import-label {
  position: relative;
  overflow: hidden;
  cursor: pointer;
}
.import-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

/* SSH 远程执行配置行：与上方命令输入框左缘对齐（agent-name 120px + 行间距 8px = 128px） */
.agent-block .ssh-row {
  padding-left: 128px;
}
.ssh-row .ssh-port {
  width: 84px;
  flex: none;
  padding: 6px 8px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  min-height: 38px;
  box-shadow: 3px 3px 0 var(--dex-navy);
}
</style>
