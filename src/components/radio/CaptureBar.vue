<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";

defineProps<{
  /** 输入值（提交逻辑与文案状态留在 RadioTab，经 v-model 双向） */
  modelValue: string;
  /** AI 判定进行中（输入与发送禁用、按钮文案切换） */
  capturing: boolean;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: string];
  submit: [];
}>();

const { t } = useI18n();
const input = ref<HTMLInputElement | null>(null);

function onInput(e: Event) {
  emit("update:modelValue", (e.target as HTMLInputElement).value);
}

/** 快捷键「快速捕捉」：切到收音机后聚焦捕捉输入框（经 template ref 由 RadioTab 转发调用） */
function focus() {
  input.value?.focus();
}
defineExpose({ focus });
</script>

<template>
  <!-- 快速捕捉（发送区）：一句话发给 AI 判定属性（内容 / 分类 / 标签 / 截止时间）；
       通栏垫底，与上方收听区分隔 -->
  <form class="capture-bar" @submit.prevent="emit('submit')">
    <span class="cap-icon" aria-hidden="true">⚡</span>
    <input
      ref="input"
      :value="modelValue"
      class="cap-input"
      :placeholder="t('im.capturePlaceholder')"
      :disabled="capturing"
      @input="onInput"
    />
    <button class="cap-send" type="submit" :disabled="!modelValue.trim() || capturing">
      {{ capturing ? t("im.capturing") : t("im.captureSend") }}
    </button>
  </form>
</template>

<style scoped>
/* 快速捕捉条（发送区）：通栏垫底，分隔线划开收 / 发两个区域，主入口用黄底强调 */
.capture-bar {
  flex: none;
  display: flex;
  gap: 8px;
  align-items: center;
  padding-top: 12px;
  border-top: 3px solid var(--dex-navy);
}
.cap-icon {
  flex: none;
  font-size: 16px;
}
.cap-input {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-size: 14px;
  background: #fff;
  font-family: inherit;
  box-shadow: 3px 3px 0 var(--dex-navy);
  min-height: 38px;
}
.cap-input:disabled {
  opacity: 0.6;
}
.cap-send {
  flex: none;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  background: var(--poke-yellow);
  color: var(--dex-navy);
  font-size: 13px;
  font-weight: 800;
  font-family: inherit;
  padding: 8px 14px;
  min-height: 38px;
  cursor: pointer;
  box-shadow: 3px 3px 0 var(--dex-navy);
  transition:
    transform var(--t-tap),
    box-shadow var(--t-tap),
    background var(--t-tap);
}
.cap-send:disabled {
  opacity: 0.55;
  cursor: default;
}
.cap-send:not(:disabled):hover {
  background: #ffdf60;
}
.cap-send:not(:disabled):active {
  transform: translate(2px, 2px);
  box-shadow: 1px 1px 0 var(--dex-navy);
}
</style>
