<script setup lang="ts">
import { useI18n } from "vue-i18n";

/** 无信号组头的一键清空（挂在 ImListGroup 头部 actions 插槽内；判定失败组另有 FailedGroupActions） */
defineProps<{
  /** 组展开时才显示 */
  expanded: boolean;
}>();

const emit = defineEmits<{
  clear: [];
}>();

const { t } = useI18n();
</script>

<template>
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
