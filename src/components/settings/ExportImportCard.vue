<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorMessage } from "../../api";
import { useActionToast } from "../../composables/useActionToast";
import { useSettingsStore } from "../../stores/settings";
import { useCategoriesStore } from "../../stores/categories";
import { useTagsStore } from "../../stores/tags";
import { useTasksStore } from "../../stores/tasks";

/**
 * 数据导出 / 导入卡（自 SettingsTab 拆出）：全量 JSON（可回导）/ 任务 CSV / 日报 Markdown 的
 * 导出与另存为 + JSON 导入（两段式确认）；导入回滚数据后各 store 重拉、备份列表经 reload 回调重拉。
 */
const props = defineProps<{ reload: () => Promise<void> }>();

const { t } = useI18n();
const settings = useSettingsStore();
const categories = useCategoriesStore();
const tagsStore = useTagsStore();
const tasksStore = useTasksStore();

// ---- 数据导出 / 导入：全量 JSON（可回导）/ 任务 CSV / 日报 Markdown ----
const exporting = ref(false);
const { msg: exportMsg, flash: flashExport } = useActionToast();
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
    flashExport(exportMsg.value, 6000);
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
    flashExport(exportMsg.value, 6000);
  }
}

function onImportFileChosen(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ""; // 允许重复选择同一文件
  if (!file) return;
  if (!file.name.endsWith(".json")) {
    flashExport(`❌ ${t("export.notJson")}`, 5000);
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
    await Promise.all([settings.load(), categories.load(), tagsStore.load(), tasksStore.reload(), props.reload()]);
    exportMsg.value = t("export.imported", { n, v: pending.name });
  } catch (e) {
    exportMsg.value = `❌ ${errorMessage(e)}`;
  } finally {
    importBusy.value = false;
    flashExport(exportMsg.value, 8000);
  }
}
</script>

<template>
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
        {{ importBusy ? t("export.importing") : importConfirm ? t("export.confirmImport") : t("export.doImport") }}
      </button>
    </div>
    <p v-if="exportMsg" class="hint">{{ exportMsg }}</p>
    <p class="set-foot">{{ t("export.hint") }}</p>
  </section>
</template>

<style scoped>
/* 共享壳样式（自 SettingsTab 复制的 scoped 副本：分区子组件沿用通用类的既定做法） */
.set-card {
  width: 100%;
  max-width: 920px;
  margin-left: auto;
  margin-right: auto;
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
.set-foot {
  margin: 12px 0 0;
  padding-top: 10px;
  border-top: 2px dashed var(--ink-faint);
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.7;
}
/* 瞬时反馈信息（保存结果 / 错误 / 空态），不是常驻说明 */
.hint {
  font-size: 12px;
  color: var(--ink-soft);
  margin: 8px 0 0;
  line-height: 1.7;
}
/* 导出/导入的多行按钮组：行与行之间留出呼吸空隙（复用备份卡同款容器类） */
.backup-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.backup-controls + .backup-controls {
  margin-top: 12px;
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
</style>
