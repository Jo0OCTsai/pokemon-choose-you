<script setup lang="ts">
import AgentSessionHistory from "../components/AgentSessionHistory.vue";

/**
 * 「冒险日志」页（原设置 · Agent 分区底部的会话历史卡，2026-09 抽为顶层菜单）：
 * 会话历史是浏览/回放的操作数据面，与设置（配置面）分家。列表内容整体在
 * AgentSessionHistory，这里只出与任务页同款的整页滚动容器（宽度跟随内容区）。
 */
</script>

<template>
  <div class="sess-page">
    <AgentSessionHistory />
  </div>
</template>

<style scoped>
/* 与任务页 .dex-list 同款整页滚动容器：列表本体（含行卡样式）在 AgentSessionHistory */
.sess-page {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 20px 20px;
}
</style>
