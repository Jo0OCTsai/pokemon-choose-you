<script setup lang="ts">
import { useI18n } from "vue-i18n";

/** 逃走原因码（可选）：帮助 AI 判重与提示词迭代，直接点「✕ 逃走」则不填原因 */
const ESCAPE_REASONS = ["duplicate", "not_task", "wrong_info", "noise", "outdated", "other"] as const;

const emit = defineEmits<{
  /** 选了原因码带码逃走；「直接逃走」不带码 */
  escape: [code?: string];
}>();

const { t } = useI18n();
</script>

<template>
  <!-- 逃走原因弹层（可选）：选原因码再逃走，帮 AI 越判越准 -->
  <div class="escape-pop">
    <div class="er-label">{{ t("im.escapeWhy") }}</div>
    <button v-for="code in ESCAPE_REASONS" :key="code" class="er-chip" @click="emit('escape', code)">
      {{ t(`im.escapeReasons.${code}`) }}
    </button>
    <button class="er-chip just" @click="emit('escape')">{{ t("im.justEscape") }}</button>
  </div>
</template>

<style scoped>
/* 逃走原因弹层：操作区贴着窗口底部，向下弹会超出窗口——改向上弹盖住详情；
   极矮窗口里限高内部滚动兜底 */
.escape-pop {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  z-index: 60;
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  box-shadow: 4px 4px 0 var(--dex-navy);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 200px;
  max-height: min(320px, 60vh);
  overflow-y: auto;
}
.escape-pop .er-label {
  font-size: 11px;
  font-weight: 800;
  color: var(--ink-soft);
  padding: 2px 6px 6px;
}
.er-chip {
  border: 2px solid var(--dex-navy);
  background: #fff;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 700;
  padding: 6px 10px;
  min-height: 32px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: var(--dex-navy);
  transition:
    background var(--t-tap),
    transform var(--t-tap);
}
.er-chip:hover {
  background: var(--hover);
}
.er-chip:active {
  transform: translate(1px, 1px);
}
.er-chip.just {
  border-style: dashed;
  color: var(--ink-soft);
}
</style>
