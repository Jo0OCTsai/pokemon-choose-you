<script setup lang="ts">
import { useI18n } from "vue-i18n";

/**
 * LCD 查看屏（UIUX §3/§6「机器屏幕读文本」）：variant="view" = 生效标签 + 悬停复制钮 +
 * 当前生效文本屏（复制事件冒泡宿主面板，剪贴板与 toast 反馈留在面板层）；variant="ref" =
 * 内置默认对照屏（无生效标签与复制钮，以区标题标识）。
 */
defineProps<{
  /** 标签行文案（查看屏 = 生效标签；对照屏 = 区标题） */
  label: string;
  /** 屏内呈现文本（生效文本 / 内置默认） */
  text: string;
  variant: "view" | "ref";
  /** 是否带悬停复制钮（仅查看屏） */
  copyable?: boolean;
}>();
const emit = defineEmits<{ copy: [] }>();
const { t } = useI18n();
</script>

<template>
  <p :class="variant === 'view' ? 'lcd-tag' : 'ref-title'">{{ label }}</p>
  <div v-if="copyable" class="lcd-wrap">
    <button class="lcd-copy" :title="t('prompts.copyAll')" :aria-label="t('prompts.copyAll')" @click="emit('copy')">
      ⧉ {{ t("prompts.copyAll") }}
    </button>
    <div class="lcd view-lcd">{{ text }}</div>
  </div>
  <div v-else class="lcd view-lcd">{{ text }}</div>
</template>

<style scoped>
/* 查看屏：LCD 三件套 + 内滚动（LogViewer 同款）+ 生效标签 */
.lcd-tag {
  margin: 10px 0 4px;
  font-size: 11px;
  font-weight: 700;
  color: var(--ink-soft);
  letter-spacing: 0.04em;
}
.lcd-wrap {
  position: relative;
}
.view-lcd {
  max-height: 320px;
  overflow-y: auto;
  padding: 10px 12px;
  font-family: monospace;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}
.lcd-copy {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  opacity: 0;
  border: 2px solid var(--lcd-text);
  border-radius: 4px;
  background: transparent;
  color: var(--lcd-text);
  font-size: 11px;
  padding: 4px 8px;
  line-height: 1;
  min-height: 32px;
  cursor: pointer;
  font-family: inherit;
}
.lcd-wrap:hover .lcd-copy,
.lcd-copy:focus-visible {
  opacity: 0.85;
}
.lcd-copy:hover {
  opacity: 1;
  background: var(--lcd-text);
  color: var(--lcd);
}

/* 对照屏区标题（无生效标签，以区标题标识） */
.ref-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--ink-soft);
  margin: 0 0 6px;
}
</style>
