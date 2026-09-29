<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { promptIssueLevel, type PromptPanelState } from "../../composables/usePromptEditor";
import { promptIssueText } from "./promptIssueText";

/**
 * 查看态底部区（UIUX §4.1）：恢复默认两步确认条（原位替换操作行）+ 操作行（编辑 /
 * 恢复默认… / 内置默认对照）+ 保存/恢复成功提示行（4s 自隐）+ 查看态遗留问题行
 * （未知占位符 / 保存失败）。焦点契约暴露 focusEditButton / focusRestoreButton /
 * focusConfirmPrimary，由宿主面板在状态转换后调用（§4.1：确认条→焦点入主动作；
 * 收起→回「恢复默认…」；成功/取消→回「编辑」）；按钮事件全部冒泡面板编排。
 */
const props = defineProps<{ panel: PromptPanelState; featureName: string; refOpen: boolean }>();
const emit = defineEmits<{
  edit: [];
  restore: [];
  compare: [];
  confirmRestore: [];
  cancelRestore: [];
}>();
const { t } = useI18n();

const editBtnRef = ref<HTMLButtonElement | null>(null);
const restoreBtnRef = ref<HTMLButtonElement | null>(null);
const confirmOkRef = ref<HTMLButtonElement | null>(null);

function focusEditButton() {
  editBtnRef.value?.focus();
}
function focusRestoreButton() {
  restoreBtnRef.value?.focus();
}
function focusConfirmPrimary() {
  confirmOkRef.value?.focus();
}
defineExpose({ focusEditButton, focusRestoreButton, focusConfirmPrimary });

/** 查看态呈现的问题（编辑期预校验项只在编辑态的校验区出现） */
const viewIssues = computed(() => props.panel.issues.filter((i) => i.kind === "unknown" || i.kind === "saveFailed"));
</script>

<template>
  <!-- 查看态操作行 / 恢复默认两步确认条（原位替换） -->
  <div v-if="panel.confirming" class="confirm-bar" role="group" :aria-label="t('prompts.confirmAria')">
    <span>{{ t("prompts.confirmText") }}</span>
    <button
      ref="confirmOkRef"
      class="btn confirm-primary"
      type="button"
      :disabled="panel.saving"
      @click="emit('confirmRestore')"
    >
      {{ t("prompts.confirmOk") }}
    </button>
    <button class="btn ghost" type="button" :disabled="panel.saving" @click="emit('cancelRestore')">
      {{ t("prompts.cancel") }}
    </button>
  </div>
  <div v-else class="act-row">
    <button v-if="panel.spec.editable" ref="editBtnRef" class="btn ghost" type="button" @click="emit('edit')">
      {{ t("prompts.edit") }}
    </button>
    <button v-if="panel.hasOverride" ref="restoreBtnRef" class="btn ghost" type="button" @click="emit('restore')">
      {{ t("prompts.restore") }}
    </button>
    <button
      v-if="panel.spec.source !== 'default'"
      class="btn ghost"
      type="button"
      :aria-expanded="refOpen"
      @click="emit('compare')"
    >
      {{ t("prompts.compare") }}
    </button>
  </div>
  <!-- 保存/恢复成功提示行（4s 自隐）与查看态遗留警告（未知占位符 / 保存失败） -->
  <p v-if="panel.hint === 'saved'" class="ok-line">{{ t("prompts.savedHint", { feature: featureName }) }}</p>
  <p v-if="panel.hint === 'restored'" class="ok-line">{{ t("prompts.restoredHint") }}</p>
  <p v-for="(issue, i) in viewIssues" :key="i" class="v-item standalone" :class="'v-' + promptIssueLevel(issue)">
    {{ promptIssueText(t, issue) }}
  </p>
</template>

<style scoped>
/* 操作行（.btn 通用类 scoped 副本先例；en 长文案 flex-wrap） */
.act-row {
  display: flex;
  gap: 10px;
  margin-top: 10px;
  flex-wrap: wrap;
  align-items: center;
}
.act-row .btn {
  padding: 6px 12px;
  min-height: 38px;
  font-size: 13px;
  box-shadow: 3px 3px 0 var(--dex-navy);
}

/* 确认条（en 长文案 flex-wrap） */
.confirm-bar {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 10px;
  background: var(--warn-soft);
  border: 2px solid var(--warn-ink);
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--warn-ink);
}
.confirm-bar .btn {
  min-height: 32px;
  padding: 4px 10px;
  font-size: 12px;
  box-shadow: 2px 2px 0 var(--dex-navy);
}
/* 主动作黄底强调（与次动作「取消」视觉权重分离，防误触反序） */
.confirm-bar .btn.confirm-primary {
  background: var(--poke-yellow);
  font-weight: 800;
}
.confirm-bar .btn.confirm-primary:hover:not(:disabled) {
  background: var(--poke-yellow);
}

/* 成功提示行 / 查看态遗留问题行（与编辑校验区同款分级的 scoped 副本） */
.ok-line {
  margin: 6px 0 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--ok-ink);
  animation: vin var(--t-pop);
}
.v-item {
  font-size: 12px;
  line-height: 1.7;
  padding: 5px 10px;
  border-radius: 4px;
  border: 2px solid transparent;
  background: #fff;
  margin: 0;
  animation: vin var(--t-pop);
}
.v-item.standalone {
  margin-top: 6px;
}
@keyframes vin {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.v-block {
  border-color: var(--danger);
  color: var(--dex-red-dark);
  font-weight: 700;
}
.v-warn {
  background: var(--warn-soft);
  border-color: var(--warn-ink);
  color: var(--warn-ink);
}
.v-info {
  color: var(--ink-soft);
}
</style>
