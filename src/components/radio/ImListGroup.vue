<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

/**
 * 电波折叠分组：组头（标题 / 计数徽标 / 右侧状态文字 / actions 插槽）+ 折叠 body（默认插槽）。
 * 时间模式四分区与频道模式分组共用；折叠状态由 RadioTab 集中管理。
 */
const props = defineProps<{
  /** 组头标题文本（频道组自带 📡 前缀） */
  title: string;
  /** 组头按钮的原生 title 提示（无信号分区点明「未经人工确认」边界） */
  headTitle?: string;
  /** 计数徽标文本（频道组传「n 条待审」文案） */
  count: string | number;
  /** 计数徽标高亮（有待处理信号） */
  countHot?: boolean;
  /** 右侧状态文字；缺省按折叠态显示「展开 / 收起」（频道组传会话总数） */
  stateLabel?: string;
  /** 是否收起 */
  collapsed: boolean;
  /** 已处理分区沿用 CSS 折叠（body 常驻 DOM，靠 .list-group.collapsed 隐藏）；待处理分区 v-if 卸载 */
  cssCollapse?: boolean;
  /** data-group 标识（分区定位用，频道组无） */
  dataGroup?: string;
}>();

const emit = defineEmits<{ toggle: [] }>();

const { t } = useI18n();

const stateText = computed(() => props.stateLabel ?? (props.collapsed ? t("im.expand") : t("im.collapse")));
</script>

<template>
  <section class="list-group" :class="{ collapsed: cssCollapse && collapsed }" :data-group="dataGroup">
    <button type="button" class="lg-head" :title="headTitle" @click="emit('toggle')">
      <span class="lg-caret">{{ collapsed ? "▸" : "▾" }}</span>
      {{ title }}
      <span class="lg-count" :class="{ hot: countHot }">{{ count }}</span>
      <span class="lg-state">{{ stateText }}</span>
      <slot name="actions"></slot>
    </button>
    <div v-if="cssCollapse || !collapsed" class="lg-body">
      <slot></slot>
    </div>
  </section>
</template>

<style scoped>
/* 相邻分组间距（本组件根节点即 .list-group，兄弟选择器作用于相邻实例的根） */
.list-group + .list-group {
  margin-top: 6px;
}
.list-group.collapsed .lg-body {
  display: none;
}
.lg-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  font-size: 12px;
  font-weight: 800;
  padding: 6px;
  cursor: pointer;
  user-select: none;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: var(--dex-navy);
  font-family: inherit;
  text-align: left;
}
.lg-head:hover {
  background: var(--hover);
}
.lg-caret {
  font-size: 10px;
  width: 12px;
  flex: none;
}
.lg-count {
  font-size: 11px;
  background: var(--dex-navy);
  color: #fff;
  border-radius: 4px;
  padding: 1px 5px;
}
.lg-count.hot {
  background: var(--danger);
}
.lg-state {
  margin-left: auto;
  font-size: 11px;
  color: var(--ink-soft);
  font-weight: 700;
}
</style>
