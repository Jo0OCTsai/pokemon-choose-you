<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorMessage } from "../../api";
import { useActionToast } from "../../composables/useActionToast";
import { useSettingToggle } from "../../composables/useSettingToggle";
import { fmtDateTime, useSettingsStore } from "../../stores/settings";
import { useCategoriesStore } from "../../stores/categories";
import { useTagsStore } from "../../stores/tags";
import { useTasksStore } from "../../stores/tasks";
import type { BackupInfo } from "../../types";
import DexSelect from "../DexSelect.vue";
import DexToggle from "../DexToggle.vue";
import SettingRow from "../SettingRow.vue";

/**
 * 数据备份卡（自 SettingsTab 拆出）：每日快照开关 + 滚动保留 + 手动备份 + 两段式确认恢复。
 * 备份列表由父级持有（页面挂载即预取），动作后经 reload 回调重拉；备份反馈位 backupMsg 渲染在本卡内。
 */
const props = defineProps<{
  backups: BackupInfo[];
  backupsLoaded: boolean;
  reload: () => Promise<void>;
}>();

const { t } = useI18n();
const settings = useSettingsStore();
const categories = useCategoriesStore();
const tagsStore = useTagsStore();
const tasksStore = useTasksStore();

const backupOn = useSettingToggle("backup_enabled");
const backingUp = ref(false);
const { msg: backupMsg, flash: flashBackup } = useActionToast();
const restoreConfirmFile = ref("");
let restoreConfirmTimer: ReturnType<typeof setTimeout> | undefined;
const backupKeepOptions = computed(() =>
  [3, 7, 14, 30].map((n) => ({ value: String(n), label: t("backup.keepN", { n }) })),
);

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function backupNow() {
  if (backingUp.value) return;
  backingUp.value = true;
  backupMsg.value = "";
  try {
    const file = await api.createBackupNow();
    backupMsg.value = t("backup.done", { v: file });
    await props.reload();
  } catch (e) {
    backupMsg.value = `❌ ${errorMessage(e)}`;
  } finally {
    backingUp.value = false;
    flashBackup(backupMsg.value, 6000);
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
    await Promise.all([settings.load(), categories.load(), tagsStore.load(), tasksStore.reload(), props.reload()]);
    backupMsg.value = t("backup.restored");
  } catch (e) {
    backupMsg.value = `❌ ${errorMessage(e)}`;
  }
}
</script>

<template>
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
  margin: 10px 0 0;
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
</style>
