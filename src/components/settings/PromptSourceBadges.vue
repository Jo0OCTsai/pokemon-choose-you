<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { PromptSpecInfo } from "../../types";

/**
 * 折叠头徽章组（UIUX §3）：未保存 / ⚠ 不可用（default_warned）/ 🔒 只读 / 来源
 * （自定义黄底 or 内置默认白底）。保存/恢复成功瞬间来源徽章弹现（--t-pop 150ms；
 * reduce-motion 全局规则降级为仅换色）。
 */
const props = defineProps<{ spec: PromptSpecInfo; dirty: boolean }>();
const { t } = useI18n();

/** 保存/恢复成功瞬间徽章弹现 */
const badgePop = ref(false);
watch(
  () => props.spec.source,
  () => {
    badgePop.value = true;
    setTimeout(() => (badgePop.value = false), 400);
  },
);
</script>

<template>
  <span class="panel-badges">
    <span v-if="dirty" class="badge b-unsaved">{{ t("prompts.badgeUnsaved") }}</span>
    <span v-if="spec.source === 'default_warned'" class="badge b-warn">{{ t("prompts.badgeWarn") }}</span>
    <span v-if="!spec.editable" class="badge b-readonly">{{ t("prompts.badgeReadonly") }}</span>
    <span v-else class="badge" :class="[spec.source === 'custom' ? 'b-custom' : 'b-default', { pop: badgePop }]">
      {{ spec.source === "custom" ? t("prompts.badgeCustom") : t("prompts.badgeDefault") }}
    </span>
  </span>
</template>

<style scoped>
.panel-badges {
  margin-left: auto;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

/* 徽章（复用全局 .badge 小件级；来源/警示/只读/未saved 的语义配色） */
.badge.b-default {
  background: #fff;
  color: var(--dex-navy);
}
.badge.b-custom {
  background: var(--poke-yellow);
  color: var(--dex-navy);
}
.badge.b-unsaved {
  background: var(--hover);
  color: var(--warn-ink);
  border-color: var(--warn-ink);
  box-shadow: 2px 2px 0 var(--warn-ink);
}
.badge.b-warn {
  background: var(--warn-soft);
  color: var(--warn-ink);
  border-color: var(--warn-ink);
  box-shadow: 2px 2px 0 var(--warn-ink);
}
.badge.b-readonly {
  background: var(--dex-body);
  color: var(--ink-soft);
  border-color: var(--ink-faint);
  box-shadow: 2px 2px 0 var(--ink-faint);
}
.badge.pop {
  animation: bpop var(--t-pop) var(--e-snap);
}
@keyframes bpop {
  0% {
    transform: scale(1);
  }
  60% {
    transform: scale(1.06);
  }
  100% {
    transform: scale(1);
  }
}

@media (max-width: 760px) {
  .panel-badges {
    margin-left: 22px;
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
