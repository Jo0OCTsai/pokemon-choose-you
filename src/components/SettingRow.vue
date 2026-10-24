<script setup lang="ts">
/**
 * 设置行：左侧标签（说明悬浮气泡）、右侧控件贴右缘垂直居中。
 * 说明文字悬浮气泡归属（标签内联 / label data-tip / 卡标题 data-tip）见
 * DESIGN_SYSTEM.md §4.4；本组件承载前两层，卡片级说明由页面挂到卡标题 data-tip。
 */
defineProps<{
  /** 标签：只写名字，一行以内 */
  label: string;
  /** 行内说明：悬浮标签时气泡展示，可省略 */
  desc?: string;
  /** 文本输入类控件加 wide，占满标签右侧整行（默认控件按内容宽） */
  wide?: boolean;
  /** 控件列左缘钉在指定像素处（标签列定宽），用于与上方其他控件的左缘对齐 */
  labelWidth?: number;
}>();
</script>

<template>
  <div class="set-row" :class="{ wide }" :style="labelWidth ? { gap: '0px' } : undefined">
    <div class="set-text" :style="labelWidth ? { flex: `0 0 ${labelWidth}px`, paddingRight: '12px' } : undefined">
      <span class="set-label" :data-tip="desc || undefined">{{ label }}<slot name="label-extra" /></span>
    </div>
    <div class="set-control" :style="labelWidth ? { margin: '0 auto 0 0' } : undefined">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.set-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 10px;
}
.set-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.set-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  line-height: 1.5;
}
/* 标签行内附加内容（如时间制式预览）：软色小字缀在标签右侧 */
.set-label :deep(.row-preview) {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 400;
  color: var(--ink-soft);
}
.set-control {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
}
/* 槽内文本输入统一控件级质感；slot 内容属父作用域，需 :deep 命中 */
.set-control :deep(input) {
  width: 200px;
  max-width: 100%;
  padding: 8px 10px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  min-height: 38px;
  box-shadow: 3px 3px 0 var(--dex-navy);
}
/* 附加参数 / 工作目录 / 历史参数这类长文本输入：输入框占满标签右侧整行；
   空间不足时说明文字先折行让位，输入框最低 320px */
.set-row.wide .set-control {
  flex: 1 1 320px;
}
.set-row.wide .set-control :deep(input) {
  width: 100%;
}
</style>
