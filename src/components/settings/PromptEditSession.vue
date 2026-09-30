<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import { promptIssueLevel, type PromptPanelState } from "../../composables/usePromptEditor";
import { promptIssueText } from "./promptIssueText";

/**
 * 编辑会话块（UIUX §3/§4.1）：常驻警示条 + textarea + 字符计数 + 校验反馈区 + 保存/取消行。
 * 编辑缓冲由面板级 composable 自持（写入经 setDraft 路由）；焦点契约（UIUX §4.1）暴露
 * focusEditorTail（进编辑→textarea 光标置尾）与 insertAtCursor（chip 插入不抢焦），
 * 由宿主面板在模式转换/占位符插入时调用；保存/取消事件冒泡面板处理焦点回收。
 */
const props = defineProps<{ panel: PromptPanelState; featureName: string }>();
const emit = defineEmits<{ save: []; cancel: [] }>();
const { t } = useI18n();
const taRef = ref<HTMLTextAreaElement | null>(null);

/** textarea 双向绑定桥：panel 的编辑缓冲由 composable 自持（非单向 props 数据），
 * 写入经 setDraft 方法路由，模板不直接 v-model 改 prop 路径 */
const draftModel = computed({
  get: () => props.panel.draft,
  set: (v: string) => props.panel.setDraft(v),
});

/** 进编辑焦点：textarea 聚焦且光标置文本尾 */
function focusEditorTail() {
  const ta = taRef.value;
  if (ta) {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
}

/** 占位符 chip：插入光标处（替换选区），插入后焦点保持 textarea（不抢焦） */
function insertAtCursor(tok: string) {
  const p = props.panel;
  const ta = taRef.value;
  const pos = ta?.selectionStart ?? p.draft.length;
  const end = ta?.selectionEnd ?? pos;
  p.setDraft(p.draft.slice(0, pos) + tok + p.draft.slice(end));
  void nextTick(() => {
    ta?.focus();
    ta?.setSelectionRange(pos + tok.length, pos + tok.length);
  });
}

defineExpose({ focusEditorTail, insertAtCursor });
</script>

<template>
  <div class="edit-block">
    <p class="editor-warn">{{ t("prompts.editorWarn") }}</p>
    <textarea
      ref="taRef"
      v-model="draftModel"
      class="prompt-editor"
      spellcheck="false"
      :aria-label="t('prompts.editorAria', { feature: featureName })"
    ></textarea>
    <div class="editor-meta">
      <span class="counter" :class="{ hot: panel.charCount > panel.spec.lengthLimit }">
        {{ panel.charCount }} / {{ panel.spec.lengthLimit }}
      </span>
    </div>
    <div class="validation" aria-live="polite" role="status">
      <p v-for="(issue, i) in panel.issues" :key="i" class="v-item" :class="'v-' + promptIssueLevel(issue)">
        {{ promptIssueText(t, issue) }}
      </p>
    </div>
    <div class="act-row">
      <button class="btn ghost" type="button" :disabled="!panel.canSave" @click="emit('save')">
        {{ panel.saving ? t("prompts.saving") : t("prompts.save") }}
      </button>
      <button class="btn ghost" type="button" :disabled="panel.saving" @click="emit('cancel')">
        {{ t("prompts.cancel") }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 常驻警示条（协议句风险，SDD P1）——与面板警示行同款配色的 scoped 副本 */
.editor-warn {
  background: var(--warn-soft);
  color: var(--warn-ink);
  border: 2px solid var(--warn-ink);
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 12px;
  line-height: 1.7;
  margin: 10px 0 0;
}

/* 编辑器：白纸材质（等宽 13px / min-height 240px / resize vertical） */
.prompt-editor {
  width: 100%;
  margin-top: 8px;
  padding: 8px 10px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-family: monospace;
  font-size: 13px;
  line-height: 1.7;
  resize: vertical;
  min-height: 240px;
  min-width: 0;
  box-shadow: 3px 3px 0 var(--dex-navy);
  background: #fff;
  color: var(--ink);
}
.editor-meta {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}
.counter {
  font-family: monospace;
  font-size: 11px;
  color: var(--ink-soft);
}
.counter.hot {
  color: var(--warn-ink);
  font-weight: 700;
}

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

/* 校验反馈区：底色纯白 + 阻断字 --dex-red-dark（描边 --danger）、警告黄、中性灰 */
.validation {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
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
