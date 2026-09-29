<script setup lang="ts">
import { useI18n } from "vue-i18n";

/**
 * 占位符行（UIUX §3，面板级常驻：查看态与编辑态都渲染，不随模式切换隐藏；空集由
 * 宿主不渲染本行）。编辑态缺失的占位符 chip 标红（missing 集由宿主从编辑缓冲推导）；
 * 点击 chip 经 insert 事件冒泡宿主路由到编辑会话插入光标处（非编辑态宿主忽略）。
 */
defineProps<{
  /** 必要占位符全集（spec.requiredPlaceholders） */
  tokens: string[];
  /** 编辑缓冲中缺失的占位符（仅编辑态非空；查看态不标红） */
  missing: string[];
}>();
const emit = defineEmits<{ insert: [tok: string] }>();
const { t } = useI18n();
</script>

<template>
  <div class="ph-row">
    <div class="ph-text">
      <span class="ph-label">{{ t("prompts.phLabel") }}</span>
      <span class="ph-desc">{{ t("prompts.phDesc") }}</span>
    </div>
    <div class="ph-chips">
      <button
        v-for="tok in tokens"
        :key="tok"
        class="chip"
        :class="{ missing: missing.includes(tok) }"
        type="button"
        @click="emit('insert', tok)"
      >
        {{ tok }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 占位符 chips 行 */
.ph-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.ph-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 96px;
}
.ph-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
}
.ph-desc {
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.55;
}
.ph-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}
.chip {
  border: 2px solid var(--dex-navy);
  border-radius: 4px;
  box-shadow: 2px 2px 0 var(--dex-navy);
  background: #fff;
  color: var(--dex-navy);
  font-family: monospace;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  min-height: 28px;
  cursor: pointer;
  transition:
    transform var(--t-tap),
    box-shadow var(--t-tap),
    background var(--t-tap);
}
.chip:hover {
  background: var(--hover);
}
.chip:active {
  transform: translate(1px, 1px);
  box-shadow: 1px 1px 0 var(--dex-navy);
}
/* 缺失签名态：白底 + --dex-red-dark（白底 ≥6:1，不引入非 token 软红底） */
.chip.missing {
  border-color: var(--dex-red-dark);
  color: var(--dex-red-dark);
  box-shadow: 2px 2px 0 var(--dex-red-dark);
}
</style>
