<script setup lang="ts">
import { ref } from "vue";
import HealthCard from "./HealthCard.vue";
import LogViewer from "./LogViewer.vue";

/**
 * 「诊断」分区壳（自 SettingsTab 拆出）：集成健康面板 + 日志查看器两张卡。
 * 健康与日志在原实现里每次进入 diag 分区都重拉（无守卫），随子卡 onMounted 等价承接；
 * reloadHealth 供父级 integrationHealthChanged 事件经 ref 转发刷新。
 */
const healthCard = ref<InstanceType<typeof HealthCard>>();

function reloadHealth() {
  healthCard.value?.reload();
}
defineExpose({ reloadHealth });
</script>

<template>
  <HealthCard ref="healthCard" />
  <LogViewer />
</template>
