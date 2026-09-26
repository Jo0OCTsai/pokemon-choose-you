<script setup lang="ts">
import { useI18n } from "vue-i18n";

/** 无信号组头的清扫动作：重判失败的 error 消息 + 一键清空无信号（挂在 ImListGroup 头部 actions 插槽内） */
defineProps<{
  /** 组展开时才显示 */
  expanded: boolean;
  /** 判定失败（error）条数，>0 才显示重判入口 */
  failedCount: number;
  /** 重判进行中 */
  retrying: boolean;
}>();

const emit = defineEmits<{
  retry: [];
  clear: [];
}>();

const { t } = useI18n();
</script>

<template>
  <span
    v-if="expanded && failedCount"
    class="clear-noise"
    role="button"
    :title="t('im.retryFailedTitle')"
    @click.stop="emit('retry')"
  >
    {{ retrying ? t("im.retrying") : `♻ ${t("im.retryFailed")}（${failedCount}）` }}
  </span>
  <span v-if="expanded" class="clear-noise" role="button" :title="t('im.clearNoiseTitle')" @click.stop="emit('clear')">
    {{ t("im.clearNoise") }}
  </span>
</template>

<style scoped>
/* 无信号组头的一键清空 */
.clear-noise {
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
.clear-noise:hover {
  background: var(--hover);
}
.clear-noise:active {
  transform: translate(1px, 1px);
}
</style>
