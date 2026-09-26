<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useSettingToggle } from "../../composables/useSettingToggle";
import { useSettingsStore } from "../../stores/settings";
import type { BackupInfo } from "../../types";
import DexSelect from "../DexSelect.vue";
import DexToggle from "../DexToggle.vue";
import SettingRow from "../SettingRow.vue";
import BackupCard from "./BackupCard.vue";
import ExportImportCard from "./ExportImportCard.vue";
import UpdateCard from "./UpdateCard.vue";

/**
 * 「通用」分区壳（自 SettingsTab 拆出）：开机自启/托盘 + 备份恢复 + 每周复盘 + 导入导出 + 自动更新。
 * 自启状态、备份列表、版本与更新忙位由父级持有（页面挂载即预取 / 下载进度事件跨分区推送），
 * 经 props/emit 接线；备份与导入导出的动作与瞬时反馈随各子卡。
 */
defineProps<{
  autostart: boolean;
  appVersion: string;
  latestVersion?: string;
  updating: boolean;
  updateMsg: string;
  backups: BackupInfo[];
  backupsLoaded: boolean;
  reloadBackups: () => Promise<void>;
}>();
const emit = defineEmits<{
  autostart: [v: boolean | string | number];
  checkUpdate: [];
  installUpdate: [];
}>();

const { t } = useI18n();
const settings = useSettingsStore();
const closeToTrayOn = useSettingToggle("close_to_tray");
const reviewOn = useSettingToggle("review_enabled");
const reviewDowOptions = computed(() =>
  [1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: String(d), label: t(`reviewDow.${d}`) })),
);
</script>

<template>
  <section class="set-card">
    <h3>⚙️ {{ t("stabs.general") }}</h3>
    <SettingRow :label="t('general.autostart')" :desc="t('general.autostartDesc')">
      <DexToggle :model-value="autostart" @update:model-value="(v) => emit('autostart', v)" />
    </SettingRow>
    <SettingRow :label="t('general.closeToTray')" :desc="t('general.closeToTrayDesc')">
      <DexToggle v-model="closeToTrayOn" />
    </SettingRow>
    <p class="set-foot">{{ t("general.shortcuts") }}</p>
  </section>

  <BackupCard :backups="backups" :backups-loaded="backupsLoaded" :reload="reloadBackups" />

  <section class="set-card">
    <h3>{{ t("reviewCfg.title") }}</h3>
    <SettingRow :label="t('reviewCfg.enable')" :desc="t('reviewCfg.enableDesc')">
      <DexToggle v-model="reviewOn" />
    </SettingRow>
    <SettingRow :label="t('reviewCfg.dow')">
      <DexSelect v-model="settings.values.review_dow" :options="reviewDowOptions" />
    </SettingRow>
  </section>

  <ExportImportCard :reload="reloadBackups" />

  <UpdateCard
    :app-version="appVersion"
    :latest-version="latestVersion"
    :updating="updating"
    :update-msg="updateMsg"
    @check="emit('checkUpdate')"
    @install="emit('installUpdate')"
  />
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
</style>
