<script setup lang="ts">
import CategoriesCard from "./CategoriesCard.vue";
import DimensionsCard from "./DimensionsCard.vue";
import TagsManagerCard from "./TagsManagerCard.vue";

/**
 * 「分类与标签」分区壳（原 cats/tags 两分区合并）：任务词表一屏管理——
 * 分类（宝可梦换装）、标签、维度（项目派发路由 2026-09 移至「Agent」分区，这里纯管词表）。
 * 标签/维度编辑缓冲 editingTags/editingDims 由父级 SettingsTab 持有（懒加载 watch 的
 * !length 守卫依赖缓冲跨分区存活以保留未保存的行内编辑），经 props 下发、reload 回调重拉。
 */
defineProps<{
  editingTags: { id: number; name: string; description: string; dimension: string }[];
  editingDims: { id: number; key: string; name: string; maxTags: number; enabled: boolean }[];
  reloadTags: () => void;
  reloadDims: () => void;
}>();
</script>

<template>
  <CategoriesCard />
  <TagsManagerCard :rows="editingTags" :reload="reloadTags" />
  <DimensionsCard :rows="editingDims" :reload-tags="reloadTags" :reload-dims="reloadDims" />
</template>
