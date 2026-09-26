<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useSettingToggle } from "../../composables/useSettingToggle";
import { useSettingsStore } from "../../stores/settings";
import DexSelect from "../DexSelect.vue";
import DexToggle from "../DexToggle.vue";
import SettingRow from "../SettingRow.vue";

/**
 * 「专注」分区（自 SettingsTab 拆出，桌宠行为卡已移至「桌宠」分区）：番茄钟 / 提醒与勿扰。
 */
const { t } = useI18n();
const settings = useSettingsStore();
const pomoOn = useSettingToggle("pomodoro_enabled");
const pomoNotify = useSettingToggle("pomodoro_notify");
const notifyOn = useSettingToggle("notifications_enabled");
const chimeOn = useSettingToggle("pomodoro_chime");
const quietOn = useSettingToggle("quiet_hours_enabled");

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
</script>

<template>
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
</style>
