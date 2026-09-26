<script setup lang="ts">
import { useI18n } from "vue-i18n";

defineProps<{
  /** toast 内容：文案 + 可选撤销回调 / 错误态（显隐由父级 v-if 控制） */
  toast: { text: string; undo?: () => void; error?: boolean };
}>();
const emit = defineEmits<{ undo: [] }>();

const { t } = useI18n();
</script>

<template>
  <!-- 撤销 toast：处理完立即生效，5 秒内可反悔 -->
  <div class="toast" :class="{ error: toast.error }">
    <span>{{ toast.text }}</span>
    <button v-if="toast.undo" @click="emit('undo')">{{ t("im.undo") }}</button>
  </div>
</template>

<style scoped>
/* 撤销 toast */
.toast {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  box-shadow: 4px 4px 0 var(--dex-navy);
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 700;
  max-width: 70%;
}
.toast.error {
  color: var(--danger);
}
.toast button {
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  background: var(--poke-yellow);
  font-size: 12px;
  font-weight: 800;
  padding: 4px 10px;
  cursor: pointer;
  font-family: inherit;
  flex: none;
  transition: transform var(--t-tap);
}
.toast button:active {
  transform: translate(1px, 1px);
}
</style>
