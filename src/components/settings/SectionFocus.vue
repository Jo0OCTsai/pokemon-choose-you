<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../../api";
import { clipWrite } from "../../contextMenu";
import { useSettingToggle } from "../../composables/useSettingToggle";
import { useSettingsStore } from "../../stores/settings";
import DexSelect from "../DexSelect.vue";
import DexToggle from "../DexToggle.vue";
import SettingRow from "../SettingRow.vue";

/**
 * 「专注」分区（自 SettingsTab 拆出）：番茄钟 / 提醒与勿扰 / 桌宠陪伴开关。
 * 输入授权状态 inputPerm/inputExe 由父级持有（save 契约的 petInputSetEnabled 同步与
 * 窗口聚焦复查都要读写），经 props 传入；这里只渲染未授权指引块与一键直达授权按钮。
 */
defineProps<{ inputPerm: boolean; inputExe: string }>();

const { t } = useI18n();
const settings = useSettingsStore();
const pomoOn = useSettingToggle("pomodoro_enabled");
const pomoNotify = useSettingToggle("pomodoro_notify");
const notifyOn = useSettingToggle("notifications_enabled");
const chimeOn = useSettingToggle("pomodoro_chime");
const quietOn = useSettingToggle("quiet_hours_enabled");
const petInputOn = useSettingToggle("pet_input_response");
const petInputWorkOn = useSettingToggle("pet_input_response_working");
const petVoiceOn = useSettingToggle("pet_voice");
const petMateOn = useSettingToggle("pet_mate");

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

/** 一键授权引导：Finder 定位当前二进制 + 直达 系统设置→辅助功能 面板
 *  （这版 macOS 禁止了 AX 官方弹窗，只能把用户送到正确的面板） */
async function grantInputPerm() {
  try {
    await api.petInputGrant();
  } catch {
    /* 非桌面环境静默 */
  }
}
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

  <section class="set-card">
    <h3>{{ t("focus.petTitle") }}</h3>
    <SettingRow :label="t('focus.petInput')" :desc="t('focus.petInputDesc')">
      <DexToggle v-model="petInputOn" />
    </SettingRow>
    <SettingRow v-if="petInputOn" :label="t('focus.petInputWorking')" :desc="t('focus.petInputWorkingDesc')">
      <DexToggle v-model="petInputWorkOn" />
    </SettingRow>
    <!-- 未授权指引：一键直达辅助功能面板 + 当前二进制路径（可拖进列表/复制后 ⌘⇧G） -->
    <div v-if="petInputOn && !inputPerm" class="perm-hint">
      <p>{{ t("focus.petInputPerm") }}</p>
      <p class="perm-exe-row">
        <code class="perm-exe" :title="t('focus.petInputExeCopy')" @click="void clipWrite(inputExe)">{{
          inputExe || "…"
        }}</code>
        <button class="btn ghost mini" @click="grantInputPerm">
          {{ t("focus.petInputGrant") }}
        </button>
      </p>
    </div>
    <SettingRow :label="t('focus.petVoice')" :desc="t('focus.petVoiceDesc')">
      <DexToggle v-model="petVoiceOn" />
    </SettingRow>
    <SettingRow :label="t('focus.petMate')" :desc="t('focus.petMateDesc')">
      <DexToggle v-model="petMateOn" />
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
/* 输入响应未授权指引：说明 + 当前二进制路径（点击复制）+ 去授权按钮 */
.perm-hint {
  margin: 12px 0 0;
  padding-top: 10px;
  border-top: 2px dashed var(--ink-faint);
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.7;
}
.perm-exe-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.perm-exe {
  max-width: 100%;
  overflow-wrap: anywhere;
  cursor: copy;
  font-size: 11px;
  padding: 2px 6px;
  border: 2px solid var(--ink-faint);
  border-radius: 6px;
  background: var(--dex-body);
}
</style>
