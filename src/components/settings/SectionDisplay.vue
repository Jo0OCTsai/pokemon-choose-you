<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useSettingToggle } from "../../composables/useSettingToggle";
import { fmtDateTime, useSettingsStore } from "../../stores/settings";
import { SUPPORTED_LOCALES } from "../../i18n";
import DexSelect from "../DexSelect.vue";
import DexToggle from "../DexToggle.vue";
import SettingRow from "../SettingRow.vue";

/**
 * 「外观」分区（自 SettingsTab 拆出）：日期/时间格式、相对截止、减弱动效、逾期展示、语言单卡。
 */
const { t } = useI18n();
const settings = useSettingsStore();
const dueRelativeOn = useSettingToggle("due_relative");
const reduceMotionOn = useSettingToggle("reduce_motion");
const overdueModeOptions = computed(() => [
  { value: "collapse", label: t("overdue.modeCollapse") },
  { value: "auto_grass", label: t("overdue.modeAuto") },
  { value: "show", label: t("overdue.modeShow") },
]);

const dateFormatOptions = computed(() =>
  ["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"].map((f) => ({ value: f, label: fmtDatePreview(f) })),
);
const timeFormatOptions = computed(() => [
  { value: "24h", label: t("display.h24") },
  { value: "12h", label: t("display.h12") },
]);
const languageOptions = SUPPORTED_LOCALES.map((l) => ({ value: l.value, label: l.label }));

const today = new Date();

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
</script>

<template>
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
