<script setup lang="ts">
import { useI18n } from "vue-i18n";

/** 判定失败组头动作：一键重判（整组重送 AI）+ 强制逃走（dsh FailedGroup actions 同构） */
defineProps<{
  /** 组展开时才显示 */
  expanded: boolean;
  /** 重判进行中 */
  retrying: boolean;
}>();

const emit = defineEmits<{
  retry: [];
  forceEscape: [];
}>();

const { t } = useI18n();
</script>

<template>
  <span
    v-if="expanded"
    class="failed-action"
    role="button"
    :title="t('im.retryFailedTitle')"
    @click.stop="emit('retry')"
  >
    {{ retrying ? t("im.retrying") : `♻ ${t("im.retryFailed")}` }}
  </span>
  <span
    v-if="expanded"
    class="failed-action"
    role="button"
    :title="t('im.forceEscapeFailedTitle')"
    @click.stop="emit('forceEscape')"
  >
    {{ t("im.forceEscapeFailed") }}
  </span>
</template>

<style scoped>
/* 判定失败组头动作（与 ClearNoiseActions 同名基础样式，scoped 隔离各一份） */
.failed-action {
  font-size: 11px;
  font-weight: 700;
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  background: #fff;
  padding: 2px 8px;
  cursor: pointer;
  transition:
    background var(--t-tap),
    transform var(--t-tap);
}
.failed-action:hover {
  background: var(--hover);
}
.failed-action:active {
  transform: translate(1px, 1px);
}
</style>
