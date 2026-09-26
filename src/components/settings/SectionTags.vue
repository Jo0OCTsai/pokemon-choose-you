<script setup lang="ts">
import { inject } from "vue";
import { ACTION_TOAST } from "../../composables/useActionToast";
import { useAgentsStore } from "../../stores/agents";
import TagDispatchCard from "../TagDispatchCard.vue";
import DimensionsCard from "./DimensionsCard.vue";
import TagsManagerCard from "./TagsManagerCard.vue";

/**
 * 「标签」分区壳（自 SettingsTab 拆出）：标签管理 / 项目派发配置 / 维度管理三段。
 * 编辑缓冲 editingTags/editingDims 由父级 SettingsTab 持有（懒加载 watch 的 !length 守卫
 * 依赖缓冲跨分区存活以保留未保存的行内编辑），经 props 下发、reload 回调重拉。
 */
defineProps<{
  editingTags: { id: number; name: string; description: string; dimension: string }[];
  editingDims: { id: number; key: string; name: string; maxTags: number; enabled: boolean }[];
  reloadTags: () => void;
  reloadDims: () => void;
}>();

const agentsStore = useAgentsStore();
const { flash } = inject(ACTION_TOAST)!;

// ---- project 标签的派发配置：整卡抽到 TagDispatchCard（agent / 工作目录 / 项目上下文） ----
/** 卡片内保存结果借用页面底部状态条反馈 */
function onDispatchFeedback(msg: string) {
  flash(msg);
}
</script>

<template>
  <TagsManagerCard :rows="editingTags" :reload="reloadTags" />
  <TagDispatchCard :agents="agentsStore.list" @feedback="onDispatchFeedback" />
  <DimensionsCard :rows="editingDims" :reload-tags="reloadTags" :reload-dims="reloadDims" />
</template>
